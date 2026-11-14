import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildAttention, parsePrefs, parseItemId, snoozeUntil, clip } = require('../electron/attention.cjs');

const NOW = '2026-11-13T12:00:00.000Z';
const later = (minutes) => new Date(Date.parse(NOW) + minutes * 60000).toISOString();
const projects = [{ id: 'project-a', name: 'Primeiro' }, { id: 'project-b', name: 'Segundo' }];

const request = (fields = {}) => ({ id: 'req-1', project_id: 'project-a', requested_by: 'principal-a', name: 'Implementador', state: 'pending', created_at: later(-5), expires_at: later(10), resolved_at: null, session_id: null, error: null, task_id: null, ...fields });
const task = (fields = {}) => ({ id: 'task-1', project_id: 'project-a', title: 'Ajustar a fila', state: 'in_progress', updated_at: later(-20), blocked_reason: null, assigned_session_id: 'agent-1', ...fields });
const review = (fields = {}) => ({ id: 'rev-1', project_id: 'project-a', task_id: 'task-1', requested_by: 'agent-1', state: 'pending', created_at: later(-3), requester_name: 'Implementador', ...fields });
const run = (fields = {}) => ({ id: 'run-1', session_id: 'agent-1', state: 'failed', reason: null, exit_code: 1, signal: null, ended_at: later(-1), attempt: 1, project_id: 'project-a', session_name: 'Implementador', session_role: 'agent', session_removed_at: null, ...fields });

const build = (input) => buildAttention({ now: NOW, projects, ...input });
const kinds = (result) => result.view.items.map((item) => item.id);

test('request_pending: pedido pendente e válido entra; expirado ou resolvido não', () => {
  const positive = build({ requests: [request()] });
  assert.deepEqual(kinds(positive), ['request_pending:req-1']);
  const [item] = positive.view.items;
  assert.deepEqual(Object.keys(item), ['id', 'kind', 'projectId', 'projectName', 'taskId', 'sessionId', 'title', 'reason', 'urgency', 'evidence', 'createdAt']);
  assert.equal(item.projectName, 'Primeiro');
  assert.deepEqual(item.evidence, { type: 'agent_request', id: 'req-1' });
  assert.equal(item.urgency, 'normal');
  assert.deepEqual(kinds(build({ requests: [request({ expires_at: later(-1) })] })), []);
  for (const state of ['approved', 'rejected', 'expired', 'fulfilled']) assert.deepEqual(kinds(build({ requests: [request({ state })] })), [], state);
});

test('request_pending: o motivo do modo autônomo vai em reason', () => {
  const result = build({ requests: [request()], autoNotes: { 'req-1': 'Aguardando vaga: 2 de 2 agentes ativos.' } });
  assert.match(result.view.items[0].reason, /^Modo autônomo: Aguardando vaga: 2 de 2/);
  assert.match(build({ requests: [request()] }).view.items[0].reason, /aguardando sua aprovação/);
});

test('request_failed: pedido em failed entra; recusado não', () => {
  const result = build({ requests: [request({ state: 'failed', error: 'CLI não encontrado', resolved_at: later(-2) })] });
  assert.deepEqual(kinds(result), ['request_failed:req-1']);
  assert.equal(result.view.items[0].reason, 'CLI não encontrado');
  assert.equal(result.view.items[0].createdAt, later(-2));
  assert.deepEqual(kinds(build({ requests: [request({ state: 'rejected' })] })), []);
});

test('review_pending: revisão pendente com tarefa in_review entra; decidida ou tarefa fora de revisão não', () => {
  const tasks = [task({ state: 'in_review' })];
  const result = build({ tasks, reviews: [review()] });
  assert.deepEqual(kinds(result), ['review_pending:rev-1']);
  assert.equal(result.view.items[0].taskId, 'task-1');
  assert.deepEqual(result.view.items[0].evidence, { type: 'review', id: 'rev-1' });
  assert.deepEqual(kinds(build({ tasks: [task({ state: 'in_progress' })], reviews: [review()] })), []);
  assert.deepEqual(kinds(build({ tasks, reviews: [review({ state: 'accepted' })] })), []);
});

