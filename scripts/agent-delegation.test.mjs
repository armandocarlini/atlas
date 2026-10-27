import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { createOperationalStore, migrate, MIGRATIONS } = require('../electron/operational-store.cjs');

function harness(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-delegation-'));
  const filename = path.join(directory, 'delegation.sqlite');
  const clock = { at: Date.parse('2026-10-27T10:00:00.000Z') };
  const now = () => { clock.at += 1000; return new Date(clock.at).toISOString(); };
  let store = createOperationalStore({ filename, now });
  for (const id of ['project-a', 'project-b']) store.registerProject({ id, name: id, path: `/fixture/${id}` });
  const runs = {};
  const session = (id, projectId, role = 'agent') => {
    const run = store.startSession({ id, projectId, name: `sessao-${id}`, adapterId: 'kimi-code', cli: 'Kimi Code', version: '2.3.3', cwd: `/fixture/${projectId}`, origin: 'user', createdAt: now(), role });
    runs[id] = run;
    return run;
  };
  session('principal', 'project-a', 'orchestrator');
  session('agente', 'project-a');
  session('outro', 'project-a');
  session('principal-b', 'project-b', 'orchestrator');
  session('agente-b', 'project-b');
  const task = (projectId = 'project-a', title = 'Corrigir ANSI') => store.createTask({ projectId, title, acceptance: 'Teste de regressão passa', idempotencyKey: `tarefa-${Math.random().toString(16).slice(2, 10)}` });
  const offer = (overrides = {}) => store.offerHandoff({ projectId: 'project-a', fromSessionId: 'principal', toSessionId: 'agente', objective: 'Corrigir a divergência ANSI descoberta pela sessão manual.', context: 'Ver mensagem da sessão manual.', nextSteps: 'Escrever regressão primeiro.', idempotencyKey: `oferta-${Math.random().toString(16).slice(2, 10)}`, ...overrides });
  const accept = (handoff, sessionId = 'agente') => store.acceptHandoff({ projectId: 'project-a', handoffId: handoff.id, sessionId, runId: runs[sessionId].id });
  const types = () => store.listEvents('project-a').map((item) => item.type);
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { get store() { return store; }, reopen() { store.close(); store = createOperationalStore({ filename, now }); return store; }, filename, runs, session, task, offer, accept, types };
}

test('principal oferece tarefa a um agente; backlog vira ready com oferta, comando e eventos', (t) => {
  const { store, task, offer, types } = harness(t);
  const created = task();
  const handoff = offer({ taskId: created.id, idempotencyKey: 'oferta-0001' });
  assert.equal(handoff.state, 'offered');
  assert.equal(handoff.taskTitle, 'Corrigir ANSI');
  assert.equal(handoff.fromName, 'sessao-principal');
  assert.equal(handoff.toName, 'sessao-agente');
  assert.equal(handoff.nextSteps, 'Escrever regressão primeiro.');
  assert.equal(store.getTask('project-a', created.id).state, 'ready');
  assert.deepEqual(offer({ taskId: created.id, idempotencyKey: 'oferta-0001' }), handoff, 'repetição idempotente');
  assert.throws(() => offer({ taskId: created.id, idempotencyKey: 'oferta-0001', objective: 'Outro objetivo' }), /já usada com outro conteúdo/);
  assert.throws(() => offer({ taskId: created.id }), /oferta aberta/);
  assert.deepEqual(types().filter((type) => type.startsWith('task.ready') || type.startsWith('handoff')), ['task.ready', 'handoff.offered']);
});

