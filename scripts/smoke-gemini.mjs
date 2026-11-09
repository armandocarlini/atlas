// Smoke real e opt-in do adaptador Gemini: roda o Gemini CLI de verdade com a
// política e o prompt que o ATLAS gera para a principal, contra um servidor falso
// local no formato da API do Gemini. Nenhum prompt chega a um modelo: o servidor
// responde um roteiro de chamadas de ferramenta e grava cada requisição.
// A home do Gemini (GEMINI_CLI_HOME) fica na fixture, com a entrada `atlas` que o
// diálogo de consentimento gravaria; a configuração do usuário não é tocada.
//
// O CLI roda em modo não interativo (-p) e no pior caso de aprovação (yolo), que
// o ATLAS nunca usa: a política precisa segurar mesmo assim.
// Detalhes: docs/diagnosticos/GEMINI_FASE4.md.
//
// Uso: npm run smoke:gemini
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { discoverAdapters, launchFor } = require('../electron/agent-adapters.cjs');
const { ensureGeminiProfile } = require('../electron/orchestrator-profile.cjs');
const { geminiEntry } = require('../electron/kimi-mcp-config.cjs');

const gemini = (await discoverAdapters()).find((adapter) => adapter.id === 'gemini');
if (gemini.status !== 'available') {
  console.error(`ERRO: ${gemini.error}`);
  process.exit(1);
}
console.log(`Adaptador detectado: ${gemini.name} ${gemini.version} (${gemini.executable})`);

const userFiles = ['settings.json', 'oauth_creds.json', 'google_accounts.json'].map((name) => path.join(os.homedir(), '.gemini', name));
const fingerprint = () => userFiles.map((file) => (fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null));
const before = fingerprint();

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-gemini-smoke-'));
const project = path.join(fixture, 'Projeto Gemini');
const geminiHome = path.join(fixture, 'gemini-home');
const userData = path.join(fixture, 'userData');
for (const directory of [project, path.join(geminiHome, '.gemini'), userData, path.join(project, '.gemini')]) fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(project, 'LEIA.md'), 'fixture do smoke real do Gemini\n');
fs.writeFileSync(path.join(project, '.env'), 'SEGREDO_DO_SMOKE=1\n');
// Configuração hostil do repositório: tentaria abrir outro servidor MCP.
fs.writeFileSync(path.join(project, '.gemini', 'settings.json'), JSON.stringify({ mcpServers: { hostil: { command: 'cmd.exe', args: ['/c', 'exit'] } } }));

// Ponte fictícia no lugar da do ATLAS, com a mesma entrada que o consentimento grava.
const bridgeLog = path.join(fixture, 'ponte.jsonl');
const bridgeScript = path.join(fixture, 'ponte.cjs');
fs.writeFileSync(bridgeScript, `
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(bridgeLog)}, JSON.stringify({ endpoint: process.env.ATLAS_MCP_ENDPOINT || null, token: process.env.ATLAS_MCP_TOKEN || null }) + '\\n');
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n');
    if (message.method === 'initialize') reply({ protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'atlas', version: '0.0.0' } });
    else if (message.method === 'tools/list') reply({ tools: [{ name: 'ping', description: 'teste do smoke', inputSchema: { type: 'object', properties: {} } }] });
    else if (message.method === 'tools/call') reply({ content: [{ type: 'text', text: 'pong' }] });
    else if (message.id !== undefined) reply({});
  }
});
`);
const entry = geminiEntry({ execPath: process.execPath, bridgePath: bridgeScript });
fs.writeFileSync(path.join(geminiHome, '.gemini', 'settings.json'), JSON.stringify({ security: { auth: { selectedType: 'gemini-api-key' } }, mcpServers: { atlas: entry } }, null, 2));
const profile = ensureGeminiProfile(userData);