test('suíte vermelha com revisão pendente é um item só, com urgência alta e o estado da suíte', () => {
  const tasks = [task({ state: 'in_review' })];
  for (const state of ['failed', 'timeout', 'error']) {
    const result = build({ tasks, reviews: [review()], regressionRuns: [{ id: 'suite-1', review_id: 'rev-1', state }] });
    assert.deepEqual(kinds(result), ['review_pending:rev-1'], state);
    assert.equal(result.view.items[0].urgency, 'alta');
    assert.match(result.view.items[0].reason, new RegExp(`\\(${state}\\)`));
    assert.deepEqual(result.view.items[0].evidence, { type: 'regression_run', id: 'suite-1' });
  }
  for (const state of ['queued', 'running', 'passed', 'cancelled', 'interrupted', 'skipped']) {
    const result = build({ tasks, reviews: [review()], regressionRuns: [{ id: 'suite-1', review_id: 'rev-1', state }] });
    assert.equal(result.view.items.length, 1);
    assert.equal(result.view.items[0].urgency, 'normal', state);
  }
});

test('task_blocked: tarefa bloqueada entra com o motivo; outros estados não', () => {
  const result = build({ tasks: [task({ state: 'blocked', blocked_reason: 'Falta a credencial de teste' })] });
  assert.deepEqual(kinds(result), ['task_blocked:task-1']);
  assert.equal(result.view.items[0].reason, 'Falta a credencial de teste');
  for (const state of ['backlog', 'ready', 'in_progress', 'done', 'canceled']) assert.deepEqual(kinds(build({ tasks: [task({ state })] })), [], state);
});

test('run_failed: última run em failed ou lost por queda entra', () => {
  const failed = build({ runs: [run()] });
  assert.deepEqual(kinds(failed), ['run_failed:run-1']);
  assert.match(failed.view.items[0].reason, /código 1/);
  assert.deepEqual(failed.view.items[0].evidence, { type: 'agent_run', id: 'run-1' });
  const crashed = build({ runs: [run({ state: 'lost', reason: 'application_restarted', exit_code: null })] });
  assert.match(crashed.view.items[0].reason, /interrompido/);
  const principal = build({ runs: [run({ session_role: 'orchestrator', session_name: 'Principal' })] });
  assert.match(principal.view.items[0].title, /^Sessão principal parou: Principal/);
  const principalCrashed = build({ runs: [run({ session_role: 'orchestrator', session_name: 'Principal', state: 'lost', reason: 'application_restarted', exit_code: null })] });
  assert.deepEqual(kinds(principalCrashed), ['run_failed:run-1']);
  assert.match(principalCrashed.view.items[0].title, /^Sessão principal parou: Principal/);
});

test('run_failed: encerramento pelo usuário, fechamento normal, sucesso, run mais nova e sessão excluída não entram', () => {
  assert.deepEqual(kinds(build({ runs: [run({ session_role: 'orchestrator', reason: 'user_closed' })] })), [], 'principal encerrada pelo usuário');
  assert.deepEqual(kinds(build({ runs: [run({ reason: 'user_closed' })] })), [], 'Encerrar processo');
  assert.deepEqual(kinds(build({ runs: [run({ state: 'lost', reason: 'user_closed' })] })), [], 'Encerrar processo seguido de queda');
  assert.deepEqual(kinds(build({ runs: [run({ state: 'lost', reason: 'application_closed' })] })), [], 'fechamento normal');
  assert.deepEqual(kinds(build({ runs: [run({ state: 'succeeded', exit_code: 0 })] })), [], 'desanexar ou saída normal');
  assert.deepEqual(kinds(build({ runs: [run(), run({ id: 'run-2', state: 'running', attempt: 2, ended_at: null })] })), [], 'run mais nova');
  assert.deepEqual(kinds(build({ runs: [run({ id: 'run-2', attempt: 2 }), run({ state: 'succeeded' })] })), ['run_failed:run-2'], 'só a mais nova conta');
  assert.deepEqual(kinds(build({ runs: [run({ session_removed_at: later(-1) })] })), [], 'sessão excluída');
});

