import { useState } from 'react';
import useModalFocus from './useModalFocus.js';

export const INTEGRATION_LABELS = {
  installed: 'conectadas',
  absent: 'não conectadas',
  outdated: 'desatualizadas',
  conflict: 'em conflito',
  invalid: 'com erro no arquivo',
};

// Status discreto na subbarra do workspace; sempre oferece o caminho para revisar ou remover.
export function KimiIntegrationStatus({ status, onManage }) {
  if (!status) return null;
  const label = status.loading ? 'verificando…' : INTEGRATION_LABELS[status.state] || 'indisponíveis';
  return <span className="integration-status" role="status">
    <span>Ferramentas ATLAS no Kimi: {label}</span>
    {!status.loading && <button type="button" className="link-button" onClick={onManage}>{status.state === 'installed' ? 'Gerenciar' : 'Revisar'}</button>}
  </span>;
}

// Aviso dispensável enquanto a integração não está conectada.
export function KimiIntegrationNotice({ status, onReview, onDismiss }) {
  if (!status || status.loading || status.state === 'installed') return null;
  const problem = status.state === 'invalid' || status.state === 'conflict';
  const message = problem ? status.error
    : status.state === 'outdated' ? 'A integração do ATLAS com o Kimi aponta para outra instalação do ATLAS. Revise para atualizar.'
      : 'As ferramentas do ATLAS não estão conectadas ao Kimi. Sem elas, a sessão principal não lê descobertas nem mensagens do projeto.';
  return <div className={`scope-note integration-notice ${problem ? 'error-note' : ''}`} role={problem ? 'alert' : 'status'}>
    <span>{message}</span>
    <div className="integration-notice-actions">
      <button type="button" className="button secondary compact" onClick={onReview}>{problem ? 'Verificar' : 'Revisar e conectar'}</button>
      <button type="button" className="button secondary compact" onClick={onDismiss}>Agora não</button>
    </div>
  </div>;
}

export function KimiIntegrationModal({ status, onInstall, onRemove, onRefresh, onClose }) {
  const dialogRef = useModalFocus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const installed = status.state === 'installed';
  const blocked = status.state === 'invalid' || status.state === 'conflict';

  async function run(action) {
    if (busy) return;
    // Os botões ficam desabilitados durante a ação; o foco passa ao diálogo para não cair no body.
    dialogRef.current?.focus();
    setBusy(true);
    setError('');
    try {
      await action();
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
    <section className="modal integration-modal" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="integration-title" aria-describedby="integration-summary" aria-busy={busy}>
      <header>
        <div><span className="eyebrow">Integração local</span><h2 id="integration-title">{installed ? 'Ferramentas do ATLAS no Kimi' : 'Conectar ferramentas do ATLAS ao Kimi'}</h2></div>
        <button type="button" className="session-control" disabled={busy} onClick={onClose}>Fechar</button>
      </header>
      <div className="integration-body">
        <p id="integration-summary">{installed
          ? 'O servidor atlas está registrado no arquivo de configuração MCP do Kimi abaixo. Remover apaga somente essa entrada.'
          : 'O ATLAS vai adicionar o servidor atlas ao arquivo de configuração MCP do Kimi abaixo. Outros servidores e campos do arquivo são preservados.'}</p>
        <div className="integration-field">
          <span>Arquivo</span>
          <code className="integration-path">{status.file}</code>
        </div>
        <div className="integration-field">
          <span>{installed ? 'Entrada registrada' : 'Conteúdo que será gravado'}</span>
          <pre className="integration-entry" tabIndex={0} aria-label="Conteúdo exato da entrada atlas">{status.entryText}</pre>
        </div>
        <ul className="integration-effects">
          <li><span>Vale para todas as sessões do Kimi. Fora do ATLAS o servidor não expõe ferramentas.</span></li>
          <li><span>No ATLAS, cada sessão acessa só sessões, tarefas e mensagens do próprio projeto. Não há ferramentas para criar agentes, executar comandos ou alterar arquivos.</span></li>
          <li><span>O Kimi continua pedindo sua aprovação antes de cada ferramenta, conforme suas regras de permissão.</span></li>
          <li><span>Sessões já abertas precisam de nova execução para carregar as ferramentas.</span></li>
        </ul>
        {(error || (blocked && status.error)) && <p className="error-note integration-error" role="alert">{error || status.error}</p>}
      </div>
      <footer className="integration-footer">
        {installed && <button type="button" className="button secondary danger" disabled={busy} onClick={() => run(onRemove)}>{busy ? 'Removendo…' : 'Remover integração'}</button>}
        <span className="integration-footer-spacer" />
        {blocked && <button type="button" className="button secondary" disabled={busy} onClick={() => run(onRefresh)}>Verificar novamente</button>}
        <button type="button" className="button secondary" disabled={busy} onClick={onClose}>{installed ? 'Fechar' : 'Cancelar'}</button>
        {!installed && <button type="button" className="button primary" disabled={busy || blocked} onClick={() => run(onInstall)}>{busy ? 'Gravando…' : status.state === 'outdated' ? 'Atualizar integração' : 'Conectar'}</button>}
      </footer>
    </section>
  </div>;
}
