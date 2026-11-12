import { useState } from 'react';
import { Send } from 'lucide-react';
import useModalFocus from './useModalFocus.js';
import { MessageCard } from './message-card.js';
import { DEMO_MESSAGES } from './demo-messages.js';

export function SessionMessagesPanel({ state, onMarkRead, readOnly = false, demo = false }) {
  const unread = state.items.filter((message) => !message.readAt).length;
  return <section className="messages-panel" aria-label="Mensagens entre sessões do projeto">
    <div className="section-kicker"><span>{demo ? 'COLABORAÇÃO · DEMONSTRAÇÃO' : 'COLABORAÇÃO'}</span><span role="status" aria-atomic="true">{unread === 1 ? '1 não lida' : `${unread} não lidas`}</span></div>
    <h2>Mensagens entre sessões</h2>
    {state.loading ? <p role="status">Carregando mensagens…</p> : state.error ? <p className="error-note" role="alert">{state.error}</p> : !state.projectId ? <p>Selecione um projeto autorizado.</p> : <>
      {readOnly && <p className="messages-note">Leitura na janela de acompanhamento; marque como lida na janela principal.</p>}
      {!state.items.length ? <p className="messages-note">Nenhuma mensagem registrada neste projeto.</p> : <div className="messages-list">
        {state.items.map((message) => <MessageCard key={message.id} message={message} readOnly={readOnly} onMarkRead={onMarkRead} />)}
      </div>}
    </>}
  </section>;
}

/** Painel do navegador: mesmos cartões, com mensagens de demonstração em memória. */
export function DemoMessagesPanel() {
  const [items, setItems] = useState(DEMO_MESSAGES);
  const markRead = (message) => setItems((current) => current.map((item) => item.id === message.id ? { ...item, readAt: new Date().toISOString() } : item));
  return <SessionMessagesPanel demo state={{ loading: false, error: '', projectId: 'demo', items }} onMarkRead={markRead} />;
}

export function NewMessageModal({ projectName, fromName, toName, onSend, onClose }) {
  const dialogRef = useModalFocus();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const failure = await onSend({ kind: 'discovery', subject, body, idempotencyKey });
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
    <section className="modal task-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="new-message-title">
      <header><div><span className="eyebrow">{projectName}</span><h2 id="new-message-title">Enviar descoberta</h2></div><button type="button" className="session-control" disabled={busy} aria-label="Fechar envio de descoberta" onClick={onClose}>Fechar</button></header>
      <p className="scope-note"><Send size={14} aria-hidden="true" /><span>De <strong>{fromName}</strong> para <strong>{toName}</strong>. A mensagem é registrada no projeto e exibida no painel Mensagens; nada é digitado no terminal do destinatário.</span></p>
      <form onSubmit={submit} aria-busy={busy}>
        <label>Assunto<input name="subject" value={subject} required maxLength={160} disabled={busy} onChange={(event) => setSubject(event.target.value)} onBlur={() => { if (subject && !subject.trim()) setError('Informe um assunto para a descoberta.'); }} /></label>
        <label>Conteúdo<textarea name="body" value={body} required maxLength={4000} disabled={busy} rows={5} onChange={(event) => setBody(event.target.value)} onBlur={() => { if (body && !body.trim()) setError('Informe o conteúdo da descoberta.'); }} /></label>
        {error && <p className="error-note" role="alert">{error}</p>}
        <footer><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancelar</button><button type="submit" className="button primary" disabled={busy || !subject.trim() || !body.trim()}>{busy ? 'Enviando…' : 'Enviar descoberta'}</button></footer>
      </form>
    </section>
  </div>;
}
