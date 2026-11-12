import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import useModalFocus from './useModalFocus.js';

// Política de agentes por projeto (item 5 da v0.2): quantos agentes pedidos pela
// principal rodam ao mesmo tempo, quantos pedidos esperam e se o ATLAS aprova
// sozinho os pedidos que cumprem as regras do modo autônomo controlado.

const MODES = {
  assisted: 'assistido',
  autonomous: 'autônomo controlado',
};

export function agentPolicyLabel(policy) {
  if (!policy) return '';
  return `${MODES[policy.mode] || policy.mode} · até ${policy.maxActiveAgents} ${policy.maxActiveAgents === 1 ? 'ativo' : 'ativos'}`;
}

// Estado discreto na subbarra do projeto, com o caminho para configurar.
export function AgentPolicyStatus({ state, onManage }) {
  if (!state) return null;
  const label = state.loading ? 'verificando…' : state.error ? 'indisponível' : agentPolicyLabel(state.policy);
  const autonomous = state.policy?.mode === 'autonomous';
  return <span className={`agent-policy-status${autonomous ? ' autonomous' : ''}`} role="status">
    {autonomous && <AlertTriangle size={12} aria-hidden="true" />}
    <span>Agentes: {label}</span>
    {!state.loading && <button type="button" className="link-button" onClick={onManage}>Configurar</button>}
  </span>;
}

function range(min, max) {
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}

export function AgentPolicyModal({ desktop, cwd, projectName, onClose, onSaved }) {
  const dialogRef = useModalFocus();
  const [loaded, setLoaded] = useState(null);
  const [mode, setMode] = useState('assisted');
  const [maxActiveAgents, setMaxActive] = useState(2);
  const [maxPending, setMaxPending] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scope] = useState({ cwd, projectName });

  useEffect(() => {
    let active = true;
    desktop.getAgentPolicy({ cwd: scope.cwd }).then((result) => {
      if (!active) return;
      setLoaded(result);
      setMode(result.policy.mode);
      setMaxActive(result.policy.maxActiveAgents);
      setMaxPending(result.policy.maxPending);
    }).catch((failure) => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [desktop, scope.cwd]);

  // Os campos só existem depois da leitura; o foco vai para o modo escolhido.
  useEffect(() => {
    if (loaded) dialogRef.current?.querySelector('[name=agent-policy-mode]:checked')?.focus();
  }, [loaded, dialogRef]);

  async function submit(event) {
    event.preventDefault();
    if (busy || !loaded) return;
    setBusy(true);
    setError('');
    try {
      const saved = await desktop.setAgentPolicy({ cwd: scope.cwd, mode, maxActiveAgents, maxPending, expectedVersion: loaded.policy.version });
      onSaved(saved);
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
    }
  }

  const options = loaded ? range(loaded.range.min, loaded.range.max) : [];
  return <div className="modal-backdrop" onKeyDown={(event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === ',') { event.preventDefault(); event.stopPropagation(); }
    if (event.key === 'Escape' && !busy) onClose();
  }}>
    <section className="modal regression-modal agent-policy-modal" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="agent-policy-title" aria-describedby="agent-policy-summary">
      <header><div><span className="eyebrow">{scope.projectName}</span><h2 id="agent-policy-title">Política de agentes</h2></div><button type="button" className="session-control" disabled={busy} onClick={onClose}>Fechar</button></header>
      <form onSubmit={submit} aria-busy={busy || !loaded}>
        <p id="agent-policy-summary" className="regression-intro">Vale para os agentes que a sessão principal pede neste projeto. Agentes que você abre direto não entram nos limites.</p>
        {!loaded && !error && <p role="status">Carregando política…</p>}
        {loaded && <>
          <fieldset className="regression-timeout" disabled={busy}>
            <legend>Aprovação dos pedidos</legend>
            <label className="regression-choice"><input type="radio" name="agent-policy-mode" value="assisted" checked={mode === 'assisted'} onChange={() => setMode('assisted')} /><span><strong>Assistido</strong>: você aprova cada pedido no cartão.</span></label>
            <label className="regression-choice"><input type="radio" name="agent-policy-mode" value="autonomous" checked={mode === 'autonomous'} onChange={() => setMode('autonomous')} aria-describedby="agent-policy-rules" /><span><strong>Autônomo controlado</strong>: o ATLAS aprova sozinho o que cumpre as regras abaixo.</span></label>
          </fieldset>
          <ul id="agent-policy-rules" className="agent-policy-rules">
            <li>Só pedidos com tarefa e worktree nova: a escrita fica isolada.</li>
            <li>Só funções com CLI salvo; o agente usa o CLI e o modelo que você salvou nelas.</li>
            <li>Só se houver vaga no limite de agentes ativos.</li>
            <li>O resto espera você, com o motivo no cartão. Concluir tarefas continua só com você.</li>
          </ul>
          <div className="agent-policy-limits">
            <label>Agentes ativos ao mesmo tempo
              <select name="max-active" value={maxActiveAgents} disabled={busy} onChange={(event) => setMaxActive(Number(event.target.value))}>
                {options.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>Pedidos aguardando
              <select name="max-pending" value={maxPending} disabled={busy} onChange={(event) => setMaxPending(Number(event.target.value))}>
                {options.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          </div>
          {mode === 'autonomous' && <p className="regression-warning"><AlertTriangle size={14} aria-hidden="true" /><span>Cada agente aprovado sozinho usa o seu CLI e a sua assinatura, com as permissões do próprio CLI. Para pausar, volte para Assistido: os agentes em execução continuam até você encerrá-los.</span></p>}
        </>}
        {error && <p className="error-note" role="alert">{error}</p>}
        <footer><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancelar</button><button type="submit" className="button primary" disabled={busy || !loaded}>{busy ? 'Salvando…' : 'Salvar'}</button></footer>
      </form>
    </section>
  </div>;
}
