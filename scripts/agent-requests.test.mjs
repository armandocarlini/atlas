import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { createOperationalStore, migrate, MIGRATIONS, AGENT_REQUEST_POLICY } = require('../electron/operational-store.cjs');
const { createAgentRequestHost } = require('../electron/agent-request-host.cjs');

const START = Date.parse('2026-10-27T10:00:00.000Z');

function harness(t, { policy, createAgent, countActive = () => 0 } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-agent-requests-'));
  const filename = path.join(directory, 'requests.sqlite');
  const clock = { at: START };
  const store = createOperationalStore({ filename, now: () => new Date(clock.at).toISOString() });
  const projects = [{ id: 'project-a', name: 'Primeiro', path: '/fixture/a' }, { id: 'project-b', name: 'Segundo', path: '/fixture/b' }];
  projects.forEach((project) => store.registerProject(project));
  const session = (id, projectId, role, origin = 'user') => store.startSession({ id, projectId, name: `sessao-${id}`, adapterId: 'kimi-code', cli: 'Kimi Code', version: '2.3.3', cwd: projects.find((project) => project.id === projectId).path, origin, createdAt: new Date(clock.at).toISOString(), role });
  session('orchestrator-a', 'project-a', 'orchestrator');
  session('manual-a', 'project-a', 'agent');
  session('orchestrator-b', 'project-b', 'orchestrator');
  const handlers = new Map();
  const spawns = [];
  const changes = [];
  const agentHost = {
    countActive,
    createAgent: createAgent || (async (request, options) => {
      spawns.push({ request, options });
      const id = `criado-${spawns.length}`;
      session(id, 'project-a', 'agent', options.origin);
      return { id, name: request.name, origin: options.origin, cwd: request.cwd, state: 'running' };
    }),
  };
  const projectHost = { ready: Promise.resolve(), isAllowedCwd: (cwd) => projects.some((project) => project.path === cwd), getProjectForCwd: (cwd) => projects.find((project) => project.path === cwd) };
  createAgentRequestHost({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, projectHost, store, isMainSender: (event) => event.sender === 'main', agentHost, policy, onChange: (projectId) => changes.push(projectId) });
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const call = async (name, request, sender = 'main') => handlers.get(name)({ sender }, request);
  const ask = (overrides = {}) => store.requestAgent({ projectId: 'project-a', requestedBy: 'orchestrator-a', name: 'revisor-ansi', purpose: 'Revisar a divergência ANSI relatada pela sessão manual.', idempotencyKey: `pedido-${Math.random().toString(16).slice(2, 10)}`, ...overrides });
  return { store, filename, clock, call, ask, spawns, changes, session };
}

test('pedido da principal fica pendente com hash, validade, comando auditado e evento', (t) => {
  const { store, ask, filename } = harness(t);
  const request = ask({ idempotencyKey: 'pedido-0001' });
  assert.equal(request.state, 'pending');
  assert.match(request.payloadHash, /^[0-9a-f]{64}$/);
  assert.equal(request.expiresAt, new Date(START + AGENT_REQUEST_POLICY.ttlMs).toISOString());
  assert.equal(ask({ idempotencyKey: 'pedido-0001' }).id, request.id, 'mesma chave e mesmo conteúdo não duplicam');
  assert.throws(() => ask({ idempotencyKey: 'pedido-0001', purpose: 'Outro propósito' }), /outro conteúdo/);
  assert.equal(store.listAgentRequests('project-a').length, 1);
  const events = store.listEvents('project-a').filter((item) => item.type === 'approval.requested');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].payload, { requestId: request.id, kind: 'agent.create', name: 'revisor-ansi' });
  const raw = new DatabaseSync(filename, { readOnly: true });
  try {
    assert.equal(raw.prepare("SELECT created_by FROM commands WHERE command_type = 'agent.request'").get().created_by, 'agent:orchestrator-a');
  } finally { raw.close(); }
});

test('somente a principal do próprio projeto pede agentes, com textos e limites validados', (t) => {
  const { ask } = harness(t);
  assert.throws(() => ask({ requestedBy: 'manual-a' }), /Somente a sessão principal/);
  assert.throws(() => ask({ requestedBy: 'orchestrator-b' }), /não pertence a este projeto/);
  assert.throws(() => ask({ name: '   ' }), /Nome/);
  assert.throws(() => ask({ name: 'x'.repeat(61) }), /Nome/);
  assert.throws(() => ask({ purpose: 'y'.repeat(1001) }), /Propósito/);
  assert.throws(() => ask({ idempotencyKey: 'curta' }), /idempotência/);
});

