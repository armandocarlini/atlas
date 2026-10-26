const { randomUUID } = require('node:crypto');
const { discoverAdapters } = require('./agent-adapters.cjs');

// Ciclo de vida de sessões de agente neste marco: identidade gerada no
// processo principal, cwd validado, PTY real e estado mínimo em memória.
// O estado operacional é apenas running/exited; nada é inferido do ANSI.
function createAgentHost({ ipcMain, projectHost, transport, isMainSender, discover = discoverAdapters, store, onPersistenceError = console.error, orchestratorProfile }) {
  const agents = new Map();
  const pendingOrchestrators = new Map();
  let discoveryPromise = null;

  function describe(agent) {
    return {
      id: agent.id,
      name: agent.name,
      adapterId: agent.adapterId,
      cli: agent.cli,
      version: agent.version,
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
          version: session.cli_version, cwd: session.cwd, origin: session.origin,
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

  async function createAgent(request = {}, { role = 'agent', existing = null } = {}) {
    await projectHost.ready;

    const adapters = await listAdapters();
    const adapter = adapters.find((item) => item.id === request.adapterId);
    if (!adapter) throw new Error('Adaptador desconhecido. Atualize a lista de CLIs detectados.');
    if (adapter.status !== 'available') throw new Error(adapter.error || `${adapter.name} não está disponível.`);

    const cwd = request.cwd || projectHost.getDefaultCwd();
    if (!projectHost.isAllowedCwd(cwd)) throw new Error('Selecione uma pasta autorizada ou uma worktree descoberta.');
    const project = projectHost.getProjectForCwd?.(cwd);
    if (store && !project) throw new Error('Projeto não encontrado para a pasta autorizada. Atualize os projetos.');

    const cols = Number.isInteger(request.cols) ? Math.min(500, Math.max(20, request.cols)) : 100;
    const rows = Number.isInteger(request.rows) ? Math.min(200, Math.max(5, request.rows)) : 30;
    const requestedName = typeof request.name === 'string' ? request.name.trim().slice(0, 60) : '';
    const name = requestedName || `${adapter.id}-${agents.size + 1}`;

    let record;
    try {
      record = transport.spawn({
        file: adapter.executable,
        args: [...adapter.spawnArgs, ...(role === 'orchestrator' ? ['--agent-file', orchestratorProfile] : [])],
        cwd,
        cols,
        rows,
        meta: { kind: 'agent', cli: adapter.name },
      });
    } catch (error) {
      throw new Error(`Não foi possível iniciar o ${adapter.name}: ${error.message}`);
    }

    const agent = {
      id: existing?.id || randomUUID(),
      name,
      adapterId: adapter.id,
      cli: adapter.name,
      version: adapter.version,
      cwd,
      origin: 'user',
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
    } catch (error) {
      transport.close(record);
      throw new Error(`Não foi possível persistir a sessão de agente: ${error.message}`);
    }
    record.meta.agentId = agent.id;
    record.process.onExit(({ exitCode, signal }) => {
      agent.state = 'exited';
      agent.exit = { exitCode, signal };
      if (store && !store.closed) {
        try {
          store.finishRun({ runId: run.id, expectedVersion: run.version, exitCode, signal });
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
    await projectHost.ready;
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
    const operation = createAgent({ adapterId: 'kimi-code', name: 'ORQUESTRADOR', cwd: project.path }, { role: 'orchestrator', existing })
      .finally(() => pendingOrchestrators.delete(project.id));
    pendingOrchestrators.set(project.id, operation);
    return operation;
  });

  return {
    listAgents,
    getAgent: (id) => agents.get(id),
  };
}

module.exports = { createAgentHost };
