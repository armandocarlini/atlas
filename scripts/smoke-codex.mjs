// Smoke real e opt-in do adaptador Codex: confere, no CLI instalado, a lista de
// modelos e a ponte do ATLAS montada pelos argumentos de `launchFor`, passando
// pelo mesmo caminho do Windows (shim .cmd interpretado pelo cmd.exe). Nenhum
// prompt é enviado ao modelo. A home do Codex (CODEX_HOME) fica na fixture; a
// configuração e as credenciais do usuário não são lidas nem alteradas.
//
// Uso: npm run smoke:codex
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { discoverAdapters, listModels, launchFor, assertOrchestratorSupport } = require('../electron/agent-adapters.cjs');

const codex = (await discoverAdapters()).find((adapter) => adapter.id === 'codex');
if (codex.status !== 'available') {
  console.error(`ERRO: ${codex.error}`);
  process.exit(1);
}
console.log(`Adaptador detectado: ${codex.name} ${codex.version} (${codex.executable})`);

const home = os.homedir();
const userFiles = ['config.toml', 'auth.json'].map((name) => path.join(home, '.codex', name));
const fingerprint = () => userFiles.map((file) => (fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null));
const before = fingerprint();
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-codex-smoke-'));
const codexHome = path.join(fixture, 'codex-home');
fs.mkdirSync(codexHome);

// Executa o CLI como o PTY do ATLAS faria: .cmd pelo cmd.exe, argumento com espaço entre aspas.
function run(args) {
  const env = { ...process.env, CODEX_HOME: codexHome, ATLAS_MCP_ENDPOINT: 'fixture-endpoint', ATLAS_MCP_TOKEN: 'token-do-smoke' };
  const isShim = /\.(cmd|bat)$/i.test(codex.executable);
  const line = args.map((item) => (/\s/.test(item) ? `"${item}"` : item)).join(' ');
  const [file, argv, options] = isShim
    ? [env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${codex.executable}" ${line}"`], { windowsVerbatimArguments: true }]
    : [codex.executable, args, {}];
  return new Promise((resolve, reject) => execFile(file, argv, { ...options, env, timeout: 60000 }, (error, stdout, stderr) => (error ? reject(new Error(`${error.message}\n${stderr}`)) : resolve(stdout))));
}

const passed = [];
const pass = (label) => { passed.push(label); console.log(`PASS ${label}`); };
let failure = null;
try {
  const models = await listModels(codex, { env: { ...process.env, CODEX_HOME: codexHome } });
  assert(models.length > 0, 'o Codex não listou modelos');
  pass(`modelos listados sem rede: ${models.join(', ')}`);

  const bridge = { command: 'C:\\Program Files\\ATLAS (smoke)\\ATLAS.exe', args: ['C:\\ATLAS (smoke)\\atlas-mcp-bridge.cjs'], env: { ELECTRON_RUN_AS_NODE: '1', ATLAS_MCP_ENDPOINT: 'fixture-endpoint', ATLAS_MCP_TOKEN: 'token-do-smoke' } };
  const launch = launchFor({ adapter: codex, model: models[0], bridge });
  assert(!launch.args.some((item) => item.includes('token-do-smoke') || item.includes('fixture-endpoint')), 'token fora da linha de comando');
  const configArgs = launch.args.slice(launch.args.indexOf('-c'));
  const entry = JSON.parse((await run(['mcp', 'get', 'atlas', '--json', ...configArgs])).replace(/^[^{]*/, ''));
  assert.equal(entry.transport.command, bridge.command);
  assert.deepEqual(entry.transport.args, bridge.args);
  assert.deepEqual(entry.transport.env, { ELECTRON_RUN_AS_NODE: '1' });
  assert.deepEqual(entry.transport.env_vars, ['ATLAS_MCP_ENDPOINT', 'ATLAS_MCP_TOKEN']);
  pass('ponte do ATLAS montada só nesta invocação, intacta pelo cmd.exe, com endpoint e token pelo ambiente');

  const listed = await run(['mcp', 'list']);
  assert(!listed.includes('atlas'), 'a ponte não fica gravada na home do Codex');
  pass('nada gravado na configuração do Codex');

  assert.throws(() => assertOrchestratorSupport(codex), /Codex indisponível para a principal/);
  pass('principal Codex recusada com motivo');
} catch (error) {
  failure = error;
}

assert.deepEqual(fingerprint(), before, 'arquivos reais do Codex foram alterados');
if (failure) {
  console.error(`FALHOU: ${failure.message}`);
  console.error(`Fixture preservada para inspeção: ${fixture}`);
  process.exit(1);
}
pass('configuração e credenciais reais do Codex intactas');
fs.rmSync(fixture, { recursive: true, force: true });
console.log(`${passed.length} PASS`);
