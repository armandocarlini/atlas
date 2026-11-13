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

function harness(t, { policy, createAgent, countActive = () => 0, worktrees, allowed = [], resolveLaunch } = {}) {
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
    resolveLaunch: resolveLaunch || (async (adapterId, model) => {
      if (!adapterId) throw new Error('Escolha o CLI do agente entre os detectados.');
      return { adapter: { id: adapterId }, model: model ?? null };
    }),
    createAgent: createAgent || (async (request, options) => {
      spawns.push({ request, options });
      const id = `criado-${spawns.length}`;
      session(id, 'project-a', 'agent', options.origin);
      return { id, name: request.name, origin: options.origin, cwd: request.cwd, state: 'running' };
    }),
  };
  const projectHost = { ready: Promise.resolve(), refreshRoot: async () => {}, isAllowedCwd: (cwd) => projects.some((project) => project.path === cwd) || allowed.includes(cwd), getProjectForCwd: (cwd) => projects.find((project) => project.path === cwd) };
  const autoApproved = [];
  const requestHost = createAgentRequestHost({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, projectHost, store, isMainSender: (event) => event.sender === 'main', agentHost, policy, onChange: (projectId) => changes.push(projectId), onAutoApproved: (projectId, result) => autoApproved.push({ projectId, result }), ...(worktrees ? { worktrees } : {}) });
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const call = async (name, request, sender = 'main') => handlers.get(name)({ sender }, request);
  const ask = (overrides = {}) => store.requestAgent({ projectId: 'project-a', requestedBy: 'orchestrator-a', name: 'revisor-ansi', purpose: 'Revisar a divergência ANSI relatada pela sessão manual.', idempotencyKey: `pedido-${Math.random().toString(16).slice(2, 10)}`, ...overrides });
  return { store, filename, clock, call, ask, spawns, changes, session, requestHost, autoApproved };
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

test('nome e propósito recusam controles e formatação invisível que disfarçariam o pedido', (t) => {
  const { ask } = harness(t);
  for (const name of ['ORQUESTRADOR\nrevisor', 'revisor‮odatsil', 'revi​sor', 'revisor\u0007']) {
    assert.throws(() => ask({ name }), /Nome: use somente caracteres visíveis/);
  }
  for (const purpose of ['Revisar‮ texto invertido', 'Revisar‍ junto', 'Revisar\u001b[31m vermelho']) {
    assert.throws(() => ask({ purpose }), /Propósito: remova caracteres/);
  }
  const accepted = ask({ name: 'revisor-ação', purpose: 'Primeira linha.\nSegunda\tcom tab.' });
  assert.equal(accepted.purpose, 'Primeira linha.\nSegunda\tcom tab.');
  assert.equal(accepted.requesterName, 'sessao-orchestrator-a');
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
  await assert.rejects(call('agent-request:approve', { cwd: '/fixture/a', requestId: request.id, payloadHash: request.payloadHash, adapterId: 'kimi-code' }), /já foi resolvido|expirou/);
  assert.equal(store.listEvents('project-a').filter((item) => item.type === 'approval.resolved' && item.payload.decision === 'expired').length, 1);
  for (let index = 0; index < AGENT_REQUEST_POLICY.maxPending; index += 1) ask({ name: `novo-${index}` });
});

test('consulta de status expira pedido sem depender da listagem da interface', (t) => {
  const { ask, store, clock } = harness(t);
  const request = ask();
  clock.at = START + AGENT_REQUEST_POLICY.ttlMs;
  assert.equal(store.getAgentRequest('project-a', request.id).state, 'expired');
  assert.equal(store.getAgentRequest('project-a', request.id).state, 'expired');
  assert.equal(store.listEvents('project-a').filter((item) => item.type === 'approval.resolved' && item.payload.decision === 'expired').length, 1);
});

