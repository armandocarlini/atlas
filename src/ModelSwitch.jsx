import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import useModalFocus from './useModalFocus.js';
import { switchInstructions } from './model-switch.js';

const cleanError = (error) => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

// Trocar o modelo de um agente em execução: o usuário troca no terminal do CLI e
// informa aqui. O ATLAS não digita no terminal nem reinicia a sessão.
export function ModelSwitchModal({ session, desktop, onClose, onGoToTerminal, onDeclared }) {
  const dialogRef = useModalFocus();
  const instructions = switchInstructions(session.adapterId);
  const [models, setModels] = useState({ status: 'loading', items: [], error: '' });
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = session.currentModel || session.model || '';

  useEffect(() => {
    let active = true;
    desktop.listAgentModels({ adapterId: session.adapterId })
      .then((result) => { if (active) setModels({ status: 'ready', items: result.models, error: '' }); })
      .catch((failure) => { if (active) setModels({ status: 'error', items: [], error: cleanError(failure) }); });
    return () => { active = false; };
  }, [session.adapterId]);

  async function declare(event) {
    event.preventDefault();
    if (!model || busy) return;
    setBusy(true);
    setError('');
    try {
      onDeclared(await desktop.declareAgentModel({ sessionId: session.id, model }));
    } catch (failure) {
      setError(cleanError(failure));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section ref={dialogRef} className="modal model-switch-modal" onMouseDown={(event) => event.stopPropagation()} aria-modal="true" role="dialog" aria-labelledby="model-switch-title">
        <header>
          <div><span className="eyebrow">{session.cli}</span><h2 id="model-switch-title">Trocar o modelo de {session.name}</h2></div>
          <button className="icon-button" onClick={onClose} title="Fechar" aria-label="Fechar troca de modelo"><X size={18} /></button>
        </header>
        <form onSubmit={declare} noValidate>
          <p className="model-switch-current">Modelo atual: <strong>{current || 'o da configuração do CLI'}</strong></p>
          <section className="model-switch-step" aria-labelledby="model-switch-step-1">
            <h3 id="model-switch-step-1">1. Troque no terminal</h3>
            <ol>{instructions.steps.map((step) => <li key={step}>{step}</li>)}</ol>
            {instructions.warning && <p className="model-switch-warning">{instructions.warning}</p>}
            {instructions.note && <p className="agent-choice-note">{instructions.note}</p>}
            <p className="agent-choice-note">A tela, a conversa e a tarefa continuam: nada é reiniciado. O ATLAS não digita no terminal por você.</p>
            <button type="button" className="button secondary compact" onClick={onGoToTerminal}>Ir para o terminal</button>
          </section>
          <section className="model-switch-step" aria-labelledby="model-switch-step-2">
            <h3 id="model-switch-step-2">2. Informe o modelo novo ao ATLAS</h3>
            {models.status === 'loading' && <p className="agent-choice-note" role="status">Consultando os modelos do {session.cli}…</p>}
            {models.status === 'error' && <p className="agent-choice-note error" role="alert">{models.error}</p>}
            {models.status === 'ready' && !models.items.length && <p className="agent-choice-note">O {session.cli} não informa modelos ao ATLAS, então não há como registrar a troca.</p>}
            {models.status === 'ready' && models.items.length > 0 && <label>Modelo que você escolheu no terminal
              <select name="declared-model" value={model} onChange={(event) => setModel(event.target.value)} disabled={busy}>
                <option value="" disabled>Escolha o modelo…</option>
                {models.items.map((item) => <option key={item} value={item}>{item}{item === current ? ' (atual)' : ''}</option>)}
              </select>
            </label>}
            <p className="agent-choice-note">O card e a sessão principal passam a mostrar este modelo como informado por você.</p>
          </section>
          {error && <p className="agent-request-error" role="alert">{error}</p>}
          <footer>
            <button type="button" className="button secondary" onClick={onClose} disabled={busy}>Fechar</button>
            <button type="submit" className="button primary" disabled={busy || !model || model === current}>{busy ? 'Registrando…' : 'Informar modelo'}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
