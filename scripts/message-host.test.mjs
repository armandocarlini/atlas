import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { createOperationalStore, migrate, MIGRATIONS } = require('../electron/operational-store.cjs');
const { createMessageHost } = require('../electron/message-host.cjs');

function harness(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-messages-'));
  const filename = path.join(directory, 'messages.sqlite');
  let store = createOperationalStore({ filename });
  const projects = [{ id: 'project-a', name: 'Primeiro', path: '/fixture/a' }, { id: 'project-b', name: 'Segundo', path: '/fixture/b' }];
  projects.forEach((project) => store.registerProject(project));
  const session = (id, projectId, role) => store.startSession({ id, projectId, name: `sessao-${id}`, adapterId: 'kimi-code', cli: 'Kimi Code', version: '2.3.2', cwd: projects.find((project) => project.id === projectId).path, origin: 'user', createdAt: '2026-10-26T00:00:00Z', role });
  session('orchestrator-a', 'project-a', 'orchestrator');
  session('manual-a', 'project-a', 'agent');
  session('orchestrator-b', 'project-b', 'orchestrator');
  session('manual-b', 'project-b', 'agent');
  const handlers = new Map();
  const projectHost = { ready: Promise.resolve(), isAllowedCwd: (cwd) => projects.some((project) => project.path === cwd), getProjectForCwd: (cwd) => projects.find((project) => project.path === cwd) };
  createMessageHost({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, projectHost, store, isMainSender: (event) => event.sender === 'main' });
  t.after(() => {
    store.close();
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert(path.basename(resolved).startsWith('atlas-messages-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return { store, filename, projectHost, call: (name, request, sender = 'main') => handlers.get(name)({ sender }, request), reopen: () => { store.close(); store = createOperationalStore({ filename }); return store; } };
}

const request = { cwd: '/fixture/a', fromSessionId: 'manual-a', toSessionId: 'orchestrator-a', kind: 'discovery', subject: 'Divergência ANSI encontrada', body: 'Sequências de resize diferem entre ConPTY e WinPTY.', idempotencyKey: 'discovery-0001' };

test('envio via IPC persiste mensagem, entrega, comando e evento, e sobrevive à reabertura', async (t) => {
  const { call, store, filename, reopen } = harness(t);
  const message = await call('message:send', { ...request, projectId: 'project-b' });
  assert.equal(message.projectId, 'project-a');
  assert.equal(message.toSessionId, 'orchestrator-a');
  assert.equal(message.readAt, null);
  assert.match(message.id, /^[0-9a-f-]{36}$/);
  assert.equal(store.listEvents('project-a').filter((event) => event.type === 'message.sent').length, 1);
  const raw = new DatabaseSync(filename, { readOnly: true });
  try {
    const command = raw.prepare("SELECT status, target_id FROM commands WHERE command_type = 'message.send'").get();
    assert.equal(command.status, 'completed');
    assert.equal(command.target_id, message.id);
    const delivery = raw.prepare('SELECT session_id, read_at FROM message_deliveries').get();
    assert.equal(delivery.session_id, 'orchestrator-a');
    assert.equal(delivery.read_at, null);
  } finally { raw.close(); }
  const listed = reopen().listMessages('project-a');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].fromName, 'sessao-manual-a');
  assert.equal(listed[0].toName, 'sessao-orchestrator-a');
  assert.equal(listed[0].subject, request.subject);
});

test('reenvios concorrentes com a mesma chave não duplicam mensagem, entrega ou evento', async (t) => {
  const { call, store } = harness(t);
  const [first, second] = await Promise.all([call('message:send', request), call('message:send', request)]);
  assert.deepEqual(first, second);
  assert.equal(store.listMessages('project-a').length, 1);
  assert.equal(store.listEvents('project-a').filter((event) => event.type === 'message.sent').length, 1);
  await assert.rejects(call('message:send', { ...request, subject: 'Conteúdo divergente' }), /outro conteúdo/);
});

test('projetos isolam listagem, leitura e chave de idempotência', async (t) => {
  const { call } = harness(t);
  const first = await call('message:send', request);
  assert.equal((await call('message:list', { cwd: '/fixture/b' })).items.length, 0);
  await assert.rejects(call('message:send', { ...request, cwd: '/fixture/b', fromSessionId: 'manual-b', toSessionId: 'manual-b' }), /si mesma/);
  const second = await call('message:send', { ...request, cwd: '/fixture/b', fromSessionId: 'manual-b', toSessionId: 'orchestrator-b' });
  assert.notEqual(first.id, second.id);
  assert.deepEqual((await call('message:list', { cwd: '/fixture/a' })).items.map((message) => message.id), [first.id]);
});

test('destinatário de outro projeto ou inexistente é recusado', async (t) => {
  const { call, store } = harness(t);
  await assert.rejects(call('message:send', { ...request, toSessionId: 'manual-b' }), /sessões deste projeto/);
  await assert.rejects(call('message:send', { ...request, toSessionId: 'fantasma' }), /sessões deste projeto/);
  await assert.rejects(call('message:send', { ...request, fromSessionId: 'fantasma' }), /sessões deste projeto/);
  assert.equal(store.listMessages('project-a').length, 0);
});

test('IPC recusa janela secundária, diretório não autorizado e projeto ausente', async (t) => {
  const { call, projectHost, store } = harness(t);
  await assert.rejects(call('message:send', request, 'popup'), /Janela não autorizada/);
  await assert.rejects(call('message:list', { cwd: '/fixture/a' }, 'popup'), /Janela não autorizada/);
  await assert.rejects(call('message:mark-read', { cwd: '/fixture/a', messageId: 'x', sessionId: 'y' }, 'popup'), /Janela não autorizada/);
  await assert.rejects(call('message:send', { ...request, cwd: '/outside' }), /pasta autorizada/);
  await assert.rejects(call('message:list', null), /pasta autorizada/);
  projectHost.getProjectForCwd = () => null;
  await assert.rejects(call('message:send', request), /Projeto não encontrado/);
  assert.equal(store.listMessages('project-a').length, 0);
});

test('textos vazios, tipos, limites e tipo de mensagem são validados antes de gravar', async (t) => {
  const { call, store } = harness(t);
  for (const invalid of [
    { subject: '   ' }, { subject: 10 }, { subject: 'a'.repeat(161) },
    { body: '' }, { body: [] }, { body: 'a'.repeat(4001) },
    { kind: 'broadcast' }, { idempotencyKey: 'x' },
  ]) await assert.rejects(call('message:send', { ...request, ...invalid }), /texto válido|idempotência|Tipo de mensagem/);
  assert.equal(store.listMessages('project-a').length, 0);
  const maximal = await call('message:send', { ...request, subject: 'a'.repeat(160), body: 'b'.repeat(4000) });
  assert.equal(maximal.subject.length, 160);
});

test('marcar como lida é idempotente e registra evento uma única vez', async (t) => {
  const { call, store } = harness(t);
  const message = await call('message:send', request);
  assert.equal(await call('message:mark-read', { cwd: '/fixture/a', messageId: message.id, sessionId: 'orchestrator-a' }), true);
  assert.equal(await call('message:mark-read', { cwd: '/fixture/a', messageId: message.id, sessionId: 'orchestrator-a' }), false);
  assert.equal(store.listEvents('project-a').filter((event) => event.type === 'message.read').length, 1);
  assert(store.listMessages('project-a')[0].readAt);
  await assert.rejects(call('message:mark-read', { cwd: '/fixture/a', messageId: message.id, sessionId: 'manual-b' }), /não encontrada/);
  await assert.rejects(call('message:mark-read', { cwd: '/fixture/b', messageId: message.id, sessionId: 'orchestrator-a' }), /não encontrada/);
});

test('falha ao gravar evento reverte mensagem, entrega e comando; mesma chave pode ser tentada de novo', async (t) => {
  const { call, store, filename } = harness(t);
  const raw = new DatabaseSync(filename);
  try {
    raw.exec("CREATE TRIGGER fail_message_event BEFORE INSERT ON audit_events WHEN NEW.type = 'message.sent' BEGIN SELECT RAISE(ABORT, 'disk unavailable'); END");
    await assert.rejects(call('message:send', request), /disk unavailable/);
    assert.equal(store.listMessages('project-a').length, 0);
    assert.equal(raw.prepare("SELECT count(*) AS count FROM commands WHERE command_type = 'message.send'").get().count, 0);
    assert.equal(raw.prepare('SELECT count(*) AS count FROM message_deliveries').get().count, 0);
    raw.exec('DROP TRIGGER fail_message_event');
    assert((await call('message:send', request)).id);
  } finally { raw.close(); }
});

test('conteúdo de mensagem é tratado como texto, sem interpretar SQL', async (t) => {
  const { call } = harness(t);
  const message = await call('message:send', { ...request, subject: "'); DROP TABLE messages; --", body: '<script>example()</script>' });
  assert.equal((await call('message:list', { cwd: request.cwd })).items[0].subject, message.subject);
});

test('migration 3 para 4 preserva dados e habilita mensagens', (t) => {
  const { filename, store, reopen } = harness(t);
  store.close();
  const legacyFile = `${filename}.legacy`;
  const legacy = new DatabaseSync(legacyFile);
  try {
    migrate(legacy, MIGRATIONS.slice(0, 3));
    legacy.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?)').run('legacy', 'Legado', '/fixture/legacy', '2026-10-26T00:00:00Z', '2026-10-26T00:00:00Z');
    legacy.prepare("INSERT INTO sessions (id, project_id, name, adapter_id, cli, cli_version, cwd, origin, created_at, role) VALUES ('legacy-orchestrator', 'legacy', 'Principal', 'kimi-code', 'Kimi Code', '2.3.2', '/fixture/legacy', 'user', '2026-10-26T00:00:00Z', 'orchestrator')").run();
    legacy.prepare("INSERT INTO sessions (id, project_id, name, adapter_id, cli, cli_version, cwd, origin, created_at, role) VALUES ('legacy-manual', 'legacy', 'Manual', 'kimi-code', 'Kimi Code', '2.3.2', '/fixture/legacy', 'user', '2026-10-26T00:00:00Z', 'agent')").run();
  } finally { legacy.close(); }
  const upgraded = createOperationalStore({ filename: legacyFile });
  try {
    const message = upgraded.sendMessage({ projectId: 'legacy', fromSessionId: 'legacy-manual', toSessionId: 'legacy-orchestrator', kind: 'discovery', subject: 'Migração', body: 'Dados preservados.', idempotencyKey: 'legacy-0001' });
    assert(message.id);
    assert.equal(upgraded.listMessages('legacy').length, 1);
    assert.equal(upgraded.getOrchestrator('legacy').id, 'legacy-orchestrator');
  } finally { upgraded.close(); }
  reopen();
});

test('IPC da interface sempre audita o usuário, mesmo se o renderer enviar outro ator', async (t) => {
  const { call, store } = harness(t);
  const message = await call('message:send', { ...request, idempotencyKey: 'discovery-ator-01', actor: 'agent:orchestrator-a' });
  const event = store.listEvents('project-a').find((item) => item.type === 'message.sent' && item.payload.messageId === message.id);
  assert.equal(event.payload.actor, 'user');
});
