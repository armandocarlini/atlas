import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBriefing } from '../electron/briefing.cjs';
import { createBriefingHost } from '../electron/briefing-host.cjs';
import { createOperationalStore } from '../electron/operational-store.cjs';

const before = '2026-11-13T10:00:00.000Z';
const now = '2026-11-13T12:00:00.000Z';
const live = { id: 'agent', name: 'Revisão', cli: 'Codex', functionName: 'Revisor', role: 'agent', tasks: [{ id: 't', title: 'Teste' }, { id: 't2', title: 'Outra tarefa' }], terminalId: 'pty' };

test('briefing mostra só fatos mapeados após a visita, com limite por projeto', () => {
  const events = [
    ['task.completed', { taskId: 't' }, 'task_completed'],
    ['task.review_requested', { taskId: 't' }, 'task_in_review'],
    ['run.succeeded', {}, 'run_succeeded'],
    ['run.failed', {}, 'run_failed'],
    ['run.lost', { reason: 'application_restarted' }, 'run_lost'],
    ['regression.finished', { state: 'passed' }, 'regression_finished'],
    ['unknown', {}, null],
    ['regression.finished', { state: 'unknown' }, null],
    ['run.lost', { reason: 'user_closed' }, 'run_stopped'],
  ].map(([type, payload, kind], i) => ({ id: `e${i}`, project_id: 'p', type, payload, session_name: 'Nome\u0007', task_title: 'Teste\u200b', created_at: now, kind }));
  const items = [{ projectId: 'p', id: 'pending' }];
  const input = {
    lastVisitAt: before, items,
    projects: [{ projectId: 'quiet', projectName: 'Quieto' }, { projectId: 'p', projectName: 'Projeto' }],
    events: [...events, { ...events[0], id: 'old', created_at: before }],
    sessions: [{ ...live, projectId: 'p' }, { id: 'external', name: 'Externo', cli: 'Kimi Code', role: 'agent', external: true, projectId: 'p' }],
    principalProjectIds: ['p'],
  };
  const [active, quiet] = buildBriefing(input);
  assert.equal(active.projectId, 'p');
  assert.deepEqual(active.precisa, items);
  assert.equal(active.aconteceu.length, 6);
  assert.equal(active.mais, 1);
  assert.deepEqual(buildBriefing({ ...input, limit: 10 })[0].aconteceu.map(({ kind }) => kind), events.flatMap(({ kind }) => kind ? [kind] : []));
  assert.equal(active.aconteceu[0].title, 'Teste');
  assert.deepEqual(active.agora.sessoes[0].tasks, live.tasks);
  assert.equal(active.agora.sessoes[0].functionName, 'Revisor');
  assert.equal(active.agora.sessoes[0].cli, 'Codex');
  assert.equal(active.agora.sessoes[1].terminalId, null);
  assert.equal(active.agora.principal, 'ended');
  assert.equal(quiet.semNovidades, true);
  assert.equal(quiet.agora.principal, 'never_started');
  assert.equal(buildBriefing({ ...input, lastVisitAt: null })[0].aconteceu.length, 0);
  const stopped = { ...events[3], payload: { exitCode: 1 }, run_reason: 'user_closed' };
  assert.equal(buildBriefing({ ...input, events: [stopped] })[0].aconteceu[0].kind, 'run_stopped');
  for (const [session, state] of [[{ ...live }, 'running'], [{ ...live, terminalId: null, external: true }, 'external']]) {
    const [card] = buildBriefing({ ...input, sessions: [{ ...session, projectId: 'p', role: 'orchestrator' }] });
    assert.equal(card.agora.principal, state);
  }
});

function fixture(t) {
  const store = createOperationalStore({ filename: ':memory:', now: () => now });
  t.after(() => store.close());
  for (const [id, path] of [['p', 'allowed'], ['other', 'other'], ['closed', 'forbidden']]) store.registerProject({ id, name: id, path });
  const agents = new Map();
  const ptys = new Map();
  const writes = [];
  for (const [id, projectId, role, attachment, state] of [
    ['principal', 'p', 'orchestrator'], ['worker', 'p', 'agent'], ['foreign', 'other', 'agent'],
    ['external', 'p', 'agent', 'external'], ['ended', 'p', 'agent', null, 'ended'], ['deleted', 'p', 'agent', null, 'deleted'],
    ['dead', 'p', 'agent'],
  ]) {
    const run = store.startSession({ id, projectId, name: id, role, attachment, cwd: projectId === 'p' ? 'allowed' : 'other', adapterId: 'fixture', cli: 'Fixture', version: '1', origin: 'user', createdAt: before });
    if (state) store.finishRun({ runId: run.id, expectedVersion: run.version, exitCode: 0 });
    if (state === 'deleted') store.removeSession(id);
    agents.set(id, { id, projectId, runId: run.id, ptyId: `pty-${id}`, state: 'running' });
    ptys.set(`pty-${id}`, { meta: { kind: 'agent', agentId: id }, exit: id === 'dead', bracketedPaste: { enabled: id === 'principal' }, process: { write: (text) => writes.push([id, text]) } });
  }
  const handlers = new Map();
  createBriefingHost({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, store,
    projectHost: { isAllowedCwd: (cwd) => cwd !== 'forbidden' },
    agentHost: { getAgent: (id) => agents.get(id) }, transport: { get: (id) => ptys.get(id) },
    terminalHost: { hasSession: (id) => id === 'shell', isMainSender: (event) => event.main },
  });
  const send = (request = {}, main = true) => handlers.get('briefing:send')({ main }, { projectId: 'p', sessionId: 'principal', text: 'Olá', idempotencyKey: 'test-key', ...request });
  return { send, writes, store, ptys };
}

