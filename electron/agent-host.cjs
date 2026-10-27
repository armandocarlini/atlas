const { randomUUID } = require('node:crypto');
const { discoverAdapters, listModels, launchFor, MODEL_PATTERN } = require('./agent-adapters.cjs');
const { waitForCwd } = require('./project-host.cjs');

const MODELS_CACHE_MS = 60 * 1000;

// Ciclo de vida de sessões de agente neste marco: identidade gerada no
// processo principal, cwd validado, PTY real e estado mínimo em memória.
// O estado operacional é apenas running/exited; nada é inferido do ANSI.
function createAgentHost({ ipcMain, projectHost, transport, isMainSender, discover = discoverAdapters, listModelsImpl = listModels, store, onPersistenceError = console.error, orchestratorProfile, mcpHost = null, bridgeEntry = null, onRunEnded = () => {} }) {
  const agents = new Map();
  const pendingOrchestrators = new Map();
  const modelCache = new Map();
  let discoveryPromise = null;

  function describe(agent) {
    return {
      id: agent.id,
      name: agent.name,
      adapterId: agent.adapterId,
      cli: agent.cli,
      version: agent.version,
      model: agent.model,
      cwd: agent.cwd,
      origin: agent.origin,
      ptyId: agent.ptyId,
      state: agent.state,
      exit: agent.exit,
      createdAt: agent.createdAt,
      projectId: agent.projectId,
      runId: agent.runId,
      role: agent.role,
      runStartedAt: agent.runStartedAt,
      runAttempt: agent.runAttempt,
      atlasTools: Boolean(mcpHost?.isConnected(agent.id)),
    };
  }

  function listAgents() {
    const current = [...agents.values()].map(describe);
    if (!store) return current;
    const activeIds = new Set(current.map((agent) => agent.id));
    const history = [];
    for (const project of projectHost.getProjects()) {
      if (!projectHost.isAllowedCwd(project.path)) continue;
      const latestRuns = new Map(store.listRuns(project.id).map((run) => [run.session_id, run]));
      for (const session of store.listSessions(project.id)) {
        if (activeIds.has(session.id) || !projectHost.isAllowedCwd(session.cwd)) continue;
        const run = latestRuns.get(session.id);
        if (!run) continue;
        history.push({
          id: session.id, name: session.name, adapterId: session.adapter_id, cli: session.cli,
          version: session.cli_version, model: run.model ?? null, cwd: session.cwd, origin: session.origin,
          projectId: project.id, ptyId: null, state: 'exited', archived: true,
          runId: run.id, runState: run.state, reason: run.reason,
          exit: run.exit_code === null ? null : { exitCode: run.exit_code, signal: run.signal },
          createdAt: session.created_at, endedAt: run.ended_at,
          role: session.role, runStartedAt: run.started_at, runAttempt: run.attempt,
        });
      }
    }
    return [...current, ...history];
  }

  async function listAdapters() {
    if (!discoveryPromise) {
      discoveryPromise = discover().finally(() => { discoveryPromise = null; });
    }
    return discoveryPromise;
  }

  ipcMain.handle('agent:list-adapters', async (event) => {
    if (!isMainSender(event)) return [];
    return listAdapters();
  });

  ipcMain.handle('agent:list', (event) => {
    if (!isMainSender(event)) return [];
    return listAgents();
  });

  // Confirma o CLI antes de efeitos fora do ATLAS, como criar uma worktree.
  async function requireAdapter(adapterId) {
    if (typeof adapterId !== 'string' || !adapterId) throw new Error('Escolha o CLI do agente entre os detectados.');
    const adapter = (await listAdapters()).find((item) => item.id === adapterId);
    if (!adapter) throw new Error('Adaptador desconhecido. Atualize a lista de CLIs detectados.');
    if (adapter.status !== 'available') throw new Error(adapter.error || `${adapter.name} não está disponível.`);
    return adapter;
  }

  // Listar modelos pode levar segundos (o OpenCode consulta os provedores); a lista
  // fica em cache por pouco tempo e é atualizada quando o usuário pede.
  function modelsFor(adapter, refresh = false) {
    const cached = modelCache.get(adapter.id);
    if (!refresh && cached && Date.now() - cached.at < MODELS_CACHE_MS) return cached.promise;
    const promise = listModelsImpl(adapter);
    modelCache.set(adapter.id, { at: Date.now(), promise });
    promise.catch(() => { if (modelCache.get(adapter.id)?.promise === promise) modelCache.delete(adapter.id); });
    return promise;
  }

  // Não há CLI nem modelo padrão: os dois vêm da escolha do usuário. Sem modelos
  // identificados para o CLI, ele usa a própria configuração.
  async function resolveLaunch(adapterId, model) {
    const adapter = await requireAdapter(adapterId);
    const chosen = typeof model === 'string' && model ? model : null;
    if (chosen !== null && !MODEL_PATTERN.test(chosen)) throw new Error('Modelo inválido.');
    const models = await modelsFor(adapter);
    if (models.length && chosen === null) throw new Error(`Escolha o modelo do ${adapter.name} entre os identificados.`);
    if (chosen !== null && !models.includes(chosen)) throw new Error(`O modelo ${chosen} não foi identificado no ${adapter.name}. Atualize a lista de modelos.`);
    return { adapter, model: chosen };
  }

  ipcMain.handle('agent:list-models', async (event, request = {}) => {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a listar modelos.');
    const adapter = await requireAdapter(request?.adapterId);
    return { adapterId: adapter.id, models: await modelsFor(adapter, request?.refresh === true) };
  });

  async function createAgent(request = {}, { role = 'agent', existing = null, origin = 'user', launch: resolved = null } = {}) {
    await waitForCwd(projectHost, request.cwd);

    const { adapter, model } = resolved || await resolveLaunch(request.adapterId, request.model);

    const cwd = request.cwd || projectHost.getDefaultCwd();
    if (!projectHost.isAllowedCwd(cwd)) throw new Error('Selecione uma pasta autorizada ou uma worktree descoberta.');
    const project = projectHost.getProjectForCwd?.(cwd);
    if (store && !project) throw new Error('Projeto não encontrado para a pasta autorizada. Atualize os projetos.');

    const cols = Number.isInteger(request.cols) ? Math.min(500, Math.max(20, request.cols)) : 100;
    const rows = Number.isInteger(request.rows) ? Math.min(200, Math.max(5, request.rows)) : 30;
    const requestedName = typeof request.name === 'string' ? request.name.trim().slice(0, 60) : '';
    const name = requestedName || `${adapter.id}-${agents.size + 1}`;

    // Cada run recebe um token próprio para as ferramentas do ATLAS; a ponte
    // MCP herda endpoint e token do ambiente do PTY e o token morre com a run.
    const id = existing?.id || randomUUID();
    const atlasToken = mcpHost && project ? mcpHost.register({ projectId: project.id, sessionId: id, role }) : null;
    // Sempre definidas, mesmo vazias: o PTY nunca herda endpoint ou token do ambiente do próprio ATLAS.
    const env = { ATLAS_MCP_ENDPOINT: atlasToken ? mcpHost.endpoint : '', ATLAS_MCP_TOKEN: atlasToken || '' };
    // CLIs que recebem a ponte por run (OpenCode) levam a entrada com o token desta run.
    const bridge = atlasToken && bridgeEntry ? { command: bridgeEntry.command, args: bridgeEntry.args, env: { ...bridgeEntry.env, ...env } } : null;

    let record;
    try {
      const launch = launchFor({ adapter, role, model, orchestratorProfile, bridge });
      record = transport.spawn({
        file: adapter.executable,
        args: launch.args,
        cwd,
        cols,
        rows,
        env: { ...env, ...launch.env },
        meta: { kind: 'agent', cli: adapter.name },
      });
    } catch (error) {
      if (atlasToken) mcpHost.revoke(atlasToken);
      throw new Error(`Não foi possível iniciar o ${adapter.name}: ${error.message}`);
    }

    const agent = {
      id,
      name,
      adapterId: adapter.id,
      cli: adapter.name,
      version: adapter.version,
      model,
      cwd,
      origin,
      ptyId: record.id,
      state: 'running',
      exit: null,
      createdAt: existing?.created_at || new Date().toISOString(),
      runStartedAt: new Date().toISOString(),
      role,
      projectId: project?.id,
    };
    let run;
    try {
      run = store?.startSession(agent);
      agent.runId = run?.id;
      agent.runAttempt = run?.attempt;
      if (atlasToken && run) mcpHost.bindRun(atlasToken, run.id);
    } catch (error) {
      if (atlasToken) mcpHost.revoke(atlasToken);
      transport.close(record);
      throw new Error(`Não foi possível persistir a sessão de agente: ${error.message}`);
    }
    record.meta.agentId = agent.id;
    record.process.onExit(({ exitCode, signal }) => {
      if (atlasToken) mcpHost.revoke(atlasToken);
      agent.state = 'exited';
      agent.exit = { exitCode, signal };
      if (store && !store.closed) {
        try {
          store.finishRun({ runId: run.id, expectedVersion: run.version, exitCode, signal });
          // O fim da run tira o claim das tarefas dela; a interface precisa recarregar.
          onRunEnded(agent.projectId);
        } catch (error) {
          onPersistenceError(new Error(`Não foi possível persistir a saída da run ${run.id}: ${error.message}`));
        }
      }
    });
    agents.set(agent.id, agent);
    return describe(agent);
  }

  ipcMain.handle('agent:create', async (event, request = {}) => {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a criar sessões de agente.');
    return createAgent(request);
  });

  ipcMain.handle('agent:open-orchestrator', async (event, request = {}) => {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a abrir o orquestrador.');
    if (!store || typeof orchestratorProfile !== 'string') throw new Error('Perfil do orquestrador não configurado.');
    await waitForCwd(projectHost, request?.cwd);
    if (!request || !projectHost.isAllowedCwd(request.cwd)) throw new Error('Selecione uma pasta autorizada.');
    const project = projectHost.getProjectForCwd(request.cwd);
    if (!project || !projectHost.isAllowedCwd(project.path)) throw new Error('Projeto não encontrado para a pasta autorizada.');
    if (pendingOrchestrators.has(project.id)) return pendingOrchestrators.get(project.id);
    const current = [...agents.values()].find((agent) => agent.projectId === project.id && agent.role === 'orchestrator' && agent.state === 'running');
    if (current) return describe(current);
    const existing = store.getOrchestrator(project.id);
    if (existing && request.startNewRun !== true) {
      const history = listAgents().find((agent) => agent.id === existing.id);
      if (!history) throw new Error('Histórico da principal fora do escopo autorizado.');
      return history;
    }
    // Sem escolha do usuário a principal não inicia: a interface pergunta o CLI e o modelo.
    if (typeof request.adapterId !== 'string' || !request.adapterId) return { needsChoice: true, projectId: project.id, previousCli: existing?.cli || null };
    const operation = createAgent({ adapterId: request.adapterId, model: request.model, name: 'ORQUESTRADOR', cwd: project.path }, { role: 'orchestrator', existing })
      .finally(() => pendingOrchestrators.delete(project.id));
    pendingOrchestrators.set(project.id, operation);
    return operation;
  });

  return {
    listAgents,
    requireAdapter,
    resolveLaunch,
    getAgent: (id) => agents.get(id),
    createAgent,
    countActive: ({ projectId, origin }) => [...agents.values()].filter((agent) => agent.projectId === projectId && agent.origin === origin && agent.state === 'running').length,
  };
}

module.exports = { createAgentHost };