const script = [
  { tool: 'read_file', args: { file_path: '.env' } },
  { tool: 'grep_search', args: { pattern: 'SEGREDO_DO_SMOKE' } },
  { tool: 'run_shell_command', args: { command: 'echo shell' } },
  { tool: 'write_file', args: { file_path: 'escrito.txt', content: 'x' } },
  { tool: 'read_file', args: { file_path: 'LEIA.md' } },
  { tool: 'mcp_atlas_ping', args: {} },
];
const requests = [];
let step = 0;
const server = http.createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    let parsed = {};
    try { parsed = JSON.parse(body); } catch { /* corpo auxiliar */ }
    if (request.url.includes('countTokens')) { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"totalTokens":1}'); return; }
    const main = Array.isArray(parsed.tools) && parsed.tools.length > 0;
    if (main) requests.push({ url: request.url, body: parsed });
    const action = main && step < script.length ? script[step++] : null;
    const part = action ? { functionCall: { name: action.tool, args: action.args } } : { text: 'fim do roteiro' };
    const chunk = { candidates: [{ content: { role: 'model', parts: [part] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } };
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(`data: ${JSON.stringify(chunk)}\r\n\r\n`);
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

const passed = [];
const pass = (label) => { passed.push(label); console.log(`PASS ${label}`); };
let failure = null;
try {
  const launch = launchFor({ adapter: gemini, role: 'orchestrator', model: 'gemini-smoke', geminiProfile: profile });
  const token = `token-${Date.now()}`;
  const env = {
    ...process.env,
    ...launch.env,
    GEMINI_CLI_HOME: geminiHome,
    GOOGLE_GEMINI_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    GEMINI_API_KEY: 'fixture',
    ATLAS_MCP_ENDPOINT: 'fixture-endpoint',
    ATLAS_MCP_TOKEN: token,
  };
  // Como o PTY do ATLAS: o shim .cmd passa pelo cmd.exe.
  const args = [...launch.args, '-p', 'roteiro do smoke', '--skip-trust', '--approval-mode', 'yolo'];
  const line = args.map((item) => (/\s/.test(item) ? `"${item}"` : item)).join(' ');
  const isShim = /\.(cmd|bat)$/i.test(gemini.executable);
  const output = await new Promise((resolve) => execFile(
    isShim ? env.ComSpec || 'cmd.exe' : gemini.executable,
    isShim ? ['/d', '/s', '/c', `""${gemini.executable}" ${line}"`] : args,
    { cwd: project, env, timeout: 180000, windowsVerbatimArguments: isShim },
    (error, stdout, stderr) => resolve({ error, text: `${stdout}${stderr}` }),
  ));
  assert(!output.error, `o CLI falhou: ${output.error?.message}\n${output.text}`);
  assert(!/Policy file error/i.test(output.text), `a política do ATLAS não carregou:\n${output.text}`);
  assert.equal(step, script.length, `o roteiro parou no passo ${step}:\n${output.text}`);

  const first = requests[0];
  assert.match(first.url, /models\/gemini-smoke:/);
  pass('modelo escolhido vai na run');
  const system = JSON.stringify(first.body.systemInstruction);
  assert(system.includes('sessão principal de planejamento do ATLAS') && system.includes('mcp_atlas_tasks_delegate'));
  pass('instruções da principal entram por GEMINI_SYSTEM_MD');
  const tools = requests.at(-1).body.tools.flatMap((group) => (group.functionDeclarations || []).map((declaration) => declaration.name)).sort();
  assert.deepEqual(tools, ['glob', 'list_directory', 'mcp_atlas_ping', 'read_file']);
  pass(`ferramentas da principal, mesmo em yolo: ${tools.join(', ')}`);

  const responses = [];
  for (const content of requests.at(-1).body.contents) for (const part of content.parts || []) if (part.functionResponse) responses.push(JSON.stringify(part.functionResponse.response));
  assert.equal(responses.length, script.length);
  // O próprio Gemini recusa o .env como fora do workspace; a regra de negação da política fica como segunda camada.
  assert(!responses[0].includes('SEGREDO_DO_SMOKE') && /"error"/.test(responses[0]), `read_file do .env não foi negado: ${responses[0]}`);
  assert(/not found/i.test(responses[1]) && !responses[1].includes('SEGREDO_DO_SMOKE'), `grep não foi recusado: ${responses[1]}`);
  pass('.env negado e grep fora da principal');
  assert(/not found/i.test(responses[2]) && /not found/i.test(responses[3]), `shell ou escrita não recusados: ${responses[2]} ${responses[3]}`);
  assert(!fs.existsSync(path.join(project, 'escrito.txt')));
  pass('shell e escrita recusados');
  assert(responses[4].includes('fixture do smoke real do Gemini'), `leitura comum falhou: ${responses[4]}`);
  pass('leitura de arquivo comum permitida');
  assert(responses[5].includes('pong'), `ponte do ATLAS não respondeu: ${responses[5]}`);
  const bridgeRuns = fs.readFileSync(bridgeLog, 'utf8').trim().split('\n').map((item) => JSON.parse(item));
  assert(bridgeRuns.length > 0 && bridgeRuns.every((run) => run.token === token && run.endpoint === 'fixture-endpoint'));
  assert(!launch.args.some((item) => item.includes(token)), 'token fora da linha de comando');
  pass('ponte recebe endpoint e token pela referência da entrada e responde');
} catch (error) {
  failure = error;
} finally {
  server.close();
}

assert.deepEqual(fingerprint(), before, 'arquivos reais do Gemini foram alterados');
if (failure) {
  console.error(`FALHOU: ${failure.message}`);
  console.error(`Fixture preservada para inspeção: ${fixture}`);
  process.exit(1);
}
pass('configuração e credenciais reais do Gemini intactas');
fs.rmSync(fixture, { recursive: true, force: true });
console.log(`${passed.length} PASS`);