test('reinício reconcilia aprovação interrompida sem repetir spawn nem inventar sucesso', (t) => {
  const { ask, store, filename } = harness(t);
  const request = ask();
  store.approveAgentRequest({ projectId: 'project-a', requestId: request.id, payloadHash: request.payloadHash, adapterId: 'kimi-code' });
  store.close();
  const reopened = createOperationalStore({ filename });
  try {
    reopened.reconcileRuns();
    const restored = reopened.getAgentRequest('project-a', request.id);
    assert.equal(restored.state, 'failed');
    assert.match(restored.error, /interrompida/);
    assert.equal(restored.sessionId, null);
    assert.equal(restored.resolvedBy, 'user');
    reopened.reconcileRuns();
    assert.equal(reopened.listEvents('project-a').filter((item) => item.type === 'approval.failed').length, 1);
    assert.equal(reopened.listSessions('project-a').length, 2);
  } finally { reopened.close(); }
});

test('aprovação pela interface inicia agente com origem orchestrator e conclui o pedido', async (t) => {
  const { ask, call, spawns, changes, store } = harness(t);
  const request = ask();
  const listed = await call('agent-request:list', { cwd: '/fixture/a' });
  assert.deepEqual(listed.policy, { mode: 'assisted', maxPending: 3, ttlMinutes: 15, maxActiveAgents: 2 });
  assert.equal(listed.items[0].payloadHash, request.payloadHash);
  const result = await call('agent-request:approve', { cwd: '/fixture/a', requestId: request.id, payloadHash: request.payloadHash, adapterId: 'kimi-code' });
  assert.equal(spawns.length, 1);
  assert.deepEqual(spawns[0].request, { adapterId: 'kimi-code', model: null, name: 'revisor-ansi', cwd: '/fixture/a', functionSlug: null, functionOverridden: null });
  // A escolha conferida na aprovação é a usada no início, sem nova consulta de modelos.
  assert.deepEqual(spawns[0].options, { origin: 'orchestrator', launch: { adapter: { id: 'kimi-code' }, model: null }, kickoff: true });
  assert.equal(result.request.state, 'fulfilled');
  assert.equal(result.request.sessionId, result.agent.id);
  assert.equal(result.request.resolvedBy, 'user');
  assert.deepEqual(changes, ['project-a']);
  const created = store.listEvents('project-a').find((item) => item.type === 'approval.fulfilled' && item.payload.requestId === request.id);
  assert.deepEqual(created.payload, { requestId: request.id, origin: 'orchestrator', requestedBy: 'orchestrator-a' });
  assert.equal(store.listSessions('project-a').find((item) => item.id === result.agent.id).origin, 'orchestrator');
  await assert.rejects(call('agent-request:approve', { cwd: '/fixture/a', requestId: request.id, payloadHash: request.payloadHash, adapterId: 'kimi-code' }), /já foi resolvido/);
});

test('aprovação vale só para o conteúdo exibido: hash divergente não inicia nada', async (t) => {
  const { ask, call, spawns, store } = harness(t);
  const request = ask();
  await assert.rejects(call('agent-request:approve', { cwd: '/fixture/a', requestId: request.id, payloadHash: 'f'.repeat(64), adapterId: 'kimi-code' }), /não corresponde/);
  await assert.rejects(call('agent-request:approve', { cwd: '/fixture/a', requestId: request.id }), /Conteúdo aprovado inválido/);
  assert.equal(spawns.length, 0);
  assert.equal(store.getAgentRequest('project-a', request.id).state, 'pending');
});

test('janela secundária, pasta não autorizada e projeto alheio não decidem pedidos', async (t) => {
  const { ask, call, store } = harness(t);
  const request = ask();
  await assert.rejects(call('agent-request:approve', { cwd: '/fixture/a', requestId: request.id, payloadHash: request.payloadHash, adapterId: 'kimi-code' }, 'popup'), /não autorizada/);
  await assert.rejects(call('agent-request:list', { cwd: '/fora' }), /pasta autorizada/);
  await assert.rejects(call('agent-request:reject', { cwd: '/fixture/b', requestId: request.id }), /não encontrado neste projeto/);
  assert.equal(store.getAgentRequest('project-a', request.id).state, 'pending');
});