test('tarefas órfãs usam a run do claim perdido, ainda que a sessão tenha outra run viva', () => {
  const since = later(-10);
  const ended = run({ id: 'old', reason: 'user_closed', session_cli: 'Claude Code', function_name: 'Implementar' });
  const orphan = task({ claim_run_id: null, lost_run_id: 'old', lost_at: later(-1) });
  const input = { since, tasks: [orphan], runs: [ended, run({ id: 'live', attempt: 2, state: 'running' })] };
  const [item] = build(input).view.items;
  assert.equal(item.kind, 'task_orphaned');
  assert.match(item.title, /^Tarefa sem responsável:/);
  assert.match(item.reason, /Implementador \(Implementar, Claude Code\).*encerrada por você/);
  assert.equal(item.evidence.runId, 'old');
  assert.equal(item.resumeSessionIds.length, 0);
  assert.match(build({ ...input, runs: [{ ...ended, session_removed_at: later(0) }] }).view.items[0].reason, /encerrada por você .* enquanto trabalhava nesta tarefa\. A sessão foi excluída\./);
  assert.match(build({ ...input, runs: [{ ...ended, state: 'lost', reason: 'application_closed' }] }).view.items[0].reason, /ATLAS foi fechado/);
  assert.deepEqual(kinds(build({ ...input, tasks: [{ ...orphan, claim_run_id: 'live' }] })), []);
  assert.deepEqual(kinds(build({ ...input, since: later(0) })), []);
  assert.deepEqual(kinds(build({ ...input, tasks: [{ ...orphan, state: 'ready' }] })), []);
  assert.equal(build({ ...input, tasks: [{ ...orphan, lost_at: later(-20), updated_at: later(-2) }] }).view.items[0].kind, 'task_orphaned', 'revisão devolvida ao andamento após o marco');
});

test('handoff aberto com ponta parada e mensagens não lidas aparecem por projeto', () => {
  const stopped = run({ id: 'ended', session_id: 'a', reason: 'user_closed', session_name: 'Ana' });
  const active = run({ id: 'running', session_id: 'b', state: 'running' });
  const removed = run({ id: 'removed', project_id: 'project-b', session_id: 'x', session_name: 'Revisão', reason: 'user_closed', session_removed_at: later(0) });
  const handoff = { id: 'offer', project_id: 'project-a', state: 'offered', from_session_id: 'a', from_name: 'Ana', to_session_id: 'b', to_name: 'Bia', task_id: 'task', task_title: 'Revisar', created_at: later(-8) };
  const message = { id: 'm1', project_id: 'project-b', session_id: 'x', session_name: 'Revisão', subject: '<b>texto</b>\u200b', created_at: later(-5), latest_message_id: 'm2' };
  const input = { since: later(-7), runs: [stopped, active, removed], handoffs: [handoff], unreadMessages: [message, { ...message, id: 'm2', subject: 'Outro' }] };
  const [offered, unread] = build(input).view.items;
  assert.equal(offered.kind, 'handoff_stranded');
  assert.match(offered.reason, /remetente Ana/);
  assert.deepEqual(offered.resumeSessionIds, ['a']);
  assert.equal(unread.kind, 'messages_stranded');
  assert.match(unread.title, /^2 mensagens não lidas para Revisão/);
  assert.match(unread.reason, /<b>texto<\/b>/);
  assert(!unread.reason.includes('\u200b'));
  assert.equal(unread.projectId, 'project-b');
  assert.deepEqual(unread.resumeSessionIds, []);
  assert.deepEqual(kinds(build({ ...input, runs: [{ ...stopped, state: 'running' }, active, { ...removed, state: 'running', session_removed_at: null }] })), []);
  assert.deepEqual(kinds(build({ ...input, handoffs: [{ ...handoff, state: 'canceled' }], unreadMessages: [] })), []);
  assert.deepEqual(kinds(build({ ...input, since: later(0) })), []);
  const dismissedRaw = JSON.stringify({ [offered.id]: NOW, [unread.id]: NOW });
  assert.deepEqual(kinds(build({ ...input, dismissedRaw })), []);
  assert.equal(build({ ...input, dismissedRaw, runs: [{ ...stopped, id: 'next', attempt: 2 }, active, { ...removed, id: 'next-other', attempt: 2 }] }).view.items.length, 2);
});

