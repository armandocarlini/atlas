const { clip } = require('./attention.cjs');

const FACT_TYPES = Object.freeze(['task.completed', 'task.review_requested', 'run.succeeded', 'run.failed', 'run.lost', 'regression.finished']);
const REGRESSION_RESULTS = new Set(['passed', 'failed', 'timeout', 'error', 'cancelled', 'interrupted', 'skipped']);

function describeFact(event) {
  const { id, type, payload, created_at: at } = event;
  const task = clip(event.task_title, 120);
  const session = clip(event.session_name, 100);
  const fact = { id, at };
  const stopped = ['user_closed', 'application_closed'].includes(event.run_reason ?? payload.reason);
  switch (type) {
    case 'task.completed': return { ...fact, kind: 'task_completed', title: task };
    case 'task.review_requested': return { ...fact, kind: 'task_in_review', title: task };
    case 'run.succeeded': return { ...fact, kind: stopped ? 'run_stopped' : 'run_succeeded', title: session };
    case 'run.failed': return stopped ? { ...fact, kind: 'run_stopped', title: session } : { ...fact, kind: 'run_failed', title: session, exitCode: Number.isInteger(payload.exitCode) ? payload.exitCode : null };
    case 'run.lost': return { ...fact, kind: stopped ? 'run_stopped' : 'run_lost', title: session };
    case 'regression.finished': return REGRESSION_RESULTS.has(payload.state) ? { ...fact, kind: 'regression_finished', title: task, state: payload.state } : null;
    default: return null;
  }
}

function groupByProject(entries, key) {
  const groups = new Map();
  for (const entry of entries) {
    const id = entry[key];
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(entry);
  }
  return groups;
}

function buildBriefing({ projects, items, lastVisitAt, events = [], sessions = [], principalProjectIds = [], limit = 6 }) {
  const factsByProject = groupByProject(events.filter((event) => lastVisitAt && Date.parse(event.created_at) > Date.parse(lastVisitAt)), 'project_id');
  const sessionsByProject = groupByProject(sessions, 'projectId');
  const itemsByProject = groupByProject(items, 'projectId');
  const started = new Set(principalProjectIds);
  return projects.map(({ projectId, projectName }) => {
    const precisa = itemsByProject.get(projectId) ?? [];
    const facts = (factsByProject.get(projectId) ?? []).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).map(describeFact).filter(Boolean);
    const sessoes = (sessionsByProject.get(projectId) ?? []).map((session) => ({
      id: session.id,
      name: clip(session.name, 100),
      cli: clip(session.cli, 80),
      functionName: clip(session.functionName, 60) || null,
      role: session.role,
      tasks: (session.tasks ?? []).map((task) => ({ id: task.id, title: clip(task.title, 120) })),
      external: Boolean(session.external),
      terminalId: session.external ? null : session.terminalId ?? null,
    }));
    const principalSession = sessoes.find((session) => session.role === 'orchestrator');
    let principal = started.has(projectId) ? 'ended' : 'never_started';
    if (principalSession) principal = principalSession.external ? 'external' : 'running';
    return {
      projectId, projectName: clip(projectName, 120), precisa,
      aconteceu: facts.slice(0, limit),
      mais: Math.max(0, facts.length - limit),
      agora: { principal, sessoes },
      semNovidades: !precisa.length && !facts.length && !sessoes.length,
    };
  }).sort((a, b) => Number(Boolean(b.precisa.length)) - Number(Boolean(a.precisa.length)) || Number(a.semNovidades) - Number(b.semNovidades));
}

module.exports = { buildBriefing, FACT_TYPES };
