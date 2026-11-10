import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, GitBranch, RefreshCw } from 'lucide-react';
import { buildWorkspaceTree, sameWorkspacePath } from './workspace-layout.js';
import SessionGlyph from './SessionGlyph.jsx';

export function changeSummary(worktree) {
  const status = worktree.status;
  if (worktree.statusError) return 'indisponível';
  if (!status) return '';
  const changes = status.staged + status.modified + status.untracked + status.conflicts;
  const parts = [];
  if (changes) parts.push(`${changes} ${changes === 1 ? 'alteração' : 'alterações'}`);
  if (status.ahead) parts.push(`↑${status.ahead}`);
  if (status.behind) parts.push(`↓${status.behind}`);
  return parts.join(' · ');
}

export function sessionState(session, hidden) {
  return hidden ? 'oculta' : session.archived ? 'histórico' : session.exited ? 'encerrada' : 'ativa';
}

// Descrição completa da sessão: vai para o title e para o nome acessível quando a coluna estreita
// esconde as linhas secundárias ou mostra só o ícone.
export function sessionDescription(session, { hidden = false, worktree = null } = {}) {
  const lead = session.roleKind === 'orchestrator' || session.origin === 'principal';
  const model = session.currentModel || session.model;
  return [
    lead ? `Principal (${session.name})` : session.name,
    session.cli || 'Terminal',
    model,
    sessionState(session, hidden),
    worktree?.path || session.worktree,
    worktree?.branch,
    worktree ? changeSummary(worktree) : '',
  ].filter(Boolean).join(' · ');
}

export function projectDescription(project, attention = 0) {
  return [
    project.name,
    project.path,
    `${project.sessionCount} ${project.sessionCount === 1 ? 'sessão' : 'sessões'}`,
    attention ? `${attention} ${attention === 1 ? 'decisão espera' : 'decisões esperam'} você` : '',
  ].filter(Boolean).join(' · ');
}

function TreeSession({ session, selected, hidden, worktree, onSelect, onFocus }) {
  const lead = session.roleKind === 'orchestrator' || session.origin === 'principal';
  const model = session.currentModel || session.model;
  const state = sessionState(session, hidden);
  return (
    <li>
      <button
        type="button"
        id={`tree-session-${session.id}`}
        className={`tree-session ${lead ? 'lead' : ''} ${selected ? 'active' : ''} ${hidden ? 'hidden-session' : ''}`}
        aria-pressed={selected}
        data-state={state}
        title={`${sessionDescription(session, { hidden, worktree })}${hidden ? '. Clique para restaurar sem iniciar outro processo.' : ''}`}
        onClick={() => onSelect(session.id)}
        onDoubleClick={() => onFocus(session.id)}
      >
        <SessionGlyph session={session} hidden={hidden} size={14} announce={false} />
        <span className="tree-label"><strong>{lead ? 'Principal' : session.name}</strong><small>{session.cli || 'Terminal'}{model ? ` · ${model}` : ''}</small></span>
        <span className="tree-state">{state}</span>
      </button>
    </li>
  );
}

