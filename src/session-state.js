export function agentSession(agent) {
  const archived = Boolean(agent.archived);
  let status = 'em execução';
  if (archived) {
    status = agent.runState === 'lost' ? 'interrompida · resultado incerto'
      : agent.runState === 'succeeded' ? 'encerrada · código 0'
        : agent.runState === 'failed' ? `falhou · código ${agent.exit?.exitCode ?? 'desconhecido'}${agent.exit?.signal ? ` · sinal ${agent.exit.signal}` : ''}`
          : 'sem processo conectado';
  } else if (agent.state === 'exited') {
    status = `encerrado · código ${agent.exit?.exitCode ?? 'desconhecido'}`;
  }
  return {
    id: agent.id, ptyId: archived ? null : agent.ptyId, projectId: agent.projectId,
    roleKind: agent.role || 'agent', exited: archived || agent.state === 'exited', runStartedAt: agent.runStartedAt, runAttempt: agent.runAttempt,
    name: agent.name, cli: agent.cli, version: agent.version,
    role: archived ? 'Histórico de sessão; nenhum processo conectado'
      : agent.role === 'orchestrator' ? 'Planejamento do projeto; pede novos agentes com aprovação do usuário'
        : agent.origin === 'orchestrator' ? 'Agente pedido pela sessão principal e aprovado pelo usuário' : 'Sessão de agente criada pelo usuário',
    origin: agent.role === 'orchestrator' ? 'principal' : agent.origin === 'orchestrator' ? 'orquestrador' : 'manual',
    status, color: archived ? '#8d959d' : '#4ecb8d', worktree: agent.cwd,
    archived, runState: agent.runState, reason: agent.reason, createdAt: agent.createdAt,
    endedAt: agent.endedAt, model: null, effort: null, lines: [],
    atlasTools: !archived && Boolean(agent.atlasTools),
  };
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

export function sessionExit(current, sessionId, exit) {
  return current.map((session) => session.id === sessionId && typeof exit.ptyId === 'string' && exit.ptyId === session.ptyId
    ? { ...session, exited: true, status: `encerrado · código ${exit.exitCode}` } : session);
}
