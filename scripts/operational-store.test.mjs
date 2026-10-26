import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const { createOperationalStore, closeOperationalStore, migrate, MIGRATIONS } = createRequire(import.meta.url)('../electron/operational-store.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-store-'));
  const filename = path.join(directory, 'estado.sqlite');
  const stores = [];
  t.after(() => {
    stores.forEach((store) => store.close());
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert(path.basename(resolved).startsWith('atlas-store-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const open = (file = filename) => {
    const store = createOperationalStore({ filename: file });
    stores.push(store);
    return store;
  };
  return { directory, filename, open };
}

function project(store, id = 'project-a') {
  store.registerProject({ id, name: `Projeto ${id} · revisão`, path: `/fixtures/${id}` });
  return id;
}

function session(store, projectId, id = 'session-a') {
  return store.startSession({
    id, projectId, name: 'Investigação', adapterId: 'kimi-code', cli: 'Kimi Code', version: '2.3.2',
    cwd: `/fixtures/${projectId}`, origin: 'user', createdAt: '2026-10-26T12:00:00.000Z',
  });
}

test('migrations repetidas preservam projetos e não duplicam eventos', (t) => {
  const { open } = fixture(t);
  const first = open();
  project(first);
  project(first);
  first.close();
  first.close();
  const reopened = open();
  assert.equal(reopened.listProjects().length, 1);
  assert.equal(reopened.listEvents('project-a').length, 1);
  assert.equal(reopened.listProjects()[0].name, 'Projeto project-a · revisão');
});

test('versão futura é recusada sem apagar dados', (t) => {
  const { filename, open } = fixture(t);
  const store = open();
  project(store);
  store.close();
  const raw = new DatabaseSync(filename);
  raw.exec('PRAGMA user_version = 99');
  raw.close();
  assert.throws(() => open(), /versão futura/);
  const preserved = new DatabaseSync(filename, { readOnly: true });
  assert.equal(preserved.prepare('SELECT count(*) AS total FROM projects').get().total, 1);
  assert.equal(preserved.prepare('PRAGMA user_version').get().user_version, 99);
  preserved.close();
});

test('migration inválida reverte DDL e versão, sem tocar dados anteriores', (t) => {
  const { filename, open } = fixture(t);
  const store = open();
  project(store);
  store.close();
  const raw = new DatabaseSync(filename);
  try {
    assert.throws(() => migrate(raw, [...MIGRATIONS, { version: 4, sql: 'CREATE TABLE partial (id TEXT); INVALID SQL;' }]), /syntax/);
    assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 3);
    assert.equal(raw.prepare("SELECT count(*) AS total FROM sqlite_master WHERE name = 'partial'").get().total, 0);
    assert.equal(raw.prepare('SELECT count(*) AS total FROM projects').get().total, 1);
    assert.equal(raw.prepare('SELECT count(*) AS total FROM schema_migrations').get().total, 3);
  } finally {
    raw.close();
  }
});

test('sessão e run sobrevivem ao reinício; run ativa vira lost sem inventar saída', (t) => {
  const { open } = fixture(t);
  const first = open();
  const id = project(first);
  const run = session(first, id);
  first.close();
  const reopened = open();
  assert.equal(reopened.listRuns(id)[0].state, 'running');
  assert.equal(reopened.reconcileRuns(), 1);
  assert.equal(reopened.reconcileRuns(), 0);
  assert.equal(reopened.listSessions(id)[0].id, 'session-a');
  const restored = reopened.listRuns(id)[0];
  assert.equal(restored.id, run.id);
  assert.equal(restored.state, 'lost');
  assert.equal(restored.exit_code, null);
  assert.equal(restored.reason, 'application_restarted');
  assert.equal(restored.version, 2);
  assert.equal(reopened.listEvents(id).filter((event) => event.type === 'run.lost').length, 1);
  assert(reopened.listEvents(id).filter((event) => event.run_id).every((event) => event.correlation_id === run.id));
});

test('saída persistida e evento são idempotentes, sem sobrescrever resultados', (t) => {
  const { open } = fixture(t);
  const store = open();
  const id = project(store);
  const run = session(store, id);
  const request = { runId: run.id, expectedVersion: 1, exitCode: 0 };
  assert.equal(store.finishRun(request), true);
  assert.equal(store.finishRun(request), false);
  assert.throws(() => store.finishRun({ ...request, exitCode: 1 }), /outro resultado/);
  assert.equal(store.reconcileRuns(), 0);
  assert.equal(store.listRuns(id)[0].state, 'succeeded');
  assert.equal(store.listEvents(id).filter((event) => event.type === 'run.succeeded').length, 1);
  store.close();
  assert.equal(open().listRuns(id)[0].exit_code, 0);
});

test('saída com erro ou sinal não é sucesso', (t) => {
  const { open } = fixture(t);
  const store = open();
  const id = project(store);
  const failed = session(store, id);
  store.finishRun({ runId: failed.id, expectedVersion: 1, exitCode: 7 });
  const signaled = session(store, id, 'session-b');
  store.finishRun({ runId: signaled.id, expectedVersion: 1, exitCode: 0, signal: 15 });
  assert(store.listRuns(id).every((run) => run.state === 'failed'));
});

test('foreign keys e conflitos rejeitam operação inteira, incluindo eventos', (t) => {
  const { open } = fixture(t);
  const store = open();
  assert.throws(() => session(store, 'unknown'), /FOREIGN KEY/);
  const id = project(store);
  assert.equal(store.listRuns(id).length, 0);
  assert.equal(store.listSessions(id).length, 0);
  const run = session(store, id);
  const before = store.listEvents(id);
  assert.throws(() => store.finishRun({ runId: run.id, expectedVersion: 99, exitCode: 0 }), /conflito/);
  assert.throws(() => session(store, id), /Identidade de sessão já existente/);
  assert.equal(store.listRuns(id)[0].state, 'running');
  assert.deepEqual(store.listEvents(id), before);
});

test('duas conexões não concluem a mesma run com resultados diferentes', (t) => {
  const { open } = fixture(t);
  const first = open();
  const id = project(first);
  const run = session(first, id);
  const second = open();
  first.finishRun({ runId: run.id, expectedVersion: 1, exitCode: 0 });
  assert.throws(() => second.finishRun({ runId: run.id, expectedVersion: 1, exitCode: 1 }), /outro resultado/);
  assert.equal(second.listEvents(id).filter((event) => event.type.startsWith('run.')).length, 2);
});

test('falha ao escrever evento reverte sessão e transição de run', (t) => {
  const { filename, open } = fixture(t);
  const store = open();
  const id = project(store);
  const run = session(store, id);
  const raw = new DatabaseSync(filename);
  try {
    raw.exec("CREATE TRIGGER fail_event BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'event unavailable'); END");
    assert.throws(() => session(store, id, 'session-b'), /event unavailable/);
    assert.equal(store.listSessions(id).length, 1);
    assert.equal(store.listRuns(id).length, 1);
    assert.throws(() => store.finishRun({ runId: run.id, expectedVersion: 1, exitCode: 0 }), /event unavailable/);
    assert.equal(store.listRuns(id)[0].state, 'running');
    assert.equal(store.listEvents(id).length, 3);
  } finally {
    raw.close();
  }
});

test('projetos isolam sessões, runs e eventos; conteúdo não vira SQL', (t) => {
  const { open } = fixture(t);
  const store = open();
  const first = project(store);
  const second = project(store, "other'); DROP TABLE projects; --");
  session(store, first);
  assert.equal(store.listSessions(second).length, 0);
  assert.equal(store.listRuns(second).length, 0);
  assert.equal(store.listEvents(second).length, 1);
  assert.equal(store.listProjects().length, 2);
  assert.throws(() => store.registerProject({ id: first, name: 'Outro', path: '/different' }), /outro caminho/);
});

test('falha de escrita no shutdown é reportada e deixa run para reconciliar no reinício', (t) => {
  const { filename, open } = fixture(t);
  const store = open();
  const id = project(store);
  session(store, id);
  const raw = new DatabaseSync(filename);
  const errors = [];
  try {
    raw.exec("CREATE TRIGGER fail_shutdown BEFORE UPDATE ON agent_runs BEGIN SELECT RAISE(ABORT, 'disk unavailable'); END");
    assert.doesNotThrow(() => closeOperationalStore(store, (error) => errors.push(error)));
    assert.equal(store.closed, true);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /disk unavailable/);
    closeOperationalStore(store, (error) => errors.push(error));
    assert.equal(errors.length, 1);
    raw.exec('DROP TRIGGER fail_shutdown');
  } finally {
    raw.close();
  }
  const reopened = open();
  assert.equal(reopened.listRuns(id)[0].state, 'running');
  assert.equal(reopened.reconcileRuns(), 1);
  assert.equal(reopened.listRuns(id)[0].state, 'lost');
});

