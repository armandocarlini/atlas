import { createPortal } from 'react-dom';
import { BellDot, ChevronsLeftRight, Folder, FolderOpen, FolderPlus, Inbox, RefreshCw } from 'lucide-react';
import { buildWorkspaceTree } from './workspace-layout.js';
import SessionGlyph from './SessionGlyph.jsx';
import WorkspaceTree, { projectDescription, sessionDescription } from './WorkspaceTree.jsx';
import useFlyout, { flyoutPosition } from './useFlyout.js';
import { countAnnouncement } from './attention-queue.js';

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
// projeto ativo aparecem pelo ícone do CLI e os itens da fila "Precisam de mim" viram selo. Nada
// se perde: o nome acessível e o title trazem tudo, clicar no projeto abre a árvore completa ao
// lado e o botão da fila abre a fila inteira no mesmo flyout.
export default function NavigationRail({
  projects, sessions, activeProjectId, workingDirectory, selectedSessionId,
  hiddenSessionIds, attentionCounts = {}, attention = null, onSelectProject, onSelectWorktree,
  onSelectSession, onFocusSession, onAddProject, onRefresh, onExpand, loading,
}) {
  const tree = buildWorkspaceTree(projects, sessions);
  const hidden = hiddenSessionIds instanceof Set ? hiddenSessionIds : new Set(hiddenSessionIds);
  const flyout = useFlyout({ initialFocus: '.tree-project-name' });
  const attentionCount = attention?.count ?? 0;
  const attentionLabel = `Precisam de mim: ${attention?.loaded ? countAnnouncement(attentionCount) : 'carregando'}`;
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
        {attention && <RailButton
          icon={attentionCount ? BellDot : Inbox}
          label={attentionLabel}
          className={`rail-queue ${attentionCount ? 'has-items' : ''}`}
          aria-pressed={attention.open}
          onClick={closeAfter(attention.onShow)}
        >{attentionCount > 0 && <span className="rail-attention" aria-hidden="true">{attentionCount}</span>}</RailButton>}
      </div>
      <ul className="rail-projects">
        {tree.map((project) => {
          const active = project.id === activeProjectId;
          const pending = attentionCounts[project.id] || 0;
          const description = projectDescription(project, pending);
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
                {pending > 0 && <span className="rail-attention" aria-hidden="true">{pending}</span>}
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
            attentionCounts={attentionCounts}
            onSelectProject={onSelectProject}
            onSelectWorktree={closeAfter(onSelectWorktree)}
            onSelectSession={closeAfter(onSelectSession)}
            onFocusSession={closeAfter(onFocusSession)}
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