test('limite de agentes ativos é verificado no ponto de execução', async (t) => {
  const { ask, call, spawns, store } = harness(t, { countActive: () => 2 });
  const request = ask();
  await assert.rejects(call('agent-request:approve', { cwd: '/fixture/a', requestId: request.id, payloadHash: request.payloadHash, adapterId: 'kimi-code' }), /Limite da política: 2 agentes/);
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
  const firstApproval = created.call('agent-request:approve', { cwd: '/fixture/a', requestId: first.id, payloadHash: first.payloadHash, adapterId: 'kimi-code' });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(created.call('agent-request:approve', { cwd: '/fixture/a', requestId: second.id, payloadHash: second.payloadHash, adapterId: 'kimi-code' }), /Limite da política/);
  release();
  assert.equal((await firstApproval).request.state, 'fulfilled');
  assert.equal(created.store.getAgentRequest('project-a', second.id).state, 'pending');
});

test('falha de spawn vira pedido failed com motivo, sem sessão fictícia', async (t) => {
  const { ask, call, store, changes } = harness(t, { createAgent: async () => { throw new Error('Kimi Code não está disponível.'); } });
  const request = ask();
  await assert.rejects(call('agent-request:approve', { cwd: '/fixture/a', requestId: request.id, payloadHash: request.payloadHash, adapterId: 'kimi-code' }), /não está disponível/);
  const failed = store.getAgentRequest('project-a', request.id);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.error, 'Kimi Code não está disponível.');
  assert.equal(failed.sessionId, null);
  assert.deepEqual(changes, ['project-a']);
  assert.equal(store.listEvents('project-a').filter((item) => item.type === 'approval.failed').length, 1);
});

test('falha de spawn libera a vaga reservada para a próxima aprovação', async (t) => {
  let attempts = 0;
  const { ask, call } = harness(t, { policy: { ...AGENT_REQUEST_POLICY, maxActiveAgents: 1 }, createAgent: async (request) => {
    attempts += 1;
    if (attempts === 1) throw new Error('Kimi Code não está disponível.');
    return { id: 'criado-depois', name: request.name, origin: 'orchestrator', cwd: request.cwd, state: 'running' };
  } });
  const first = ask({ name: 'primeiro' });
  const second = ask({ name: 'segundo' });
  await assert.rejects(call('agent-request:approve', { cwd: '/fixture/a', requestId: first.id, payloadHash: first.payloadHash, adapterId: 'kimi-code' }), /não está disponível/);
  const result = await call('agent-request:approve', { cwd: '/fixture/a', requestId: second.id, payloadHash: second.payloadHash, adapterId: 'kimi-code' });
  assert.equal(result.agent.id, 'criado-depois');
});

test('agente iniciado continua visível quando o registro do resultado falha', async (t) => {
  let spawned = 0;
  const context = harness(t, { createAgent: async (request) => {
    spawned += 1;
    // Simula o fechamento do app no meio do spawn: a reconciliação conclui o pedido antes.
    context.store.reconcileRuns('application_closed');
    return { id: 'criado-orfao', name: request.name, origin: 'orchestrator', cwd: request.cwd, state: 'running' };
  } });
  const request = context.ask();
  const result = await context.call('agent-request:approve', { cwd: '/fixture/a', requestId: request.id, payloadHash: request.payloadHash, adapterId: 'kimi-code' });
  assert.equal(spawned, 1);
  assert.equal(result.agent.id, 'criado-orfao');
  assert.equal(result.request, null);
  assert.match(result.recordError, /Somente pedidos aprovados/);
  assert.deepEqual(context.changes, ['project-a']);
});

test('recusa resolve o pedido e impede aprovação posterior', async (t) => {
  const { ask, call, store, changes } = harness(t);
  const request = ask();
  assert.equal((await call('agent-request:reject', { cwd: '/fixture/a', requestId: request.id })).state, 'rejected');
  assert.deepEqual(changes, ['project-a']);
  await assert.rejects(call('agent-request:approve', { cwd: '/fixture/a', requestId: request.id, payloadHash: request.payloadHash, adapterId: 'kimi-code' }), /já foi resolvido \(rejected\)/);
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
    assert.equal(reopened.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.at(-1).version);
    assert.equal(reopened.prepare("SELECT name FROM projects WHERE id = 'legacy'").get().name, 'Legado');
  } finally { reopened.close(); }
});

