import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const { ADAPTERS, VERSION_TIMEOUT_MS, discoverAdapters, parseVersion, resolveOnPath } = createRequire(import.meta.url)('../electron/agent-adapters.cjs');

const kimi = ADAPTERS.find((adapter) => adapter.id === 'kimi-code');

test('descoberta encontra o executável no PATH e lê a versão com execFile', async () => {
  const calls = [];
  const [adapter] = await discoverAdapters({
    env: { PATH: 'C:\\cli;C:\\outros', PATHEXT: '.EXE;.CMD' },
    platform: 'win32',
    existsSync: (candidate) => candidate === 'C:\\cli\\kimi.exe',
    execFileImpl: async (file, args) => {
      calls.push({ file, args });
      return { stdout: '2.3.2\n', stderr: '' };
    },
  });
  assert.equal(adapter.status, 'available');
  assert.equal(adapter.executable, 'C:\\cli\\kimi.exe');
  assert.equal(adapter.version, '2.3.2');
  assert.deepEqual(calls, [{ file: 'C:\\cli\\kimi.exe', args: ['--version'] }]);
});

test('descoberta prefere .exe a shims .cmd no Windows', () => {
  const resolved = resolveOnPath('kimi', {
    env: { PATH: 'C:\\cli', PATHEXT: '.CMD;.EXE' },
    platform: 'win32',
    existsSync: () => true,
  });
  assert.equal(resolved, 'C:\\cli\\kimi.exe');
});

test('descoberta resolve executável sem extensão no POSIX', async () => {
  const [adapter] = await discoverAdapters({
    env: { PATH: '/usr/local/bin:/usr/bin' },
    platform: 'linux',
    existsSync: (candidate) => candidate === '/usr/bin/kimi',
    execFileImpl: async (file) => {
      assert.equal(file, '/usr/bin/kimi');
      return { stdout: '2.3.2\n', stderr: '' };
    },
  });
  assert.equal(adapter.status, 'available');
  assert.equal(adapter.executable, '/usr/bin/kimi');
});

test('adaptador ausente do PATH fica indisponível com erro acionável', async () => {
  const [adapter] = await discoverAdapters({
    env: { PATH: 'C:\\vazio', PATHEXT: '.EXE' },
    platform: 'win32',
    existsSync: () => false,
    execFileImpl: async () => { throw new Error('não deve ser chamado'); },
  });
  assert.equal(adapter.status, 'unavailable');
  assert.equal(adapter.executable, null);
  assert.match(adapter.error, /não está no PATH/);
});

test('timeout do --version gera erro acionável', async () => {
  const [adapter] = await discoverAdapters({
    env: { PATH: 'C:\\cli', PATHEXT: '.EXE' },
    platform: 'win32',
    existsSync: () => true,
    execFileImpl: async () => {
      const error = new Error('timed out');
      error.killed = true;
      error.signal = 'SIGTERM';
      throw error;
    },
  });
  assert.equal(adapter.status, 'unavailable');
  assert.match(adapter.error, /não respondeu em 15s/);
  // Regressão: a primeira execução do OpenCode pelo shim levou 4,5 s e o limite era 5 s.
  assert(VERSION_TIMEOUT_MS >= 10000);
  assert.match(adapter.error, /kimi\.exe/);
});

test('saída com código de erro vira indisponibilidade explicada', async () => {
  const [adapter] = await discoverAdapters({
    env: { PATH: 'C:\\cli', PATHEXT: '.EXE' },
    platform: 'win32',
    existsSync: () => true,
    execFileImpl: async () => {
      const error = new Error('failed');
      error.code = 3;
      throw error;
    },
  });
  assert.equal(adapter.status, 'unavailable');
  assert.match(adapter.error, /código 3/);
});

test('parseVersion extrai semver de saída com ruído', () => {
  assert.equal(parseVersion('kimi 2.3.2-beta.1\noutra linha'), '2.3.2-beta.1');
  assert.equal(parseVersion('sem versão'), 'sem versão');
});

