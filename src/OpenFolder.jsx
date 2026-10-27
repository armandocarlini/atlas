import { useEffect, useState } from 'react';
import useModalFocus from './useModalFocus.js';

// Confirmação de "Abrir no ATLAS" para uma pasta ainda não cadastrada.
export function OpenFolderModal({ request, onAuthorize, onCancel }) {
  const dialogRef = useModalFocus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function authorize() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const failure = await onAuthorize(request);
      if (failure) setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return <div className="modal-backdrop" onKeyDown={(event) => { if (event.key === 'Escape' && !busy) onCancel(request); }}>
    <section className="modal integration-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="open-folder-title" aria-describedby="open-folder-description" aria-busy={busy}>
      <header><div><span className="eyebrow">ABRIR NO ATLAS</span><h2 id="open-folder-title">Cadastrar {request.name} como projeto?</h2></div></header>
      <div className="integration-body">
        <p id="open-folder-description">O ATLAS recebeu esta pasta pelo Explorador de Arquivos. Ela ainda não é um projeto autorizado.</p>
        <div className="integration-field"><span>Pasta recebida</span><p className="integration-path">{request.path}</p></div>
        <ul className="integration-effects">
          <li>A pasta passa a fazer parte do escopo autorizado: terminais e agentes podem iniciar nela.</li>
          <li>A descoberta Git é somente leitura.</li>
          {request.nested?.length > 0 && <li>Já contém {request.nested.length === 1 ? 'o projeto' : 'os projetos'} {request.nested.join(', ')}. Eles continuam cadastrados e seus repositórios também aparecem dentro desta pasta.</li>}
          {request.git
            ? <li>A pasta é a raiz de um repositório Git; ele aparece na navegação.</li>
            : <li>A pasta não é a raiz de um repositório Git. O ATLAS procura repositórios dentro dela e não executa <code>git init</code>.</li>}
        </ul>
        {error && <p className="integration-error" role="alert">{error}</p>}
      </div>
      <footer className="integration-footer">
        <span className="integration-footer-spacer" />
        <button type="button" className="button secondary" disabled={busy} onClick={() => onCancel(request)}>Cancelar</button>
        <button type="button" className="button primary" disabled={busy} onClick={authorize}>{busy ? 'Cadastrando…' : 'Cadastrar e abrir'}</button>
      </footer>
    </section>
  </div>;
}

const EXPLORER_STATE = {
  absent: 'Não adicionada',
  installed: 'Ativa no menu de pastas (no Windows 11, em “Mostrar mais opções”)',
  outdated: 'Desatualizada: aponta para outro executável',
};

// Entrada opcional "Abrir no ATLAS" no Explorador: mostra exatamente o que será
// gravado no registro do usuário e só grava depois da confirmação.
export function ExplorerIntegrationSection({ desktop }) {
  const [status, setStatus] = useState(null);
  const [confirming, setConfirming] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    desktop.getExplorerIntegration().then((value) => { if (active) setStatus(value); }).catch((failure) => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [desktop]);

  if (!status || status.state === 'unsupported') return null;

  async function apply(action) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      setStatus(await (action === 'install' ? desktop.installExplorerIntegration({ confirm: true }) : desktop.removeExplorerIntegration({ confirm: true })));
      setConfirming('');
    } catch (failure) {
      setError(String(failure.message || failure).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      desktop.getExplorerIntegration().then(setStatus).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  return <fieldset className="theme-fieldset explorer-integration" aria-busy={busy}>
    <legend>Explorador de Arquivos</legend>
    <p className="explorer-status">“{status.label}” no menu de pastas: <strong>{EXPLORER_STATE[status.state] || status.state}</strong></p>
    {confirming && <div className="integration-field">
      <span>{confirming === 'install' ? 'Será gravado no registro do seu usuário (sem administrador):' : 'Será removido do registro do seu usuário:'}</span>
      <p className="integration-path">{status.keys.join('\n')}</p>
      {confirming === 'install' && <><span>Comando executado pelo Explorador</span><p className="integration-path">{status.command}</p></>}
    </div>}
    {error && <p className="integration-error" role="alert">{error}</p>}
    <div className="explorer-actions">
      {confirming
        ? <>
          <button type="button" className="button secondary compact" disabled={busy} onClick={() => setConfirming('')}>Cancelar</button>
          <button type="button" className={`button compact ${confirming === 'remove' ? 'secondary danger' : 'primary'}`} disabled={busy} onClick={() => apply(confirming)}>{busy ? 'Aplicando…' : confirming === 'install' ? 'Confirmar e adicionar' : 'Confirmar e remover'}</button>
        </>
        : <>
          {status.state !== 'absent' && <button type="button" className="button secondary danger compact" onClick={() => setConfirming('remove')}>Remover do Explorador</button>}
          {status.state !== 'installed' && <button type="button" className="button primary compact" onClick={() => setConfirming('install')}>{status.state === 'outdated' ? 'Atualizar entrada' : 'Adicionar ao Explorador'}</button>}
        </>}
    </div>
  </fieldset>;
}
