import { useState } from 'react';
import useModalFocus from './useModalFocus.js';

const TASK_STATE_LABELS = {
  backlog: 'Backlog',
  ready: 'Pronta',
  in_progress: 'Em andamento',
  blocked: 'Bloqueada',
  in_review: 'Em revisão',
  done: 'Concluída',
  canceled: 'Cancelada',
};

const stateLabel = (state) => TASK_STATE_LABELS[state] || state;

// Execução atribuída à tarefa: oferta aberta, responsável e bloqueio. Textos
// escritos por agentes aparecem como texto e identificados como tal.
function TaskAssignment({ task, handoffs, onCancelHandoff, onRelease }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const related = handoffs.filter((handoff) => handoff.taskId === task.id);
  const open = related.find((handoff) => handoff.state === 'offered');
  const last = related.at(-1);

  async function run(action, target) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const failure = await action(target);
      if (failure) setError(failure);
    } finally {
      setBusy(false);
    }
  }

  let body;
  if (open) {
    body = <>
      <p>Oferecida a <strong>{open.toName}</strong> por {open.fromName}. Aguardando o agente aceitar ou recusar.</p>
      <div className="handoff-text"><span>Objetivo, escrito pela sessão principal</span><p>{open.objective}</p></div>
      {open.nextSteps && <div className="handoff-text"><span>Próximos passos</span><p>{open.nextSteps}</p></div>}
      {onCancelHandoff && <button type="button" className="button secondary compact" disabled={busy} onClick={() => run(onCancelHandoff, open)}>{busy ? 'Cancelando…' : 'Cancelar oferta'}</button>}
    </>;
  } else if (task.assignedSessionId) {
    body = <>
      <p>Responsável: <strong>{task.assigneeName || 'sessão encerrada'}</strong></p>
      {!task.claimRunId && <p className="task-warning">A run do responsável terminou. O andamento real é incerto; devolva a tarefa para delegá-la de novo.</p>}
      {task.state === 'blocked' && <div className="handoff-text"><span>Bloqueio informado pelo agente</span><p>{task.blockedReason}</p></div>}
      {onRelease && <button type="button" className="button secondary compact" disabled={busy} onClick={() => run(onRelease, task)}>{busy ? 'Devolvendo…' : 'Devolver tarefa'}</button>}
    </>;
  } else {
    body = <>
      <p>Sem execução atribuída.</p>
      {last?.state === 'rejected' && <div className="handoff-text"><span>Última oferta recusada por {last.toName}</span><p>{last.reason}</p></div>}
    </>;
  }
  return <section className="task-assignment" aria-label="Execução da tarefa" aria-busy={busy}>
    <h3>Execução</h3>
    {body}
    {error && <p className="error-note" role="alert">{error}</p>}
  </section>;
}

export function PersistentTaskPanel({ state, onNew, onCancelHandoff, onRelease }) {
  const [selectedId, setSelectedId] = useState(null);
  const selected = state.items.find((task) => task.id === selectedId) || state.items[0];
  const handoffs = state.handoffs || [];
  return <section className="persistent-tasks" aria-label="Tarefas persistentes do projeto">
    <div className="section-title"><span>TAREFAS DO PROJETO</span>{onNew && <button type="button" className="button secondary compact" disabled={!state.projectId || state.loading} onClick={onNew}>Nova tarefa</button>}</div>
    {state.loading ? <p role="status">Carregando tarefas…</p> : state.error ? <p className="error-note" role="alert">{state.error}</p> : !state.projectId ? <p>Selecione um projeto autorizado.</p> : <>
      <p className="task-project-name">{state.projectName}</p>
      {!onNew && <p>Crie tarefas na janela principal.</p>}
      {!state.items.length ? <p>Nenhuma tarefa criada neste projeto.</p> : <>
        <div className="task-queue" aria-label="Lista de tarefas">{state.items.map((task) => <button type="button" key={task.id} className={`queue-item ${task.id === selected.id ? 'active' : ''}`} aria-pressed={task.id === selected.id} onClick={() => setSelectedId(task.id)}><span><small>{stateLabel(task.state)}{task.assigneeName ? ` · ${task.assigneeName}` : ''}</small><strong>{task.title}</strong></span></button>)}</div>
        <article className="persistent-task-detail">
          <div className="section-kicker"><span>TAREFA SELECIONADA</span><span>{stateLabel(selected.state)}</span></div>
          <h2>{selected.title}</h2>
          {selected.description && <p className="task-text">{selected.description}</p>}
          <h3>Critérios de aceite</h3><p className="task-text">{selected.acceptance}</p>
          <TaskAssignment key={selected.id} task={selected} handoffs={handoffs} onCancelHandoff={onCancelHandoff} onRelease={onRelease} />
        </article>
      </>}
    </>}
  </section>;
}

export function NewTaskModal({ projectName, cwd, onCreate, onClose }) {
  const dialogRef = useModalFocus();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [acceptance, setAcceptance] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [scope] = useState({ projectName, cwd });
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const failure = await onCreate({ cwd: scope.cwd, title, description, acceptance, idempotencyKey });
      if (failure) setError(failure);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return <div className="modal-backdrop" onKeyDown={(event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === ',') { event.preventDefault(); event.stopPropagation(); }
    if (event.key === 'Escape' && !busy) onClose();
  }}>
    <section className="modal task-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="new-task-title">
      <header><div><span className="eyebrow">{scope.projectName}</span><h2 id="new-task-title">Criar tarefa</h2></div><button type="button" className="session-control" disabled={busy} aria-label="Fechar nova tarefa" onClick={onClose}>Fechar</button></header>
      <form onSubmit={submit} aria-busy={busy}>
        <label>Título<input name="title" value={title} required maxLength={160} disabled={busy} onChange={(event) => setTitle(event.target.value)} onBlur={() => { if (title && !title.trim()) setError('Informe um título para a tarefa.'); }} /></label>
        <label><span>Descrição (opcional)</span><textarea name="description" value={description} maxLength={8000} disabled={busy} rows={3} onChange={(event) => setDescription(event.target.value)} /></label>
        <label>Critérios de aceite<textarea name="acceptance" value={acceptance} required maxLength={4000} disabled={busy} rows={4} onChange={(event) => setAcceptance(event.target.value)} onBlur={() => { if (acceptance && !acceptance.trim()) setError('Informe critérios de aceite para a tarefa.'); }} /></label>
        <p>A tarefa será criada no backlog deste projeto.</p>
        {error && <p className="error-note" role="alert">{error}</p>}
        <footer><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancelar</button><button type="submit" className="button primary" disabled={busy || !title.trim() || !acceptance.trim()}>{busy ? 'Criando…' : 'Criar tarefa'}</button></footer>
      </form>
    </section>
  </div>;
}
