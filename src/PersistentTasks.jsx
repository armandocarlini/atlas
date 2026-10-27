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

function shortCommit(value) {
  return typeof value === 'string' ? value.slice(0, 8) : '—';
}

function formatDateTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

// Evidências de uma revisão: o que o agente declarou e o que o ATLAS verificou no Git.
function ReviewEvidence({ evidence }) {
  const report = evidence.find((item) => item.kind === 'agent_report');
  const snapshot = evidence.find((item) => item.kind === 'git_snapshot');
  const git = snapshot?.payload;
  return <>
    {report && <div className="handoff-text">
      <span>Declarado pelo agente</span>
      <p>{report.payload.summary}</p>
      {report.payload.commands.length > 0 && <ul className="evidence-commands">{report.payload.commands.map((item, index) => <li key={index}><code>{item.command}</code><span className={item.exitCode === 0 ? 'success-text' : 'danger-text'}>exit {item.exitCode}</span></li>)}</ul>}
    </div>}
    {git && <div className="handoff-text">
      <span>Verificado pelo ATLAS no Git</span>
      {git.unavailable ? <>
        <p>{git.unavailable}</p>
        {git.detail && <p className="evidence-detail">Saída do Git (pode conter texto da worktree): {git.detail}</p>}
      </> : <dl className="evidence-git">
        <dt>Branch</dt><dd>{git.branch || 'HEAD destacado'}{git.expectedBranch && git.branch !== git.expectedBranch ? ` (esperada ${git.expectedBranch})` : ''}</dd>
        <dt>Commits</dt><dd>{git.commits} desde {shortCommit(git.baseCommit)} até {shortCommit(git.headCommit)}</dd>
        <dt>Diff</dt><dd>{git.diff.files} arquivos, +{git.diff.insertions} −{git.diff.deletions}</dd>
        <dt>Sem commit</dt><dd className={git.uncommittedFiles ? 'warning-text' : ''}>{git.uncommittedFiles ? `${git.uncommittedFiles} arquivos fora dos commits` : 'nenhum'}</dd>
      </dl>}
    </div>}
  </>;
}

function ReviewDecision({ review, onDecide }) {
  const [mode, setMode] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function decide(decision) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const failure = await onDecide(review, decision, decision === 'changes' ? note : undefined);
      if (failure) setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return <div className="review-decision" aria-busy={busy}>
    {mode === 'changes' ? <>
      <label>O que precisa mudar<textarea value={note} rows={3} maxLength={2000} disabled={busy} onChange={(event) => setNote(event.target.value)} /></label>
      <div className="review-actions">
        <button type="button" className="button secondary compact" disabled={busy} onClick={() => setMode('')}>Voltar</button>
        <button type="button" className="button primary compact" disabled={busy || !note.trim()} onClick={() => decide('changes')}>{busy ? 'Enviando…' : 'Enviar pedido de ajustes'}</button>
      </div>
    </> : <div className="review-actions">
      <button type="button" className="button secondary compact" disabled={busy} onClick={() => setMode('changes')}>Pedir ajustes</button>
      <button type="button" className="button primary compact" disabled={busy} onClick={() => decide('accept')}>{busy ? 'Concluindo…' : 'Aceitar e concluir'}</button>
    </div>}
    {error && <p className="error-note" role="alert">{error}</p>}
  </div>;
}

// Execução atribuída à tarefa: oferta aberta, responsável e bloqueio. Textos
// escritos por agentes aparecem como texto e identificados como tal.
function TaskAssignment({ task, handoffs, reviews, evidence, onCancelHandoff, onRelease, onDecideReview }) {
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

  const review = reviews.filter((item) => item.taskId === task.id).at(-1);
  const reviewEvidence = review ? evidence.filter((item) => item.reviewId === review.id) : [];

  let body;
  if (task.state === 'in_review' && review?.state === 'pending') {
    body = <>
      <p>Revisão pedida por <strong>{review.requesterName}</strong> em {formatDateTime(review.createdAt)}. Confira as evidências e os critérios de aceite.</p>
      <ReviewEvidence evidence={reviewEvidence} />
      {onDecideReview && <ReviewDecision key={review.id} review={review} onDecide={onDecideReview} />}
    </>;
  } else if (task.state === 'done' && review?.state === 'accepted') {
    body = <>
      <p>Concluída por você em {formatDateTime(review.decidedAt)}, com o trabalho de <strong>{task.assigneeName || 'sessão encerrada'}</strong>.</p>
      <ReviewEvidence evidence={reviewEvidence} />
    </>;
  } else if (open) {
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
      {review?.state === 'changes_requested' && <div className="handoff-text"><span>Ajustes que você pediu</span><p>{review.note}</p></div>}
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

export function PersistentTaskPanel({ state, onNew, onCancelHandoff, onRelease, onDecideReview }) {
  const [selectedId, setSelectedId] = useState(null);
  const selected = state.items.find((task) => task.id === selectedId) || state.items[0];
  const handoffs = state.handoffs || [];
  const reviews = state.reviews || [];
  const evidence = state.evidence || [];
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
          <TaskAssignment key={selected.id} task={selected} handoffs={handoffs} reviews={reviews} evidence={evidence} onCancelHandoff={onCancelHandoff} onRelease={onRelease} onDecideReview={onDecideReview} />
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

// Evidências reais do projeto, agrupadas por revisão, da mais recente para a mais antiga.
export function TaskEvidencePanel({ state }) {
  const reviews = [...(state.reviews || [])].reverse();
  const evidence = state.evidence || [];
  const titleOf = (taskId) => state.items.find((task) => task.id === taskId)?.title || 'Tarefa';
  const reviewLabel = { pending: 'Aguardando sua revisão', accepted: 'Aceita', changes_requested: 'Ajustes pedidos' };
  return <section className="evidence-panel" aria-label="Evidências do projeto">
    <div className="section-kicker"><span>ENTREGA VERIFICÁVEL</span><span>{reviews.length} revisões</span></div>
    {!state.projectId ? <p>Selecione um projeto autorizado.</p> : !reviews.length ? <p>Nenhuma evidência registrada. O agente responsável pede revisão com evidências; o ATLAS anexa o retrato Git da worktree da tarefa.</p>
      : reviews.map((review) => <article key={review.id} className="evidence-review">
        <h3>{titleOf(review.taskId)}</h3>
        <p className="evidence-review-state">{reviewLabel[review.state] || review.state} · {formatDateTime(review.createdAt)}</p>
        <ReviewEvidence evidence={evidence.filter((item) => item.reviewId === review.id)} />
      </article>)}
    <p className="evidence-footnote">Uma run concluída não marca a tarefa como pronta: só a sua revisão conclui.</p>
  </section>;
}