test('briefing entrega no PTY resolvido no principal, higieniza, envia Enter e audita somente metadados', (t) => {
  const { send, writes, store } = fixture(t);
  const result = send({ text: 'a\u0003\u001b[201~\u200bb\r\nc', terminalId: 'pty-worker' });
  assert.deepEqual(send({ text: 'a\u0003\u001b[201~\u200bb\r\nc' }), result);
  assert.throws(() => send({ sessionId: 'worker' }), /chave/i);
  send({ sessionId: 'worker', idempotencyKey: 'worker-key' });
  assert.deepEqual(writes, [['principal', '\x1b[200~ab\rc\x1b[201~'], ['principal', '\r'], ['worker', 'Olá'], ['worker', '\r']]);
  const events = store.listEvents('p').filter(({ type }) => type === 'briefing.sent');
  assert.equal(events.length, 2);
  assert.equal(events[0].session_id, 'principal');
  assert(events[0].run_id);
  assert.deepEqual(events[0].payload, { length: 4 });
  assert.deepEqual(events[1].payload, { length: 3 });
});

test('briefing recusa outras janelas, projetos não autorizados, destinos sem PTY e texto inválido', (t) => {
  const { send, writes } = fixture(t);
  assert.throws(() => send({}, false), /janela/i);
  for (const [request, reason] of [
    [{ projectId: 'closed' }, /autorizad/i], [{ sessionId: 'foreign' }, /outro projeto/i],
    [{ sessionId: 'shell' }, /PowerShell/i], [{ sessionId: 'external' }, /externa/i],
    [{ sessionId: 'ended' }, /encerrada/i], [{ sessionId: 'deleted' }, /excluída/i],
    [{ sessionId: 'dead' }, /terminal/i], [{ text: '\u0003 ' }, /escreva/i],
    [{ text: 'a'.repeat(4001) }, /4000/], [{ sessionId: 'worker', text: 'a\nb' }, /colagem protegida/i],
  ]) assert.throws(() => send(request), reason);
  assert.deepEqual(writes, []);
});

test('uma falha durante o envio não permite repetir a mesma chave', (t) => {
  const { send, ptys, writes, store } = fixture(t);
  ptys.get('pty-principal').process.write = (text) => {
    if (text === '\r') throw new Error('PTY falhou');
    writes.push(text);
  };
  assert.throws(() => send(), /confirmar o envio/i);
  assert.throws(() => send(), /confirmar o envio/i);
  assert.equal(writes.length, 1);
  assert(!store.listEvents('p').some(({ type }) => type === 'briefing.sent'));
});

test('Briefing preserva os conectores de palavras e emojis na mensagem do usuário', (t) => {
  const { send, writes } = fixture(t);
  const text = 'می‌خواهم 👩‍💻';
  send({ text, sessionId: 'worker' });
  assert.deepEqual(writes, [['worker', text], ['worker', '\r']]);
});

test('fechamento normal usa o mesmo instante para o corte e para o fim das runs', (t) => {
  let tick = Date.parse(now);
  const store = createOperationalStore({ filename: ':memory:', now: () => new Date(tick++).toISOString() });
  t.after(() => store.close());
  store.registerProject({ id: 'p', name: 'Projeto', path: 'allowed' });
  store.startSession({ id: 'agent', projectId: 'p', name: 'Agente', adapterId: 'fixture', cli: 'Fixture', version: '1', cwd: 'allowed', origin: 'user', createdAt: before });
  store.markAppClosed();
  const attention = store.listAttention({ projectIds: ['p'] });
  assert.equal(store.listEvents('p').find(({ type }) => type === 'run.lost').created_at, attention.lastVisitAt);
  assert.deepEqual(store.briefingSources(['p'], attention.lastVisitAt).events, []);
});
