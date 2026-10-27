const { AGENT_REQUEST_POLICY } = require('./operational-store.cjs');

// Aprovação, pelo usuário, dos agentes pedidos pela sessão principal. A decisão
// vale apenas para o payload exibido e é revalidada no ponto de execução:
// pendência, validade, hash e limite de agentes ativos antes do spawn.
function createAgentRequestHost({ ipcMain, projectHost, store, isMainSender, agentHost, policy = AGENT_REQUEST_POLICY, onChange = () => {} }) {
  const reserved = new Map();
  const publicPolicy = { maxPending: policy.maxPending, ttlMinutes: Math.round(policy.ttlMs / 60000), maxActiveAgents: policy.maxActiveAgents };

  async function projectForRequest(event, request) {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a decidir pedidos de agente.');
    if (!request || typeof request !== 'object' || typeof request.cwd !== 'string') throw new Error('Informe uma pasta autorizada.');
    await projectHost.ready;
    if (!projectHost.isAllowedCwd(request.cwd)) throw new Error('Selecione uma pasta autorizada.');
    const project = projectHost.getProjectForCwd(request.cwd);
    if (!project || !projectHost.isAllowedCwd(project.path)) throw new Error('Projeto não encontrado para a pasta selecionada.');
    return project;
  }

  function requireId(value, label) {
    if (typeof value !== 'string' || !value) throw new Error(`${label} inválido.`);
    return value;
  }

  ipcMain.handle('agent-request:list', async (event, request) => {
    const project = await projectForRequest(event, request);
    return { projectId: project.id, policy: publicPolicy, items: store.listAgentRequests(project.id) };
  });

  ipcMain.handle('agent-request:reject', async (event, request) => {
    const project = await projectForRequest(event, request);
    const rejected = store.rejectAgentRequest({ projectId: project.id, requestId: requireId(request.requestId, 'Pedido') });
    onChange(project.id);
    return rejected;
  });

  ipcMain.handle('agent-request:approve', async (event, request) => {
    const project = await projectForRequest(event, request);
    const requestId = requireId(request.requestId, 'Pedido');
    const payloadHash = requireId(request.payloadHash, 'Conteúdo aprovado');
    // Vagas reservadas durante o spawn evitam que aprovações simultâneas excedam o limite.
    const inFlight = reserved.get(project.id) || 0;
    const active = agentHost.countActive({ projectId: project.id, origin: 'orchestrator' }) + inFlight;
    if (active >= policy.maxActiveAgents) throw new Error(`Limite da política: ${active} agentes criados pela principal já estão em execução neste projeto. Encerre um deles antes de aprovar.`);
    const approved = store.approveAgentRequest({ projectId: project.id, requestId, payloadHash });
    reserved.set(project.id, inFlight + 1);
    try {
      let agent;
      try {
        agent = await agentHost.createAgent({ adapterId: 'kimi-code', name: approved.name, cwd: project.path }, { origin: 'orchestrator' });
      } catch (error) {
        try {
          store.completeAgentRequest({ projectId: project.id, requestId, error: error.message });
        } catch {
          // O pedido fica `approved` e é reconciliado como falha no próximo início.
        }
        throw error;
      }
      // O agente já está em execução: uma falha ao registrar o resultado não pode
      // marcá-lo como falho nem escondê-lo da interface.
      try {
        return { request: store.completeAgentRequest({ projectId: project.id, requestId, sessionId: agent.id }), agent };
      } catch (error) {
        return { request: null, agent, recordError: error.message };
      }
    } finally {
      reserved.set(project.id, (reserved.get(project.id) || 1) - 1);
      onChange(project.id);
    }
  });

  return { policy: publicPolicy };
}

module.exports = { createAgentRequestHost };