export default function WorkspaceTree({
  projects, sessions, activeProjectId, workingDirectory, selectedSessionId,
  hiddenSessionIds, decisions, onSelectProject, onSelectWorktree,
  onSelectSession, onFocusSession, onDecision, onAddProject, onRefresh, loading, expandAll = false,
}) {
  const [collapsed, setCollapsed] = useState({});
  const tree = buildWorkspaceTree(projects, sessions);
  const hidden = hiddenSessionIds instanceof Set ? hiddenSessionIds : new Set(hiddenSessionIds);

  useEffect(() => {
    if (!activeProjectId) return;
    setCollapsed((current) => {
      const next = { ...current, [activeProjectId]: false };
      for (const repository of projects.find((project) => project.id === activeProjectId)?.repositories || []) {
        if (!(repository.id in next)) next[repository.id] = false;
      }
      return next;
    });
  }, [activeProjectId, projects]);

  function chooseProject(project) {
    setCollapsed((current) => {
      const next = { ...current, [project.id]: false };
      for (const repository of project.repositories) next[repository.id] = false;
      return next;
    });
    onSelectProject(project);
  }

  function sessionList(items, worktree = null) {
    return <ul className="tree-sessions">{items.map((session) => <TreeSession
      key={session.id}
      session={session}
      worktree={worktree}
      selected={selectedSessionId === session.id}
      hidden={hidden.has(session.id)}
      onSelect={onSelectSession}
      onFocus={onFocusSession}
    />)}</ul>;
  }

  return (
    <nav className="workspace-tree" aria-label="Projetos, worktrees e sessões">
      <div className="workspace-tree-heading">
        <strong>Projetos</strong>
        <div>
          <button type="button" className="chrome-icon-button" onClick={onRefresh} disabled={loading} title="Atualizar estado Git" aria-label="Atualizar estado Git"><RefreshCw size={15} aria-hidden="true" /></button>
          <button type="button" className="chrome-icon-button" onClick={onAddProject} title="Autorizar pasta de projeto" aria-label="Autorizar pasta de projeto"><FolderPlus size={16} aria-hidden="true" /></button>
        </div>
      </div>
      <div className="workspace-tree-scroll">
        <ul className="tree-projects">
          {tree.map((project) => {
            const projectCollapsed = collapsed[project.id] ?? (!expandAll && project.id !== activeProjectId);
            const active = project.id === activeProjectId;
            const attention = active ? decisions.length : 0;
            return (
              <li className={`tree-project ${active ? 'active' : ''}`} key={project.id}>
                <div className="tree-project-row">
                  <button
                    type="button"
                    className="tree-expander"
                    aria-label={`${projectCollapsed ? 'Expandir' : 'Recolher'} ${project.name}`}
                    aria-expanded={!projectCollapsed}
                    onClick={() => setCollapsed((current) => ({ ...current, [project.id]: !projectCollapsed }))}
                  >{projectCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</button>
                  <button type="button" className="tree-project-name" aria-current={active ? 'page' : undefined} onClick={() => chooseProject(project)} title={projectDescription(project, attention)}>
                    {active && !projectCollapsed ? <FolderOpen size={14} /> : <Folder size={14} />}<span>{project.name}</span><small title={`${project.sessionCount} sessões`}>{project.sessionCount}</small>
                  </button>
                </div>
                {!projectCollapsed && <div className="tree-project-content">
                  {attention > 0 && <section className="tree-decisions has-attention" aria-label="Espera você">
                    <div className="tree-section-label"><span>Espera você</span><b>{attention}</b></div>
                    <ul>{decisions.map((decision) => <li key={decision.id}>
                      <button type="button" className={`tree-decision ${decision.kind}`} onClick={() => onDecision(decision)} title={[decision.title, decision.detail].filter(Boolean).join(' · ')}>
                        <span className="tree-decision-mark" aria-hidden="true">{decision.kind === 'review' ? '✓' : '!'}</span>
                        <span>{decision.title}</span>
                      </button>
                    </li>)}</ul>
                  </section>}
                  {project.repositories.map((repository) => {
                    const containsDirectory = repository.worktrees.some((worktree) => sameWorkspacePath(worktree.path, workingDirectory));
                    const repositoryCollapsed = collapsed[repository.id] ?? !(expandAll || active || containsDirectory);
                    return (
                      <section className="tree-repository" key={repository.id}>
                        <button type="button" className="tree-repository-title" title={`${repository.name} · ${repository.worktrees.length} ${repository.worktrees.length === 1 ? 'worktree' : 'worktrees'}`} aria-expanded={!repositoryCollapsed} onClick={() => setCollapsed((current) => ({ ...current, [repository.id]: !repositoryCollapsed }))}>
                          {repositoryCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}<strong>{repository.name}</strong><small title={`${repository.worktrees.length} worktrees`}>{repository.worktrees.length}</small>
                        </button>
                        {!repositoryCollapsed && <ul className="tree-worktrees">{repository.worktrees.map((worktree) => {
                          const selected = sameWorkspacePath(worktree.path, workingDirectory);
                          const summary = changeSummary(worktree);
                          return <li key={worktree.id}>
                            <button type="button" className={`tree-worktree ${selected ? 'active' : ''}`} aria-pressed={selected} data-worktree-path={worktree.path} title={[worktree.name, worktree.branch || 'diretório autorizado', summary, worktree.path].filter(Boolean).join(' · ')} onClick={() => onSelectWorktree(project, repository, worktree)}>
                              <GitBranch size={12} aria-hidden="true" /><span className="tree-label"><strong>{worktree.name}</strong><small>{worktree.branch || 'diretório autorizado'}</small></span>
                              {summary && <span className="tree-change">{summary}</span>}
                            </button>
                            {worktree.sessions.length > 0 && sessionList(worktree.sessions, worktree)}
                          </li>;
                        })}</ul>}
                      </section>
                    );
                  })}
                  {project.sessions.length > 0 && <section className="tree-unscoped-sessions">
                    {project.repositories.length > 0 && <div className="tree-section-label"><span>Sessões do projeto</span></div>}
                    {sessionList(project.sessions)}
                  </section>}
                  {active && project.sessionCount === 0 && <p className="tree-empty">Nenhuma sessão neste projeto.</p>}
                </div>}
              </li>
            );
          })}
        </ul>
        {!loading && tree.length === 0 && <p className="tree-empty">Autorize uma pasta para começar.</p>}
        {loading && <p className="tree-empty" role="status">Lendo projetos e Git…</p>}
      </div>
    </nav>
  );
}