test('limite de pedidos pendentes por projeto, sem afetar outro projeto', (t) => {
  const { ask, store } = harness(t);
  for (let index = 0; index < AGENT_REQUEST_POLICY.maxPending; index += 1) ask({ name: `agente-${index}` });
  assert.throws(() => ask({ name: 'excedente' }), /Limite da política/);
  assert.equal(store.requestAgent({ projectId: 'project-b', requestedBy: 'orchestrator-b', name: 'outro', purpose: 'Outro projeto.', idempotencyKey: 'pedido-b-0001' }).state, 'pending');
});

test('pedido expira após a validade, libera vaga e não pode mais ser aprovado', async (t) => {
  const { ask, store, clock, call } = harness(t);
  const request = ask();
  clock.at = START + AGENT_REQUEST_POLICY.ttlMs;
  assert.equal(store.listAgentRequests('project-a')[0].state, 'expired');
  await assert.rejects(call('agent-request:approve', { cwd: '/fixture/a', requestId: request.id, payloadHash: request.payloadHash }), /já foi resolvido|expirou/);
  assert.equal(store.listEvents('project-a').filter((item) => item.type === 'approval.resolved' && item.payload.decision === 'expired').length, 1);
  for (let index = 0; index < AGENT_REQUEST_POLICY.maxPending; index += 1) ask({ name: `novo-${index}` });
});

test('aprovação pela interface inicia agente com origem orchestrator e conclui o pedido', async (t) => {
  const { ask, call, spawns, changes, store } = harness(t);
  const request = ask();
  const listed = await call('agent-request:list', { cwd: '/fixture/a' });
  assert.deepEqual(listed.policy, { maxPending: 3, ttlMinutes: 15, maxActiveAgents: 2 });
  assert.equal(listed.items[0].payloadHash, request.payloadHash);
  const result = await call('agent-request:approve', { cwd: '/fixture/a', requestId: request.id, payloadHash: request.payloadHash });
  assert.equal(spawns.length, 1);
  assert.deepEqual(spawns[0].request, { adapterId: 'kimi-code', name: 'revisor-ansi', cwd: '/fixture/a' });
  assert.deepEqual(spawns[0].options, { origin: 'orchestrator' });
  assert.equal(result.request.state, 'fulfilled');
  assert.equal(result.request.sessionId, result.agent.id);
  assert.equal(result.request.resolvedBy, 'user');
  assert.deepEqual(changes, ['project-a']);
  const created = store.listEvents('project-a').find((item) => item.type === 'approval.fulfilled' && item.payload.requestId === request.id);
  assert.deepEqual(created.payload, { requestId: request.id, origin: 'orchestrator', requestedBy: 'orchestrator-a' });
  assert.equal(store.listSessions('project-a').find((item) => item.id === result.agent.id).origin, 'orchestrator');
  await assert.rejects(call('agent-request:approve', { cwd: '/fixture/a', requestId: request.id, payloadHash: request.payloadHash }), /já foi resolvido/);
});

test('aprovação vale só para o conteúdo exibido: hash divergente não inicia nada', async (t) => {
  const { ask, call, spawns, store } = harness(t);
  const request = ask();
  await assert.rejects(call('agent-request:approve', { cwd: '/fixture/a', requestId: request.id, payloadHash: 'f'.repeat(64) }), /não corresponde/);
  await assert.rejects(call('agent-request:approve', { cwd: '/fixture/a', requestId: request.id }), /Conteúdo aprovado inválido/);
  assert.equal(spawns.length, 0);
  assert.equal(store.getAgentRequest('project-a', request.id).state, 'pending');
});

test('janela secundária, pasta não autorizada e projeto alheio não decidem pedidos', async (t) => {
  const { ask, call, store } = harness(t);
  const request = ask();
  await assert.rejects(call('agent-request:approve', { cwd: '/fixture/a', requestId: request.id, payloadHash: request.payloadHash }, 'popup'), /não autorizada/);
  await assert.rejects(call('agent-request:list', { cwd: '/fora' }), /pasta autorizada/);
  await assert.rejects(call('agent-request:reject', { cwd: '/fixture/b', requestId: request.id }), /não encontrado neste projeto/);
  assert.equal(store.getAgentRequest('project-a', request.id).state, 'pending');
});

