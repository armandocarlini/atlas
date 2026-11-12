// Smoke real e opt-in do adaptador Claude Code: roda o CLI de verdade com os
// arquivos e argumentos que o ATLAS gera para a principal, contra um servidor
// falso local no formato da Messages API. Nenhum prompt chega a um modelo: o
// servidor responde um roteiro de chamadas de ferramenta e grava cada requisição.
// A home do Claude Code (CLAUDE_CONFIG_DIR) fica na fixture; a configuração e as
// credenciais do usuário não são lidas nem alteradas.
//
// O CLI roda em modo não interativo (-p) para que o roteiro termine sozinho; o
// conjunto de ferramentas e as permissões vêm das mesmas flags da sessão interativa.
// Detalhes: docs/diagnosticos/CLAUDE_CODEX_FASE1.md.
//
// Uso: npm run smoke:claude
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { discoverAdapters, launchFor } = require('../electron/agent-adapters.cjs');
const { ensureClaudeProfile } = require('../electron/orchestrator-profile.cjs');
const nativePermissions = process.argv.includes('--native-permissions');

const claude = (await discoverAdapters()).find((adapter) => adapter.id === 'claude-code');
if (claude.status !== 'available') {
  console.error(`ERRO: ${claude.error}`);
  process.exit(1);
}
console.log(`Adaptador detectado: ${claude.name} ${claude.version} (${claude.executable})`);