test('somente a principal delega, para agente ativo do mesmo projeto, sem textos invisíveis', (t) => {
  const { store, task, offer, session } = harness(t);
  const created = task();
  assert.throws(() => offer({ taskId: created.id, fromSessionId: 'agente', toSessionId: 'outro' }), /Somente a sessão principal/);
  assert.throws(() => offer({ taskId: created.id, toSessionId: 'principal' }), /não para a sessão principal/);
  assert.throws(() => offer({ taskId: created.id, toSessionId: 'agente-b' }), /não pertence a este projeto/);
  assert.throws(() => offer({ taskId: task('project-b').id }), /Tarefa não encontrada/);
  assert.throws(() => offer({ taskId: created.id, objective: '  ' }), /Objetivo/);
  assert.throws(() => offer({ taskId: created.id, context: 'contexto‮invertido' }), /Contexto: remova/);
  assert.throws(() => offer({ taskId: created.id, nextSteps: 'x'.repeat(2001) }), /Próximos passos/);
  const exited = session('encerrado', 'project-a');
  store.finishRun({ runId: exited.id, expectedVersion: 1, exitCode: 0 });
  assert.throws(() => offer({ taskId: created.id, toSessionId: 'encerrado' }), /não está em execução/);
  assert.equal(store.listHandoffs('project-a').length, 0);
  assert.equal(store.getTask('project-a', created.id).state, 'backlog');
});

test('aceite só pelo destino com a run ativa grava responsável, claim e epoch', (t) => {
  const { store, task, offer, accept, runs, types } = harness(t);
  const created = task();
  const handoff = offer({ taskId: created.id });
  assert.throws(() => accept(handoff, 'outro'), /Somente a sessão de destino/);
  assert.throws(() => store.acceptHandoff({ projectId: 'project-a', handoffId: handoff.id, sessionId: 'agente', runId: 'run-antiga' }), /run desta sessão não está ativa/);
  assert.throws(() => store.acceptHandoff({ projectId: 'project-b', handoffId: handoff.id, sessionId: 'agente', runId: runs.agente.id }), /não encontrado neste projeto/);
  const { task: claimed, handoff: accepted } = accept(handoff);
  assert.equal(accepted.state, 'accepted');
  assert.equal(accepted.resolvedBy, 'agent:agente');
  assert.equal(claimed.state, 'in_progress');
  assert.equal(claimed.assignedSessionId, 'agente');
  assert.equal(claimed.assigneeName, 'sessao-agente');
  assert.equal(claimed.claimRunId, runs.agente.id);
  assert.equal(claimed.claimEpoch, 1);
  assert.throws(() => accept(handoff), /já foi resolvido/);
  assert.deepEqual(types().slice(-2), ['handoff.accepted', 'task.assigned']);
});

test('recusa e cancelamento resolvem a oferta sem mudar a tarefa e liberam nova oferta', (t) => {
  const { store, task, offer } = harness(t);
  const created = task();
  const first = offer({ taskId: created.id });
  assert.throws(() => store.rejectHandoff({ projectId: 'project-a', handoffId: first.id, sessionId: 'outro', reason: 'Não é comigo.' }), /Somente a sessão de destino/);
  assert.throws(() => store.rejectHandoff({ projectId: 'project-a', handoffId: first.id, sessionId: 'agente', reason: '' }), /Motivo/);
  const rejected = store.rejectHandoff({ projectId: 'project-a', handoffId: first.id, sessionId: 'agente', reason: 'Sem contexto do módulo.' });
  assert.equal(rejected.state, 'rejected');
  assert.equal(rejected.reason, 'Sem contexto do módulo.');
  assert.equal(store.getTask('project-a', created.id).state, 'ready');
  const second = offer({ taskId: created.id, toSessionId: 'outro' });
  assert.throws(() => store.cancelHandoff({ projectId: 'project-a', handoffId: second.id, actor: 'agent:agente' }), /Somente o usuário ou a sessão que ofereceu/);
  assert.equal(store.cancelHandoff({ projectId: 'project-a', handoffId: second.id, actor: 'user' }).state, 'canceled');
  assert.throws(() => store.cancelHandoff({ projectId: 'project-a', handoffId: second.id, actor: 'user' }), /já foi resolvido/);
  const third = offer({ taskId: created.id });
  assert.equal(store.cancelHandoff({ projectId: 'project-a', handoffId: third.id, actor: 'agent:principal' }).resolvedBy, 'agent:principal');
});