test('limite de agentes ativos é verificado no ponto de execução', async (t) => {
  const { ask, call, spawns, store } = harness(t, { countActive: () => 2 });
  const request = ask();
  await assert.rejects(call('agent-request:approve', { cwd: '/fixture/a', requestId: request.id, payloadHash: request.payloadHash }), /Limite da política: 2 agentes/);
  assert.equal(spawns.length, 0);
  assert.equal(store.getAgentRequest('project-a', request.id).state, 'pending', 'pedido continua decidível após encerrar um agente');
});

test('aprovações simultâneas reservam vaga e não excedem o limite', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const context = {};
  const created = harness(t, {
    policy: { ...AGENT_REQUEST_POLICY, maxActiveAgents: 1 },
    createAgent: async (request, options) => {
      await gate;
      context.session('criado-lento', 'project-a', 'agent', options.origin);
      return { id: 'criado-lento', name: request.name, origin: options.origin };
    },
  });
  context.session = created.session;
  const first = created.ask({ name: 'primeiro' });
  const second = created.ask({ name: 'segundo' });
  const firstApproval = created.call('agent-request:approve', { cwd: '/fixture/a', requestId: first.id, payloadHash: first.payloadHash });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(created.call('agent-request:approve', { cwd: '/fixture/a', requestId: second.id, payloadHash: second.payloadHash }), /Limite da política/);
  release();
  assert.equal((await firstApproval).request.state, 'fulfilled');
  assert.equal(created.store.getAgentRequest('project-a', second.id).state, 'pending');
});

test('falha de spawn vira pedido failed com motivo, sem sessão fictícia', async (t) => {
  const { ask, call, store, changes } = harness(t, { createAgent: async () => { throw new Error('Kimi Code não está disponível.'); } });
  const request = ask();
  await assert.rejects(call('agent-request:approve', { cwd: '/fixture/a', requestId: request.id, payloadHash: request.payloadHash }), /não está disponível/);
  const failed = store.getAgentRequest('project-a', request.id);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.error, 'Kimi Code não está disponível.');
  assert.equal(failed.sessionId, null);
  assert.deepEqual(changes, ['project-a']);
  assert.equal(store.listEvents('project-a').filter((item) => item.type === 'approval.failed').length, 1);
});

test('recusa resolve o pedido e impede aprovação posterior', async (t) => {
  const { ask, call, store, changes } = harness(t);
  const request = ask();
  assert.equal((await call('agent-request:reject', { cwd: '/fixture/a', requestId: request.id })).state, 'rejected');
  assert.deepEqual(changes, ['project-a']);
  await assert.rejects(call('agent-request:approve', { cwd: '/fixture/a', requestId: request.id, payloadHash: request.payloadHash }), /já foi resolvido \(rejected\)/);
  assert.throws(() => store.completeAgentRequest({ projectId: 'project-a', requestId: request.id, sessionId: 'manual-a' }), /Somente pedidos aprovados/);
});

test('migration 4→5 preserva dados anteriores e cria pedidos vazios', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-agent-requests-migration-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'legacy.sqlite');
  const raw = new DatabaseSync(filename);
  try {
    raw.exec('PRAGMA foreign_keys = ON');
    migrate(raw, MIGRATIONS.slice(0, 4));
    raw.prepare('INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('legacy', 'Legado', '/legado', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 4);
  } finally { raw.close(); }
  const store = createOperationalStore({ filename });
  try {
    assert.deepEqual(store.listAgentRequests('legacy'), []);
    assert.deepEqual(store.listProjects().map((project) => project.id), ['legacy']);
  } finally { store.close(); }
  const reopened = new DatabaseSync(filename, { readOnly: true });
  try {
    assert.equal(reopened.prepare('PRAGMA user_version').get().user_version, 5);
    assert.equal(reopened.prepare("SELECT name FROM projects WHERE id = 'legacy'").get().name, 'Legado');
  } finally { reopened.close(); }
});
