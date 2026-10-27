const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');
const { createTaskDelegation } = require('./task-delegation.cjs');
const { createTaskReview } = require('./task-review.cjs');

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
}, {
  version: 2,
  sql: `
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
      description TEXT NOT NULL CHECK(length(description) <= 8000),
      acceptance TEXT NOT NULL CHECK(length(acceptance) BETWEEN 1 AND 4000),
      state TEXT NOT NULL DEFAULT 'backlog' CHECK(state IN ('backlog', 'ready', 'in_progress', 'in_review', 'done', 'blocked', 'canceled')),
      version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX tasks_by_project ON tasks(project_id, created_at);
    CREATE TABLE commands (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      command_type TEXT NOT NULL, target_id TEXT NOT NULL,
      payload TEXT NOT NULL CHECK(json_valid(payload)), payload_hash TEXT NOT NULL,
      idempotency_key TEXT NOT NULL, status TEXT NOT NULL,
      created_by TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT,
      result TEXT NOT NULL CHECK(json_valid(result)), correlation_id TEXT NOT NULL,
      UNIQUE(project_id, idempotency_key)
    ) STRICT;
  `,
}, {
  version: 3,
  sql: `
    ALTER TABLE sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'agent' CHECK(role IN ('agent', 'orchestrator'));
    CREATE UNIQUE INDEX one_orchestrator_per_project ON sessions(project_id) WHERE role = 'orchestrator';
    ALTER TABLE agent_runs ADD COLUMN cli_version TEXT;
    ALTER TABLE agent_runs ADD COLUMN cwd TEXT;
    ALTER TABLE agent_runs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1;
    CREATE UNIQUE INDEX run_attempt_per_session ON agent_runs(session_id, attempt);
    UPDATE agent_runs SET cli_version = (SELECT cli_version FROM sessions WHERE sessions.id = agent_runs.session_id), cwd = (SELECT cwd FROM sessions WHERE sessions.id = agent_runs.session_id);
  `,
}, {
  version: 4,
  sql: `
    CREATE TABLE messages (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      from_session_id TEXT NOT NULL REFERENCES sessions(id),
      to_session_id TEXT NOT NULL REFERENCES sessions(id),
      kind TEXT NOT NULL CHECK(kind IN ('discovery', 'note')),
      subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 160),
      body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX messages_by_project ON messages(project_id, created_at);
    CREATE TABLE message_deliveries (
      message_id TEXT NOT NULL REFERENCES messages(id),
      session_id TEXT NOT NULL REFERENCES sessions(id),
      read_at TEXT,
      PRIMARY KEY (message_id, session_id)
    ) STRICT;
    CREATE INDEX deliveries_unread ON message_deliveries(session_id) WHERE read_at IS NULL;
  `,
}, {
  version: 5,
  sql: `
    CREATE TABLE agent_requests (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      requested_by TEXT NOT NULL REFERENCES sessions(id),
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
      purpose TEXT NOT NULL CHECK(length(purpose) BETWEEN 1 AND 1000),
      payload_hash TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending', 'approved', 'rejected', 'expired', 'fulfilled', 'failed')),
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      resolved_at TEXT, resolved_by TEXT, session_id TEXT REFERENCES sessions(id), error TEXT,
      version INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX agent_requests_by_project ON agent_requests(project_id, created_at);
  `,
}, {
  version: 6,
  sql: `
    ALTER TABLE tasks ADD COLUMN assigned_session_id TEXT REFERENCES sessions(id);
    ALTER TABLE tasks ADD COLUMN claim_run_id TEXT REFERENCES agent_runs(id);
    ALTER TABLE tasks ADD COLUMN claim_epoch INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE tasks ADD COLUMN blocked_reason TEXT;
    CREATE TABLE handoffs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      task_id TEXT NOT NULL REFERENCES tasks(id),
      from_session_id TEXT NOT NULL REFERENCES sessions(id),
      to_session_id TEXT NOT NULL REFERENCES sessions(id),
      objective TEXT NOT NULL CHECK(length(objective) BETWEEN 1 AND 2000),
      context TEXT NOT NULL CHECK(length(context) <= 4000),
      next_steps TEXT NOT NULL CHECK(length(next_steps) <= 2000),
      state TEXT NOT NULL CHECK(state IN ('offered', 'accepted', 'rejected', 'canceled')),
      created_at TEXT NOT NULL, resolved_at TEXT, resolved_by TEXT, reason TEXT,
      version INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX handoffs_by_project ON handoffs(project_id, created_at);
    CREATE UNIQUE INDEX one_open_handoff_per_task ON handoffs(task_id) WHERE state = 'offered';
    CREATE INDEX tasks_by_claim_run ON tasks(claim_run_id) WHERE claim_run_id IS NOT NULL;
  `,
}, {
  version: 7,
  sql: `
    ALTER TABLE agent_requests ADD COLUMN task_id TEXT REFERENCES tasks(id);
    ALTER TABLE agent_requests ADD COLUMN use_worktree INTEGER NOT NULL DEFAULT 0 CHECK(use_worktree IN (0, 1));
    CREATE TABLE worktrees (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      task_id TEXT REFERENCES tasks(id), request_id TEXT REFERENCES agent_requests(id),
      repository_path TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
      branch TEXT NOT NULL, base_commit TEXT NOT NULL CHECK(length(base_commit) BETWEEN 7 AND 64),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX worktrees_by_project ON worktrees(project_id, created_at);
  `,
}, {
  version: 8,
  sql: `
    CREATE TABLE reviews (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      task_id TEXT NOT NULL REFERENCES tasks(id),
      requested_by TEXT NOT NULL REFERENCES sessions(id), run_id TEXT REFERENCES agent_runs(id),
      state TEXT NOT NULL CHECK(state IN ('pending', 'accepted', 'changes_requested')),
      summary TEXT NOT NULL CHECK(length(summary) BETWEEN 1 AND 2000),
      created_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT, note TEXT,
      version INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX reviews_by_project ON reviews(project_id, created_at);
    CREATE UNIQUE INDEX one_pending_review_per_task ON reviews(task_id) WHERE state = 'pending';
    CREATE TABLE evidence (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      task_id TEXT NOT NULL REFERENCES tasks(id), review_id TEXT REFERENCES reviews(id),
      kind TEXT NOT NULL CHECK(kind IN ('agent_report', 'git_snapshot')),
      source TEXT NOT NULL CHECK(source IN ('agent', 'system')),
      session_id TEXT REFERENCES sessions(id), run_id TEXT REFERENCES agent_runs(id),
      payload TEXT NOT NULL CHECK(json_valid(payload)), created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX evidence_by_project ON evidence(project_id, created_at);
  `,
}];