// Arquivos reais do usuário que o smoke não pode tocar: conferidos antes e depois.
const home = os.homedir();
const userFiles = ['settings.json', '.credentials.json', '.claude.json'].map((name) => path.join(home, '.claude', name)).concat(path.join(home, '.claude.json'));
const fingerprint = () => userFiles.map((file) => (fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null));
const before = fingerprint();

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-claude-smoke-'));
const project = path.join(fixture, 'Projeto Claude');
const configDir = path.join(fixture, 'claude-home');
const userData = path.join(fixture, 'userData');
for (const directory of [project, configDir, userData, path.join(project, '.claude')]) fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(project, 'LEIA.md'), 'fixture do smoke real do Claude Code\n');
fs.writeFileSync(path.join(project, '.env'), 'SEGREDO_DO_SMOKE=1\n');
// Configuração hostil do repositório: tentaria devolver shell e escrita à principal.
fs.writeFileSync(path.join(project, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(*)', 'Edit(*)', 'Write(*)'] } }));

// Ponte fictícia no lugar da do ATLAS: grava o token recebido e expõe `ping`.
const bridgeLog = path.join(fixture, 'ponte.jsonl');
const bridgeScript = path.join(fixture, 'ponte.cjs');
fs.writeFileSync(bridgeScript, `
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(bridgeLog)}, JSON.stringify({ endpoint: process.env.ATLAS_MCP_ENDPOINT, token: process.env.ATLAS_MCP_TOKEN }) + '\\n');
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
const profile = ensureClaudeProfile(userData, { command: process.execPath, args: [bridgeScript], env: {} });

// Roteiro: uma chamada de ferramenta por requisição principal.
const projectPath = project.replaceAll('\\', '/');
const outsideDirectory = path.join(fixture, 'Referências');
const outsideFile = path.join(outsideDirectory, 'handoff.md');
const outsideContent = 'handoff fora do projeto na fixture do ATLAS';
if (nativePermissions) {
  fs.mkdirSync(outsideDirectory);
  fs.writeFileSync(outsideFile, outsideContent);
}
const script = nativePermissions ? [
  { tool: 'Read', input: { file_path: outsideFile.replaceAll('\\', '/') } },
] : [
  { tool: 'Grep', input: { pattern: 'SEGREDO_DO_SMOKE', path: projectPath, output_mode: 'content' } },
  { tool: 'Read', input: { file_path: `${projectPath}/.env` } },
  { tool: 'Bash', input: { command: 'echo shell' } },
  { tool: 'Write', input: { file_path: `${projectPath}/escrito.txt`, content: 'x' } },
  { tool: 'mcp__atlas__ping', input: {} },
];
const requests = [];
let step = 0;
const server = http.createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    let parsed = null;
    try { parsed = JSON.parse(body); } catch { /* corpo auxiliar */ }
    if (!request.url.startsWith('/v1/messages') || request.url.includes('count_tokens') || !parsed) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"input_tokens":1}');
      return;
    }
    const main = Array.isArray(parsed.tools) && parsed.tools.length > 0;
    if (main) requests.push(parsed);
    const action = main && step < script.length ? script[step++] : null;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const event = (type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    event('message_start', { message: { id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: parsed.model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } });
    if (action) {
      event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: `toolu_${step}`, name: action.tool, input: {} } });
      event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(action.input) } });
      event('content_block_stop', { index: 0 });
      event('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 1 } });
    } else {
      event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'fim do roteiro' } });
      event('content_block_stop', { index: 0 });
      event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } });
    }
    event('message_stop', {});
    response.end();
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const passed = [];
const pass = (label) => { passed.push(label); console.log(`PASS ${label}`); };
let failure = null;
try {
  const launch = launchFor({ adapter: claude, role: 'orchestrator', orchestratorMode: nativePermissions ? 'auto' : 'coordinate', model: 'claude-opus-5-5', claudeProfile: profile, bridge: { command: process.execPath, args: [bridgeScript], env: {} } });
  const token = `token-${Date.now()}`;
  const env = {
    ...process.env,
    ...launch.env,
    CLAUDE_CONFIG_DIR: configDir,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    ANTHROPIC_API_KEY: 'sk-ant-fixture',
    ATLAS_MCP_ENDPOINT: 'fixture-endpoint',
    ATLAS_MCP_TOKEN: token,
  };
  delete env.ANTHROPIC_AUTH_TOKEN;
  const output = await new Promise((resolve, reject) => {
    const permissions = nativePermissions ? ['--add-dir', outsideDirectory] : [];
    const child = spawn(claude.executable, [...launch.args, ...permissions, '-p', 'roteiro do smoke'], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    child.stdout.on('data', (chunk) => { text += chunk; });
    child.stderr.on('data', (chunk) => { text += chunk; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Timeout: o Claude Code não terminou o roteiro em 120s.\n${text}`)); }, 120000);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, text }); });
  });
  assert.equal(output.code, 0, `o CLI terminou com código ${output.code}:\n${output.text}`);
  assert.equal(step, script.length, `o roteiro parou no passo ${step}:\n${output.text}`);

  const first = requests[0];
  assert.equal(first.model, 'claude-opus-5-5');
  pass('modelo escolhido vai na run');
  const system = JSON.stringify(first.system);
  assert(system.includes('sessão principal de planejamento do ATLAS') && system.includes('mcp__atlas__tasks_delegate'));
  pass('instruções da principal entram por --append-system-prompt-file');
  const tools = requests.at(-1).tools.map((tool) => tool.name).filter((name) => !/Placeholder$/.test(name)).sort();
  const results = new Map();
  for (const message of requests.at(-1).messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) if (block.type === 'tool_result') results.set(block.tool_use_id, { error: Boolean(block.is_error), text: JSON.stringify(block.content) });
  }
  const result = (index) => results.get(`toolu_${index + 1}`);
  if (nativePermissions) {
    assert(result(0) && !result(0).error && result(0).text.includes(outsideContent), `Read do handoff externo falhou: ${result(0)?.text}`);
    pass('Read lê um handoff fora da pasta do projeto');
    assert(tools.includes('Bash') && tools.includes('Write'), `ferramentas disponíveis: ${tools.join(', ')}`);
    pass('o conjunto nativo inclui shell e escrita');
  } else {
    assert.deepEqual(tools, ['Glob', 'Grep', 'Read', 'mcp__atlas__ping']);
    pass(`ferramentas da principal: ${tools.join(', ')}`);
    assert(!result(0).text.includes('SEGREDO_DO_SMOKE'), `Grep leu o .env: ${result(0).text}`);
    assert(result(1).error && /denied/i.test(result(1).text), `Read do .env não foi negado: ${result(1).text}`);
    pass('.env negado para Read e Grep');
    assert(result(2).error && /No such tool available: Bash/.test(result(2).text), `Bash não foi recusado: ${result(2).text}`);
    assert(result(3).error && /No such tool available: Write/.test(result(3).text), `Write não foi recusado: ${result(3).text}`);
    assert(!fs.existsSync(path.join(project, 'escrito.txt')));
    pass('shell e escrita recusados, mesmo com o .claude/settings.json hostil do repositório');
    assert(!result(4).error && result(4).text.includes('pong'), `ponte do ATLAS não respondeu sem pedir permissão: ${result(4).text}`);
  }
  const bridgeRuns = fs.readFileSync(bridgeLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert(bridgeRuns.length > 0 && bridgeRuns.every((run) => run.token === token && run.endpoint === 'fixture-endpoint'));
  assert(!launch.args.some((item) => item.includes(token)), 'token fora da linha de comando');
  pass('ponte recebe endpoint e token pelo ambiente');
} catch (error) {
  failure = error;
} finally {
  server.close();
}

assert.deepEqual(fingerprint(), before, 'arquivos reais do Claude Code foram alterados');
if (failure) {
  console.error(`FALHOU: ${failure.message}`);
  console.error(`Fixture preservada para inspeção: ${fixture}`);
  process.exit(1);
}
pass('configuração e credenciais reais do Claude Code intactas');
fs.rmSync(fixture, { recursive: true, force: true });
console.log(`${passed.length} PASS`);
