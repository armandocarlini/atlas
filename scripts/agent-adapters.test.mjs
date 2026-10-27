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

const { listModels, launchFor, runCli } = createRequire(import.meta.url)('../electron/agent-adapters.cjs');
const opencode = ADAPTERS.find((adapter) => adapter.id === 'opencode');

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
  assert.deepEqual(launchFor({ adapter: kimi, model: 'kimi-code/k3' }), { args: ['--model', 'kimi-code/k3'], env: {} });
  assert.deepEqual(launchFor({ adapter: kimi, role: 'orchestrator', orchestratorProfile: 'C:\\perfil.md' }).args, ['--agent-file', 'C:\\perfil.md']);
  assert.throws(() => launchFor({ adapter: kimi, role: 'orchestrator' }), /Perfil do orquestrador/);
  assert.throws(() => launchFor({ adapter: opencode, model: '--auto' }), /Modelo inválido/);
  const plain = launchFor({ adapter: opencode, model: 'nvidia/a' });
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
