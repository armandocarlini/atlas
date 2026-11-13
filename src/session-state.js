export function agentSession(agent) {
  const archived = Boolean(agent.archived);
  const stopping = agent.reason === 'user_closed' && agent.state === 'running';
  let status = 'em execução';
  if (agent.reason === 'user_closed') {
    status = stopping ? 'encerrando…' : 'encerrada pelo usuário';
  } else if (archived) {
    status = agent.runState === 'lost' ? 'interrompida · resultado incerto'
      : agent.runState === 'succeeded' ? 'encerrada · código 0'
        : agent.runState === 'failed' ? `falhou · código ${agent.exit?.exitCode ?? 'desconhecido'}${agent.exit?.signal ? ` · sinal ${agent.exit.signal}` : ''}`
          : 'sem processo conectado';
  } else if (agent.state === 'exited') {
    status = `encerrado · código ${agent.exit?.exitCode ?? 'desconhecido'}`;
  }
  return {
    id: agent.id, ptyId: archived ? null : agent.ptyId, projectId: agent.projectId,
    roleKind: agent.role || 'agent', exited: archived || agent.state === 'exited', stopping, runStartedAt: agent.runStartedAt, runAttempt: agent.runAttempt,
    name: agent.name, cli: agent.cli, version: agent.version,
    role: archived ? 'Histórico de sessão; nenhum processo conectado'
      : agent.role === 'orchestrator' ? 'Planejamento do projeto; pede novos agentes com aprovação do usuário'
        : agent.external ? 'Sessão externa: o CLI roda fora do ATLAS e colabora pela ponte'
          : agent.origin === 'orchestrator' ? 'Agente pedido pela sessão principal e aprovado pelo usuário' : 'Sessão de agente criada pelo usuário',
    origin: agent.role === 'orchestrator' ? 'principal' : agent.external ? 'externa' : agent.origin === 'orchestrator' ? 'orquestrador' : 'manual',
    status, color: archived ? '#8d959d' : '#4ecb8d', worktree: agent.cwd,
    archived, runState: agent.runState, reason: agent.reason, createdAt: agent.createdAt,
    endedAt: agent.endedAt, model: agent.model ?? null, currentModel: agent.currentModel ?? null, adapterId: agent.adapterId ?? null,
    functionSlug: agent.functionSlug ?? null, effort: null, lines: [],
    atlasTools: !archived && Boolean(agent.atlasTools),
    external: Boolean(agent.external),
  };
}

export function terminalSession(terminal) {
  return {
    id: terminal.sessionId, ptyId: terminal.id, projectId: terminal.projectId,
    name: terminal.name, cli: 'PowerShell', worktree: terminal.cwd,
    role: 'Shell sem identidade de agente', origin: 'terminal', effort: 'local',
    exited: Boolean(terminal.exit), stopping: terminal.stopping,
    status: terminal.exit ? exitStatus(terminal.exit) : terminal.stopping ? 'encerrando…' : 'em execução',
    color: '#8d959d', tokens: '0', cost: '—', lines: [],
  };
}

const joinNames = (items) => {
  const names = items.map((item) => item.name);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names.at(-1)}` : names[0] || '';
};

// Aviso da retomada ao reabrir o ATLAS: o que voltou de onde estava, o que voltou com
// conversa nova (o CLI não retoma aquela conversa) e o que não voltou, com o motivo.
export function restoreSummary(result) {
  if (!result) return '';
  const { restored = [], fresh = [], failed = [] } = result;
  const parts = [];
  if (restored.length) parts.push(restored.length === 1 ? `${restored[0].name} voltou de onde estava.` : `${restored.length} sessões voltaram de onde estavam.`);
  if (fresh.length) parts.push(`${joinNames(fresh)} ${fresh.length === 1 ? 'voltou' : 'voltaram'} com conversa nova: o CLI não retoma aquela conversa.`);
  if (failed.length) parts.push(`Não foi possível retomar ${failed.map((item) => `${item.name} (${item.error})`).join('; ')}.`);
  return parts.join(' ');
}

export function mergeAgentSessions(current, agents) {
  const updates = new Map(agents.map((agent) => [agent.id, agentSession(agent)]));
  const merged = current.map((session) => {
    const update = updates.get(session.id);
    updates.delete(session.id);
    if (Number.isInteger(update?.runAttempt) && Number.isInteger(session.runAttempt) && update.runAttempt < session.runAttempt) return session;
    if (update?.runAttempt === session.runAttempt && session.exited && !update?.exited) return session;
    return update || session;
  });
  return [...merged, ...updates.values()];
}

function exitStatus(exit) {
  return exit.stoppedByUser ? 'encerrado pelo usuário' : `encerrado · código ${exit.exitCode}`;
}

export function sessionExit(current, sessionId, exit) {
  return current.map((session) => (sessionId === null || session.id === sessionId) && typeof exit.ptyId === 'string' && exit.ptyId === session.ptyId
    ? { ...session, exited: true, stopping: false, status: exitStatus(exit) } : session);
}

// O aviso de ferramentas do Kimi só faz sentido com sessão Kimi no projeto (ativa ou
// no histórico, que a próxima execução retoma). OpenCode recebe as ferramentas por run.
export function usesKimi(sessions) {
  return sessions.some((session) => typeof session.cli === 'string' && /kimi/i.test(session.cli));
}

export function usesGemini(sessions) {
  return sessions.some((session) => typeof session.cli === 'string' && /gemini/i.test(session.cli));
}

// Estado da principal ao abrir o projeto: sem processo vivo (histórico ou encerrada), ela
// espera uma nova run explícita, com nova escolha de CLI e modelo, como depois de excluí-la.
export function orchestratorStatusFor(projectId, agent) {
  if (agent?.needsChoice) return { projectId, loading: false, error: '', needsChoice: true, previousCli: agent.previousCli || null };
  if (agent && (agent.archived || agent.state === 'exited')) return { projectId, loading: false, error: '', needsChoice: true, previousCli: agent.cli || null };
  return { projectId, loading: false, error: '' };
}
