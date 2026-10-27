const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

// Entrada "Abrir no ATLAS" do Explorador de Arquivos (marco 6a). Opcional, só por
// consentimento na interface, no registro do usuário atual (HKCU, sem
// administrador) e removível pelo mesmo diálogo. `reg.exe` roda por execFile, sem
// shell; o caminho da pasta chega ao ATLAS pelo `%V` do próprio Explorador.
const KEY_NAME = 'ATLAS.Open';
const LABEL = 'Abrir no ATLAS';
const DEFAULT_ROOT = 'HKCU\\Software\\Classes';

function quote(value) {
  if (/["\r\n]/.test(value)) throw new Error('Caminho do executável inválido para o registro.');
  return `"${value}"`;
}

// Electron em desenvolvimento precisa do caminho do app; o instalado não.
function openCommand({ execPath, appPath }) {
  return [quote(execPath), ...(appPath ? [quote(appPath)] : []), '"--atlas-open=%V"'].join(' ');
}

function keysFor(root) {
  return [`${root}\\Directory\\shell\\${KEY_NAME}`, `${root}\\Directory\\Background\\shell\\${KEY_NAME}`];
}

async function defaultReg(args) {
  const { stdout } = await execFileAsync('reg.exe', args, { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  return stdout;
}

// Valor padrão de um .reg: texto entre aspas (escapes \\ e \") ou REG_EXPAND_SZ em hex(2), UTF-16 LE.
function decodeRegValue(raw) {
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1).replace(/\\(.)/g, '$1');
  const hex = /^hex\(2\):(.*)$/i.exec(raw);
  if (hex) return Buffer.from(hex[1].split(',').filter(Boolean).map((byte) => parseInt(byte, 16))).toString('utf16le').replace(/\0+$/, '');
  return '';
}

// Chave (em minúsculas) -> valor padrão; '' quando a chave existe sem valor padrão.
function parseRegExport(text) {
  const sections = new Map();
  let current = null;
  for (const line of text.replace(/^\uFEFF/, '').replace(/\\\r?\n\s*/g, '').split(/\r?\n/)) {
    const header = /^\[(.+)\]$/.exec(line);
    if (header) { current = header[1].toLowerCase(); sections.set(current, ''); continue; }
    if (current !== null && line.startsWith('@=')) sections.set(current, decodeRegValue(line.slice(2)));
  }
  return sections;
}

// A saída de `reg query` usa a página de código OEM e o rótulo localizado do valor
// padrão; caminhos com acento nunca bateriam. `reg export` grava o arquivo em
// UTF-16 LE, independente do console, e inclui as subchaves: uma exportação por
// entrada lê as quatro chaves. A versão anterior usava PowerShell, cuja
// inicialização passou de 30 s no runner do Windows (regressão vista na CI).
// null: chave ausente; '': chave sem valor padrão; texto: valor padrão.
async function defaultReadDefaults(keys) {
  const registryKeys = keys.map((key) => key.replace(/^HKCU\\/i, 'HKEY_CURRENT_USER\\'));
  const roots = registryKeys.filter((key) => !registryKeys.some((other) => key.toLowerCase().startsWith(`${other.toLowerCase()}\\`)));
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'atlas-reg-'));
  try {
    const sections = new Map();
    for (const [index, key] of roots.entries()) {
      const file = path.join(directory, `${index}.reg`);
      try {
        await execFileAsync('reg.exe', ['export', key, file, '/y'], { windowsHide: true, timeout: 10000 });
      } catch (error) {
        // reg.exe sai com 1 quando a chave não existe; tempo esgotado ou outra falha sobe.
        if (error.code === 1) continue;
        throw error;
      }
      for (const [name, value] of parseRegExport(await fs.promises.readFile(file, 'utf16le'))) sections.set(name, value);
    }
    return registryKeys.map((key) => (sections.has(key.toLowerCase()) ? sections.get(key.toLowerCase()) : null));
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
}

function createExplorerIntegration({ execPath, appPath = null, root = DEFAULT_ROOT, reg = defaultReg, readDefault = null, readDefaults = readDefault ? (items) => Promise.all(items.map(readDefault)) : defaultReadDefaults, platform = process.platform }) {
  const command = openCommand({ execPath, appPath });
  const keys = keysFor(root);

  // Por entrada: null se ausente, '' se sem comando, ou o comando gravado.
  async function readCommands() {
    const values = await readDefaults(keys.flatMap((key) => [key, `${key}\\command`]));
    return keys.map((_, index) => {
      const [shell, current] = [values[index * 2], values[index * 2 + 1]];
      if (shell === null && current === null) return null;
      return current || '';
    });
  }

  async function getStatus() {
    if (platform !== 'win32') return { state: 'unsupported', label: LABEL, keys, command };
    const current = await readCommands();
    let state = 'absent';
    if (current.every((item) => item === command)) state = 'installed';
    else if (current.some((item) => item !== null)) state = 'outdated';
    return { state, label: LABEL, keys, command };
  }

  async function install() {
    if (platform !== 'win32') throw new Error('A entrada do Explorador só existe no Windows.');
    for (const key of keys) {
      await reg(['add', key, '/ve', '/d', LABEL, '/f']);
      await reg(['add', key, '/v', 'Icon', '/d', execPath, '/f']);
      await reg(['add', `${key}\\command`, '/ve', '/d', command, '/f']);
    }
    return getStatus();
  }

  async function remove() {
    if (platform !== 'win32') throw new Error('A entrada do Explorador só existe no Windows.');
    for (const key of keys) {
      try {
        await reg(['delete', key, '/f']);
      } catch {
        // Chave já ausente: remover é idempotente.
      }
    }
    return getStatus();
  }

  return { getStatus, install, remove };
}

function createExplorerHost({ ipcMain, isMainSender, integration }) {
  const guard = (event) => { if (!isMainSender(event)) throw new Error('Janela não autorizada a alterar a integração com o Windows.'); };
  const confirmed = (request) => { if (!request || request.confirm !== true) throw new Error('Confirme na interface antes de alterar o registro do Windows.'); };
  ipcMain.handle('explorer:status', (event) => { guard(event); return integration.getStatus(); });
  ipcMain.handle('explorer:install', (event, request) => { guard(event); confirmed(request); return integration.install(); });
  ipcMain.handle('explorer:remove', (event, request) => { guard(event); confirmed(request); return integration.remove(); });
}

module.exports = { createExplorerIntegration, createExplorerHost, openCommand, parseRegExport, KEY_NAME, LABEL };
