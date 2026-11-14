// Fila "Precisam de mim" (docs/planos/PLANO_GESTAO_DE_ATENCAO.md): o que exige decisão
// do usuário entre todos os projetos, mais um resumo por projeto. Funções puras, sem
// I/O: recebem as linhas do banco e as preferências já lidas de `app_state`.

const { createHash } = require('node:crypto');
const STRANDED = ['task_orphaned', 'handoff_stranded', 'messages_stranded'];
const KINDS = Object.freeze(['request_pending', 'request_failed', 'review_pending', 'task_blocked', 'run_failed', ...STRANDED]);
const DISMISSIBLE = Object.freeze(['request_failed', 'run_failed', ...STRANDED]);
const ITEM_ID = new RegExp(`^(${KINDS.join('|')}):([A-Za-z0-9_-]{1,100})$`);
const RED_SUITE = Object.freeze({ failed: 'falhou', timeout: 'excedeu o prazo', error: 'não pôde ser executada' });
// Encerramentos que não são falha: "Encerrar processo" (operational-store markRunStopRequested)
// e o fechamento normal do app (markAppClosed). Desanexar fecha a run com código 0.
const ENDED_BY_USER = new Set(['user_closed', 'application_closed']);
const MAX_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;
const TITLE_MAX = 120;
const REASON_MAX = 240;

// Texto de agentes é dado não confiável: sem controles nem formatação invisível, cortado.
function clip(value, max) {
  const text = String(value ?? '').replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : text;
}

const isIso = (value) => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const time = (value) => Date.parse(value);

function parseItemId(value) {
  const match = typeof value === 'string' ? ITEM_ID.exec(value) : null;
  return match ? { kind: match[1], entityId: match[2] } : null;
}

// JSON de `app_state` validado na leitura: corrompido ou fora do formato vale como vazio,
// e cada entrada inválida é descartada (e limpa na próxima gravação).
function parsePrefs(raw) {
  if (raw === null || raw === undefined) return { entries: {}, valid: true };
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { entries: {}, valid: false };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { entries: {}, valid: false };
  const entries = {};
  let valid = true;
  for (const [key, at] of Object.entries(value)) {
    if (parseItemId(key) && isIso(at)) entries[key] = new Date(at).toISOString();
    else valid = false;
  }
  return { entries, valid };
}

