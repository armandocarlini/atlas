import { useState } from 'react';

function changeSummary(worktree) {
  const status = worktree.status;
  if (worktree.statusError) return 'indisponível';
  if (!status) return 'lendo…';
  const changes = status.staged + status.modified + status.untracked + status.conflicts;
  if (!changes && !status.ahead && !status.behind) return 'limpa';
  const parts = [];
  if (changes) parts.push(`${changes} ${changes === 1 ? 'alteração' : 'alterações'}`);
  if (status.ahead) parts.push(`↑${status.ahead}`);
  if (status.behind) parts.push(`↓${status.behind}`);
  return parts.join(' · ');
}

export default function GitDiscovery({ projects, selectedWorktree, onSelect, onRefresh, loading }) {
  const [collapsed, setCollapsed] = useState({});
  const repositories = projects.flatMap((project) => project.repositories.map((repository) => ({ project, repository })));
  const errors = projects.flatMap((project) => project.errors.map((error) => ({ ...error, project: project.name })));
  // Projetos ainda em varredura: a janela abre antes e eles aparecem ao terminar.
  const scanning = projects.filter((project) => project.scanning);

  return (
    <section className="git-discovery" aria-label="Repositórios e worktrees descobertos">
      <div className="sidebar-heading discovery-heading">
        <span>REPOSITÓRIOS</span>
        <button type="button" onClick={onRefresh} disabled={loading} title="Atualizar estado Git" aria-label="Atualizar estado Git">{loading ? '···' : '↻'}</button>
      </div>
      <div className="discovery-content">
        {!loading && repositories.length === 0 && <p className="discovery-empty">Nenhum repositório Git nas pastas autorizadas.</p>}
        {scanning.length > 0 && <p className="discovery-empty" role="status">Lendo o Git de {scanning.map((project) => project.name).join(', ')}…</p>}
        {repositories.map(({ project, repository }) => {
          const isCollapsed = collapsed[repository.id];
          return (
            <div className="repository-block" key={repository.id}>
              <button
                type="button"
                className="repository-title"
                onClick={() => setCollapsed((current) => ({ ...current, [repository.id]: !current[repository.id] }))}
                aria-expanded={!isCollapsed}
              >
                <span>{isCollapsed ? '+' : '−'}</span>
                <strong>{repository.name}</strong>
                <small>{repository.worktrees.length} WT</small>
              </button>
              {!isCollapsed && (
                <div className="repository-details">
                  {repository.worktrees.map((worktree) => (
                    <button
                      type="button"
                      className={`worktree-item ${selectedWorktree === worktree.path ? 'active' : ''}`}
                      key={worktree.id}
                      onClick={() => onSelect(project, repository, worktree)}
                      title={worktree.path}
                      aria-pressed={selectedWorktree === worktree.path}
                    >
                      <span className="worktree-name">{worktree.name}</span>
                      <span className="worktree-branch">{worktree.branch || `HEAD ${worktree.head?.slice(0, 7) || 'desconhecido'}`}</span>
                      <small>{changeSummary(worktree)}{worktree.locked ? ' · bloqueada' : ''}{worktree.detached ? ' · detached' : ''}</small>
                    </button>
                  ))}
                  <div className="repository-branches" aria-label={`Branches de ${repository.name}`}>
                    {repository.branches.map((branch) => (
                      <span key={branch.name} title={`${branch.name} · ${branch.subject}`}>{branch.name}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {errors.slice(0, 2).map((error) => <p className="discovery-error" key={`${error.path}-${error.message}`} title={error.message}>{error.project}: não foi possível ler {error.path}</p>)}
      </div>
    </section>
  );
}