// v0.2, fase 3: a principal sugere a função; o usuário confirma ou troca no cartão.
test('pedido com função: valida o slug, entra no hash e aparece no cartão', (t) => {
  const { store, ask } = harness(t);
  assert.throws(() => ask({ functionSlug: 'inventada' }), /Função desconhecida: inventada\. Use uma de: planejar, explorar, implementar, revisar, testes\./);
  assert.throws(() => ask({ functionSlug: 'orquestrador' }), /Função desconhecida: orquestrador/, 'a função da principal não é pedida para agentes');
  assert.throws(() => ask({ functionSlug: 'Com Espaço' }), /Função inválida/);
  const withFunction = ask({ idempotencyKey: 'pedido-funcao-01', functionSlug: 'revisar' });
  const without = ask({ idempotencyKey: 'pedido-funcao-02' });
  assert.notEqual(withFunction.payloadHash, without.payloadHash, 'a função escrita pela principal entra no hash');
  assert.throws(() => ask({ idempotencyKey: 'pedido-funcao-01', functionSlug: 'testes' }), /outro conteúdo/, 'mesma chave com outra função');
  const listed = store.listAgentRequests('project-a').find((item) => item.id === withFunction.id);
  assert.equal(listed.functionSlug, 'revisar');
  assert.equal(listed.functionName, 'Revisar');
  assert.equal(store.listAgentRequests('project-a').find((item) => item.id === without.id).functionSlug, null);
});

test('aprovação registra a função final e se o usuário trocou a sugestão', async (t) => {
  const { store, ask, call, spawns, filename } = harness(t);
  const revisar = store.getFunctionBySlug('revisar');
  store.updateFunction({ id: revisar.id, expectedVersion: revisar.version, adapterId: 'opencode', model: 'prov/forte' });
  const approve = (request, choice) => call('agent-request:approve', { cwd: '/fixture/a', requestId: request.id, payloadHash: request.payloadHash, ...choice });
  // Aceita a sugestão como veio: não alterado.
  await approve(ask({ idempotencyKey: 'aprova-funcao-01', functionSlug: 'revisar' }), { adapterId: 'opencode', model: 'prov/forte', functionSlug: 'revisar' });
  assert.equal(spawns[0].request.functionSlug, 'revisar');
  assert.equal(spawns[0].request.functionOverridden, false);
  // Mesma função, outro modelo: alterado.
  await approve(ask({ idempotencyKey: 'aprova-funcao-02', functionSlug: 'revisar' }), { adapterId: 'opencode', model: 'prov/fraco', functionSlug: 'revisar' });
  assert.equal(spawns[1].request.functionOverridden, true);
  // Outra função escolhida pelo usuário: alterado.
  const done = await approve(ask({ idempotencyKey: 'aprova-funcao-03', functionSlug: 'revisar' }), { adapterId: 'kimi-code', functionSlug: 'testes' });
  assert.equal(spawns[2].request.functionSlug, 'testes');
  assert.equal(spawns[2].request.functionOverridden, true);
  assert.equal(done.request.state, 'fulfilled');
  // A função da principal e slugs inventados não valem na aprovação, e nada é consumido.
  const kept = ask({ idempotencyKey: 'aprova-funcao-04', functionSlug: 'revisar' });
  await assert.rejects(approve(kept, { adapterId: 'opencode', functionSlug: 'orquestrador' }), /Função inválida/);
  await assert.rejects(approve(kept, { adapterId: 'opencode', functionSlug: 'inventada' }), /Função inválida/);
  assert.equal(store.getAgentRequest('project-a', kept.id).state, 'pending');
  assert.equal(spawns.length, 3);
  // A run persiste a auditoria.
  store.startSession({ id: 'auditada', projectId: 'project-a', name: 'auditada', adapterId: 'opencode', cli: 'OpenCode', version: '1', cwd: '/fixture/a', origin: 'orchestrator', createdAt: new Date(START).toISOString(), functionSlug: 'revisar', functionOverridden: true });
  const db = new DatabaseSync(filename, { timeout: 1000 });
  try {
    const run = db.prepare("SELECT function_slug, function_overridden FROM agent_runs r JOIN sessions s ON s.id = r.session_id WHERE s.id = 'auditada'").get();
    assert.deepEqual({ ...run }, { function_slug: 'revisar', function_overridden: 1 });
  } finally {
    db.close();
  }
});