test('dois projetos: itens dos dois na mesma lista com projectId correto; projeto fora da lista não entra', () => {
  const result = build({
    requests: [request(), request({ id: 'req-2', project_id: 'project-b', requested_by: 'principal-b' }), request({ id: 'req-3', project_id: 'project-x' })],
    tasks: [task({ id: 'task-b', project_id: 'project-b', state: 'blocked' })],
  });
  assert.deepEqual(result.view.items.map((item) => [item.id, item.projectId, item.projectName]), [
    ['task_blocked:task-b', 'project-b', 'Segundo'],
    ['request_pending:req-1', 'project-a', 'Primeiro'],
    ['request_pending:req-2', 'project-b', 'Segundo'],
  ]);
});

test('ordem: urgência alta primeiro, depois do mais antigo ao mais novo', () => {
  const result = build({
    requests: [request({ created_at: later(-30) })],
    tasks: [task({ state: 'in_review' }), task({ id: 'task-2', state: 'blocked', updated_at: later(-60) })],
    reviews: [review({ created_at: later(-1) })],
    regressionRuns: [{ id: 'suite-1', review_id: 'rev-1', state: 'failed' }],
  });
  assert.deepEqual(kinds(result), ['review_pending:rev-1', 'task_blocked:task-2', 'request_pending:req-1']);
});

test('texto de agentes é cortado e perde controles e formatação invisível', () => {
  const result = build({ tasks: [task({ state: 'blocked', title: `Título‮ invertido\n${'x'.repeat(300)}`, blocked_reason: `linha 1\r\nlinha 2​ ${'y'.repeat(400)}` })] });
  const [item] = result.view.items;
  assert(!/[\p{Cc}\p{Cf}]/u.test(item.title + item.reason));
  assert(Array.from(item.title).length <= 120);
  assert(Array.from(item.reason).length <= 240);
  assert(item.title.endsWith('…'));
  assert.equal(clip('🙂'.repeat(10), 5), `${'🙂'.repeat(4)}…`);
});

test('adiar: some até a data e volta sozinho; vencido é limpo', () => {
  const input = { tasks: [task({ state: 'blocked' })] };
  const snoozed = build({ ...input, snoozedRaw: JSON.stringify({ 'task_blocked:task-1': later(30) }) });
  assert.deepEqual(kinds(snoozed), []);
  assert.equal(snoozed.view.hidden.snoozed, 1);
  assert.equal(snoozed.prefsChanged.snoozed, false);
  assert.equal(snoozed.nextChangeAt, later(30));
  const back = buildAttention({ now: later(31), projects, ...input, snoozedRaw: JSON.stringify({ 'task_blocked:task-1': later(30) }) });
  assert.deepEqual(kinds(back), ['task_blocked:task-1']);
  assert.deepEqual(back.prefs.snoozed, {});
  assert.equal(back.prefsChanged.snoozed, true);
});