test('backup WAL restaura estado consistente sem sobrescrever arquivos existentes', async (t) => {
  const { open, directory } = fixture(t);
  const store = open();
  const id = project(store);
  const run = session(store, id);
  store.finishRun({ runId: run.id, expectedVersion: 1, exitCode: 0 });
  const destination = path.join(directory, 'backup.sqlite');
  const pending = store.backupTo(destination);
  assert.throws(() => store.close(), /Backup em andamento/);
  await pending;
  const restored = open(destination);
  assert.equal(restored.listSessions(id).length, 1);
  assert.deepEqual(restored.listEvents(id), store.listEvents(id));
  assert.equal(restored.listRuns(id)[0].state, 'succeeded');
  await assert.rejects(store.backupTo(destination), /EEXIST/);
  await assert.rejects(store.backupTo(path.join(directory, 'estado.sqlite')), /outro caminho/);
  assert.equal(store.listRuns(id)[0].state, 'succeeded');
});

test('tentativas da principal ordenam por sequência durável, mesmo se relógio voltar', (t) => {
  const { open } = fixture(t);
  const store = open();
  const projectId = project(store);
  const principal = { id: 'principal', projectId, name: 'ORQUESTRADOR', adapterId: 'kimi-code', cli: 'Kimi Code', version: '2.3.2', cwd: '/fixtures/project-a', origin: 'user', role: 'orchestrator', createdAt: '2026-10-26T12:00:00Z' };
  const first = store.startSession({ ...principal, runStartedAt: '2026-10-26T12:00:00Z' });
  store.finishRun({ runId: first.id, expectedVersion: 1, exitCode: 0 });
  const second = store.startSession({ ...principal, runStartedAt: '2026-10-26T11:59:00Z', version: '2.3.3' });
  const runs = store.listRuns(projectId);
  assert.deepEqual(runs.map((run) => run.attempt), [1, 2]);
  assert.equal(runs.at(-1).id, second.id);
  assert.equal(runs[0].cli_version, '2.3.2');
  assert.equal(runs[1].cli_version, '2.3.3');
  assert.equal(store.listSessions(projectId).length, 1);
});
