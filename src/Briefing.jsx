import { useId, useRef, useState } from 'react';
import { Activity, ArrowLeft, BellDot, CircleCheck, Send, SquareTerminal } from 'lucide-react';
import { AttentionItem } from './AttentionQueue.jsx';
import TerminalView from './TerminalView.jsx';
import { terminalCli } from './terminal-clipboard.js';
import { briefingCanSend, briefingDestination } from './briefing.js';
import './briefing.css';

const PRINCIPAL = {
  running: 'Principal em execução',
  external: 'Principal anexada externamente',
  ended: 'Principal encerrada',
  never_started: 'Principal ainda não iniciada',
};

const FACT_LABELS = {
  task_completed: 'Tarefa concluída',
  task_in_review: 'Tarefa em revisão',
  run_succeeded: 'Sessão terminou',
  run_failed: 'Sessão falhou',
  run_lost: 'Sessão interrompida',
  run_stopped: 'Sessão encerrada',
};

const REGRESSION_LABELS = {
  passed: 'Suíte de regressão passou',
  failed: 'Suíte de regressão falhou',
  timeout: 'Suíte de regressão excedeu o prazo',
  error: 'Suíte de regressão não pôde ser executada',
  cancelled: 'Suíte de regressão cancelada',
  interrupted: 'Suíte de regressão interrompida',
  skipped: 'Suíte de regressão não executada',
};

function sessionLabel(session) {
  const role = session.functionName || (session.role === 'orchestrator' ? 'Principal' : 'Agente sem função');
  return [session.name, role === session.name ? null : role, session.cli].filter(Boolean).join(' · ');
}