test('dispensar vale só para request_failed e run_failed; entradas de outros kinds são ignoradas e limpas', () => {
  const input = { runs: [run()], tasks: [task({ state: 'blocked' })], requests: [request({ state: 'failed' })] };
  const result = build({ ...input, dismissedRaw: JSON.stringify({ 'run_failed:run-1': later(-1), 'request_failed:req-1': later(-1), 'task_blocked:task-1': later(-1) }) });
  assert.deepEqual(kinds(result), ['task_blocked:task-1']);
  assert.deepEqual(Object.keys(result.prefs.dismissed).sort(), ['request_failed:req-1', 'run_failed:run-1']);
  assert.equal(result.prefsChanged.dismissed, true);
});

test('entradas de itens que não existem mais são limpas', () => {
  const result = build({ snoozedRaw: JSON.stringify({ 'request_pending:old': later(30) }), dismissedRaw: JSON.stringify({ 'run_failed:old': later(-5) }) });
  assert.deepEqual(result.prefs, { snoozed: {}, dismissed: {} });
  assert.deepEqual(result.prefsChanged, { snoozed: true, dismissed: true });
});

test('JSON corrompido em app_state não derruba a lista e é substituído', () => {
  for (const raw of ['{', 'null', '[]', '"texto"', JSON.stringify({ 'nao-e-item': later(1), 'task_blocked:task-1': 'ontem' })]) {
    const result = build({ tasks: [task({ state: 'blocked' })], snoozedRaw: raw, dismissedRaw: raw });
    assert.deepEqual(kinds(result), ['task_blocked:task-1'], raw);
    assert.equal(result.prefsChanged.snoozed, true, raw);
    assert.deepEqual(result.prefs.snoozed, {});
  }
  assert.deepEqual(parsePrefs('{'), { entries: {}, valid: false });
  assert.deepEqual(parsePrefs(null), { entries: {}, valid: true });
});

test('resumo por projeto: concluídas desde a visita, em andamento, bloqueadas e aguardando, com ids', () => {
  const tasks = [
    task({ id: 'done-old', state: 'done', updated_at: later(-120) }),
    task({ id: 'done-new', state: 'done', updated_at: later(-10) }),
    task({ id: 'working', state: 'in_progress' }),
    task({ id: 'stuck', state: 'blocked' }),
    task({ id: 'review', state: 'in_review' }),
    task({ id: 'other', project_id: 'project-b', state: 'in_progress' }),
  ];
  const result = build({ tasks, reviews: [review({ task_id: 'review' })], requests: [request({ task_id: 'working' })], lastVisitAt: later(-60) });
  const [a, b] = result.view.projects;
  assert.deepEqual(a, {
    projectId: 'project-a', projectName: 'Primeiro',
    doneSinceLastVisit: { count: 1, taskIds: ['done-new'] },
    inProgress: { count: 1, taskIds: ['working'] },
    blocked: { count: 1, taskIds: ['stuck'] },
    awaitingUser: { count: 2, taskIds: ['working', 'review'] },
  });
  assert.equal(b.inProgress.count, 1);
  assert.deepEqual(b.awaitingUser, { count: 0, taskIds: [] });
  assert.equal(build({ tasks, lastVisitAt: null }).view.projects[0].doneSinceLastVisit.count, 0);
});

test('id do item e prazo de adiar são validados', () => {
  assert.deepEqual(parseItemId('run_failed:abc-1'), { kind: 'run_failed', entityId: 'abc-1' });
  for (const value of ['run_failed:', 'outro:abc', 'run_failed:a b', 'run_failed:a:b', 42, null]) assert.equal(parseItemId(value), null, String(value));
  assert.equal(snoozeUntil(later(60), NOW), later(60));
  assert.throws(() => snoozeUntil(later(-1), NOW), /futuro/);
  assert.throws(() => snoozeUntil(later(31 * 24 * 60), NOW), /30 dias/);
  assert.throws(() => snoozeUntil('amanhã', NOW), /data válida/);
});