test('aprovação sem tarefa entrega o propósito como mensagem da principal ao novo agente', async (t) => {
  const { ask, call, store } = harness(t);
  const request = ask();
  const result = await call('agent-request:approve', { cwd: '/fixture/a', requestId: request.id, payloadHash: request.payloadHash, adapterId: 'claude-code' });
  const messages = store.listMessages('project-a').filter((item) => item.toSessionId === result.agent.id);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].fromSessionId, 'orchestrator-a');
  assert.equal(messages[0].subject, 'Pedido aprovado: revisor-ansi');
  assert.equal(messages[0].body, 'Revisar a divergência ANSI relatada pela sessão manual.');
  assert.deepEqual(result.delivery, { messageId: messages[0].id });
  assert.equal(result.request.state, 'fulfilled');
});

test('aprovação com tarefa oferece a tarefa ao novo agente com o propósito, auditada como do usuário', async (t) => {
  const { ask, call, store } = harness(t);
  const task = store.createTask({ projectId: 'project-a', title: 'Mensagens legíveis', acceptance: 'Painel legível em três larguras.', idempotencyKey: 'tarefa-entrega-01', actor: 'agent:orchestrator-a' });
  const request = ask({ taskId: task.id });
  const result = await call('agent-request:approve', { cwd: '/fixture/a', requestId: request.id, payloadHash: request.payloadHash, adapterId: 'claude-code' });
  const offered = store.listHandoffs('project-a').filter((item) => item.taskId === task.id);
  assert.equal(offered.length, 1);
  assert.equal(offered[0].state, 'offered');
  assert.equal(offered[0].fromSessionId, 'orchestrator-a');
  assert.equal(offered[0].toSessionId, result.agent.id);
  assert.equal(offered[0].objective, 'Revisar a divergência ANSI relatada pela sessão manual.');
  assert.deepEqual(result.delivery, { handoffId: offered[0].id });
  assert.equal(store.listEvents('project-a').find((item) => item.type === 'handoff.offered').payload.actor, 'user');
  assert.equal(store.listMessages('project-a').filter((item) => item.toSessionId === result.agent.id).length, 0, 'com a oferta, sem mensagem duplicada');
});

test('oferta impossível na aprovação cai para a mensagem com o motivo; falha total não derruba o agente', async (t) => {
  const context = harness(t);
  const { ask, call, store } = context;
  const task = store.createTask({ projectId: 'project-a', title: 'Já oferecida', acceptance: 'Aceite.', idempotencyKey: 'tarefa-entrega-02' });
  const request = ask({ taskId: task.id });
  // Outra oferta aberta para a mesma tarefa impede a segunda.
  store.offerHandoff({ projectId: 'project-a', fromSessionId: 'orchestrator-a', toSessionId: 'manual-a', taskId: task.id, objective: 'Assumir.', idempotencyKey: 'oferta-anterior-01' });
  const result = await call('agent-request:approve', { cwd: '/fixture/a', requestId: request.id, payloadHash: request.payloadHash, adapterId: 'claude-code' });
  assert.match(result.delivery.offerError, /oferta aberta/);
  const message = store.listMessages('project-a').find((item) => item.toSessionId === result.agent.id);
  assert.match(message.body, /^Revisar a divergência ANSI[\s\S]*não pôde ser oferecida automaticamente: Já existe uma oferta aberta/);

  // Sem como entregar (a principal sumiu do projeto), o agente continua iniciado e o pedido atendido.
  const second = ask({ name: 'sem-entrega' });
  const original = store.sendMessage;
  store.sendMessage = () => { throw new Error('banco indisponível'); };
  const failed = await call('agent-request:approve', { cwd: '/fixture/a', requestId: second.id, payloadHash: second.payloadHash, adapterId: 'claude-code' });
  store.sendMessage = original;
  assert.equal(failed.request.state, 'fulfilled');
  assert.equal(failed.deliveryError, 'banco indisponível');
});

