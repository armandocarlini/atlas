import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clipboard, Clock } from 'lucide-react';
import useModalFocus from './useModalFocus.js';

// Sessão externa (item 5 da v0.2, fase 2): um CLI aberto fora do ATLAS entra na
// equipe do projeto pela ponte. O ATLAS não tem o processo nem o terminal.

// O token aparece só no que vai para a área de transferência, nunca na tela.
export function maskedCommand(command) {
  return String(command || '').replace(/(\$env:ATLAS_MCP_TOKEN = ')[^']*(')/, '$1••••••••$2');
}

export function ExternalAttachModal({ adapters, functions, projectName, onAttach, onClose }) {
  const dialogRef = useModalFocus();
  const available = (adapters || []).filter((adapter) => adapter.status === 'available');
  const [name, setName] = useState('');
  const [adapterId, setAdapterId] = useState(available[0]?.id || '');
  const [functionSlug, setFunctionSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    dialogRef.current?.querySelector('[name=external-name]')?.focus();
  }, [dialogRef]);

  // A lista de CLIs chega depois de abrir: o primeiro disponível vira a escolha inicial.
  useEffect(() => {
    if (!adapterId && available[0]) setAdapterId(available[0].id);
  }, [adapterId, available]);

  async function submit(event) {
    event.preventDefault();
    if (busy || !adapterId) return;
    setBusy(true);
    setError('');
    try {
      await onAttach({ name: name.trim(), adapterId, functionSlug: functionSlug || null });
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
    }
  }

  return <div className="modal-backdrop" onKeyDown={(event) => { if (event.key === 'Escape' && !busy) onClose(); }}>
    <section className="modal regression-modal external-modal" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="external-title" aria-describedby="external-summary">
      <header><div><span className="eyebrow">{projectName}</span><h2 id="external-title">Anexar sessão externa</h2></div><button type="button" className="session-control" disabled={busy} onClick={onClose}>Fechar</button></header>
      <form onSubmit={submit} aria-busy={busy}>
        <p id="external-summary" className="regression-intro">Para um CLI aberto fora do ATLAS, por exemplo no Terminal do Windows. Ele entra na equipe deste projeto: recebe mensagens e ofertas de tarefa e pode pedir revisão. O ATLAS não vê nem controla o terminal dele.</p>
        <label>Nome
          <input name="external-name" value={name} maxLength={60} disabled={busy} autoComplete="off" placeholder={adapterId ? `${adapterId}-externa` : ''} onChange={(event) => setName(event.target.value)} />
        </label>
        {adapters === null ? <p role="status">Detectando CLIs…</p> : available.length
          ? <label>CLI
            <select name="external-cli" value={adapterId} disabled={busy} onChange={(event) => setAdapterId(event.target.value)}>
              {available.map((adapter) => <option key={adapter.id} value={adapter.id}>{adapter.name}</option>)}
            </select>
          </label>
          : <p className="error-note" role="alert">Nenhum CLI detectado no PATH. Instale um CLI de agente e atualize a lista.</p>}
        <label>Função do agente
          <select name="external-function" value={functionSlug} disabled={busy} onChange={(event) => setFunctionSlug(event.target.value)}>
            <option value="">Sem função</option>
            {(functions || []).filter((item) => item.kind !== 'orchestrator').map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}
          </select>
        </label>
        {error && <p className="error-note" role="alert">{error}</p>}
        <footer><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancelar</button><button type="submit" className="button primary" disabled={busy || !adapterId}>{busy ? 'Anexando…' : 'Anexar'}</button></footer>
      </form>
    </section>
  </div>;
}

// Corpo do card de uma sessão externa em execução: estado da ponte, o comando
// para conectar e "Desanexar".
export function ExternalSessionPanel({ session, desktop, connected, onDetach }) {
  const [loaded, setLoaded] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    desktop?.getExternalCommand?.(session.id).then((result) => { if (active) setLoaded(result); }).catch((failure) => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [desktop, session.id]);

  async function copy() {
    if (!loaded) return;
    try {
      await desktop.writeClipboardText(loaded.command);
      setCopied(true);
    } catch (failure) {
      setError(failure.message);
    }
  }

  async function detach() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onDetach(session);
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
    }
  }

  return <div className="session-history external-session">
    <p className={`external-state ${connected ? 'success-text' : ''}`} role="status">
      {connected ? <CheckCircle2 size={14} aria-hidden="true" /> : <Clock size={14} aria-hidden="true" />}
      <strong>{connected ? 'Conectada ao ATLAS' : 'Aguardando conexão'}</strong>
    </p>
    <ol className="external-steps">
      <li>Abra um PowerShell novo, fora do ATLAS.</li>
      <li>Cole o comando abaixo: ele entra em {session.worktree}, define a conexão só naquele processo e abre o {session.cli} com as ferramentas do ATLAS.</li>
      <li>Converse com o CLI lá. Mensagens e tarefas desta equipe chegam a ele pelas ferramentas do ATLAS.</li>
    </ol>
    {loaded && <pre className="external-command" tabIndex={0} aria-label="Comando de conexão, com o token oculto">{maskedCommand(loaded.command)}</pre>}
    {loaded?.needsConsent && <p className="regression-warning"><AlertTriangle size={14} aria-hidden="true" /><span>O {session.cli} lê a ponte da entrada do ATLAS no arquivo de configuração dele. Sem ela (Integrações, no Estado do projeto), o CLI abre sem as ferramentas do ATLAS.</span></p>}
    <p className="evidence-detail">O comando leva o token desta sessão: não o compartilhe. Ao desanexar, o token deixa de valer e as tarefas que a sessão assumiu ficam sem responsável ativo.</p>
    {error && <p className="error-note" role="alert">{error}</p>}
    <div className="review-actions">
      <button type="button" className="button secondary compact" disabled={!loaded} onClick={copy}><Clipboard size={14} aria-hidden="true" />{copied ? 'Copiado' : 'Copiar comando'}</button>
      <button type="button" className="button secondary danger compact" disabled={busy} onClick={detach}>{busy ? 'Desanexando…' : 'Desanexar'}</button>
    </div>
  </div>;
}
