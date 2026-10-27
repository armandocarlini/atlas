const { AGENT_REQUEST_POLICY } = require('./operational-store.cjs');
const path = require('node:path');
const worktreeManager = require('./worktree-manager.cjs');

// Aprovação, pelo usuário, dos agentes pedidos pela sessão principal. A decisão
// vale apenas para o payload exibido e é revalidada no ponto de execução:
// pendência, validade, hash e limite de agentes ativos antes do spawn.
function createAgentRequestHost({ ipcMain, projectHost, store, isMainSender, agentHost, policy = AGENT_REQUEST_POLICY, onChange = () => {}, worktrees = worktreeManager }) {
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
    // Pedidos pendentes com worktree mostram caminho e branch antes da decisão (sem chamar o Git).
    const items = store.listAgentRequests(project.id).map((item) => {
      if (!item.useWorktree || item.state !== 'pending') return item;
      try {
        const { path: plannedPath, branch } = worktrees.planWorktree({ project, taskId: item.taskId });
        // O cartão avisa quando a escrita acontece fora da pasta autorizada pelo usuário.
        const relative = path.relative(project.path, plannedPath);
        const outsideProject = relative.startsWith('..') || path.isAbsolute(relative);
        return { ...item, plannedWorktree: { path: plannedPath, branch, outsideProject } };
      } catch (error) {
        return { ...item, plannedWorktree: { error: error.message } };
      }
    });
    return { projectId: project.id, policy: publicPolicy, items };
  });

  ipcMain.handle('agent-request:reject', async (event, request) => {
    const project = await projectForRequest(event, request);
    const rejected = store.rejectAgentRequest({ projectId: project.id, requestId: requireId(request.requestId, 'Pedido') });
    onChange(project.id);
    return rejected;
  });

  // Só depois da aprovação: cria a worktree da tarefa, registra e atualiza a
  // descoberta para que o caminho entre no escopo autorizado.
  async function prepareWorktree(project, approved) {
    const plan = worktrees.planWorktree({ project, taskId: approved.taskId });
    const created = await worktrees.createWorktree(plan);
    try {
      store.recordWorktree({ projectId: project.id, requestId: approved.id, taskId: approved.taskId, repositoryPath: created.repositoryPath, path: created.path, branch: created.branch, baseCommit: created.baseCommit });
      await projectHost.refresh();
      if (!projectHost.isAllowedCwd(created.path)) throw new Error('A descoberta Git não encontrou a worktree criada.');
    } catch (error) {
      error.message = `Worktree criada em ${created.path}, mas não foi possível usá-la: ${error.message}`;
      throw error;
    }
    return created;
  }

  ipcMain.handle('agent-request:approve', async (event, request) => {
    const project = await projectForRequest(event, request);
    const requestId = requireId(request.requestId, 'Pedido');
    const payloadHash = requireId(request.payloadHash, 'Conteúdo aprovado');
    // O usuário escolhe o CLI e o modelo na aprovação; a escolha é conferida antes
    // de aprovar, para que um CLI indisponível não consuma o pedido nem crie worktree.
    const launch = await agentHost.resolveLaunch(request.adapterId, request.model);
    // Vagas reservadas durante o spawn evitam que aprovações simultâneas excedam o limite.
    const inFlight = reserved.get(project.id) || 0;
    const active = agentHost.countActive({ projectId: project.id, origin: 'orchestrator' }) + inFlight;
    if (active >= policy.maxActiveAgents) throw new Error(`Limite da política: ${active} agentes criados pela principal já estão em execução neste projeto. Encerre um deles antes de aprovar.`);
    const approved = store.approveAgentRequest({ projectId: project.id, requestId, payloadHash });
    reserved.set(project.id, inFlight + 1);
    try {
      let agent;
      let created = null;
      try {
        const cwd = approved.useWorktree ? (created = await prepareWorktree(project, approved)).path : project.path;
        agent = await agentHost.createAgent({ adapterId: launch.adapter.id, model: launch.model, name: approved.name, cwd }, { origin: 'orchestrator', launch });
      } catch (error) {
        // A worktree criada permanece: o ATLAS não remove nada automaticamente.
        if (created) error.message = `Worktree criada em ${created.path}, mas o agente não iniciou: ${error.message}`;
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
