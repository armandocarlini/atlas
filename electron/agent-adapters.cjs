const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { kimiHome } = require('./kimi-mcp-config.cjs');
const { orchestratorInstructions } = require('./orchestrator-profile.cjs');

const VERSION_TIMEOUT_MS = 5000;
const MODELS_TIMEOUT_MS = 30000;
// O modelo vai como argumento do CLI, que no Windows pode ser um shim .cmd
// interpretado pelo cmd.exe: só caracteres sem significado para o shell.
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const ORCHESTRATOR_AGENT = 'atlas-orchestrator';

// Metadados estáticos dos adaptadores suportados. A descoberta do executável
// acontece em runtime pelo PATH, sem caminhos pessoais fixos. Nenhum CLI é
// padrão: o usuário escolhe o CLI e o modelo de cada sessão, inclusive da principal.
const ADAPTERS = [
  {
    id: 'kimi-code',
    name: 'Kimi Code',
    command: 'kimi',
    versionArgs: ['--version'],
    // Sem flags de autonomia, prompt inicial ou configuração do harness:
    // a sessão nasce interativa e as permissões permanecem no CLI.
    spawnArgs: [],
    // Modelos são os aliases do config.toml do Kimi; as ferramentas do ATLAS
    // chegam pelo mcp.json, gravado só com consentimento.
    atlasTools: 'consent',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    versionArgs: ['--version'],
    spawnArgs: [],
    // Modelos vêm de `opencode models` (provedores com credencial). A ponte MCP
    // e o perfil da principal entram por OPENCODE_CONFIG_CONTENT só nesta run,
    // sem gravar na configuração do usuário.
    atlasTools: 'per-run',
  },
];

function pathExtensions(env, platform) {
  if (platform !== 'win32') return [''];
  const raw = env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
  const extensions = raw.split(';').map((item) => item.trim().toLowerCase()).filter(Boolean);
  return [...extensions.filter((item) => item === '.exe' || item === '.com'), ...extensions.filter((item) => item !== '.exe' && item !== '.com')];
}

