const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');

const MIGRATIONS = [{
  version: 1,
  sql: `
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      name TEXT NOT NULL, adapter_id TEXT NOT NULL, cli TEXT NOT NULL, cli_version TEXT NOT NULL,
      cwd TEXT NOT NULL, origin TEXT NOT NULL CHECK(origin IN ('user', 'orchestrator')),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE agent_runs (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
      state TEXT NOT NULL CHECK(state IN ('running', 'succeeded', 'failed', 'lost')),
      version INTEGER NOT NULL DEFAULT 1, started_at TEXT NOT NULL, ended_at TEXT,
      exit_code INTEGER, signal INTEGER, reason TEXT,
      CHECK((state = 'running' AND ended_at IS NULL) OR (state != 'running' AND ended_at IS NOT NULL))
    ) STRICT;
    CREATE UNIQUE INDEX one_active_run_per_session ON agent_runs(session_id) WHERE state = 'running';
    CREATE TABLE audit_events (
      sequence INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL REFERENCES projects(id), session_id TEXT REFERENCES sessions(id),
      run_id TEXT REFERENCES agent_runs(id), type TEXT NOT NULL,
      correlation_id TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX sessions_by_project ON sessions(project_id, created_at);
    CREATE INDEX runs_by_session ON agent_runs(session_id, started_at);
    CREATE INDEX events_by_project ON audit_events(project_id, sequence);
  `,
}];

function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function migrate(db, migrations = MIGRATIONS) {
  return transaction(db, () => {
    const current = db.prepare('PRAGMA user_version').get().user_version;
    const latest = migrations.at(-1)?.version || 0;
    if (current > latest) throw new Error('Banco ATLAS de versão futura. Atualize o aplicativo; os dados foram preservados.');
    if (migrations.some((item, index) => item.version !== index + 1)) throw new Error('Sequência de migrations inválida.');
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT');
    for (const migration of migrations) {
      if (migration.version <= current) continue;
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(migration.version, new Date().toISOString());
      db.exec(`PRAGMA user_version = ${migration.version}`);
    }
    return latest;
  });
}

function createOperationalStore({ filename, now = () => new Date().toISOString() }) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename, { timeout: 1000, enableForeignKeyConstraints: true, allowExtension: false });
  let closed = false;
  let backups = 0;
  try {
    migrate(db);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL');
  } catch (error) {
    db.close();
    throw error;
  }

  function event({ projectId, sessionId = null, runId = null, type, payload = {}, at = now() }) {
    db.prepare(`INSERT INTO audit_events
      (id, project_id, session_id, run_id, type, correlation_id, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      randomUUID(), projectId, sessionId, runId, type, runId || sessionId || projectId, JSON.stringify(payload), at,
    );
  }

  function finishRun({ runId, expectedVersion, exitCode, signal = null }) {
    if (!Number.isInteger(exitCode) || (signal !== null && !Number.isInteger(signal))) throw new Error('Saída de processo inválida.');
    return transaction(db, () => {
      const run = db.prepare(`SELECT r.*, s.project_id FROM agent_runs r JOIN sessions s ON s.id = r.session_id WHERE r.id = ?`).get(runId);
      if (!run) throw new Error('Run não encontrada.');
      if (run.state !== 'running') {
        if (run.exit_code === exitCode && run.signal === signal) return false;
        throw new Error('Run já encerrada com outro resultado.');
      }
      if (run.version !== expectedVersion) throw new Error('Versão da run em conflito.');
      const at = now();
      const state = exitCode === 0 && !signal ? 'succeeded' : 'failed';
      db.prepare(`UPDATE agent_runs SET state = ?, version = version + 1, ended_at = ?, exit_code = ?, signal = ? WHERE id = ?`).run(state, at, exitCode, signal, runId);
      event({ projectId: run.project_id, sessionId: run.session_id, runId, type: `run.${state}`, payload: { exitCode, signal }, at });
      return true;
    });
  }

  return {
    registerProject({ id, name, path: projectPath }) {
      return transaction(db, () => {
        const previous = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
        if (previous && previous.path !== projectPath) throw new Error('Identidade de projeto já vinculada a outro caminho.');
        if (previous?.name === name) return;
        const at = now();
        db.prepare(`INSERT INTO projects VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`).run(id, name, projectPath, at, at);
        event({ projectId: id, type: previous ? 'project.updated' : 'project.registered', at });
      });
    },
    startSession({ id, projectId, name, adapterId, cli, version, cwd, origin, createdAt }) {
      return transaction(db, () => {
        const runId = randomUUID();
        db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, projectId, name, adapterId, cli, version, cwd, origin, createdAt);
        db.prepare(`INSERT INTO agent_runs (id, session_id, state, started_at) VALUES (?, ?, 'running', ?)`).run(runId, id, createdAt);
        event({ projectId, sessionId: id, runId, type: 'session.created', at: createdAt });
        event({ projectId, sessionId: id, runId, type: 'run.started', at: createdAt });
        return { id: runId, version: 1 };
      });
    },
    finishRun,
    reconcileRuns(reason = 'application_restarted') {
      return transaction(db, () => {
        const active = db.prepare(`SELECT r.id, r.session_id, s.project_id FROM agent_runs r JOIN sessions s ON s.id = r.session_id WHERE r.state = 'running'`).all();
        const at = now();
        for (const run of active) {
          db.prepare(`UPDATE agent_runs SET state = 'lost', version = version + 1, ended_at = ?, reason = ? WHERE id = ?`).run(at, reason, run.id);
          event({ projectId: run.project_id, sessionId: run.session_id, runId: run.id, type: 'run.lost', payload: { reason }, at });
        }
        return active.length;
      });
    },
    listProjects: () => db.prepare('SELECT * FROM projects ORDER BY created_at, id').all(),
    listSessions: (projectId) => db.prepare('SELECT * FROM sessions WHERE project_id = ? ORDER BY created_at, id').all(projectId),
    listRuns: (projectId) => db.prepare(`SELECT r.* FROM agent_runs r JOIN sessions s ON s.id = r.session_id WHERE s.project_id = ? ORDER BY r.started_at, r.id`).all(projectId),
    listEvents: (projectId) => db.prepare('SELECT * FROM audit_events WHERE project_id = ? ORDER BY sequence').all(projectId).map((row) => ({ ...row, payload: JSON.parse(row.payload) })),
    async backupTo(destination) {
      if (closed) throw new Error('Banco fechado.');
      if (path.resolve(destination) === path.resolve(filename)) throw new Error('Backup deve usar outro caminho.');
      // Reserve the destination so backup never overwrites an existing file.
      const descriptor = fs.openSync(destination, 'wx');
      fs.closeSync(descriptor);
      backups += 1;
      try {
        return await backup(db, destination);
      } finally {
        backups -= 1;
      }
    },
    close() {
      if (closed) return;
      if (backups) throw new Error('Backup em andamento.');
      db.close();
      closed = true;
    },
    get closed() { return closed; },
  };
}

function closeOperationalStore(store, onError = console.error) {
  if (!store || store.closed) return;
  try {
    store.reconcileRuns('application_closed');
  } catch (error) {
    // Leave active rows for reconciliation on next startup if this write fails.
    onError(error);
  } finally {
    store.close();
  }
}

module.exports = { createOperationalStore, closeOperationalStore, migrate, MIGRATIONS };
