import { useEffect, useRef, useState } from 'react';
import { AgentChoice } from './AgentChoice.jsx';
import { choiceFromFunction, pickRecommendation } from './agent-functions.js';

function formatTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function AgentRequestCard({ request, policy, requesterName, adapters, functions, error, onApprove, onReject, onDismiss }) {
  const [busy, setBusy] = useState('');
  // A principal sugere a função; o cartão vem com o CLI e o modelo que o usuário
  // salvou nela, e ele confirma ou troca a função, o CLI e o modelo.
  const agentFunctions = (functions?.items || []).filter((item) => item.kind !== 'orchestrator');
  const [functionSlug, setFunctionSlug] = useState(request.functionSlug && agentFunctions.some((item) => item.slug === request.functionSlug) ? request.functionSlug : '');
  const selectedFunction = agentFunctions.find((item) => item.slug === functionSlug) || null;
  const [choice, setChoice] = useState(() => choiceFromFunction(selectedFunction));
  const functionChanged = Boolean(request.functionSlug) && functionSlug !== request.functionSlug;
  const choiceChanged = Boolean(selectedFunction?.adapterId) && choice.ready && (choice.adapterId !== selectedFunction.adapterId || (choice.model || null) !== (selectedFunction.model || null));

  // As funções podem chegar depois do cartão: aplica a sugestão enquanto o usuário não mexeu.
  const touched = useRef(false);
  const suggestionReady = agentFunctions.some((item) => item.slug === request.functionSlug);
  useEffect(() => {
    if (!touched.current && suggestionReady && !functionSlug) selectFunction(request.functionSlug, false);
  }, [suggestionReady]);

  function selectFunction(slug, byUser = true) {
    if (byUser) touched.current = true;
    setFunctionSlug(slug);
    setChoice(choiceFromFunction(agentFunctions.find((item) => item.slug === slug) || null));
  }
  const pending = request.state === 'pending';
  const titleId = `agent-request-${request.id}`;

  async function run(kind, action) {
    if (busy) return;
    setBusy(kind);
    try {
      await action(request);
    } finally {
      setBusy('');
    }
  }

  return <section className="agent-request" aria-labelledby={titleId} aria-busy={Boolean(busy)}>
    <span className="eyebrow">Pedido de {requesterName}</span>
    <h3 id={titleId}>Novo agente: {request.name}</h3>
    <div className="agent-request-purpose">
      <span>Propósito, escrito pela sessão principal</span>
      <p>{request.purpose}</p>
    </div>
    {request.taskTitle && <p className="agent-request-policy">Tarefa: <strong>{request.taskTitle}</strong></p>}
    {request.useWorktree && pending && (request.plannedWorktree?.error
      ? <p className="agent-request-error">{request.plannedWorktree.error}</p>
      : request.plannedWorktree && <div className="agent-request-worktree">
        <span>Ao aprovar, o ATLAS cria uma worktree Git para esta tarefa</span>
        <dl>
          <dt>Caminho</dt><dd>{request.plannedWorktree.path}</dd>
          <dt>Branch nova</dt><dd>{request.plannedWorktree.branch}, a partir do HEAD atual</dd>
        </dl>
        {request.plannedWorktree.outsideProject && <span>Fica fora da pasta autorizada do projeto, ao lado do repositório.</span>}
        <span>O agente nasce nessa worktree. O ATLAS não remove worktrees nem branches automaticamente.</span>
      </div>)}
    <p className="agent-request-policy">
      {pending ? `Vale até ${formatTime(request.expiresAt)}. ` : ''}
      Inicia o CLI escolhido, interativo, {request.useWorktree ? 'na worktree da tarefa' : 'no diretório do projeto'}, sem flags de autonomia nem prompt inicial; permissões continuam no harness.
      {policy ? ` Política: até ${policy.maxActiveAgents} agentes da principal em execução.` : ''}
    </p>
    {pending && <div className="agent-request-function">
      <label>Função do agente
        <select name="function" value={functionSlug} onChange={(event) => selectFunction(event.target.value)} disabled={Boolean(busy)}>
          <option value="">Sem função</option>
          {agentFunctions.map((item) => <option key={item.slug} value={item.slug}>{item.name}{item.slug === request.functionSlug ? ' (escolhida pela principal)' : ''}</option>)}
        </select>
      </label>
      {request.functionSlug && !agentFunctions.some((item) => item.slug === request.functionSlug) && <p className="agent-choice-note error" role="alert">A função {request.functionSlug} pedida pela principal não existe mais. Escolha outra ou siga sem função.</p>}
      {selectedFunction && !selectedFunction.adapterId && <p className="agent-choice-note">A função {selectedFunction.name} ainda não tem CLI e modelo. Escolha abaixo ou configure em Funções de agente.</p>}
      {(functionChanged || choiceChanged) && <p className="agent-choice-note">Alterado em relação {functionChanged ? 'à função escolhida pela principal' : 'ao que está salvo na função'}.</p>}
    </div>}
    {pending && <AgentChoice key={functionSlug || 'none'} adapters={adapters} value={choice} onChange={setChoice} disabled={Boolean(busy)} recommendation={pickRecommendation(functions?.recommendations, functionSlug, adapters)} />}
    {error && <p className="agent-request-error" role="alert">{error}</p>}
    <div className="agent-request-actions">
      {pending ? <>
        <button type="button" className="button secondary compact" disabled={Boolean(busy)} onClick={() => run('reject', onReject)}>{busy === 'reject' ? 'Recusando…' : 'Recusar'}</button>
        <button type="button" className="button primary compact" disabled={Boolean(busy) || !choice.ready} onClick={() => run('approve', (item) => onApprove(item, { ...choice, functionSlug }))}>{busy === 'approve' ? 'Iniciando…' : 'Aprovar e iniciar'}</button>
      </> : <button type="button" className="button secondary compact" onClick={() => onDismiss(request)}>Dispensar</button>}
    </div>
  </section>;
}

// Pedidos de agente da sessão principal aguardando a decisão do usuário. Pedidos
// que falharam permanecem visíveis com o motivo até serem dispensados.
export function AgentRequestsPanel({ state, sessions, adapters, functions, errors, onApprove, onReject, onDismiss }) {
  if (!state?.projectId) return null;
  const visible = state.items.filter((request) => request.state === 'pending' || errors[request.id]);
  if (state.error) return <p className="scope-note error-note" role="alert"><span>Não foi possível carregar os pedidos de agente: {state.error}</span></p>;
  if (!visible.length) return null;
  const nameOf = (id) => sessions.find((session) => session.id === id)?.name || 'sessão principal';
  return <div className="agent-requests" role="region" aria-label="Pedidos de agente aguardando sua decisão">
    {visible.map((request) => <AgentRequestCard
      key={request.id}
      request={request}
      policy={state.policy}
      requesterName={request.requesterName || nameOf(request.requestedBy)}
      adapters={adapters}
      functions={functions}
      error={errors[request.id]}
      onApprove={onApprove}
      onReject={onReject}
      onDismiss={onDismiss}
    />)}
  </div>;
}