// Item 5 da v0.2: política de agentes por projeto.
function fakeWorktrees(created = []) {
  return {
    planWorktree: ({ taskId }) => ({ path: '/fixture/a-wt/' + taskId, branch: 'atlas/task-' + taskId }),
    createWorktree: async (plan) => { created.push(plan.path); return { repositoryPath: '/fixture/a', path: '/fixture/a-wt', branch: plan.branch, baseCommit: 'a'.repeat(40) }; },
  };
}

function autonomousHarness(t, options = {}) {
  const created = [];
  const context = harness(t, { worktrees: fakeWorktrees(created), allowed: ['/fixture/a-wt'], ...options });
  const { store } = context;
  const implementar = store.getFunctionBySlug('implementar');
  store.updateFunction({ id: implementar.id, expectedVersion: implementar.version, adapterId: 'opencode', model: 'prov/forte' });
  const task = (title = 'Tarefa autônoma') => store.createTask({ projectId: 'project-a', title, acceptance: 'Critério.', idempotencyKey: 'tarefa-' + Math.random().toString(16).slice(2, 10), actor: 'agent:orchestrator-a' });
  const setPolicy = (overrides = {}) => store.setAgentPolicy({ projectId: 'project-a', mode: 'autonomous', maxActiveAgents: 2, maxPending: 3, ...overrides });
  return { ...context, created, task, setPolicy };
}

test('política: padrão da v0.1, faixa de 1 a 6, modo válido, projeto existente e versão conferida', (t) => {
  const { store } = harness(t);
  assert.deepEqual(store.getAgentPolicy('project-a'), { mode: 'assisted', maxActiveAgents: 2, maxPending: 3, ttlMs: 15 * 60 * 1000, version: 0 });
  const saved = store.setAgentPolicy({ projectId: 'project-a', mode: 'autonomous', maxActiveAgents: 4, maxPending: 5, expectedVersion: 0 });
  assert.deepEqual({ ...saved }, { mode: 'autonomous', maxActiveAgents: 4, maxPending: 5, ttlMs: 15 * 60 * 1000, version: 1 });
  assert.equal(store.getAgentPolicy('project-b').mode, 'assisted', 'cada projeto tem a sua');
  assert.throws(() => store.setAgentPolicy({ projectId: 'project-a', mode: 'auto', maxActiveAgents: 2, maxPending: 3 }), /Modo da política/);
  for (const value of [0, 7, 2.5, '3']) {
    assert.throws(() => store.setAgentPolicy({ projectId: 'project-a', mode: 'assisted', maxActiveAgents: value, maxPending: 3 }), /Agentes ativos/);
    assert.throws(() => store.setAgentPolicy({ projectId: 'project-a', mode: 'assisted', maxActiveAgents: 2, maxPending: value }), /Pedidos aguardando/);
  }
  assert.throws(() => store.setAgentPolicy({ projectId: 'nenhum', mode: 'assisted', maxActiveAgents: 2, maxPending: 3 }), /Projeto não encontrado/);
  assert.throws(() => store.setAgentPolicy({ projectId: 'project-a', mode: 'assisted', maxActiveAgents: 2, maxPending: 3, expectedVersion: 0 }), /alterada em outra janela/);
  const audited = store.listEvents('project-a').filter((item) => item.type === 'agent.policy');
  assert.deepEqual(audited.map((item) => item.payload), [{ mode: 'autonomous', maxActiveAgents: 4, maxPending: 5, actor: 'user' }]);
});