test('o adaptador kimi não recebe flags de autonomia nem prompt inicial', () => {
  assert.deepEqual(kimi.spawnArgs, []);
  assert.deepEqual(kimi.versionArgs, ['--version']);
});

const { listModels, launchFor, runCli, assertOrchestratorSupport } = createRequire(import.meta.url)('../electron/agent-adapters.cjs');
const opencode = ADAPTERS.find((adapter) => adapter.id === 'opencode');
const claude = ADAPTERS.find((adapter) => adapter.id === 'claude-code');
const codex = ADAPTERS.find((adapter) => adapter.id === 'codex');
const gemini = ADAPTERS.find((adapter) => adapter.id === 'gemini');

test('OpenCode por shim .cmd é consultado pelo cmd.exe só com argumentos constantes', async () => {
  const calls = [];
  const adapters = await discoverAdapters({
    env: { PATH: 'C:\\npm', PATHEXT: '.EXE;.CMD', ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    platform: 'win32',
    existsSync: (candidate) => candidate === 'C:\\npm\\opencode.cmd',
    execFileImpl: async (file, args, options) => { calls.push({ file, args, options }); return { stdout: '1.18.21\n', stderr: '' }; },
  });
  const found = adapters.find((adapter) => adapter.id === 'opencode');
  assert.equal(found.status, 'available');
  assert.equal(found.version, '1.18.21');
  assert.deepEqual(calls, [{ file: 'C:\\Windows\\System32\\cmd.exe', args: ['/d', '/s', '/c', '""C:\\npm\\opencode.cmd" --version"'], options: { windowsVerbatimArguments: true } }]);
  await assert.rejects(runCli('C:\\a&b\\opencode.cmd', ['models'], { execFileImpl: async () => ({}) }), /inseguro/);
  await assert.rejects(runCli('C:\\npm\\opencode.cmd', ['models & calc'], { execFileImpl: async () => ({}) }), /inseguro/);
});

test('modelos do OpenCode vêm de `opencode models`, sem ANSI e sem linhas estranhas', async () => {
  const output = '\u001b[0mnvidia/meta/llama-3.3-70b-instruct\r\nopenrouter/x-ai/grok-4\nINFO carregando\nnvidia/meta/llama-3.3-70b-instruct\nmal/formado & calc\n';
  const models = await listModels({ ...opencode, status: 'available', executable: 'C:\\bin\\opencode.exe' }, { execFileImpl: async (file, args) => { assert.deepEqual(args, ['models']); return { stdout: output, stderr: '' }; } });
  assert.deepEqual(models, ['nvidia/meta/llama-3.3-70b-instruct', 'openrouter/x-ai/grok-4']);
  const timeout = Object.assign(new Error('timeout'), { killed: true });
  await assert.rejects(listModels({ ...opencode, status: 'available', executable: 'C:\\bin\\opencode.exe' }, { execFileImpl: async () => { throw timeout; } }), /não listou os modelos: o CLI não respondeu em 30s/);
  await assert.rejects(listModels({ ...opencode, status: 'unavailable', error: 'OpenCode não está no PATH.' }), /não está no PATH/);
});

test('modelos do Kimi são os aliases do config.toml da home configurada, sem executar o CLI', async () => {
  const read = [];
  const toml = 'default_model = "kimi-code/k3"\n[providers."managed:kimi-code"]\n[models."kimi-code/k3"]\nmax = 1\n[models.local-alias]\n[thinking]\n';
  const models = await listModels({ ...kimi, status: 'available', executable: 'C:\\cli\\kimi.exe' }, {
    env: { KIMI_CODE_HOME: 'C:\\fixture\\kimi' },
    execFileImpl: async () => { throw new Error('não deve executar'); },
    readFile: (file) => { read.push(file); return toml; },
  });
  assert.deepEqual(models, ['kimi-code/k3', 'local-alias']);
  assert.equal(read[0].replaceAll('/', '\\'), 'C:\\fixture\\kimi\\config.toml');
  const missing = await listModels({ ...kimi, status: 'available' }, { env: { KIMI_CODE_HOME: 'C:\\vazio' }, readFile: () => { throw Object.assign(new Error('ausente'), { code: 'ENOENT' }); } });
  assert.deepEqual(missing, []);
});

test('lançamento por CLI: modelo, perfil da principal e ponte só por run no OpenCode', () => {
  assert.deepEqual(launchFor({ adapter: kimi, model: 'kimi-code/k3' }), { args: ['--model', 'kimi-code/k3'], env: { KIMI_CODE_NO_AUTO_UPDATE: '1' } });
  assert.deepEqual(launchFor({ adapter: kimi, role: 'orchestrator', orchestratorProfile: 'C:\\perfil.md' }).args, ['--agent-file', 'C:\\perfil.md']);
  assert.throws(() => launchFor({ adapter: kimi, role: 'orchestrator' }), /Perfil do orquestrador/);
  assert.throws(() => launchFor({ adapter: opencode, model: '--auto' }), /Modelo inválido/);
  const plain = launchFor({ adapter: opencode, model: 'nvidia/a' });
  assert.equal(plain.env.KIMI_CODE_NO_AUTO_UPDATE, undefined, 'a proteção de atualização é específica do Kimi');
  assert.deepEqual(plain.args, ['--model', 'nvidia/a']);
  assert.deepEqual(JSON.parse(plain.env.OPENCODE_CONFIG_CONTENT), {});
  const bridge = { command: 'C:\\ATLAS.exe', args: ['C:\\ponte.cjs'], env: { ELECTRON_RUN_AS_NODE: '1', ATLAS_MCP_TOKEN: 't' } };
  const principal = launchFor({ adapter: opencode, role: 'orchestrator', model: 'nvidia/a', bridge });
  assert.deepEqual(principal.args, ['--model', 'nvidia/a', '--agent', 'atlas-orchestrator']);
  const config = JSON.parse(principal.env.OPENCODE_CONFIG_CONTENT);
  assert.deepEqual(config.mcp.atlas.command, ['C:\\ATLAS.exe', 'C:\\ponte.cjs']);
  // Regressão de segurança: trocar de agente na TUI ou configurar o repositório não
  // devolve escrita, shell, rede nem leitura de .env por grep à principal.
  assert.deepEqual(config.agent.build, { disable: true });
  assert.deepEqual(config.agent.plan, { disable: true });
  assert.deepEqual(config.permission, config.agent['atlas-orchestrator'].permission, 'permissão vale para a run inteira');
  for (const tool of ['bash', 'edit', 'write', 'patch', 'grep', 'task', 'webfetch', 'external_directory']) assert.equal(config.permission[tool], 'deny', tool);
  assert.equal(principal.env.OPENCODE_DISABLE_PROJECT_CONFIG, '1', 'configuração do repositório ignorada na principal');
  assert.equal(plain.env.OPENCODE_DISABLE_PROJECT_CONFIG, undefined, 'agentes comuns seguem a configuração do projeto');
  assert(principal.args.every((item) => item !== '--auto'), 'sem flags de autonomia');
});

test('lançamento do Claude Code: só caminhos na linha de comando e principal restrita', () => {
  assert.equal(claude.command, 'claude');
  assert.deepEqual(claude.spawnArgs, [], 'sem flags de autonomia');
  assert.equal(claude.modelEntry, 'free');
  const claudeProfile = { instructions: 'C:\\perfil\\claude-orchestrator.md', settings: 'C:\\perfil\\claude-orchestrator-settings.json', mcpConfig: 'C:\\perfil\\claude-mcp.json' };
  const bridge = { command: 'C:\\ATLAS.exe', args: ['C:\\ponte.cjs'], env: { ELECTRON_RUN_AS_NODE: '1', ATLAS_MCP_TOKEN: 'segredo-da-run' } };
  const plain = launchFor({ adapter: claude, model: 'claude-opus-5-5' });
  assert.deepEqual(plain, { args: ['--model', 'claude-opus-5-5'], env: { DISABLE_AUTOUPDATER: '1' } });
  const agent = launchFor({ adapter: claude, claudeProfile, bridge });
  assert.deepEqual(agent.args, ['--mcp-config', 'C:\\perfil\\claude-mcp.json'], 'agente comum mantém os servidores MCP e as permissões dele');
  const principal = launchFor({ adapter: claude, role: 'orchestrator', model: 'opus', claudeProfile, bridge });
  assert.deepEqual(principal.args, [
    '--model', 'opus',
    '--mcp-config', 'C:\\perfil\\claude-mcp.json',
    '--restricted', '--tools', 'Read,Grep,Glob', '--strict-mcp-config',
    '--settings', 'C:\\perfil\\claude-orchestrator-settings.json',
    '--append-system-prompt-file', 'C:\\perfil\\claude-orchestrator.md',
  ]);
  // Regressão de segurança: o token da run nunca vai em argumento.
  assert(!JSON.stringify(principal).includes('segredo-da-run'));
  assert(!principal.args.some((item) => /bypass|dangerously|auto/.test(item)), 'sem flags de autonomia');
  const semPonte = launchFor({ adapter: claude, role: 'orchestrator', claudeProfile });
  assert(!semPonte.args.includes('--mcp-config') && semPonte.args.includes('--strict-mcp-config'), 'sem ponte, nenhum servidor MCP');
  assert.throws(() => launchFor({ adapter: claude, role: 'orchestrator' }), /Perfil do orquestrador/);
  assert.throws(() => launchFor({ adapter: claude, model: 'opus & calc' }), /Modelo inválido/);
});

test('modelos do Codex vêm de `codex debug models`: só os visíveis, na ordem do CLI', async () => {
  const catalog = { models: [
    { slug: 'gpt-b', visibility: 'list', priority: 2 },
    { slug: 'oculto', visibility: 'hide', priority: 0 },
    { slug: 'gpt-a', visibility: 'list', priority: 1 },
    { slug: 'mal formado & calc', visibility: 'list', priority: 3 },
  ] };
  const output = 'WARNING: aviso do CLI\n' + JSON.stringify(catalog);
  const models = await listModels({ ...codex, status: 'available', executable: 'C:\\bin\\codex.exe' }, { execFileImpl: async (file, args) => { assert.deepEqual(args, ['debug', 'models']); return { stdout: output, stderr: '' }; } });
  assert.deepEqual(models, ['gpt-a', 'gpt-b']);
  await assert.rejects(listModels({ ...codex, status: 'available', executable: 'C:\\bin\\codex.exe' }, { execFileImpl: async () => ({ stdout: 'sem json', stderr: '' }) }), /O Codex não listou os modelos/);
});

test('lançamento do Codex: ponte só por -c, cmd.exe seguro e token fora da linha de comando', () => {
  assert.equal(codex.command, 'codex');
  assert.deepEqual(codex.spawnArgs, [], 'sem flags de autonomia');
  assert.deepEqual(launchFor({ adapter: codex, model: 'gpt-a' }), { args: ['--model', 'gpt-a'], env: {} });
  const bridge = { command: 'C:\\Program Files\\ATLAS (teste)\\ATLAS.exe', args: ['C:\\ATLAS\\atlas-mcp-bridge.cjs'], env: { ELECTRON_RUN_AS_NODE: '1', ATLAS_MCP_ENDPOINT: '\\\\.\\pipe\\atlas', ATLAS_MCP_TOKEN: 'segredo-da-run' } };
  const agent = launchFor({ adapter: codex, model: 'gpt-a', bridge });
  assert.deepEqual(agent.args, [
    '--model', 'gpt-a',
    '-c', "mcp_servers.atlas.command='C:\\Program Files\\ATLAS (teste)\\ATLAS.exe'",
    '-c', "mcp_servers.atlas.args=['C:\\ATLAS\\atlas-mcp-bridge.cjs']",
    '-c', "mcp_servers.atlas.env={ELECTRON_RUN_AS_NODE='1'}",
    '-c', "mcp_servers.atlas.env_vars=['ATLAS_MCP_ENDPOINT','ATLAS_MCP_TOKEN']",
  ]);
  // Regressão de segurança: endpoint e token chegam pelo ambiente do PTY, nunca em argumento.
  assert(!JSON.stringify(agent).includes('segredo-da-run') && !JSON.stringify(agent).includes('pipe'));
  for (const unsafe of ['C:\\a&b\\ATLAS.exe', 'C:\\50%\\ATLAS.exe', "C:\\o'brien\\ATLAS.exe", 'C:\\x"y\\ATLAS.exe']) {
    assert.throws(() => launchFor({ adapter: codex, bridge: { ...bridge, command: unsafe } }), /inseguro para o cmd.exe/, unsafe);
  }
  assert(!agent.args.some((item) => /bypass|dangerously|full-auto|approve-for-me/.test(item)), 'sem flags de autonomia');
});

test('Codex pode ser principal com as mesmas permissões e ponte de um agente', () => {
  assert.throws(() => assertOrchestratorSupport(codex), /Desligue “Principal só coordena”/);
  assert.throws(() => launchFor({ adapter: codex, role: 'orchestrator' }), /Desligue “Principal só coordena”/);
  assert.doesNotThrow(() => assertOrchestratorSupport({ ...claude, version: '2.1.319' }));
  const bridge = { command: 'C:\\ATLAS\\electron.exe', args: ['bridge.cjs'], env: {} };
  const agent = launchFor({ adapter: codex, model: 'gpt-5.5', bridge });
  const principal = launchFor({ adapter: codex, role: 'orchestrator', orchestratorMode: 'auto', model: 'gpt-5.5', bridge });
  assert.deepEqual(principal, agent);
});

test('modelos do Gemini vêm de `gemini --list-models`, um por linha sem recuo', async () => {
  const output = 'Available Gemini Models:\n\nauto (Auto)\n  Description:   decide sozinho\n  Context limit: 1\n\ngemini-2.5-pro (gemini-2.5-pro)\n  Context limit: 1\n\nmal formado & x (y)\n';
  const models = await listModels({ ...gemini, status: 'available', executable: 'C:\\bin\\gemini.exe' }, { execFileImpl: async (file, args) => { assert.deepEqual(args, ['--list-models']); return { stdout: output, stderr: '' }; } });
  assert.deepEqual(models, ['auto', 'gemini-2.5-pro']);
});

test('lançamento do Gemini: agente só com o modelo; principal com política e prompt do ATLAS', () => {
  assert.equal(gemini.atlasTools, 'consent', 'a ponte vem do settings.json com consentimento');
  assert.deepEqual(launchFor({ adapter: gemini, model: 'gemini-2.5-pro' }), { args: ['--model', 'gemini-2.5-pro'], env: {} });
  const geminiProfile = { policy: 'C:\\perfil\\gemini-orchestrator-policy.toml', systemPrompt: 'C:\\perfil\\gemini-orchestrator.md' };
  const principal = launchFor({ adapter: gemini, role: 'orchestrator', model: 'gemini-2.5-pro', geminiProfile, bridge: { command: 'x', args: [], env: { ATLAS_MCP_TOKEN: 'segredo-da-run' } } });
  assert.deepEqual(principal.args, ['--model', 'gemini-2.5-pro', '--policy', 'C:\\perfil\\gemini-orchestrator-policy.toml', '--allowed-mcp-server-names', 'atlas']);
  assert.deepEqual(principal.env, { GEMINI_SYSTEM_MD: 'C:\\perfil\\gemini-orchestrator.md' });
  assert(!JSON.stringify(principal).includes('segredo-da-run'));
  assert(!principal.args.some((item) => /yolo|auto_edit|approval-mode|skip-trust/.test(item)), 'sem flags de autonomia nem de confiança');
  assert.throws(() => launchFor({ adapter: gemini, role: 'orchestrator' }), /Perfil do orquestrador/);
  assert.throws(() => launchFor({ adapter: gemini, role: 'orchestrator', geminiProfile: { ...geminiProfile, policy: 'C:\\a&b\\p.toml' } }), /insegura para o cmd.exe/);
});

test('modo auto da principal usa as permissões nativas e mantém a integração do ATLAS', () => {
  assert.throws(() => launchFor({ adapter: claude, role: 'orchestrator', orchestratorMode: 'tudo', claudeProfile: {} }), /Modo da principal inválido/);
  for (const version of ['2.3.3', '2.4.1', '2.5.2']) {
    const adapter = { ...kimi, version };
    assert.deepEqual(launchFor({ adapter, role: 'orchestrator', orchestratorMode: 'auto' }), launchFor({ adapter }));
  }
  const bridge = { command: 'C:\\ATLAS\\electron.exe', args: ['bridge.cjs'], env: {} };
  const opencodeLaunch = launchFor({ adapter: opencode, role: 'orchestrator', orchestratorMode: 'auto', bridge });
  const opencodeAuto = JSON.parse(opencodeLaunch.env.OPENCODE_CONFIG_CONTENT);
  assert.equal(opencodeLaunch.env.OPENCODE_DISABLE_PROJECT_CONFIG, undefined);
  assert.equal(opencodeAuto.permission, undefined);
  assert.equal(opencodeAuto.agent['atlas-orchestrator'].permission, undefined);
  assert.equal(opencodeAuto.agent.build, undefined);
  assert.equal(opencodeAuto.mcp.atlas.enabled, true);
  assert(opencodeAuto.agent['atlas-orchestrator'].prompt.includes('pode fazer sozinha alterações pequenas e claras'));
  const opencodeCoordinate = JSON.parse(launchFor({ adapter: opencode, role: 'orchestrator' }).env.OPENCODE_CONFIG_CONTENT);
  assert.equal(opencodeCoordinate.permission.bash, 'deny', 'padrão continua só coordena');
  assert(opencodeCoordinate.agent['atlas-orchestrator'].prompt.includes('Neste projeto você só coordena'));
  const claudeProfile = { instructions: 'C:\\perfil\\a.md', instructionsAuto: 'C:\\perfil\\auto.md', settings: 'C:\\perfil\\s.json', mcpConfig: 'C:\\perfil\\mcp.json' };
  const claudeAuto = launchFor({ adapter: claude, role: 'orchestrator', orchestratorMode: 'auto', claudeProfile, bridge });
  assert.deepEqual(claudeAuto.args, ['--mcp-config', claudeProfile.mcpConfig, '--append-system-prompt-file', claudeProfile.instructionsAuto]);
  const geminiProfile = { policy: 'C:\\perfil\\p.toml', systemPrompt: 'C:\\perfil\\p.md', systemPromptAuto: 'C:\\perfil\\auto.md' };
  const geminiAuto = launchFor({ adapter: gemini, role: 'orchestrator', orchestratorMode: 'auto', geminiProfile });
  assert.deepEqual(geminiAuto.args, []);
  assert.deepEqual(geminiAuto.env, { GEMINI_SYSTEM_MD: 'C:\\perfil\\auto.md' });
  // Agentes comuns ignoram o modo da principal.
  assert.deepEqual(launchFor({ adapter: claude, orchestratorMode: 'auto' }).args, []);
  for (const launch of [claudeAuto, geminiAuto]) assert(!launch.args.some((item) => /bypass|dangerously|yolo|skip-trust|auto_edit/.test(item)), 'sem flags de autonomia');
});
