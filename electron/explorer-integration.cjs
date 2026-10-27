const { execFile } = require('node:child_process');
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

// A saída de `reg query` usa a página de código OEM e o rótulo localizado do valor
// padrão; caminhos com acento nunca bateriam. A leitura usa PowerShell em UTF-8, e as
// chaves chegam por variável de ambiente, nunca interpoladas no script. Todas as
// chaves saem de um único PowerShell: vários processos em paralelo estouravam o
// tempo limite em máquinas lentas (regressão vista na CI do Windows).
const READ_SCRIPT = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  "$results = foreach ($key in ($env:ATLAS_REGISTRY_KEYS -split [char]10)) { $item = Get-Item -LiteralPath ('Registry::' + $key) -ErrorAction SilentlyContinue; if ($null -eq $item) { [pscustomobject]@{ state = 'absent'; value = '' } } else { $value = $item.GetValue(''); if ($null -eq $value) { [pscustomobject]@{ state = 'empty'; value = '' } } else { [pscustomobject]@{ state = 'value'; value = [string]$value } } } }",
  '[Console]::Out.Write((ConvertTo-Json -InputObject @($results) -Compress))',
].join('; ');

// null: chave ausente; '': chave sem valor padrão; texto: valor padrão.
async function defaultReadDefaults(keys) {
  const registryKeys = keys.map((key) => key.replace(/^HKCU\\/i, 'HKEY_CURRENT_USER\\'));
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', READ_SCRIPT], {
    encoding: 'utf8', windowsHide: true, timeout: 30000, env: { ...process.env, ATLAS_REGISTRY_KEYS: registryKeys.join('\n') },
  });
  const results = JSON.parse(stdout.replace(/^\uFEFF/, ''));
  if (!Array.isArray(results) || results.length !== keys.length) throw new Error('Leitura do registro incompleta.');
  return results.map((item) => (item.state === 'absent' ? null : item.state === 'empty' ? '' : String(item.value)));
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

module.exports = { createExplorerIntegration, createExplorerHost, openCommand, KEY_NAME, LABEL };