// Política padrão da v0.1 para pedidos de agente feitos pela sessão principal.
const AGENT_REQUEST_POLICY = Object.freeze({ maxPending: 3, ttlMs: 15 * 60 * 1000, maxActiveAgents: 2 });

function agentRequestPayload({ name, purpose, idempotencyKey, taskId, worktree = false }) {
  for (const [label, value, max] of [['Nome', name, 60], ['Propósito', purpose, 1000]]) {
    if (typeof value !== 'string' || value.length > max || !value.trim()) throw new Error(`${label}: informe texto válido com até ${max} caracteres.`);
  }
  // Texto do agente é exibido ao usuário: sem controles nem formatação invisível
  // (bidi, largura zero) que possam disfarçar o nome ou esconder conteúdo.
  if (/[\p{Cc}\p{Cf}]/u.test(name)) throw new Error('Nome: use somente caracteres visíveis, sem quebras de linha ou formatação invisível.');
  if (/\p{Cf}|[^\P{Cc}\n\t]/u.test(purpose)) throw new Error('Propósito: remova caracteres de controle ou formatação invisível.');
  if (typeof idempotencyKey !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(idempotencyKey)) throw new Error('Chave de idempotência inválida.');
  if (taskId !== undefined && taskId !== null && (typeof taskId !== 'string' || !taskId)) throw new Error('Tarefa inválida.');
  if (typeof worktree !== 'boolean') throw new Error('Indique worktree como verdadeiro ou falso.');
  if (worktree && !taskId) throw new Error('Worktree exige a tarefa a que o agente vai se dedicar.');
  // Campos novos entram no payload só quando usados: hashes de pedidos antigos não mudam.
  return { name: name.trim(), purpose: purpose.trim(), ...(taskId ? { taskId, worktree } : {}) };
}