function BriefingCard({ card, focused, focus, onOpenProject, onStartPrincipal, queue, desktop, theme, detachedTerminals }) {
  const headingId = useId();
  const selectId = useId();
  const textId = useId();
  const [selection, setSelection] = useState(undefined);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState('');
  const pending = useRef(null);
  const inFlight = useRef(false);
  const sessions = card.agora.sessoes;
  const target = briefingDestination(sessions, selection);
  const showStartPrincipal = ['never_started', 'ended'].includes(card.agora.principal);
  if (receipt && receipt.terminalId !== target?.terminalId) setReceipt(null);
  const status = receipt && receipt.terminalId === target?.terminalId ? receipt.message : '';
  const readOnlyTerminal = Boolean(target && detachedTerminals.includes(target.id));
  const canSend = !busy && briefingCanSend(target, text);
  const receivers = sessions.filter((session) => session.terminalId && !session.external);
  const receiverName = (session) => receivers.some((other) => other.id !== session.id && other.name === session.name)
    ? `${session.name} (${session.id.slice(0, 8)})`
    : session.name;
  const StateIcon = card.semNovidades ? CircleCheck : card.precisa.length ? BellDot : Activity;
  const state = card.semNovidades ? 'Sem novidades' : card.precisa.length ? 'Precisa de você' : 'Com atividade';

  async function send(event) {
    event?.preventDefault();
    if (!canSend || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setReceipt(null);
    const last = pending.current;
    const key = last?.sessionId === target.id && last.text === text ? last.key : crypto.randomUUID();
    pending.current = { sessionId: target.id, text, key };
    try {
      const receipt = await desktop.sendBriefing({ projectId: card.projectId, sessionId: target.id, text, idempotencyKey: key });
      const time = new Date(receipt.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      setReceipt({ terminalId: target.terminalId, message: `Enviado a ${receiverName(target)} às ${time}` });
      setText('');
      pending.current = null;
    } catch (failure) {
      setError(String(failure?.message || failure).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      queue.reload();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <article className={`briefing-card${card.semNovidades ? ' briefing-quiet' : ''}`} data-project-id={card.projectId} aria-labelledby={headingId} tabIndex={0} onFocus={focus}>
      <header className="briefing-card-header">
        <h2 id={headingId}>{card.projectName}</h2>
        <span className="briefing-state" data-needs-user={Boolean(card.precisa.length)}><StateIcon size={15} aria-hidden="true" />{state}</span>
        <button type="button" className="button secondary compact" onClick={() => onOpenProject(card.projectId)}>Abrir projeto</button>
      </header>
      {(!card.semNovidades || text || error || status) && <div className="briefing-card-body">
        <div className="briefing-details">
          {card.aconteceu.length > 0 && <section className="briefing-row">
            <h3>Aconteceu</h3>
            <ul>{card.aconteceu.map((fact) => <li key={fact.id}>
              {FACT_LABELS[fact.kind] ?? REGRESSION_LABELS[fact.state]}{fact.title && <> · {fact.title}</>}{fact.exitCode != null && <> (código {fact.exitCode})</>}
            </li>)}
            {card.mais > 0 && <li className="briefing-muted">e mais {card.mais}</li>}</ul>
          </section>}
          <section className="briefing-row">
            <h3>Agora</h3>
            <ul>
              <li>{PRINCIPAL[card.agora.principal]}</li>
              {sessions.map((session) => <li key={session.id}>
                {sessionLabel(session)}{session.tasks.map((task) => <span key={task.id}> · {task.title}</span>)}
                {session.external && <span className="briefing-muted"> · Externa, sem terminal para receber</span>}
              </li>)}
            </ul>
          </section>
          {card.precisa.length > 0 && <section className="briefing-row">
            <h3>Precisa de você</h3>
            <ul className="attention-items">{card.precisa.map((item) => <AttentionItem key={item.id} item={item} onOpen={queue.onOpen} onSnooze={queue.snooze} onDismiss={queue.dismiss} onResume={queue.onResume} sessions={queue.sessions} />)}</ul>
          </section>}
          {(receivers.length > 0 || text) && <form className="briefing-composer" onSubmit={send}>
            <div className="briefing-recipient">
              <label htmlFor={selectId}>Para:</label>
              <select id={selectId} value={target?.id || ''} onChange={(event) => {
                if (event.target.value !== (target?.id || '')) setReceipt(null);
                setSelection(event.target.value);
              }} disabled={busy || !receivers.length}>
                <option value="">{receivers.length ? 'Escolher sessão' : 'Nenhum terminal disponível'}</option>
                {receivers.map((session) => <option key={session.id} value={session.id}>{sessionLabel({ ...session, name: receiverName(session) })}</option>)}
              </select>
            </div>
            <label className="visually-hidden" htmlFor={textId}>{target ? `Mensagem para ${receiverName(target)} de ${card.projectName}` : `Mensagem para uma sessão de ${card.projectName}`}</label>
            <textarea id={textId} placeholder="Escreva uma mensagem" value={text} readOnly={busy} rows={3} onChange={(event) => {
              if (selection === undefined) setSelection(target?.id ?? '');
              setText(event.target.value);
            }} onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) send(event);
            }} />
            <div className="briefing-submit">
              <span className="briefing-muted">Enter envia · Shift+Enter quebra linha</span>
              <button type="submit" className="button primary compact" disabled={!canSend}><Send size={14} aria-hidden="true" />{busy ? 'Enviando…' : target ? `Enviar para ${receiverName(target)}` : 'Enviar'}</button>
            </div>
            {Array.from(text).length > 4000 && <p className="briefing-error" role="status">A mensagem deve ter até 4000 caracteres.</p>}
          </form>}
          <div role="status" aria-atomic="true" className="briefing-receipt">{status}</div>
          {error && <p className="briefing-error" role="alert">{error}</p>}
          {!card.semNovidades && showStartPrincipal && <button type="button" className="button secondary compact" onClick={() => onStartPrincipal(card.projectId)}>Iniciar a principal</button>}
        </div>
        {focused && target && <section className="briefing-terminal" aria-label={`Terminal de ${receiverName(target)}`} data-terminal-id={target.terminalId} data-read-only={readOnlyTerminal}>
          <h3><SquareTerminal size={15} aria-hidden="true" />{receiverName(target)}</h3>
          <TerminalView key={target.terminalId} terminalId={target.terminalId} desktop={desktop} theme={theme} cli={terminalCli(target.cli)} onExit={queue.reload} readOnly={readOnlyTerminal} tabNavigates />
        </section>}
      </div>}
      {card.semNovidades && <button type="button" className="button subtle compact briefing-quiet-start" onClick={() => onStartPrincipal(card.projectId)}>Iniciar a principal</button>}
    </article>
  );
}

export default function Briefing({ open, heading, onClose, view, queue, onOpenProject, onStartPrincipal, desktop, theme, detachedTerminals }) {
  const [focusedProject, setFocusedProject] = useState(null);
  const cards = view?.briefing ?? [];
  const focused = focusedProject ?? cards.find((card) => !card.semNovidades)?.projectId;
  return (
    <section className="briefing" aria-labelledby="briefing-title" hidden={!open}>
      <header className="briefing-toolbar">
        <h1 id="briefing-title" ref={heading} tabIndex={-1}>Briefing</h1>
        <button type="button" className="button secondary compact" onClick={onClose}><ArrowLeft size={15} aria-hidden="true" />Terminais</button>
      </header>
      <div className="briefing-scroll">
        {queue.error && <p className="briefing-error" role="alert">{queue.error}</p>}
        {!queue.loaded && <p role="status">Carregando briefing…</p>}
        {queue.loaded && !cards.length && !queue.error && <p>Autorize uma pasta para ver o briefing de um projeto.</p>}
        {cards.map((card) => <BriefingCard key={card.projectId} card={card} focused={open && focused === card.projectId} focus={() => setFocusedProject(card.projectId)} {...{ queue, onOpenProject, onStartPrincipal, desktop, theme, detachedTerminals }} />)}
      </div>
    </section>
  );
}