test('progresso, bloqueio e retomada exigem o claim atual', (t) => {
  const { store, task, offer, accept, runs, types } = harness(t);
  const created = task();
  accept(offer({ taskId: created.id }));
  const update = (kind, note, sessionId = 'agente', runId = runs[sessionId].id) => store.updateTask({ projectId: 'project-a', taskId: created.id, sessionId, runId, kind, note });
  assert.equal(update('progress', 'Regressão escrita.').state, 'in_progress');
  assert.throws(() => update('progress', 'Tentando assumir.', 'outro'), /não é responsável/);
  assert.throws(() => update('resumed', 'Nada bloqueado.'), /não está bloqueada/);
  assert.throws(() => update('done', 'Pronto.'), /Tipo de atualização inválido/);
  const blocked = update('blocked', 'Falta acesso ao fixture de terminal.');
  assert.equal(blocked.state, 'blocked');
  assert.equal(blocked.blockedReason, 'Falta acesso ao fixture de terminal.');
  assert.throws(() => update('blocked', 'De novo.'), /já está bloqueada/);
  const resumed = update('resumed', 'Fixture liberado.');
  assert.equal(resumed.state, 'in_progress');
  assert.equal(resumed.blockedReason, null);
  const progress = store.listEvents('project-a').find((item) => item.type === 'task.progress');
  assert.deepEqual(progress.payload, { taskId: created.id, epoch: 1, note: 'Regressão escrita.' });
  assert.deepEqual(types().filter((type) => /task\.(progress|blocked|unblocked)/.test(type)), ['task.progress', 'task.blocked', 'task.unblocked']);
});

test('devolução pelo usuário incrementa o epoch e cerca o dono anterior', (t) => {
  const { store, task, offer, accept, runs } = harness(t);
  const created = task();
  accept(offer({ taskId: created.id }));
  const released = store.releaseTask({ projectId: 'project-a', taskId: created.id, actor: 'user' });
  assert.equal(released.state, 'ready');
  assert.equal(released.assignedSessionId, null);
  assert.equal(released.claimEpoch, 2);
  assert.throws(() => store.updateTask({ projectId: 'project-a', taskId: created.id, sessionId: 'agente', runId: runs.agente.id, kind: 'progress', note: 'Ainda trabalhando.' }), /não é responsável/);
  assert.throws(() => store.releaseTask({ projectId: 'project-a', taskId: created.id, actor: 'user' }), /não está com um responsável/);
  // Nova oferta e novo aceite geram epoch maior que o do dono anterior.
  const again = accept(offer({ taskId: created.id, toSessionId: 'outro' }), 'outro').task;
  assert.equal(again.claimEpoch, 3);
});

test('devolução pelo próprio agente exige claim e motivo', (t) => {
  const { store, task, offer, accept, runs } = harness(t);
  const created = task();
  accept(offer({ taskId: created.id }));
  const release = (sessionId, reason) => store.releaseTask({ projectId: 'project-a', taskId: created.id, actor: `agent:${sessionId}`, sessionId, runId: runs[sessionId].id, reason });
  assert.throws(() => release('outro', 'Não é minha.'), /não é responsável/);
  assert.throws(() => release('agente', ''), /Motivo/);
  const released = release('agente', 'Escopo maior que o combinado.');
  assert.equal(released.state, 'ready');
  const event = store.listEvents('project-a').find((item) => item.type === 'task.released');
  assert.deepEqual(event.payload, { taskId: created.id, actor: 'agent:agente', previousEpoch: 1, reason: 'Escopo maior que o combinado.' });
});

test('fim da run perde o claim sem concluir nem devolver a tarefa', (t) => {
  const { store, task, offer, accept, runs } = harness(t);
  const created = task();
  accept(offer({ taskId: created.id }));
  store.finishRun({ runId: runs.agente.id, expectedVersion: 1, exitCode: 0 });
  const after = store.getTask('project-a', created.id);
  assert.equal(after.state, 'in_progress', 'run.succeeded não implica done nem ready');
  assert.equal(after.assignedSessionId, 'agente');
  assert.equal(after.claimRunId, null);
  assert.throws(() => store.updateTask({ projectId: 'project-a', taskId: created.id, sessionId: 'agente', runId: runs.agente.id, kind: 'progress', note: 'Depois de sair.' }), /claim desta tarefa não pertence à run atual/);
  assert.equal(store.listEvents('project-a').filter((item) => item.type === 'task.claim_lost').length, 1);
  assert.equal(store.releaseTask({ projectId: 'project-a', taskId: created.id, actor: 'user' }).state, 'ready');
});