function sameEntries(left, right) {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

function item(kind, entityId, fields) {
  return {
    id: `${kind}:${entityId}`,
    kind,
    projectId: fields.projectId,
    projectName: fields.projectName,
    taskId: fields.taskId ?? null,
    sessionId: fields.sessionId ?? null,
    title: clip(fields.title, TITLE_MAX),
    reason: clip(fields.reason, REASON_MAX),
    urgency: fields.urgency || 'normal',
    evidence: fields.evidence,
    createdAt: fields.createdAt,
    ...(fields.resumeSessionIds && { resumeSessionIds: fields.resumeSessionIds }),
  };
}

function runReason(run) {
  if (run.state === 'failed') {
    const code = Number.isInteger(run.exit_code) ? `código ${run.exit_code}` : 'código desconhecido';
    return `O processo saiu com ${code}${Number.isInteger(run.signal) && run.signal ? ` (sinal ${run.signal})` : ''}.`;
  }
  if (run.reason === 'application_restarted') return 'O ATLAS foi interrompido com a sessão em execução.';
  return 'A sessão foi perdida sem registro de saída.';
}

function occurrence(...ids) {
  return createHash('sha256').update(JSON.stringify(ids)).digest('hex').slice(0, 32);
}

function termination(run, { showRemoval = true } = {}) {
  if (showRemoval && run.session_removed_at) return ['foi excluída', run.session_removed_at];
  if (run.reason === 'user_closed') return ['foi encerrada por você', run.ended_at];
  if (run.reason === 'application_closed') return ['foi encerrada quando o ATLAS foi fechado', run.ended_at];
  if (run.reason === 'application_restarted') return ['foi interrompida quando o ATLAS parou', run.ended_at];
  if (run.state === 'failed' || run.state === 'lost') return ['parou com falha', run.ended_at];
  return ['encerrou', run.ended_at];
}

function eventTime(at) {
  return isIso(at) ? ` em ${new Date(at).toISOString().slice(0, 16).replace('T', ' às ')} UTC` : '';
}

function strandedItems({ since, tasks, runs, handoffs, unreadMessages, names }) {
  if (!isIso(since)) return [];
  const afterSince = (at) => time(at) > time(since);
  const byId = new Map(runs.map((run) => [run.id, run]));
  const latest = new Map();
  for (const run of runs) {
    const prior = latest.get(run.session_id);
    if (!prior || run.attempt > prior.attempt) latest.set(run.session_id, run);
  }
  const canResume = (run) => run && run.state !== 'running' && !run.session_removed_at && run.attachment !== 'external';
  const withoutRun = (sessionId) => latest.get(sessionId)?.state !== 'running';
  const base = (row) => ({ projectId: row.project_id, projectName: names.get(row.project_id) });
  const out = [];
  const newer = (...dates) => dates.filter(isIso).sort((a, b) => time(b) - time(a))[0];

  for (const task of tasks) {
    if (!names.has(task.project_id) || task.state !== 'in_progress' || task.claim_run_id) continue;
    const recorded = byId.get(task.lost_run_id);
    const run = recorded?.project_id === task.project_id && recorded.state !== 'running' ? recorded : null;
    const at = newer(task.lost_at, task.updated_at);
    if (!afterSince(at)) continue;
    const [ended, endedAt] = run ? termination(run, { showRemoval: false }) : [];
    const details = run && [clip(run.function_name, 36), clip(run.session_cli, 28)].filter(Boolean).join(', ');
    const who = run && `${clip(run.session_name, 42)}${details ? ` (${details})` : ''}`;
    const resume = run && canResume(latest.get(run.session_id)) ? [run.session_id] : [];
    out.push(item('task_orphaned', occurrence(task.id, task.claim_epoch, task.lost_run_id ?? null), {
      ...base(task), taskId: task.id, sessionId: run?.session_id,
      title: `Tarefa sem responsável: ${task.title}`,
      reason: [
        who && `${who} ${ended}${eventTime(endedAt)} enquanto trabalhava nesta tarefa.`,
        run?.session_removed_at && 'A sessão foi excluída.',
        'A tarefa continua em andamento, sem responsável.',
      ].filter(Boolean).join(' '),
      evidence: { type: 'task', id: task.id, ...(run && { runId: run.id }) },
      createdAt: at, resumeSessionIds: resume,
    }));
  }

  for (const handoff of handoffs) {
    if (handoff.state !== 'offered' || !names.has(handoff.project_id)) continue;
    const sides = [
      { id: handoff.from_session_id, name: handoff.from_name, role: 'remetente' },
      { id: handoff.to_session_id, name: handoff.to_name, role: 'destinatário' },
    ].filter(({ id }) => withoutRun(id)).map((side) => ({ ...side, run: latest.get(side.id) }));
    const at = newer(handoff.created_at, ...sides.map(({ run }) => run?.ended_at));
    if (!sides.length || !afterSince(at)) continue;
    out.push(item('handoff_stranded', occurrence(handoff.id, sides.map(({ id, run }) => [id, run?.id ?? null])), {
      ...base(handoff), taskId: handoff.task_id, sessionId: sides[0].id,
      title: `Handoff pendente: ${handoff.task_title}`,
      reason: sides.map(({ name, role, run }) => {
        const [ended, endedAt] = run ? termination(run) : ['está sem execução'];
        return `Sessão de ${role} ${clip(name, 33)} ${ended}${eventTime(endedAt)}.`;
      }).join(' '),
      evidence: { type: 'handoff', id: handoff.id },
      createdAt: at, resumeSessionIds: sides.filter(({ run }) => canResume(run)).map(({ id }) => id),
    }));
  }

  const groups = new Map();
  for (const message of unreadMessages) {
    if (!names.has(message.project_id) || !withoutRun(message.session_id)) continue;
    const run = latest.get(message.session_id);
    const at = newer(message.created_at, run?.ended_at);
    if (!afterSince(at)) continue;
    if (!groups.has(message.session_id)) groups.set(message.session_id, []);
    groups.get(message.session_id).push({ ...message, at });
  }
  for (const [sessionId, messages] of groups) {
    const first = messages[0];
    const run = latest.get(sessionId);
    const [ended, endedAt] = run ? termination(run) : ['está sem execução'];
    const count = messages.length;
    const topics = messages.slice(0, 3).map(({ subject }) => clip(subject, 40)).join(' · ');
    out.push(item('messages_stranded', occurrence(sessionId, run?.id ?? null, first.latest_message_id ?? first.id), {
      ...base(first), sessionId,
      title: `${count} ${count === 1 ? 'mensagem não lida' : 'mensagens não lidas'} para ${clip(first.session_name, 53)}`,
      reason: `A sessão ${ended}${eventTime(endedAt)}. ${topics}${count > 3 ? ` · e mais ${count - 3}` : ''}`,
      evidence: { type: 'message_delivery', id: sessionId, count },
      createdAt: messages.reduce((at, message) => newer(at, message.at), first.at),
      resumeSessionIds: canResume(run) ? [sessionId] : [],
    }));
  }
  return out;
}

// Todos os itens que existem agora, antes de adiar e dispensar.
function candidates({ now, projects, requests = [], reviews = [], regressionRuns = [], tasks = [], runs = [], autoNotes = {} }) {
  const nowMs = time(now);
  const names = new Map(projects.map((project) => [project.id, project.name]));
  const known = (projectId) => names.has(projectId);
  const out = [];

  for (const request of requests) {
    if (!known(request.project_id)) continue;
    const base = { projectId: request.project_id, projectName: names.get(request.project_id), taskId: request.task_id, evidence: { type: 'agent_request', id: request.id } };
    if (request.state === 'pending' && time(request.expires_at) > nowMs) {
      const note = typeof autoNotes[request.id] === 'string' ? autoNotes[request.id] : '';
      out.push(item('request_pending', request.id, {
        ...base, sessionId: request.requested_by, title: `Novo agente: ${clip(request.name, 60)}`,
        reason: note ? `Modo autônomo: ${note}` : 'Pedido da sessão principal aguardando sua aprovação.', createdAt: request.created_at,
      }));
    } else if (request.state === 'failed') {
      out.push(item('request_failed', request.id, {
        ...base, sessionId: request.session_id || request.requested_by, title: `Agente não iniciou: ${clip(request.name, 60)}`,
        reason: request.error || 'Falha ao iniciar o agente aprovado.', createdAt: request.resolved_at || request.created_at,
      }));
    }
  }

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const suiteByReview = new Map(regressionRuns.map((run) => [run.review_id, run]));
  for (const review of reviews) {
    const task = taskById.get(review.task_id);
    if (review.state !== 'pending' || task?.state !== 'in_review' || !known(review.project_id)) continue;
    const suite = suiteByReview.get(review.id);
    const red = suite && RED_SUITE[suite.state];
    out.push(item('review_pending', review.id, {
      projectId: review.project_id, projectName: names.get(review.project_id), taskId: task.id, sessionId: review.requested_by,
      title: `Revisar: ${clip(task.title, 80)}`,
      reason: red ? `A suíte de regressão ${red} (${suite.state}). Só você decide a revisão.` : `Revisão pedida por ${clip(review.requester_name || 'um agente', 60)}. Só você conclui.`,
      urgency: red ? 'alta' : 'normal',
      evidence: red ? { type: 'regression_run', id: suite.id } : { type: 'review', id: review.id },
      createdAt: review.created_at,
    }));
  }

  for (const task of tasks) {
    if (task.state !== 'blocked' || !known(task.project_id)) continue;
    out.push(item('task_blocked', task.id, {
      projectId: task.project_id, projectName: names.get(task.project_id), taskId: task.id, sessionId: task.assigned_session_id,
      title: `Bloqueada: ${clip(task.title, 80)}`, reason: task.blocked_reason || 'O agente marcou a tarefa como bloqueada.',
      evidence: { type: 'task', id: task.id }, createdAt: task.updated_at,
    }));
  }

  // Só a run mais nova de cada sessão conta; sessão excluída não entra.
  const latest = new Map();
  for (const run of runs) {
    if (run.session_removed_at) continue;
    const current = latest.get(run.session_id);
    if (!current || run.attempt > current.attempt) latest.set(run.session_id, run);
  }
  for (const run of latest.values()) {
    if (!['failed', 'lost'].includes(run.state) || ENDED_BY_USER.has(run.reason) || !known(run.project_id)) continue;
    out.push(item('run_failed', run.id, {
      projectId: run.project_id, projectName: names.get(run.project_id), sessionId: run.session_id,
      title: `${run.session_role === 'orchestrator' ? 'Sessão principal parou' : 'Agente parou'}: ${clip(run.session_name, 60)}`,
      reason: runReason(run), evidence: { type: 'agent_run', id: run.id }, createdAt: run.ended_at,
    }));
  }
  return out;
}

const order = (left, right) => (left.urgency === right.urgency ? 0 : left.urgency === 'alta' ? -1 : 1)
  || time(left.createdAt) - time(right.createdAt) || left.id.localeCompare(right.id);

function summarize({ projects, tasks = [], items, lastVisitAt }) {
  const since = lastVisitAt ? time(lastVisitAt) : null;
  return projects.map((project) => {
    const own = tasks.filter((task) => task.project_id === project.id);
    const ids = (filter) => own.filter(filter).map((task) => task.id);
    const awaiting = [...new Set(items.filter((entry) => entry.projectId === project.id && entry.taskId && entry.kind !== 'task_blocked').map((entry) => entry.taskId))];
    const count = (taskIds) => ({ count: taskIds.length, taskIds });
    return {
      projectId: project.id,
      projectName: project.name,
      doneSinceLastVisit: count(since === null ? [] : ids((task) => task.state === 'done' && time(task.updated_at) > since)),
      inProgress: count(ids((task) => task.state === 'in_progress')),
      blocked: count(ids((task) => task.state === 'blocked')),
      awaitingUser: count(awaiting),
    };
  });
}

// Itens visíveis, resumo e as preferências limpas (órfãs, vencidas e inválidas saem).
function buildAttention({ now, projects = [], requests = [], reviews = [], regressionRuns = [], tasks = [], runs = [], handoffs = [], unreadMessages = [], autoNotes = {}, snoozedRaw = null, dismissedRaw = null, lastVisitAt = null, since = null }) {
  const nowMs = time(now);
  const names = new Map(projects.map(({ id, name }) => [id, name]));
  const all = [
    ...candidates({ now, projects, requests, reviews, regressionRuns, tasks, runs, autoNotes }),
    ...strandedItems({ since, tasks, runs, handoffs, unreadMessages, names }),
  ].sort(order);
  const existing = new Map(all.map((entry) => [entry.id, entry]));
  const snoozedParsed = parsePrefs(snoozedRaw);
  const dismissedParsed = parsePrefs(dismissedRaw);
  const snoozed = Object.fromEntries(Object.entries(snoozedParsed.entries).filter(([id, until]) => existing.has(id) && time(until) > nowMs));
  const dismissed = Object.fromEntries(Object.entries(dismissedParsed.entries).filter(([id]) => existing.has(id) && DISMISSIBLE.includes(parseItemId(id).kind)));
  const items = all.filter((entry) => !dismissed[entry.id] && !snoozed[entry.id]);
  const wakeTimes = [
    ...Object.values(snoozed).map(time),
    ...requests.filter((request) => request.state === 'pending' && existing.has(`request_pending:${request.id}`)).map((request) => time(request.expires_at)),
  ].filter((value) => value > nowMs);
  return {
    view: {
      generatedAt: now,
      lastVisitAt,
      items,
      projects: summarize({ projects, tasks, items, lastVisitAt }),
      hidden: { snoozed: Object.keys(snoozed).length, dismissed: Object.keys(dismissed).length },
    },
    all,
    prefs: { snoozed, dismissed },
    prefsChanged: {
      snoozed: !snoozedParsed.valid || !sameEntries(snoozed, snoozedParsed.entries),
      dismissed: !dismissedParsed.valid || !sameEntries(dismissed, dismissedParsed.entries),
    },
    nextChangeAt: wakeTimes.length ? new Date(Math.min(...wakeTimes)).toISOString() : null,
  };
}

// Prazo de adiar: data ISO no futuro, até 30 dias.
function snoozeUntil(value, now) {
  if (!isIso(value)) throw new Error('Adiar: informe uma data válida.');
  const until = time(value);
  const nowMs = time(now);
  if (until <= nowMs) throw new Error('Adiar: escolha uma data no futuro.');
  if (until - nowMs > MAX_SNOOZE_MS) throw new Error('Adiar: escolha uma data em até 30 dias.');
  return new Date(until).toISOString();
}

module.exports = { KINDS, DISMISSIBLE, MAX_SNOOZE_MS, buildAttention, parseItemId, parsePrefs, snoozeUntil, clip };