test('política: limites do projeto valem para pedidos pendentes e para a aprovação no cartão', async (t) => {
  const { store, ask, call } = harness(t, { countActive: () => 1 });
  store.setAgentPolicy({ projectId: 'project-a', mode: 'assisted', maxActiveAgents: 1, maxPending: 1 });
  const first = ask();
  assert.throws(() => ask({ name: 'segundo' }), /já há 1 pedidos de agente aguardando/);
  await assert.rejects(call('agent-request:approve', { cwd: '/fixture/a', requestId: first.id, payloadHash: first.payloadHash, adapterId: 'kimi-code' }), /Limite da política: 1 agentes/);
  store.setAgentPolicy({ projectId: 'project-a', mode: 'assisted', maxActiveAgents: 2, maxPending: 1 });
  const approved = await call('agent-request:approve', { cwd: '/fixture/a', requestId: first.id, payloadHash: first.payloadHash, adapterId: 'kimi-code' });
  assert.equal(approved.request.state, 'fulfilled');
  assert.equal(approved.request.resolvedBy, 'user');
});

test('modo autônomo aprova sozinho o pedido elegível com o CLI e o modelo salvos na função', async (t) => {
  const { store, ask, requestHost, spawns, created, task, setPolicy, autoApproved } = autonomousHarness(t);
  setPolicy();
  const work = task();
  const request = ask({ taskId: work.id, worktree: true, functionSlug: 'implementar' });
  await requestHost.evaluate('project-a');
  assert.equal(spawns.length, 1);
  assert.deepEqual(spawns[0].request, { adapterId: 'opencode', model: 'prov/forte', name: 'revisor-ansi', cwd: '/fixture/a-wt', functionSlug: 'implementar', functionOverridden: false });
  assert.deepEqual(spawns[0].options.kickoff, true);
  assert.equal(created.length, 1, 'worktree nova para a tarefa');
  const resolved = store.getAgentRequest('project-a', request.id);
  assert.equal(resolved.state, 'fulfilled');
  assert.equal(resolved.resolvedBy, 'policy');
  assert.equal(store.listEvents('project-a').find((item) => item.type === 'approval.resolved' && item.payload.requestId === request.id).payload.by, 'policy');
  assert.equal(autoApproved.length, 1);
  assert.equal(autoApproved[0].result.delivery.handoffId, store.listHandoffs('project-a').find((item) => item.taskId === work.id).id, 'a tarefa é oferecida ao agente');
});

test('modo autônomo deixa com o usuário, com o motivo no cartão, o que não cumpre as regras', async (t) => {
  const { store, ask, call, requestHost, spawns, created, task, setPolicy } = autonomousHarness(t);
  setPolicy();
  const noTask = ask({ name: 'sem-tarefa', functionSlug: 'implementar' });
  const noWorktree = ask({ name: 'sem-worktree', taskId: task('Sem worktree').id, functionSlug: 'implementar' });
  const noFunction = ask({ name: 'sem-funcao', taskId: task('Sem função').id, worktree: true });
  await requestHost.evaluate('project-a');
  // A função revisar ainda não tem CLI salvo.
  const listed = (await call('agent-request:list', { cwd: '/fixture/a' })).items;
  const note = (id) => listed.find((item) => item.id === id).autoNote;
  assert.match(note(noTask.id), /Sem tarefa com worktree/);
  assert.match(note(noWorktree.id), /Sem tarefa com worktree/);
  assert.match(note(noFunction.id), /Sem função indicada/);
  assert.equal(spawns.length, 0);
  assert.equal(created.length, 0);
  assert(listed.every((item) => item.state === 'pending'));
  store.rejectAgentRequest({ projectId: 'project-a', requestId: noTask.id });
  const unconfigured = ask({ name: 'revisar', taskId: task('Revisar').id, worktree: true, functionSlug: 'revisar' });
  await requestHost.evaluate('project-a');
  assert.match((await call('agent-request:list', { cwd: '/fixture/a' })).items.find((item) => item.id === unconfigured.id).autoNote, /ainda não tem CLI salvo/);
  assert.equal(spawns.length, 0);
});

