// Diagnóstico opt-in do CLI real; não passa pelo bloqueio de compatibilidade
// do produto. Usa somente uma home descartável e um provedor HTTP de fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync, execFileSync } = require('node:child_process');

if (!process.versions.electron) {
  const result = spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', windowsHide: true,
  });
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}

const { resolveOnPath } = require('../electron/agent-adapters.cjs');
const { ensureOrchestratorProfile } = require('../electron/orchestrator-profile.cjs');
const { atlasEntry, install } = require('../electron/kimi-mcp-config.cjs');
const { createMcpHost } = require('../electron/mcp-host.cjs');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const plain = value => value.replace(/\x1b\](?:[^\x07\x1b]|\x1b(?!\\))*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
async function until(check, label, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = check();
    if (result) return result;
    await delay(150);
  }
  throw new Error(`Timeout: ${label}`);
}

const { profileSnapshot, assertPrincipalProfile } = require('./kimi-profile-state.cjs');
const { assertCleanExit } = require('./smoke-completion.cjs');

async function main() {
  assert.equal(process.platform, 'win32', 'Este diagnóstico exige Windows/ConPTY.');
  const executable = resolveOnPath('kimi');
  assert(executable, 'Kimi precisa estar instalado no PATH.');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-kimi-profile-'));
  const home = path.join(fixture, 'home');
  fs.mkdirSync(home);
  const probeEnv = { ...process.env, KIMI_CODE_HOME: home, KIMI_CODE_NO_AUTO_UPDATE: '1' };
  delete probeEnv.ELECTRON_RUN_AS_NODE;
  let requests = 0;
  const provider = http.createServer((_request, response) => {
    requests += 1;
    response.writeHead(500).end('Este diagnóstico não pode consultar um modelo.');
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  const config = `default_model = "fixture-a"\ntelemetry = false\n[providers.fixture]\ntype = "openai"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\napi_key = "fixture-only"\n[models.fixture-a]\nprovider = "fixture"\nmodel = "fixture-a"\nmax_context_size = 32000\ncapabilities = ["tool_use"]\n[models.fixture-b]\nprovider = "fixture"\nmodel = "fixture-b"\nmax_context_size = 32000\ncapabilities = ["tool_use"]\n`;
  fs.writeFileSync(path.join(home, 'config.toml'), config);
  const host = createMcpHost({ store: {} });
  let terminal;
  let exited = false;
  let code = null;
  let forced = false;
  let output = '';
  let passed = false;
  try {
    const version = execFileSync(executable, ['--version'], { env: probeEnv, encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim();
    console.log(`Kimi ${version}`);
    await host.listen();
    const token = host.register({ projectId: 'fixture', sessionId: 'principal', role: 'orchestrator' });
    install({ home, entry: atlasEntry({ execPath: process.execPath, bridgePath: path.resolve(__dirname, '../electron/atlas-mcp-bridge.cjs') }) });
    const env = { ...probeEnv, ATLAS_MCP_ENDPOINT: host.endpoint, ATLAS_MCP_TOKEN: token };
    terminal = require('node-pty').spawn(executable, ['--model', 'fixture-a', '--agent-file', ensureOrchestratorProfile(fixture)], { cwd: fixture, env, cols: 130, rows: 40 });
    terminal.onExit(event => { exited = true; code = event.exitCode; });
    let trusted = false;
    terminal.onData(chunk => {
      output = (output + chunk).slice(-256000);
      if (!trusted && plain(output).includes('Trust this folder?')) {
        trusted = true;
        terminal.write('\r'); // Confiança apenas nesta fixture.
      }
    });
    async function sendCommand(command) {
      const start = output.length;
      terminal.write(command);
      // Antes de a TUI consumir a entrada, o PTY pode agrupar texto e Enter
      // apesar do atraso entre writes. O eco confirma que o texto foi processado.
      await until(() => plain(output.slice(start)).includes(command), 'eco do comando na TUI');
      await delay(200);
      terminal.write('\r');
    }
    await until(() => plain(output).includes('Welcome to Kimi Code!'), 'TUI inicializada');
    // A TUI distingue colagem de texto de uma tecla Enter. Enviar o comando e
    // CR no mesmo chunk pode inserir uma quebra no título em vez de submetê-lo.
    await sendCommand('/title atlas-profile-check');
    await until(() => plain(output).includes('Session title set to: atlas-profile-check'), 'sessão local criada sem prompt');
    const profile = await until(() => profileSnapshot(home), 'perfil efetivamente vinculado');
    assert.equal(profile.title, 'atlas-profile-check', 'O título persistido deve confirmar o comando exato, sem texto colado adicional.');
    await until(() => host.isConnected('principal'), 'MCP da sessão materializada');
    await delay(750);
    assert(host.isConnected('principal'), 'A ponte precisa continuar conectada após a descoberta.');
    console.log('PASS sessão local criada por /title e ponte MCP ativa');
    console.log(JSON.stringify(profile));
    assertPrincipalProfile(profile);
    assert.equal(profile.model, 'fixture-a');
    if (process.argv.includes('--switch-model')) {
      const pid = terminal.pid;
      await sendCommand('/model');
      await until(() => plain(output).includes('Alt+S session-only'), 'seletor nativo de modelo');
      terminal.write('fixture-b');
      await delay(200);
      terminal.write('\x1bs'); // Alt+S: só a sessão, sem alterar default_model.
      const changed = await until(() => {
        const current = profileSnapshot(home);
        return current?.model === 'fixture-b' && current;
      }, 'modelo alterado pela TUI');
      assert.equal(terminal.pid, pid);
      assert.equal(exited, false);
      assert.equal(changed.sessionKey, profile.sessionKey);
      assert.equal(changed.title, profile.title);
      assert.equal(changed.profileName, profile.profileName);
      assert.deepEqual(changed.activeToolNames, profile.activeToolNames);
      assert.deepEqual(changed.subagents, []);
      assert(host.isConnected('principal'), 'A ponte deve continuar conectada após trocar o modelo.');
      console.log('PASS troca nativa com Alt+S: mesmo PTY e sessão, perfil de leitura e MCP preservados');
    }
    assert.equal(requests, 0, 'Nenhum pedido pode ter sido enviado ao provedor fictício.');
    assert.equal(fs.readFileSync(path.join(home, 'config.toml'), 'utf8'), config);
    console.log('PASS perfil somente leitura preservado, sem chamar modelo');
    await sendCommand('/exit');
    await until(() => exited, '/exit limpo do CLI', 15000);
    assertCleanExit({ exited, code, forced });
    console.log('PASS /exit encerra o diagnóstico com código zero');
    passed = true;
  } finally {
    if (terminal && !exited) {
      terminal.write('/exit');
      await delay(200);
      terminal.write('\r');
      for (let i = 0; i < 20 && !exited; i += 1) await delay(150);
      if (!exited) {
        forced = true;
        // PID exclusivamente do processo de fixture criado acima, sem shell.
        try { execFileSync('taskkill.exe', ['/PID', String(terminal.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {}
      }
    }
    await host.close();
    await new Promise(resolve => provider.close(resolve));
    if (requests !== 0) passed = false;
    if (!passed) {
      fs.writeFileSync(path.join(fixture, 'terminal.txt'), plain(output));
      console.error(`Fixture preservada: ${fixture}`);
    } else {
      const target = fs.realpathSync.native(fixture);
      assert.equal(path.dirname(target).toLowerCase(), fs.realpathSync.native(os.tmpdir()).toLowerCase());
      assert(path.basename(target).startsWith('atlas-kimi-profile-'));
      fs.rmSync(target, { recursive: true, force: true });
    }
    assert.equal(requests, 0, 'O diagnóstico chamou o provedor fictício inesperadamente.');
  }
}

main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
