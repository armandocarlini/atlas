const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const VERSION_TIMEOUT_MS = 5000;

// Metadados estáticos dos adaptadores suportados neste marco. A descoberta do
// executável acontece em runtime pelo PATH, sem caminhos pessoais fixos.
const ADAPTERS = [
  {
    id: 'kimi-code',
    name: 'Kimi Code',
    command: 'kimi',
    versionArgs: ['--version'],
    // Sem flags de autonomia, prompt inicial ou configuração do harness:
    // a sessão nasce interativa e as permissões permanecem no CLI.
    spawnArgs: [],
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
    execFile(file, args, { timeout: VERSION_TIMEOUT_MS, windowsHide: true, ...options }, (error, stdout, stderr) => {
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

function parseVersion(output) {
  const match = String(output).match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
  return match ? match[0] : String(output).trim().split(/\r?\n/)[0] || 'desconhecida';
}

function describeError(error) {
  if (error.killed || error.signal === 'SIGTERM') return `o CLI não respondeu em ${VERSION_TIMEOUT_MS / 1000}s`;
  if (error.code === 'ENOENT') return 'executável não encontrado';
  if (typeof error.code === 'number') return `o comando --version saiu com código ${error.code}`;
  return error.message;
}

async function probeAdapter(adapter, { env, platform, existsSync, execFileImpl = defaultExecFile } = {}) {
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
    const { stdout, stderr } = await execFileImpl(executable, adapter.versionArgs, {});
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

module.exports = { ADAPTERS, VERSION_TIMEOUT_MS, discoverAdapters, parseVersion, resolveOnPath };