function resolveOnPath(command, { env = process.env, platform = process.platform, existsSync = fs.existsSync } = {}) {
  const pathImpl = platform === 'win32' ? path.win32 : path.posix;
  const delimiter = platform === 'win32' ? ';' : ':';
  const directories = (env.PATH || '').split(delimiter).filter(Boolean);
  for (const directory of directories) {
    for (const extension of pathExtensions(env, platform)) {
      const candidate = pathImpl.join(directory, platform === 'win32' ? `${command}${extension}` : command);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function defaultExecFile(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: VERSION_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

// Shims .cmd/.bat só rodam pelo cmd.exe. Os argumentos são constantes do ATLAS,
// conferidos aqui; nada vindo do usuário ou de agentes entra nessa linha.
function runCli(executable, args, { execFileImpl = defaultExecFile, env = process.env, timeout } = {}) {
  const options = timeout ? { timeout } : {};
  if (!/\.(cmd|bat)$/i.test(executable)) return execFileImpl(executable, args, options);
  if (/["%!^&|<>]/.test(executable) || !args.every((item) => /^[A-Za-z0-9._-]+$/.test(item))) {
    return Promise.reject(new Error('Comando inseguro para o cmd.exe.'));
  }
  return execFileImpl(env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${executable}" ${args.join(' ')}"`], { ...options, windowsVerbatimArguments: true });
}

function parseVersion(output) {
  const match = String(output).match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
  return match ? match[0] : String(output).trim().split(/\r?\n/)[0] || 'desconhecida';
}

function describeError(error, { timeoutMs = VERSION_TIMEOUT_MS, command = '--version' } = {}) {
  if (error.killed || error.signal === 'SIGTERM') return `o CLI não respondeu em ${timeoutMs / 1000}s`;
  if (error.code === 'ENOENT') return 'executável não encontrado';
  if (typeof error.code === 'number') return `o comando ${command} saiu com código ${error.code}`;
  return error.message;
}

async function probeAdapter(adapter, { env = process.env, platform, existsSync, execFileImpl = defaultExecFile } = {}) {
  const executable = resolveOnPath(adapter.command, { env, platform, existsSync });
  if (!executable) {
    return {
      ...adapter,
      executable: null,
      version: null,
      status: 'unavailable',
      error: `${adapter.name} não está no PATH. Instale o CLI e reabra o ATLAS.`,
    };
  }
  try {
    const { stdout, stderr } = await runCli(executable, adapter.versionArgs, { execFileImpl, env });
    return { ...adapter, executable, version: parseVersion(stdout || stderr), status: 'available', error: null };
  } catch (error) {
    return {
      ...adapter,
      executable,
      version: null,
      status: 'unavailable',
      error: `${adapter.name} foi encontrado em ${executable}, mas falhou ao responder: ${describeError(error)}.`,
    };
  }
}

async function discoverAdapters(options = {}) {
  return Promise.all(ADAPTERS.map((adapter) => probeAdapter(adapter, options)));
}

function stripAnsi(text) {
  return String(text).replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
}

// Aliases declarados no config.toml do Kimi, lidos sem executar o CLI.
function kimiModels(env, readFile) {
  let text;
  try {
    text = readFile(path.join(kimiHome(env), 'config.toml'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const models = [];
  for (const match of text.matchAll(/^\s*\[models\.(?:"([^"\r\n]+)"|([A-Za-z0-9_-]+))\]\s*$/gm)) models.push(match[1] || match[2]);
  return models;
}

// Modelos identificados para o CLI, na ordem em que ele os informa.
async function listModels(adapter, { env = process.env, execFileImpl = defaultExecFile, readFile = fs.readFileSync } = {}) {
  if (!adapter || adapter.status !== 'available') throw new Error(adapter?.error || 'CLI indisponível.');
  let models = [];
  if (adapter.id === 'kimi-code') models = kimiModels(env, readFile);
  else if (adapter.id === 'opencode') {
    try {
      const { stdout } = await runCli(adapter.executable, ['models'], { execFileImpl, env, timeout: MODELS_TIMEOUT_MS });
      models = stripAnsi(stdout).split(/\r?\n/).map((line) => line.trim()).filter((line) => line.includes('/'));
    } catch (error) {
      throw new Error(`O OpenCode não listou os modelos: ${describeError(error, { timeoutMs: MODELS_TIMEOUT_MS, command: 'models' })}.`);
    }
  }
  return [...new Set(models.filter((model) => MODEL_PATTERN.test(model)))];
}

// Principal no OpenCode: somente leitura e ferramentas do ATLAS; arquivos de
// ambiente ficam de fora mesmo para leitura. Sem grep: ele leria o conteúdo de
// `.env` sem passar pela regra de `read`. As negações explícitas sobrescrevem
// valores de outra configuração mesclada, onde a ordem das chaves decide a regra.
const DENIED_TOOLS = ['bash', 'edit', 'write', 'patch', 'grep', 'task', 'webfetch', 'websearch', 'codesearch', 'external_directory', 'skill', 'todowrite'];
function orchestratorPermission() {
  return {
    '*': 'deny',
    ...Object.fromEntries(DENIED_TOOLS.map((tool) => [tool, 'deny'])),
    read: { '*': 'allow', '*.env': 'deny', '*.env.*': 'deny', '*.env.example': 'allow' },
    glob: 'allow',
    list: 'allow',
    'atlas_*': 'allow',
  };
}

// Argumentos e ambiente da run para cada CLI. `bridge` é a entrada MCP da ponte
// (comando, argumentos e ambiente com o token da run) ou null sem ferramentas.
function launchFor({ adapter, role = 'agent', model = null, orchestratorProfile = null, bridge = null }) {
  if (model !== null && !MODEL_PATTERN.test(model)) throw new Error('Modelo inválido.');
  const modelArgs = model ? ['--model', model] : [];
  if (adapter.id === 'kimi-code') {
    if (role === 'orchestrator' && typeof orchestratorProfile !== 'string') throw new Error('Perfil do orquestrador não configurado.');
    return { args: [...adapter.spawnArgs, ...modelArgs, ...(role === 'orchestrator' ? ['--agent-file', orchestratorProfile] : [])], env: {} };
  }
  if (adapter.id === 'opencode') {
    const config = {};
    if (bridge) config.mcp = { atlas: { type: 'local', command: [bridge.command, ...bridge.args], environment: bridge.env, enabled: true } };
    if (role === 'orchestrator') {
      // A permissão vale para a run inteira e os agentes padrão (build, plan) saem:
      // trocar de agente na TUI não devolve escrita nem shell à principal.
      config.permission = orchestratorPermission();
      config.agent = {
        build: { disable: true },
        plan: { disable: true },
        [ORCHESTRATOR_AGENT]: {
          description: 'Planejamento e acompanhamento do projeto autorizado no ATLAS',
          mode: 'primary',
          prompt: orchestratorInstructions('atlas_'),
          permission: orchestratorPermission(),
        },
      };
    }
    return {
      args: [...adapter.spawnArgs, ...modelArgs, ...(role === 'orchestrator' ? ['--agent', ORCHESTRATOR_AGENT] : [])],
      // Na principal, a configuração do repositório (opencode.json, .opencode/) é
      // ignorada: ela poderia reabrir permissões ou iniciar plugins e servidores MCP.
      env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config), ...(role === 'orchestrator' ? { OPENCODE_DISABLE_PROJECT_CONFIG: '1' } : {}) },
    };
  }
  throw new Error(`${adapter.name} não tem lançamento definido no ATLAS.`);
}

module.exports = { ADAPTERS, VERSION_TIMEOUT_MS, MODEL_PATTERN, ORCHESTRATOR_AGENT, discoverAdapters, parseVersion, resolveOnPath, listModels, launchFor, runCli };