test('modo autônomo espera vaga e aprova quando um agente termina; assistido não aprova nada', async (t) => {
  let active = 2;
  const { store, ask, call, requestHost, spawns, task, setPolicy } = autonomousHarness(t, { countActive: () => active });
  const request = ask({ taskId: task().id, worktree: true, functionSlug: 'implementar' });
  await requestHost.evaluate('project-a');
  assert.equal(spawns.length, 0, 'modo assistido: nada é aprovado sozinho');
  assert.equal((await call('agent-request:list', { cwd: '/fixture/a' })).items[0].autoNote, undefined);
  setPolicy();
  await requestHost.evaluate('project-a');
  assert.match((await call('agent-request:list', { cwd: '/fixture/a' })).items[0].autoNote, /Aguardando vaga: 2 de 2/);
  // A fila "Precisam de mim" lê o mesmo motivo, só no modo autônomo.
  assert.match(requestHost.autoNoteFor(request.id, 'project-a'), /Aguardando vaga: 2 de 2/);
  store.setAgentPolicy({ projectId: 'project-a', mode: 'assisted', maxActiveAgents: 2, maxPending: 3 });
  assert.equal(requestHost.autoNoteFor(request.id, 'project-a'), null);
  setPolicy();
  active = 1;
  await requestHost.evaluate('project-a');
  assert.equal(spawns.length, 1);
  assert.equal(store.getAgentRequest('project-a', request.id).resolvedBy, 'policy');
});

test('modo autônomo sem CLI disponível não consome o pedido nem cria worktree', async (t) => {
  const { store, ask, call, requestHost, spawns, created, task, setPolicy } = autonomousHarness(t, { resolveLaunch: async () => { throw new Error('Codex não está disponível.'); } });
  setPolicy();
  const request = ask({ taskId: task().id, worktree: true, functionSlug: 'implementar' });
  await requestHost.evaluate('project-a');
  assert.equal(store.getAgentRequest('project-a', request.id).state, 'pending');
  assert.equal(spawns.length, 0);
  assert.equal(created.length, 0);
  assert.match((await call('agent-request:list', { cwd: '/fixture/a' })).items[0].autoNote, /não conseguiu iniciar: Codex não está disponível/);
});

test('diálogo da política: só a janela principal lê e altera; ligar o modo reavalia os pendentes', async (t) => {
  const { store, ask, call, spawns, task } = autonomousHarness(t);
  await assert.rejects(call('agent-policy:get', { cwd: '/fixture/a' }, 'popup'), /Janela não autorizada/);
  await assert.rejects(call('agent-policy:set', { cwd: '/fixture/a', mode: 'autonomous', maxActiveAgents: 2, maxPending: 3 }, 'popup'), /Janela não autorizada/);
  assert.deepEqual(await call('agent-policy:get', { cwd: '/fixture/a' }), { projectId: 'project-a', policy: { mode: 'assisted', maxActiveAgents: 2, maxPending: 3, version: 0 }, range: { min: 1, max: 6 } });
  ask({ taskId: task().id, worktree: true, functionSlug: 'implementar' });
  const saved = await call('agent-policy:set', { cwd: '/fixture/a', mode: 'autonomous', maxActiveAgents: 3, maxPending: 3, expectedVersion: 0 });
  assert.deepEqual(saved, { projectId: 'project-a', policy: { mode: 'autonomous', maxActiveAgents: 3, maxPending: 3, version: 1 } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(spawns.length, 1, 'o pedido que esperava foi aprovado ao ligar o modo');
  await assert.rejects(call('agent-policy:set', { cwd: '/fixture/a', mode: 'autonomous', maxActiveAgents: 9, maxPending: 3, expectedVersion: 1 }), /Agentes ativos/);
  assert.equal(store.getAgentPolicy('project-a').maxActiveAgents, 3);
});
