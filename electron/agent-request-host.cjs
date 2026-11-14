const { AGENT_REQUEST_POLICY, AGENT_POLICY_RANGE } = require('./operational-store.cjs');
const path = require('node:path');
const worktreeManager = require('./worktree-manager.cjs');
const { waitForCwd } = require('./project-host.cjs');

// Aprovação dos agentes pedidos pela sessão principal: pelo usuário no cartão ou,
// no modo autônomo controlado do projeto, pelo ATLAS dentro das regras da política
// (docs/planos/PLANO_V0_2_PARALELISMO_POLITICAS.md). A decisão vale apenas para o
// payload exibido e é revalidada no ponto de execução: pendência, validade, hash e
// limite de agentes ativos antes do spawn.
function createAgentRequestHost({ ipcMain, projectHost, store, isMainSender, agentHost, policy: override = {}, onChange = () => {}, onAutoApproved = () => {}, worktrees = worktreeManager }) {
  const reserved = new Map();
  // Motivo, por pedido pendente, de o modo autônomo não o ter aprovado.
  const autoNotes = new Map();
  // Uma avaliação automática por projeto de cada vez.
  const evaluations = new Map();

  function policyFor(projectId) {
    return { ...(store.getAgentPolicy ? store.getAgentPolicy(projectId) : { ...AGENT_REQUEST_POLICY, mode: 'assisted', version: 0 }), ...override };
  }

  function publicPolicy(projectId) {
    const current = policyFor(projectId);
    return { mode: current.mode, maxPending: current.maxPending, ttlMinutes: Math.round(current.ttlMs / 60000), maxActiveAgents: current.maxActiveAgents };
  }

  async function projectForRequest(event, request) {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a decidir pedidos de agente.');
    if (!request || typeof request !== 'object' || typeof request.cwd !== 'string') throw new Error('Informe uma pasta autorizada.');
    await waitForCwd(projectHost, request.cwd);
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
    const autonomous = policyFor(project.id).mode === 'autonomous';
    // Pedidos pendentes com worktree mostram caminho e branch antes da decisão (sem chamar o Git).
    const items = store.listAgentRequests(project.id).map((item) => {
      const withNote = autonomous && item.state === 'pending' && autoNotes.has(item.id) ? { ...item, autoNote: autoNotes.get(item.id) } : item;
      if (!item.useWorktree || item.state !== 'pending') return withNote;
      try {
        const { path: plannedPath, branch } = worktrees.planWorktree({ project, taskId: item.taskId });
        // O cartão avisa quando a escrita acontece fora da pasta autorizada pelo usuário.
        const relative = path.relative(project.path, plannedPath);
        const outsideProject = relative.startsWith('..') || path.isAbsolute(relative);
        return { ...withNote, plannedWorktree: { path: plannedPath, branch, outsideProject } };
      } catch (error) {
        return { ...withNote, plannedWorktree: { error: error.message } };
      }
    });
    return { projectId: project.id, policy: publicPolicy(project.id), items };
  });

  ipcMain.handle('agent-request:reject', async (event, request) => {
    const project = await projectForRequest(event, request);
    const rejected = store.rejectAgentRequest({ projectId: project.id, requestId: requireId(request.requestId, 'Pedido') });
    autoNotes.delete(rejected?.id);
    onChange(project.id);
    return rejected;
  });

  // Só o usuário lê e altera a política, pela janela principal; a ponte MCP não altera.
  ipcMain.handle('agent-policy:get', async (event, request) => {
    const project = await projectForRequest(event, request);
    const { mode, maxActiveAgents, maxPending, version } = policyFor(project.id);
    return { projectId: project.id, policy: { mode, maxActiveAgents, maxPending, version }, range: { ...AGENT_POLICY_RANGE } };
  });

  ipcMain.handle('agent-policy:set', async (event, request) => {
    const project = await projectForRequest(event, request);
    const saved = store.setAgentPolicy({ projectId: project.id, mode: request.mode, maxActiveAgents: request.maxActiveAgents, maxPending: request.maxPending, expectedVersion: request.expectedVersion });
    onChange(project.id);
    // Ligar o modo (ou abrir vagas) reavalia o que já estava esperando.
    if (saved.mode === 'autonomous') evaluate(project.id);
    const { mode, maxActiveAgents, maxPending, version } = saved;
    return { projectId: project.id, policy: { mode, maxActiveAgents, maxPending, version } };
  });

  // Só depois da aprovação: cria a worktree da tarefa, registra e atualiza a
  // descoberta para que o caminho entre no escopo autorizado.
  async function prepareWorktree(project, approved) {
    const plan = worktrees.planWorktree({ project, taskId: approved.taskId });
    const created = await worktrees.createWorktree(plan);
    try {
      store.recordWorktree({ projectId: project.id, requestId: approved.id, taskId: approved.taskId, repositoryPath: created.repositoryPath, path: created.path, branch: created.branch, baseCommit: created.baseCommit });
      // Só o projeto da tarefa: os demais não precisam ser varridos de novo.
      await (projectHost.refreshRoot ? projectHost.refreshRoot(project.path) : projectHost.refresh());
      if (!projectHost.isAllowedCwd(created.path)) throw new Error('A descoberta Git não encontrou a worktree criada.');
    } catch (error) {
      error.message = `Worktree criada em ${created.path}, mas não foi possível usá-la: ${error.message}`;
      throw error;
    }
    return created;
  }

  // Função escolhida no cartão: a sugerida pela principal ou outra, nunca a da principal.
  function chosenFunction(slug) {
    if (slug === undefined || slug === null || slug === '') return null;
    const item = typeof slug === 'string' ? store.getFunctionBySlug?.(slug) : null;
    if (!item || item.kind === 'orchestrator') throw new Error('Função inválida para um agente.');
    return item;
  }

  // O propósito que o usuário leu no cartão chega ao novo agente pelo próprio ATLAS:
  // como oferta da tarefa do pedido ou, sem tarefa (ou se a oferta falhar), como
  // mensagem da principal. O prompt inicial fixo manda o agente consultar os dois.
  function deliverPurpose(projectId, approved, agentId) {
    const base = { projectId, fromSessionId: approved.requestedBy, toSessionId: agentId, actor: 'user' };
    let offerError = null;
    if (approved.taskId) {
      try {
        const handoff = store.offerHandoff({ ...base, taskId: approved.taskId, objective: approved.purpose, idempotencyKey: `atlas-kickoff-${approved.id}` });
        return { handoffId: handoff.id };
      } catch (error) {
        offerError = error.message;
      }
    }
    const body = offerError ? `${approved.purpose}\n\nA tarefa não pôde ser oferecida automaticamente: ${offerError}` : approved.purpose;
    const message = store.sendMessage({ ...base, kind: 'note', subject: `Pedido aprovado: ${approved.name}`, body: body.slice(0, 4000), idempotencyKey: `atlas-kickoff-${approved.id}` });
    return { messageId: message.id, ...(offerError ? { offerError } : {}) };
  }

  function activeCount(projectId) {
    return agentHost.countActive({ projectId, origin: 'orchestrator' }) + (reserved.get(projectId) || 0);
  }

  // Caminho único de aprovação: o cartão (`user`) e o modo autônomo (`policy`).
  async function approve(project, { requestId, payloadHash, adapterId, model, functionSlug }, by) {
    const fn = chosenFunction(functionSlug);
    // A escolha é conferida antes de aprovar, para que um CLI indisponível não
    // consuma o pedido nem crie worktree.
    const launch = await agentHost.resolveLaunch(adapterId, model);
    // Vagas reservadas durante o spawn evitam que aprovações simultâneas excedam o limite.
    const inFlight = reserved.get(project.id) || 0;
    const active = activeCount(project.id);
    const limit = policyFor(project.id).maxActiveAgents;
    if (active >= limit) throw new Error(`Limite da política: ${active} agentes criados pela principal já estão em execução neste projeto. Encerre um deles antes de aprovar.`);
    const approved = store.approveAgentRequest({ projectId: project.id, requestId, payloadHash, by });
    autoNotes.delete(requestId);
    // Auditoria: a run guarda a função final e se o usuário trocou a sugestão (outra
    // função, ou CLI e modelo diferentes dos salvos nela).
    const functionOverridden = fn || approved.functionSlug
      ? Boolean(fn?.slug !== approved.functionSlug || !fn || fn.adapterId !== launch.adapter.id || (fn.model || null) !== (launch.model || null))
      : null;
    reserved.set(project.id, inFlight + 1);
    try {
      let agent;
      let created = null;
      try {
        const cwd = approved.useWorktree ? (created = await prepareWorktree(project, approved)).path : project.path;
        agent = await agentHost.createAgent({ adapterId: launch.adapter.id, model: launch.model, name: approved.name, cwd, functionSlug: fn?.slug || null, functionOverridden }, { origin: 'orchestrator', launch, kickoff: true });
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
      let completed;
      try {
        completed = store.completeAgentRequest({ projectId: project.id, requestId, sessionId: agent.id });
      } catch (error) {
        return { request: null, agent, recordError: error.message };
      }
      try {
        return { request: completed, agent, delivery: deliverPurpose(project.id, approved, agent.id) };
      } catch (error) {
        return { request: completed, agent, deliveryError: error.message };
      }
    } finally {
      reserved.set(project.id, (reserved.get(project.id) || 1) - 1);
      onChange(project.id);
    }
  }

  ipcMain.handle('agent-request:approve', async (event, request) => {
    const project = await projectForRequest(event, request);
    return approve(project, {
      requestId: requireId(request.requestId, 'Pedido'),
      payloadHash: requireId(request.payloadHash, 'Conteúdo aprovado'),
      adapterId: request.adapterId,
      model: request.model,
      functionSlug: request.functionSlug,
    }, 'user');
  });

  // Regras do modo autônomo controlado. Devolve o motivo de não aprovar, ou null.
  function autoBlock(item, projectId) {
    if (!item.taskId || !item.useWorktree) return 'Sem tarefa com worktree: o modo autônomo só aprova trabalho isolado numa worktree nova. Decida você.';
    if (!item.functionSlug) return 'Sem função indicada pela principal. Decida você.';
    const fn = store.getFunctionBySlug?.(item.functionSlug);
    if (!fn || fn.kind === 'orchestrator') return `A função ${item.functionSlug} não existe mais. Decida você.`;
    if (!fn.adapterId) return `A função ${fn.name} ainda não tem CLI salvo. Configure-a ou decida você.`;
    const { maxActiveAgents } = policyFor(projectId);
    const active = activeCount(projectId);
    if (active >= maxActiveAgents) return `Aguardando vaga: ${active} de ${maxActiveAgents} agentes ativos.`;
    return null;
  }

  function projectById(projectId) {
    const row = store.listProjects?.().find((item) => item.id === projectId);
    const project = row && projectHost.getProjectForCwd(row.path);
    return project && project.id === projectId && projectHost.isAllowedCwd(project.path) ? project : null;
  }

  async function evaluateNow(projectId) {
    if (policyFor(projectId).mode !== 'autonomous') return;
    const project = projectById(projectId);
    if (!project) return;
    let changed = false;
    for (const item of store.listAgentRequests(projectId).filter((request) => request.state === 'pending')) {
      // O modo pode ter sido desligado durante uma aprovação anterior.
      if (policyFor(projectId).mode !== 'autonomous') break;
      const reason = autoBlock(item, projectId);
      if (reason) {
        if (autoNotes.get(item.id) !== reason) changed = true;
        autoNotes.set(item.id, reason);
        continue;
      }
      const fn = store.getFunctionBySlug(item.functionSlug);
      try {
        const result = await approve(project, { requestId: item.id, payloadHash: item.payloadHash, adapterId: fn.adapterId, model: fn.model || null, functionSlug: fn.slug }, 'policy');
        onAutoApproved(projectId, result);
      } catch (error) {
        // Antes de aprovar (CLI ou modelo indisponível), o pedido continua com o usuário;
        // depois, a falha do spawn já está registrada no pedido.
        autoNotes.set(item.id, `O modo autônomo não conseguiu iniciar: ${error.message}`);
        changed = true;
      }
    }
    if (changed) onChange(projectId);
  }

  function evaluate(projectId) {
    const previous = evaluations.get(projectId) || Promise.resolve();
    const next = previous.then(() => evaluateNow(projectId)).catch((error) => console.error('Avaliação automática de pedidos de agente falhou:', error));
    evaluations.set(projectId, next);
    return next;
  }

  // Motivo de o modo autônomo ter deixado o pedido esperando, como o cartão mostra.
  function autoNoteFor(requestId, projectId) {
    return policyFor(projectId).mode === 'autonomous' ? autoNotes.get(requestId) ?? null : null;
  }

  return { policy: publicPolicy, evaluate, autoNoteFor };
}

module.exports = { createAgentRequestHost };
