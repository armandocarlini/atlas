const { randomUUID } = require('node:crypto');
const { discoverAdapters, listModels, launchFor, conversationSupport, MODEL_PATTERN, assertOrchestratorSupport } = require('./agent-adapters.cjs');
const { waitForCwd } = require('./project-host.cjs');

const MODELS_CACHE_MS = 60 * 1000;

// Ciclo de vida de sessões de agente neste marco: identidade gerada no
// processo principal, cwd validado, PTY real e estado mínimo em memória.
// O estado operacional é apenas running/exited; nada é inferido do ANSI.
// Uma retomada que morre com erro logo ao abrir (conversa que nunca chegou a ser gravada,
// nenhuma conversa anterior na pasta) volta uma vez com conversa nova.
const RESUME_GRACE_MS = 4000;
const graceDelay = () => new Promise((resolve) => setTimeout(resolve, RESUME_GRACE_MS));

// Literal do PowerShell: aspas simples, com as internas dobradas. Nada é interpretado.
function psLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function createAgentHost({ ipcMain, projectHost, transport, isMainSender, discover = discoverAdapters, listModelsImpl = listModels, store, onPersistenceError = console.error, orchestratorProfile, claudeProfile = null, geminiProfile = null, mcpHost = null, bridgeEntry = null, onRunEnded = () => {}, resumeGrace = graceDelay }) {
  const agents = new Map();
  // Token da ponte de cada sessão externa anexada; nunca sai pela listagem.
  const externalTokens = new Map();
  const pendingOrchestrators = new Map();
  const modelCache = new Map();
  let discoveryPromise = null;
  // Fechamento do app: as saídas forçadas dos processos não viram "falhou"; o banco já
  // marcou as runs como fechadas pelo app (operational-store markAppClosed).
  let shuttingDown = false;
  // Retomada na abertura (docs/planos/PLANO_CONTINUIDADE_SESSOES.md).
  let restoreState = { pending: false, result: null };

  function describe(agent) {
    return {
      id: agent.id,
      name: agent.name,
      adapterId: agent.adapterId,
      cli: agent.cli,
      version: agent.version,
      model: agent.model,
      currentModel: agent.currentModel ?? null,
      functionSlug: agent.functionSlug ?? null,
      cwd: agent.cwd,
      origin: agent.origin,
      ptyId: agent.ptyId,
      state: agent.state,
      exit: agent.exit,
      reason: agent.stoppedByUser ? 'user_closed' : undefined,
      createdAt: agent.createdAt,
      projectId: agent.projectId,
      runId: agent.runId,
      role: agent.role,
      runStartedAt: agent.runStartedAt,
      runAttempt: agent.runAttempt,
      atlasTools: Boolean(mcpHost?.isConnected(agent.id)),
      external: Boolean(agent.external),
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
          version: session.cli_version, model: run.model ?? null, currentModel: run.current_model ?? null, functionSlug: run.function_slug ?? null, cwd: session.cwd, origin: session.origin,
          projectId: project.id, ptyId: null, state: 'exited', archived: true,
          runId: run.id, runState: run.state, reason: run.reason,
          exit: run.exit_code === null ? null : { exitCode: run.exit_code, signal: run.signal },
          createdAt: session.created_at, endedAt: run.ended_at,
          role: session.role, runStartedAt: run.started_at, runAttempt: run.attempt,
          external: session.attachment === 'external',
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
  // identificados para o CLI, ele usa a própria configuração; nos CLIs sem lista
  // (`modelEntry: 'free'`), o modelo digitado só passa pela validação de formato.
  async function resolveLaunch(adapterId, model) {
    const adapter = await requireAdapter(adapterId);
    const chosen = typeof model === 'string' && model ? model : null;
    if (chosen !== null && !MODEL_PATTERN.test(chosen)) throw new Error('Modelo inválido.');
    const models = await modelsFor(adapter);
    if (models.length && chosen === null) throw new Error(`Escolha o modelo do ${adapter.name} entre os identificados.`);
    const free = adapter.modelEntry === 'free' && !models.length;
    if (chosen !== null && !free && !models.includes(chosen)) throw new Error(`O modelo ${chosen} não foi identificado no ${adapter.name}. Atualize a lista de modelos.`);
    return { adapter, model: chosen };
  }

  ipcMain.handle('agent:list-models', async (event, request = {}) => {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a listar modelos.');
    const adapter = await requireAdapter(request?.adapterId);
    return { adapterId: adapter.id, models: await modelsFor(adapter, request?.refresh === true) };
  });

  // Conversa do CLI desta run. resume: null (sessão nova ou nova execução), 'resume'
  // (mesma conversa pelo ID salvo), 'continue' (a mais recente da pasta) ou 'fresh'.
  function conversationFor(adapter, role, existing, resume) {
    const support = conversationSupport(adapter.id, role);
    if (resume === 'resume' && support === 'exact' && existing?.conversation_id) return { mode: 'resume', id: existing.conversation_id };
    if ((resume === 'resume' || resume === 'continue') && support !== 'none') return { mode: 'continue' };
    return support === 'exact' ? { mode: 'new', id: randomUUID() } : null;
  }

  async function createAgent(request = {}, { role = 'agent', existing = null, origin = 'user', launch: resolved = null, resume = null, kickoff = false } = {}) {
    await waitForCwd(projectHost, request.cwd);

    const { adapter, model } = resolved || await resolveLaunch(request.adapterId, request.model);
    if (resume && existing && store?.getSession(existing.id)?.removed_at) throw new Error('A sessão foi excluída.');
    const orchestratorMode = role === 'orchestrator' ? (request.orchestratorMode || 'coordinate') : null;
    if (role === 'orchestrator') assertOrchestratorSupport(adapter);
    if (request.functionSlug !== undefined && request.functionSlug !== null && (typeof request.functionSlug !== 'string' || (store && !store.getFunctionBySlug?.(request.functionSlug)))) throw new Error('Função de agente desconhecida.');

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

    const conversation = conversationFor(adapter, role, existing, resume);
    let record;
    try {
      const launch = launchFor({ adapter, role, model, orchestratorProfile, claudeProfile, geminiProfile, bridge, orchestratorMode: orchestratorMode || 'coordinate', conversation, kickoff });
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
      // Função usada para preencher a escolha (v0.2); só auditoria, não muda o lançamento.
      functionSlug: typeof request.functionSlug === 'string' ? request.functionSlug : null,
      functionOverridden: typeof request.functionOverridden === 'boolean' ? request.functionOverridden : null,
    };
    let run;
    try {
      run = store?.startSession(agent);
      // Conversa nova com ID fixado pelo ATLAS: é por ele que a sessão volta ao reabrir.
      if (conversation?.mode === 'new') store?.setConversation({ sessionId: agent.id, conversationId: conversation.id });
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
      if (store && !store.closed && !shuttingDown) {
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

  // Auditoria da função usada para preencher a escolha: calculada aqui, nunca vinda
  // da interface. Trocar o que estava salvo na função conta como alteração.
  function functionAudit(slug, adapterId, model, { orchestrator = false } = {}) {
    if (slug === undefined || slug === null || slug === '' || !store) return { functionSlug: null, functionOverridden: null };
    const fn = typeof slug === 'string' ? store.getFunctionBySlug(slug) : null;
    if (!fn || (fn.kind === 'orchestrator') !== orchestrator) throw new Error('Função de agente inválida para esta sessão.');
    return { functionSlug: fn.slug, functionOverridden: fn.adapterId !== adapterId || (fn.model || null) !== (model || null) };
  }

  ipcMain.handle('agent:create', async (event, request = {}) => {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a criar sessões de agente.');
    return createAgent({ ...request, ...functionAudit(request?.functionSlug, request?.adapterId, request?.model) });
  });

  // Sessão externa (docs/planos/PLANO_V0_2_PARALELISMO_POLITICAS.md, fase 2): um CLI
  // aberto fora do ATLAS entra na equipe pela ponte. O ATLAS não tem o processo; a run
  // vive até o usuário desanexar ou o app fechar, e não é reaberta na abertura seguinte.
  async function attachExternal(request = {}) {
    if (!mcpHost || !store) throw new Error('O canal de ferramentas do ATLAS não está disponível; não há como anexar uma sessão externa.');
    await waitForCwd(projectHost, request.cwd);
    const cwd = request.cwd;
    if (typeof cwd !== 'string' || !projectHost.isAllowedCwd(cwd)) throw new Error('Selecione uma pasta autorizada ou uma worktree descoberta.');
    const project = projectHost.getProjectForCwd?.(cwd);
    if (!project) throw new Error('Projeto não encontrado para a pasta autorizada. Atualize os projetos.');
    const adapter = await requireAdapter(request.adapterId);
    const { functionSlug } = functionAudit(request.functionSlug, adapter.id, null);
    const requestedName = typeof request.name === 'string' ? request.name.trim().slice(0, 60) : '';
    const id = randomUUID();
    const at = new Date().toISOString();
    const agent = {
      id, name: requestedName || `${adapter.id}-externa`, adapterId: adapter.id, cli: adapter.name, version: adapter.version,
      model: null, cwd, origin: 'user', ptyId: null, state: 'running', exit: null, createdAt: at, runStartedAt: at,
      role: 'agent', projectId: project.id, functionSlug, functionOverridden: null, external: true, adapter,
    };
    const token = mcpHost.register({ projectId: project.id, sessionId: id, role: 'agent' });
    try {
      const run = store.startSession({ ...agent, attachment: 'external' });
      agent.runId = run.id;
      agent.runVersion = run.version;
      agent.runAttempt = run.attempt;
      mcpHost.bindRun(token, run.id);
    } catch (error) {
      mcpHost.revoke(token);
      throw new Error(`Não foi possível registrar a sessão externa: ${error.message}`);
    }
    externalTokens.set(id, token);
    agents.set(id, agent);
    return describe(agent);
  }

  // Comando para colar num PowerShell: endpoint e token só naquele processo, e o CLI
  // aberto com a ponte do ATLAS como numa run interna. Nada é gravado em disco.
  function externalCommand(sessionId) {
    const agent = agents.get(sessionId);
    const token = externalTokens.get(sessionId);
    if (!agent?.external || !token) throw new Error('Sessão externa não encontrada ou já desanexada.');
    const env = { ATLAS_MCP_ENDPOINT: mcpHost.endpoint, ATLAS_MCP_TOKEN: token };
    const bridge = bridgeEntry ? { command: bridgeEntry.command, args: bridgeEntry.args, env: { ...bridgeEntry.env, ...env } } : null;
    const launch = launchFor({ adapter: agent.adapter, role: 'agent', claudeProfile, geminiProfile, bridge });
    const lines = [
      `Set-Location -LiteralPath ${psLiteral(agent.cwd)}`,
      ...Object.entries({ ...env, ...launch.env }).map(([key, value]) => `$env:${key} = ${psLiteral(value)}`),
      [`& ${psLiteral(agent.adapter.executable)}`, ...launch.args.map(psLiteral)].join(' '),
    ];
    // Kimi e Gemini leem a ponte da entrada consentida no arquivo do próprio CLI.
    const needsConsent = agent.adapter.atlasTools === 'consent' || agent.adapterId === 'gemini';
    return { sessionId, command: lines.join('\n'), needsConsent };
  }

  function detachExternal(sessionId) {
    const agent = agents.get(sessionId);
    if (!agent?.external) throw new Error('Sessão externa não encontrada ou já desanexada.');
    const token = externalTokens.get(sessionId);
    if (token) mcpHost.revoke(token);
    externalTokens.delete(sessionId);
    agents.delete(sessionId);
    // O fim da run tira o claim das tarefas dela, como em qualquer run.
    store.finishRun({ runId: agent.runId, expectedVersion: agent.runVersion, exitCode: 0 });
    onRunEnded(agent.projectId);
    return { sessionId, detached: true };
  }

  ipcMain.handle('agent:attach-external', async (event, request = {}) => {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a anexar sessões.');
    return attachExternal(request || {});
  });

  ipcMain.handle('agent:external-command', (event, sessionId) => {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a ler o comando de conexão.');
    return externalCommand(sessionId);
  });

  ipcMain.handle('agent:detach-external', (event, sessionId) => {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a desanexar sessões.');
    return detachExternal(sessionId);
  });

  ipcMain.handle('agent:remove', (event, sessionId) => {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a excluir sessões.');
    const stored = typeof sessionId === 'string' && store?.getSession(sessionId);
    if (!stored || !projectHost.isAllowedCwd(stored.cwd)) throw new Error('Sessão fora das pastas autorizadas.');
    const agent = agents.get(sessionId);
    if (agent?.state === 'running') throw new Error('Encerre a sessão antes de excluí-la.');
    const removed = store.removeSession(sessionId);
    if (agent) transport.forget(agent.ptyId);
    agents.delete(sessionId);
    return removed;
  });

  // O usuário trocou o modelo dentro do CLI (/model, /models) e informa o novo.
  // O ATLAS não digita no terminal nem reinicia nada: só registra na mesma run.
  ipcMain.handle('agent:declare-model', async (event, request = {}) => {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a alterar sessões de agente.');
    const agent = typeof request?.sessionId === 'string' ? agents.get(request.sessionId) : null;
    if (!agent || agent.state !== 'running' || !agent.runId) throw new Error('Sessão de agente em execução não encontrada.');
    const model = typeof request.model === 'string' ? request.model : '';
    if (!MODEL_PATTERN.test(model)) throw new Error('Modelo inválido.');
    const models = await modelsFor(await requireAdapter(agent.adapterId));
    if (!models.length) throw new Error(`O ${agent.cli} não informa modelos ao ATLAS; não há como conferir a troca.`);
    if (!models.includes(model)) throw new Error(`O modelo ${model} não foi identificado no ${agent.cli}. Atualize a lista de modelos.`);
    if (agent.state !== 'running') throw new Error('A sessão terminou antes de registrar a troca.');
    store?.declareRunModel({ runId: agent.runId, model });
    agent.currentModel = model;
    if (agent.functionSlug) agent.functionOverridden = true;
    return describe(agent);
  });

  // Troca o rótulo de função de um agente em execução (o Orquestrador usa nas próximas
  // delegações). Não reinicia nada nem muda CLI ou modelo.
  ipcMain.handle('agent:set-function', async (event, request = {}) => {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a alterar sessões de agente.');
    const agent = typeof request?.sessionId === 'string' ? agents.get(request.sessionId) : null;
    if (!agent || agent.state !== 'running' || !agent.runId) throw new Error('Sessão de agente em execução não encontrada.');
    if (agent.role === 'orchestrator') throw new Error('A sessão principal é sempre o Orquestrador.');
    const { functionSlug } = functionAudit(request.functionSlug, agent.adapterId, agent.model);
    store?.setRunFunction({ runId: agent.runId, functionSlug });
    agent.functionSlug = functionSlug;
    agent.functionOverridden = functionSlug ? true : null;
    return describe(agent);
  });

  // Modo salvo no projeto, para o diálogo de iniciar a principal vir preenchido.
  ipcMain.handle('agent:orchestrator-mode', async (event, request = {}) => {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a consultar a principal.');
    await waitForCwd(projectHost, request?.cwd);
    const project = request && projectHost.isAllowedCwd(request.cwd) ? projectHost.getProjectForCwd(request.cwd) : null;
    if (!store || !project) throw new Error('Projeto não encontrado para a pasta autorizada.');
    return { projectId: project.id, mode: store.getOrchestratorMode(project.id) };
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
    if (existing && !existing.removed_at && request.startNewRun !== true) {
      const history = listAgents().find((agent) => agent.id === existing.id);
      if (!history) throw new Error('Histórico da principal fora do escopo autorizado.');
      return history;
    }
    // Sem escolha do usuário a principal não inicia: a interface pergunta o CLI e o modelo.
    if (typeof request.adapterId !== 'string' || !request.adapterId) return { needsChoice: true, projectId: project.id, previousCli: existing?.cli || null };
    // O modo vem do diálogo, escolhido pelo usuário; sem ele, vale o salvo no projeto.
    if (request.orchestratorMode !== undefined) store.setOrchestratorMode({ projectId: project.id, mode: request.orchestratorMode });
    const orchestratorMode = store.getOrchestratorMode(project.id);
    // A principal é sempre o Orquestrador: a run registra se a escolha seguiu o que está salvo nele.
    const operation = createAgent({ adapterId: request.adapterId, model: request.model, name: 'ORQUESTRADOR', cwd: project.path, orchestratorMode, ...functionAudit('orquestrador', request.adapterId, request.model, { orchestrator: true }) }, { role: 'orchestrator', existing })
      .finally(() => pendingOrchestrators.delete(project.id));
    pendingOrchestrators.set(project.id, operation);
    return operation;
  });

  async function restoreOrchestrator(item, resume) {
    const project = projectHost.getProjectForCwd(item.cwd);
    if (!project || !projectHost.isAllowedCwd(project.path)) throw new Error('Projeto não encontrado para a pasta autorizada.');
    if (pendingOrchestrators.has(project.id)) return pendingOrchestrators.get(project.id);
    const current = [...agents.values()].find((agent) => agent.projectId === project.id && agent.role === 'orchestrator' && agent.state === 'running');
    if (current) return describe(current);
    const model = item.current_model || item.model || null;
    const operation = createAgent({
      adapterId: item.adapter_id, model, name: 'ORQUESTRADOR', cwd: project.path, orchestratorMode: store.getOrchestratorMode(project.id),
      ...functionAudit('orquestrador', item.adapter_id, model, { orchestrator: true }),
    }, { role: 'orchestrator', existing: store.getOrchestrator(project.id), resume }).finally(() => pendingOrchestrators.delete(project.id));
    pendingOrchestrators.set(project.id, operation);
    return operation;
  }

  // Reabre, sem pedir confirmação (decisão do mantenedor, AGENTS.md), as sessões que
  // estavam em execução no último fechamento: mesmo CLI, modelo, função, nome e pasta.
  // Cada run tem uma única tentativa, gravada antes de iniciar.
  async function restoreSessions() {
    const result = { restored: [], fresh: [], failed: [] };
    if (!store) return result;
    restoreState = { pending: true, result: null };
    try {
      const candidates = store.listRestorableRuns();
      store.markRunsRestored(candidates.map((item) => item.run_id));
      // Retomada pela pasta: só a sessão mais recente de cada CLI e pasta pega a conversa.
      const folders = new Set();
      const launches = [];
      for (const item of candidates) {
        const role = item.role === 'orchestrator' ? 'orchestrator' : 'agent';
        const support = conversationSupport(item.adapter_id, role);
        let resume = 'fresh';
        if (support === 'exact' && item.conversation_id) resume = 'resume';
        else if (support !== 'none') {
          const folder = `${item.adapter_id}|${String(item.cwd).toLowerCase()}`;
          resume = folders.has(folder) ? 'fresh' : 'continue';
          folders.add(folder);
        }
        const entry = { id: item.id, name: role === 'orchestrator' ? 'Principal' : item.name, cli: item.cli };
        try {
          await waitForCwd(projectHost, item.cwd);
          if (!projectHost.isAllowedCwd(item.cwd)) throw new Error('A pasta da sessão não está mais autorizada.');
          // Função apagada desde então: a sessão volta sem o rótulo, em vez de não voltar.
          const functionSlug = item.function_slug && store.getFunctionBySlug?.(item.function_slug) ? item.function_slug : null;
          const relaunch = (mode) => (role === 'orchestrator' ? restoreOrchestrator(item, mode) : createAgent({
            adapterId: item.adapter_id, model: item.current_model || item.model || null, name: item.name, cwd: item.cwd,
            functionSlug, functionOverridden: functionSlug && item.function_overridden !== null ? Boolean(item.function_overridden) : null,
          }, { role: 'agent', existing: { ...item, ...store.getSession(item.id) }, origin: item.origin, resume: mode }));
          const agent = await relaunch(resume);
          result[resume === 'fresh' ? 'fresh' : 'restored'].push(entry);
          if (resume !== 'fresh') launches.push({ entry, agentId: agent.id, runId: agent.runId, relaunch });
        } catch (error) {
          result.failed.push({ ...entry, error: error.message });
        }
      }
      if (launches.length) {
        await resumeGrace();
        for (const launch of launches) {
          const agent = agents.get(launch.agentId);
          if (!agent || agent.runId !== launch.runId || agent.state !== 'exited' || agent.stoppedByUser || agent.exit?.exitCode === 0 || shuttingDown) continue;
          result.restored = result.restored.filter((item) => item !== launch.entry);
          try {
            await launch.relaunch('fresh');
            result.fresh.push(launch.entry);
          } catch (error) {
            result.failed.push({ ...launch.entry, error: error.message });
          }
        }
      }
    } catch (error) {
      result.failed.push({ id: null, name: 'Sessões', cli: null, error: error.message });
    }
    restoreState = { pending: false, result };
    return result;
  }

  ipcMain.handle('agent:restore-status', (event) => {
    if (!isMainSender(event)) return { pending: false, result: null };
    return restoreState;
  });

  return {
    listAgents,
    restoreSessions,
    markStopped(record) {
      const agent = agents.get(record.meta.agentId);
      if (agent?.ptyId !== record.id) return;
      agent.stoppedByUser = true;
      if (agent.runId) store?.markRunStopRequested(agent.runId);
    },
    // Fechamento: as saídas que chegam depois não são gravadas como resultado da run.
    prepareShutdown: () => { shuttingDown = true; },
    resumeRecording: () => { shuttingDown = false; },
    requireAdapter,
    resolveLaunch,
    getAgent: (id) => agents.get(id),
    createAgent,
    countActive: ({ projectId, origin }) => [...agents.values()].filter((agent) => agent.projectId === projectId && agent.origin === origin && agent.state === 'running').length,
  };
}

module.exports = { createAgentHost };