// O nome do solicitante vem do banco: a interface pode ainda não ter carregado a sessão.
const AGENT_REQUEST_SELECT = `SELECT r.*, s.name AS requester_name, t.title AS task_title, w.path AS worktree_path, w.branch AS worktree_branch
  FROM agent_requests r
  LEFT JOIN sessions s ON s.id = r.requested_by
  LEFT JOIN tasks t ON t.id = r.task_id
  LEFT JOIN worktrees w ON w.request_id = r.id`;

function agentRequestRow(row) {
  return row && {
    id: row.id, projectId: row.project_id, requestedBy: row.requested_by, requesterName: row.requester_name || null, name: row.name, purpose: row.purpose,
    payloadHash: row.payload_hash, state: row.state, createdAt: row.created_at, expiresAt: row.expires_at,
    resolvedAt: row.resolved_at, resolvedBy: row.resolved_by, sessionId: row.session_id, error: row.error, version: row.version,
    taskId: row.task_id || null, taskTitle: row.task_title || null, useWorktree: row.use_worktree === 1,
    worktree: row.worktree_path ? { path: row.worktree_path, branch: row.worktree_branch } : null,
  };
}

function taskPayload({ title, description = '', acceptance, idempotencyKey }) {
  for (const [label, value, max, required] of [
    ['Título', title, 160, true], ['Descrição', description, 8000, false], ['Critérios de aceite', acceptance, 4000, true],
  ]) {
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`${label}: informe texto válido com até ${max} caracteres.`);
  }
  if (typeof idempotencyKey !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(idempotencyKey)) throw new Error('Chave de idempotência inválida.');
  return { title: title.trim(), description: description.trim(), acceptance: acceptance.trim() };
}

