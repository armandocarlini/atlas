import { createPortal } from 'react-dom';
import { ChevronsLeftRight, Folder, FolderOpen, FolderPlus, RefreshCw } from 'lucide-react';
import { buildWorkspaceTree } from './workspace-layout.js';
import SessionGlyph from './SessionGlyph.jsx';
import WorkspaceTree, { projectDescription, sessionDescription } from './WorkspaceTree.jsx';
import useFlyout, { flyoutPosition } from './useFlyout.js';

const FLYOUT_WIDTH = 320;

function projectSessions(project) {
  const items = [];
  for (const repository of project.repositories) {
    for (const worktree of repository.worktrees) {
      for (const session of worktree.sessions) items.push({ session, worktree });
    }
  }
  for (const session of project.sessions) items.push({ session, worktree: null });
  return items;
}

function RailButton({ icon: Icon, label, className = '', children, ...props }) {
  return (
    <button type="button" className={`rail-button ${className}`} aria-label={label} title={label} {...props}>
      <Icon size={17} aria-hidden="true" />
      {children}
    </button>
  );
}

// Navegação só com ícones: cada projeto vira um ícone com o número de sessões, as sessões do
// projeto ativo aparecem pelo ícone do CLI e "Espera você" vira selo. Nada se perde: o nome
// acessível e o title trazem tudo, e clicar no projeto abre a árvore completa ao lado.
export default function NavigationRail({
  projects, sessions, activeProjectId, workingDirectory, selectedSessionId,
  hiddenSessionIds, decisions, onSelectProject, onSelectWorktree,
  onSelectSession, onFocusSession, onDecision, onAddProject, onRefresh, onExpand, loading,
}) {
  const tree = buildWorkspaceTree(projects, sessions);
  const hidden = hiddenSessionIds instanceof Set ? hiddenSessionIds : new Set(hiddenSessionIds);
  const flyout = useFlyout({ initialFocus: '.tree-project-name' });
  const openProject = tree.find((project) => project.id === flyout.open?.id);

  const closeAfter = (handler) => (...args) => {
    handler(...args);
    flyout.close(false);
  };

  return (
    <nav className="navigation-rail" aria-label="Projetos, worktrees e sessões">
      <div className="rail-actions">
        <RailButton icon={ChevronsLeftRight} label="Expandir navegação" onClick={onExpand} />
        <RailButton icon={RefreshCw} label="Atualizar estado Git" onClick={onRefresh} disabled={loading} />
        <RailButton icon={FolderPlus} label="Autorizar pasta de projeto" onClick={onAddProject} />
      </div>
      <ul className="rail-projects">
        {tree.map((project) => {
          const active = project.id === activeProjectId;
          const attention = active ? decisions.length : 0;
          const description = projectDescription(project, attention);
          const open = flyout.open?.id === project.id;
          return (
            <li key={project.id} className={`rail-project-item ${active ? 'active' : ''}`}>
              <RailButton
                icon={active ? FolderOpen : Folder}
                label={description}
                className={`rail-project ${active ? 'active' : ''}`}
                aria-current={active ? 'page' : undefined}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? 'navigation-flyout' : undefined}
                onClick={(event) => flyout.toggle(project.id, event.currentTarget)}
              >
                <span className="rail-badge" aria-hidden="true">{project.sessionCount}</span>
                {attention > 0 && <span className="rail-attention" aria-hidden="true">{attention}</span>}
              </RailButton>
              {active && <ul className="rail-sessions" aria-label={`Sessões de ${project.name}`}>
                {projectSessions(project).map(({ session, worktree }) => {
                  const isHidden = hidden.has(session.id);
                  const description = sessionDescription(session, { hidden: isHidden, worktree });
                  return <li key={session.id}>
                    <button
                      type="button"
                      className={`rail-button rail-session ${selectedSessionId === session.id ? 'active' : ''}`}
                      aria-label={description}
                      title={`${description}${isHidden ? '. Clique para restaurar sem iniciar outro processo.' : ''}`}
                      aria-pressed={selectedSessionId === session.id}
                      onClick={() => onSelectSession(session.id)}
                      onDoubleClick={() => onFocusSession(session.id)}
                    >
                      <SessionGlyph session={session} hidden={isHidden} size={18} announce={false} />
                    </button>
                  </li>;
                })}
              </ul>}
            </li>
          );
        })}
      </ul>
      {loading && <p className="visually-hidden" role="status">Lendo projetos e Git…</p>}
      {openProject && createPortal(
        <div
          id="navigation-flyout"
          ref={flyout.flyoutRef}
          className="rail-flyout navigation-flyout"
          role="dialog"
          aria-label={`Projeto ${openProject.name}`}
          data-opens={flyoutPosition(flyout.open.rail, FLYOUT_WIDTH).right !== undefined ? 'left' : 'right'}
          style={flyoutPosition(flyout.open.rail, FLYOUT_WIDTH)}
        >
          <WorkspaceTree
            projects={projects.filter((project) => project.id === openProject.id)}
            sessions={sessions}
            activeProjectId={activeProjectId}
            workingDirectory={workingDirectory}
            selectedSessionId={selectedSessionId}
            hiddenSessionIds={hiddenSessionIds}
            decisions={decisions}
            onSelectProject={onSelectProject}
            onSelectWorktree={closeAfter(onSelectWorktree)}
            onSelectSession={closeAfter(onSelectSession)}
            onFocusSession={closeAfter(onFocusSession)}
            onDecision={closeAfter(onDecision)}
            onAddProject={closeAfter(onAddProject)}
            onRefresh={onRefresh}
            loading={loading}
            expandAll
          />
        </div>,
        document.body,
      )}
    </nav>
  );
}
