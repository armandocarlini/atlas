export const TERMINAL_LAYOUTS = ['grid', 'spotlight', 'sidebar', 'tabs'];

export function normalizeTerminalLayout(layout) {
  return TERMINAL_LAYOUTS.includes(layout) ? layout : 'grid';
}

export function sameWorkspacePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return false;
  const normalize = (value) => value.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  return normalize(left) === normalize(right);
}

export function buildWorkspaceTree(projects = [], sessions = []) {
  return projects.map((project) => {
    const remaining = new Set(sessions.filter((session) => session.projectId === project.id));
    const repositories = (project.repositories || []).map((repository) => ({
      ...repository,
      worktrees: (repository.worktrees || []).map((worktree) => {
        const members = [...remaining].filter((session) => sameWorkspacePath(session.worktree, worktree.path));
        members.forEach((session) => remaining.delete(session));
        return { ...worktree, sessions: members };
      }),
    }));
    return {
      ...project,
      repositories,
      sessions: [...remaining],
      sessionCount: sessions.filter((session) => session.projectId === project.id).length,
    };
  });
}

// Na abertura, só sessões vivas ocupam a área de trabalho. O histórico (run sem
// processo) continua na árvore e só vira card quando o usuário o abre por ela.
export function workspaceSessions(sessions = [], revealedHistoryIds = []) {
  const revealed = revealedHistoryIds instanceof Set ? revealedHistoryIds : new Set(revealedHistoryIds);
  return sessions.filter((session) => !session.archived || revealed.has(session.id));
}

export function visibleWorkspaceSessions(sessions = [], hiddenSessionIds = []) {
  const hidden = hiddenSessionIds instanceof Set ? hiddenSessionIds : new Set(hiddenSessionIds);
  return sessions.filter((session) => !hidden.has(session.id));
}

export function sessionsInLayout(sessions = [], {
  layout = 'grid', selectedId = null, focusId = null, hiddenSessionIds = [],
} = {}) {
  const visible = visibleWorkspaceSessions(sessions, hiddenSessionIds);
  const mode = normalizeTerminalLayout(layout);
  if (mode === 'sidebar') {
    const lead = visible.find((session) => session.roleKind === 'orchestrator') || visible.find((session) => session.id === selectedId) || visible[0];
    return lead ? [lead, ...visible.filter((session) => session !== lead)] : [];
  }
  if (mode !== 'spotlight' && mode !== 'tabs') return visible;
  const targetId = mode === 'spotlight' ? focusId || selectedId : selectedId;
  const selected = visible.find((session) => session.id === targetId) || visible[0];
  return selected ? [selected] : [];
}

export function nextVisibleSessionId(sessions = [], hiddenSessionIds = []) {
  return visibleWorkspaceSessions(sessions, hiddenSessionIds)[0]?.id || null;
}