function messagePayload({ kind = 'discovery', subject, body, idempotencyKey }) {
  if (!['discovery', 'note'].includes(kind)) throw new Error('Tipo de mensagem inválido.');
  for (const [label, value, max] of [['Assunto', subject, 160], ['Conteúdo', body, 4000]]) {
    if (typeof value !== 'string' || value.length > max || !value.trim()) throw new Error(`${label}: informe texto válido com até ${max} caracteres.`);
  }
  if (typeof idempotencyKey !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(idempotencyKey)) throw new Error('Chave de idempotência inválida.');
  return { kind, subject: subject.trim(), body: body.trim() };
}

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

  function expirePending(projectId, at) {
    for (const row of db.prepare("SELECT id, requested_by FROM agent_requests WHERE project_id = ? AND state = 'pending' AND expires_at <= ?").all(projectId, at)) {
      db.prepare("UPDATE agent_requests SET state = 'expired', resolved_at = ?, version = version + 1 WHERE id = ?").run(at, row.id);
      event({ projectId, sessionId: row.requested_by, type: 'approval.resolved', payload: { requestId: row.id, decision: 'expired' }, correlationId: row.id, at });
    }
  }

  function event({ projectId, sessionId = null, runId = null, type, payload = {}, at = now(), correlationId }) {
    db.prepare(`INSERT INTO audit_events
      (id, project_id, session_id, run_id, type, correlation_id, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      randomUUID(), projectId, sessionId, runId, type, correlationId || runId || sessionId || projectId, JSON.stringify(payload), at,
    );
  }

  const delegation = createTaskDelegation({ db, now, event, transaction });
  const { loseClaims, requireClaim, ...delegationApi } = delegation;
  const review = createTaskReview({ db, now, event, transaction, requireClaim, getTask: delegation.getTask });

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
      loseClaims(runId, at);
      return true;
    });
  }

  return {
    createTask(request) {
      const payload = taskPayload(request);
      const encoded = JSON.stringify(payload);
      const hash = createHash('sha256').update(encoded).digest('hex');
      return transaction(db, () => {
        const previous = db.prepare('SELECT payload_hash, result FROM commands WHERE project_id = ? AND idempotency_key = ?').get(request.projectId, request.idempotencyKey);
        if (previous) {
          if (previous.payload_hash !== hash) throw new Error('Chave de idempotência já usada com outro conteúdo.');
          return JSON.parse(previous.result);
        }
        const id = randomUUID();
        const commandId = randomUUID();
        const at = now();
        const task = { id, projectId: request.projectId, ...payload, state: 'backlog', version: 1, createdBy: 'user', createdAt: at, updatedAt: at, assignedSessionId: null, assigneeName: null, claimRunId: null, claimEpoch: 0, blockedReason: null };
        db.prepare('INSERT INTO tasks (id, project_id, title, description, acceptance, state, version, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, request.projectId, payload.title, payload.description, payload.acceptance, 'backlog', 1, 'user', at, at);
        db.prepare('INSERT INTO commands VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(commandId, request.projectId, 'task.create', id, encoded, hash, request.idempotencyKey, 'completed', 'user', at, at, JSON.stringify(task), commandId);
        event({ projectId: request.projectId, type: 'task.created', payload: { taskId: id }, correlationId: commandId, at });
        return task;
      });
    },
    ...delegationApi,
    ...review,
    sendMessage(request) {
      const payload = messagePayload(request);
      // Ator auditado do comando: o usuário pela interface ou a sessão de agente pela ponte MCP.
      const actor = request.actor ?? 'user';
      if (actor !== 'user' && !/^agent:[A-Za-z0-9-]{1,80}$/.test(actor)) throw new Error('Ator de mensagem inválido.');
      if (actor !== 'user' && actor !== `agent:${request.fromSessionId}`) throw new Error('A sessão de agente só envia mensagens em nome próprio.');
      if (request.fromSessionId === request.toSessionId) throw new Error('A sessão não pode enviar mensagem para si mesma.');
      const encoded = JSON.stringify({ ...payload, fromSessionId: request.fromSessionId, toSessionId: request.toSessionId });
      const hash = createHash('sha256').update(encoded).digest('hex');
      return transaction(db, () => {
        const previous = db.prepare('SELECT payload_hash, result FROM commands WHERE project_id = ? AND idempotency_key = ?').get(request.projectId, request.idempotencyKey);
        if (previous) {
          if (previous.payload_hash !== hash) throw new Error('Chave de idempotência já usada com outro conteúdo.');
          return JSON.parse(previous.result);
        }
        const findSession = db.prepare('SELECT id, name FROM sessions WHERE id = ? AND project_id = ?');
        const from = findSession.get(request.fromSessionId, request.projectId);
        const to = findSession.get(request.toSessionId, request.projectId);
        if (!from || !to) throw new Error('Remetente e destinatário devem ser sessões deste projeto.');
        const id = randomUUID();
        const commandId = randomUUID();
        const at = now();
        const message = { id, projectId: request.projectId, fromSessionId: from.id, toSessionId: to.id, ...payload, readAt: null, createdAt: at };
        db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, request.projectId, from.id, to.id, payload.kind, payload.subject, payload.body, at);
        db.prepare('INSERT INTO message_deliveries (message_id, session_id) VALUES (?, ?)').run(id, to.id);
        db.prepare('INSERT INTO commands VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(commandId, request.projectId, 'message.send', id, encoded, hash, request.idempotencyKey, 'completed', actor, at, at, JSON.stringify(message), commandId);
        event({ projectId: request.projectId, sessionId: to.id, type: 'message.sent', payload: { messageId: id, fromSessionId: from.id, kind: payload.kind, actor }, correlationId: commandId, at });
        return message;
      });
    },
    listMessages: (projectId) => db.prepare(`
      SELECT m.id, m.project_id AS projectId, m.from_session_id AS fromSessionId, m.to_session_id AS toSessionId,
        origin.name AS fromName, target.name AS toName, m.kind, m.subject, m.body,
        d.read_at AS readAt, m.created_at AS createdAt
      FROM messages m
      JOIN sessions origin ON origin.id = m.from_session_id
      JOIN sessions target ON target.id = m.to_session_id
      JOIN message_deliveries d ON d.message_id = m.id
      WHERE m.project_id = ? ORDER BY m.created_at, m.id`).all(projectId).map((row) => ({ ...row })),
    markMessageRead({ projectId, messageId, sessionId }) {
      return transaction(db, () => {
        const delivery = db.prepare(`
          SELECT d.read_at, m.project_id FROM message_deliveries d JOIN messages m ON m.id = d.message_id
          WHERE d.message_id = ? AND d.session_id = ? AND m.project_id = ?`).get(messageId, sessionId, projectId);
        if (!delivery) throw new Error('Mensagem não encontrada para esta sessão neste projeto.');
        if (delivery.read_at) return false;
        const at = now();
        db.prepare('UPDATE message_deliveries SET read_at = ? WHERE message_id = ? AND session_id = ?').run(at, messageId, sessionId);
        event({ projectId, sessionId, type: 'message.read', payload: { messageId }, at });
        return true;
      });
    },
    requestAgent(request) {
      const payload = agentRequestPayload(request);
      const policy = { ...AGENT_REQUEST_POLICY, ...(request.policy || {}) };
      const hash = createHash('sha256').update(JSON.stringify({ ...payload, projectId: request.projectId, requestedBy: request.requestedBy })).digest('hex');
      return transaction(db, () => {
        const previous = db.prepare('SELECT payload_hash, result FROM commands WHERE project_id = ? AND idempotency_key = ?').get(request.projectId, request.idempotencyKey);
        if (previous) {
          if (previous.payload_hash !== hash) throw new Error('Chave de idempotência já usada com outro conteúdo.');
          return agentRequestRow(db.prepare(`${AGENT_REQUEST_SELECT} WHERE r.id = ?`).get(JSON.parse(previous.result).id));
        }
        const requester = db.prepare('SELECT id, role FROM sessions WHERE id = ? AND project_id = ?').get(request.requestedBy, request.projectId);
        if (!requester) throw new Error('Sessão solicitante não pertence a este projeto.');
        if (requester.role !== 'orchestrator') throw new Error('Somente a sessão principal pode pedir novos agentes.');
        if (payload.taskId) {
          const task = db.prepare('SELECT state FROM tasks WHERE id = ? AND project_id = ?').get(payload.taskId, request.projectId);
          if (!task) throw new Error('Tarefa não encontrada neste projeto.');
          if (!['backlog', 'ready'].includes(task.state)) throw new Error(`A tarefa não está disponível para um novo agente (${task.state}).`);
          if (payload.worktree && db.prepare("SELECT 1 FROM agent_requests WHERE task_id = ? AND use_worktree = 1 AND state IN ('pending', 'approved', 'fulfilled')").get(payload.taskId)) {
            throw new Error('Esta tarefa já tem um pedido de agente com worktree.');
          }
          // Uma worktree registrada nunca é recriada nem reaproveitada automaticamente na v0.1.
          const existing = payload.worktree && db.prepare('SELECT path FROM worktrees WHERE task_id = ?').get(payload.taskId);
          if (existing) throw new Error(`Esta tarefa já tem uma worktree registrada em ${existing.path}. O ATLAS não a recria nem a remove; peça um agente sem worktree ou use outra tarefa.`);
        }
        const at = now();
        expirePending(request.projectId, at);
        const pending = db.prepare("SELECT count(*) AS total FROM agent_requests WHERE project_id = ? AND state = 'pending'").get(request.projectId).total;
        if (pending >= policy.maxPending) throw new Error(`Limite da política: já há ${pending} pedidos de agente aguardando o usuário.`);
        const id = randomUUID();
        const commandId = randomUUID();
        const expiresAt = new Date(Date.parse(at) + policy.ttlMs).toISOString();
        db.prepare('INSERT INTO agent_requests (id, project_id, requested_by, name, purpose, payload_hash, state, created_at, expires_at, version, task_id, use_worktree) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
          .run(id, request.projectId, requester.id, payload.name, payload.purpose, hash, 'pending', at, expiresAt, payload.taskId || null, payload.worktree ? 1 : 0);
        db.prepare('INSERT INTO commands VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(commandId, request.projectId, 'agent.request', id, JSON.stringify({ ...payload, requestedBy: requester.id }), hash, request.idempotencyKey, 'completed', `agent:${requester.id}`, at, at, JSON.stringify({ id }), commandId);
        event({ projectId: request.projectId, sessionId: requester.id, type: 'approval.requested', payload: { requestId: id, kind: 'agent.create', name: payload.name }, correlationId: commandId, at });
        return agentRequestRow(db.prepare(`${AGENT_REQUEST_SELECT} WHERE r.id = ?`).get(id));
      });
    },
    listAgentRequests(projectId) {
      transaction(db, () => expirePending(projectId, now()));
      return db.prepare(`${AGENT_REQUEST_SELECT} WHERE r.project_id = ? ORDER BY r.created_at, r.id`).all(projectId).map(agentRequestRow);
    },
    getAgentRequest(projectId, requestId) {
      transaction(db, () => expirePending(projectId, now()));
      return agentRequestRow(db.prepare(`${AGENT_REQUEST_SELECT} WHERE r.id = ? AND r.project_id = ?`).get(requestId, projectId));
    },
    // Aprovação vinculada ao payload exibido e à validade, verificada no momento da execução.
    approveAgentRequest({ projectId, requestId, payloadHash }) {
      return transaction(db, () => {
        const at = now();
        expirePending(projectId, at);
        const row = db.prepare('SELECT * FROM agent_requests WHERE id = ? AND project_id = ?').get(requestId, projectId);
        if (!row) throw new Error('Pedido de agente não encontrado neste projeto.');
        if (row.state === 'expired') throw new Error('O pedido expirou; peça à sessão principal que o refaça.');
        if (row.state !== 'pending') throw new Error(`O pedido já foi resolvido (${row.state}).`);
        if (row.payload_hash !== payloadHash) throw new Error('O conteúdo do pedido não corresponde ao que foi exibido para aprovação.');
        // A tarefa pode ter sido assumida ou encerrada durante a validade do pedido.
        if (row.task_id) {
          const task = db.prepare('SELECT state FROM tasks WHERE id = ?').get(row.task_id);
          if (!task || !['backlog', 'ready'].includes(task.state)) throw new Error(`A tarefa do pedido não está mais disponível (${task?.state || 'removida'}). Recuse o pedido.`);
        }
        db.prepare("UPDATE agent_requests SET state = 'approved', resolved_at = ?, resolved_by = 'user', version = version + 1 WHERE id = ?").run(at, requestId);
        event({ projectId, sessionId: row.requested_by, type: 'approval.resolved', payload: { requestId, decision: 'approved' }, correlationId: requestId, at });
        return agentRequestRow(db.prepare(`${AGENT_REQUEST_SELECT} WHERE r.id = ?`).get(requestId));
      });
    },
    rejectAgentRequest({ projectId, requestId }) {
      return transaction(db, () => {
        const at = now();
        expirePending(projectId, at);
        const row = db.prepare('SELECT * FROM agent_requests WHERE id = ? AND project_id = ?').get(requestId, projectId);
        if (!row) throw new Error('Pedido de agente não encontrado neste projeto.');
        if (row.state !== 'pending') throw new Error(`O pedido já foi resolvido (${row.state}).`);
        db.prepare("UPDATE agent_requests SET state = 'rejected', resolved_at = ?, resolved_by = 'user', version = version + 1 WHERE id = ?").run(at, requestId);
        event({ projectId, sessionId: row.requested_by, type: 'approval.resolved', payload: { requestId, decision: 'rejected' }, correlationId: requestId, at });
        return agentRequestRow(db.prepare(`${AGENT_REQUEST_SELECT} WHERE r.id = ?`).get(requestId));
      });
    },
    // Worktree criada na aprovação de um pedido; o registro acompanha tarefa e commit-base.
    recordWorktree({ projectId, requestId, taskId, repositoryPath, path: worktreePath, branch, baseCommit }) {
      return transaction(db, () => {
        const id = randomUUID();
        const at = now();
        db.prepare('INSERT INTO worktrees (id, project_id, task_id, request_id, repository_path, path, branch, base_commit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, projectId, taskId, requestId, repositoryPath, worktreePath, branch, baseCommit, at);
        event({ projectId, type: 'worktree.created', payload: { worktreeId: id, taskId, requestId, path: worktreePath, branch, baseCommit }, correlationId: requestId, at });
        return { id, projectId, taskId, requestId, repositoryPath, path: worktreePath, branch, baseCommit, createdAt: at };
      });
    },
    listWorktrees: (projectId) => db.prepare(`SELECT id, project_id AS projectId, task_id AS taskId, request_id AS requestId, repository_path AS repositoryPath,
      path, branch, base_commit AS baseCommit, created_at AS createdAt FROM worktrees WHERE project_id = ? ORDER BY created_at, id`).all(projectId).map((row) => ({ ...row })),
    completeAgentRequest({ projectId, requestId, sessionId = null, error = null }) {
      return transaction(db, () => {
        const row = db.prepare('SELECT * FROM agent_requests WHERE id = ? AND project_id = ?').get(requestId, projectId);
        if (!row || row.state !== 'approved') throw new Error('Somente pedidos aprovados podem ser concluídos.');
        const at = now();
        if (sessionId) {
          db.prepare("UPDATE agent_requests SET state = 'fulfilled', session_id = ?, version = version + 1 WHERE id = ?").run(sessionId, requestId);
          event({ projectId, sessionId, type: 'approval.fulfilled', payload: { requestId, origin: 'orchestrator', requestedBy: row.requested_by }, correlationId: requestId, at });
        } else {
          const reason = String(error || 'Falha desconhecida.').slice(0, 500);
          db.prepare("UPDATE agent_requests SET state = 'failed', error = ?, version = version + 1 WHERE id = ?").run(reason, requestId);
          event({ projectId, sessionId: row.requested_by, type: 'approval.failed', payload: { requestId, error: reason }, correlationId: requestId, at });
        }
        return agentRequestRow(db.prepare(`${AGENT_REQUEST_SELECT} WHERE r.id = ?`).get(requestId));
      });
    },
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
    getOrchestrator: (projectId) => db.prepare("SELECT * FROM sessions WHERE project_id = ? AND role = 'orchestrator'").get(projectId),
    startSession({ id, projectId, name, adapterId, cli, version, cwd, origin, createdAt, runStartedAt = createdAt, role = 'agent' }) {
      return transaction(db, () => {
        const runId = randomUUID();
        const attempt = db.prepare('SELECT coalesce(max(attempt), 0) + 1 AS next FROM agent_runs WHERE session_id = ?').get(id).next;
        const existing = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
        if (existing) {
          if (existing.role !== 'orchestrator' || role !== 'orchestrator' || existing.project_id !== projectId || existing.cwd !== cwd || existing.adapter_id !== adapterId) throw new Error('Identidade de sessão já existente.');
          db.prepare('UPDATE sessions SET cli_version = ? WHERE id = ?').run(version, id);
        } else {
          db.prepare('INSERT INTO sessions (id, project_id, name, adapter_id, cli, cli_version, cwd, origin, created_at, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, projectId, name, adapterId, cli, version, cwd, origin, createdAt, role);
        }
        db.prepare(`INSERT INTO agent_runs (id, session_id, state, started_at, cli_version, cwd, attempt) VALUES (?, ?, 'running', ?, ?, ?, ?)`).run(runId, id, runStartedAt, version, cwd, attempt);
        event({ projectId, sessionId: id, runId, type: existing ? 'session.attached' : 'session.created', at: runStartedAt });
        event({ projectId, sessionId: id, runId, type: 'run.started', at: runStartedAt });
        return { id: runId, version: 1, attempt };
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
          loseClaims(run.id, at);
        }
        // Aprovação persistida não autoriza repetir um spawn após interrupção.
        // Um processo pode ter iniciado antes do crash: mantenha o histórico,
        // sem inferir sucesso nem criar outra sessão automaticamente.
        for (const request of db.prepare("SELECT * FROM agent_requests WHERE state = 'approved'").all()) {
          const error = 'Inicialização interrompida. Confira o histórico de sessões antes de solicitar outro agente.';
          db.prepare("UPDATE agent_requests SET state = 'failed', error = ?, version = version + 1 WHERE id = ?").run(error, request.id);
          event({ projectId: request.project_id, sessionId: request.requested_by, type: 'approval.failed', payload: { requestId: request.id, error, reason }, correlationId: request.id, at });
        }
        return active.length;
      });
    },
    listProjects: () => db.prepare('SELECT * FROM projects ORDER BY created_at, id').all(),
    listSessions: (projectId) => db.prepare('SELECT * FROM sessions WHERE project_id = ? ORDER BY created_at, id').all(projectId),
    listRuns: (projectId) => db.prepare(`SELECT r.* FROM agent_runs r JOIN sessions s ON s.id = r.session_id WHERE s.project_id = ? ORDER BY s.created_at, s.id, r.attempt`).all(projectId),
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

module.exports = { AGENT_REQUEST_POLICY, createOperationalStore, closeOperationalStore, migrate, MIGRATIONS };