test('reinício reconcilia a run perdida e preserva tarefa, handoff e responsável', (t) => {
  const context = harness(t);
  const created = context.task();
  const handoff = context.offer({ taskId: created.id });
  context.accept(handoff);
  const pending = context.offer({ taskId: context.task('project-a', 'Segunda').id, toSessionId: 'outro' });
  const store = context.reopen();
  store.reconcileRuns();
  const task = store.getTask('project-a', created.id);
  assert.equal(task.state, 'in_progress');
  assert.equal(task.assignedSessionId, 'agente');
  assert.equal(task.claimRunId, null);
  assert.deepEqual(store.listHandoffs('project-a').map((item) => [item.id, item.state]), [[handoff.id, 'accepted'], [pending.id, 'canceled']], 'oferta da run perdida não prende a tarefa');
  store.reconcileRuns();
  assert.equal(store.listEvents('project-a').filter((item) => item.type === 'task.claim_lost').length, 1);
});

test('migration 5→6 preserva tarefas anteriores sem responsável', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-delegation-migration-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'legacy.sqlite');
  const raw = new DatabaseSync(filename);
  try {
    raw.exec('PRAGMA foreign_keys = ON');
    migrate(raw, MIGRATIONS.slice(0, 5));
    raw.prepare('INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('legacy', 'Legado', '/legado', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    raw.prepare("INSERT INTO tasks VALUES ('t1', 'legacy', 'Antiga', '', 'Aceite', 'backlog', 1, 'user', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')").run();
  } finally { raw.close(); }
  const store = createOperationalStore({ filename });
  try {
    const [task] = store.listTasks('legacy');
    assert.equal(task.title, 'Antiga');
    assert.equal(task.state, 'backlog');
    assert.equal(task.assignedSessionId, null);
    assert.equal(task.claimEpoch, 0);
    assert.deepEqual(store.listHandoffs('legacy'), []);
  } finally { store.close(); }
});

test('regressão: oferta aberta é cancelada quando a run do destino termina e a tarefa pode ser delegada de novo', (t) => {
  const { store, task, offer, runs } = harness(t);
  const created = task();
  const stale = offer({ taskId: created.id });
  store.finishRun({ runId: runs.agente.id, expectedVersion: 1, exitCode: 0 });
  const canceled = store.getHandoff('project-a', stale.id);
  assert.equal(canceled.state, 'canceled');
  assert.equal(canceled.resolvedBy, 'system');
  assert.match(canceled.reason, /encerrou antes de responder/);
  assert.equal(store.getTask('project-a', created.id).state, 'ready');
  assert.equal(offer({ taskId: created.id, toSessionId: 'outro' }).state, 'offered');
  const event = store.listEvents('project-a').find((item) => item.type === 'handoff.canceled');
  assert.equal(event.payload.actor, 'system');
});

test('regressão: reinício cancela ofertas abertas de runs perdidas', (t) => {
  const context = harness(t);
  const created = context.task();
  const stale = context.offer({ taskId: created.id });
  const store = context.reopen();
  store.reconcileRuns();
  assert.equal(store.getHandoff('project-a', stale.id).state, 'canceled');
});

test('regressão: textos com quebra de linha CRLF são aceitos e normalizados', (t) => {
  const { task, offer } = harness(t);
  const handoff = offer({ taskId: task().id, objective: 'Primeira linha.\r\nSegunda linha.', nextSteps: 'Passo 1\r\nPasso 2' });
  assert.equal(handoff.objective, 'Primeira linha.\nSegunda linha.');
  assert.equal(handoff.nextSteps, 'Passo 1\nPasso 2');
  assert.throws(() => offer({ taskId: task('project-a', 'Outra').id, objective: 'Sozinho\rretorno' }), /Objetivo: remova/);
});
