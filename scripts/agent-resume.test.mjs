import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

// Retomada da conversa ao reabrir o ATLAS (docs/planos/PLANO_CONTINUIDADE_SESSOES.md).
const { ADAPTERS, launchFor, conversationSupport } = createRequire(import.meta.url)('../electron/agent-adapters.cjs');
const adapter = (id) => ({ ...ADAPTERS.find((item) => item.id === id), executable: `C:\\cli\\${id}.exe`, version: '1.0.0' });
const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
const claudeProfile = { mcpConfig: 'C:\\perfil\\mcp.json', settings: 'C:\\perfil\\settings.json', instructions: 'C:\\perfil\\principal.md', instructionsAuto: 'C:\\perfil\\auto.md' };
const geminiProfile = { policy: 'C:\\perfil\\policy.toml', policyAuto: 'C:\\perfil\\auto.toml', systemPrompt: 'C:\\perfil\\system.md', systemPromptAuto: 'C:\\perfil\\system-auto.md' };

test('suporte por CLI: exato no Claude Code e no Gemini, pela pasta nos demais', () => {
  assert.equal(conversationSupport('claude-code'), 'exact');
  assert.equal(conversationSupport('gemini', 'orchestrator'), 'exact');
  assert.equal(conversationSupport('codex'), 'folder');
  assert.equal(conversationSupport('opencode', 'orchestrator'), 'folder');
  assert.equal(conversationSupport('kimi-code'), 'folder');
  assert.equal(conversationSupport('kimi-code', 'orchestrator'), 'none', '--agent-file não combina com retomada');
  assert.equal(conversationSupport('outro'), 'none');
});

test('Claude Code: fixa o ID ao iniciar e retoma por ele, também na principal', () => {
  const claude = adapter('claude-code');
  assert.deepEqual(launchFor({ adapter: claude, model: 'opus', conversation: { mode: 'new', id } }).args, ['--model', 'opus', '--session-id', id]);
  assert.deepEqual(launchFor({ adapter: claude, model: 'opus', conversation: { mode: 'resume', id } }).args, ['--model', 'opus', '--resume', id]);
  assert.deepEqual(launchFor({ adapter: claude, conversation: { mode: 'continue' } }).args, ['--continue'], 'sessão anterior sem ID salvo');
  const principal = launchFor({ adapter: claude, role: 'orchestrator', claudeProfile, conversation: { mode: 'resume', id } }).args;
  assert.deepEqual(principal.slice(-2), ['--resume', id]);
  assert(principal.includes('--restricted'), 'perfil somente leitura preservado ao retomar');
});

test('Gemini: --session-id ao iniciar, --resume pelo UUID ou latest', () => {
  const gemini = adapter('gemini');
  assert.deepEqual(launchFor({ adapter: gemini, conversation: { mode: 'new', id } }).args, ['--session-id', id]);
  assert.deepEqual(launchFor({ adapter: gemini, conversation: { mode: 'resume', id } }).args, ['--resume', id]);
  assert.deepEqual(launchFor({ adapter: gemini, conversation: { mode: 'continue' } }).args, ['--resume', 'latest']);
  const principal = launchFor({ adapter: gemini, role: 'orchestrator', geminiProfile, conversation: { mode: 'resume', id } });
  assert(principal.args.includes('--policy') && principal.args.at(-1) === id);
});

test('Codex: o subcomando resume --last vem antes das opções, com modelo e ponte', () => {
  const codex = adapter('codex');
  const bridge = { command: 'C:\\atlas\\node.exe', args: ['C:\\atlas\\ponte.cjs'], env: {} };
  const args = launchFor({ adapter: codex, model: 'gpt-5.6', bridge, conversation: { mode: 'continue' } }).args;
  assert.deepEqual(args.slice(0, 4), ['resume', '--last', '--model', 'gpt-5.6']);
  assert(args.includes('-c'), 'ponte do ATLAS continua na run retomada');
  assert.deepEqual(launchFor({ adapter: codex, conversation: { mode: 'new', id } }).args, [], 'Codex não fixa ID ao iniciar');
});

test('OpenCode e Kimi agente retomam pela pasta; a principal do Kimi não retoma', () => {
  assert.deepEqual(launchFor({ adapter: adapter('opencode'), model: 'nvidia/deep', conversation: { mode: 'continue' } }).args, ['--model', 'nvidia/deep', '--continue']);
  assert.deepEqual(launchFor({ adapter: adapter('kimi-code'), conversation: { mode: 'continue' } }).args, ['--continue']);
  assert.throws(() => launchFor({ adapter: adapter('kimi-code'), role: 'orchestrator', orchestratorProfile: 'C:\\p.md', conversation: { mode: 'continue' } }), /não retoma/);
  assert.deepEqual(launchFor({ adapter: adapter('kimi-code'), role: 'orchestrator', orchestratorProfile: 'C:\\p.md', conversation: { mode: 'new', id } }).args, ['--agent-file', 'C:\\p.md']);
});

test('ID de conversa e modo são validados antes de chegar à linha de comando', () => {
  const claude = adapter('claude-code');
  for (const bad of ['abc', `${id} --dangerously-skip-permissions`, `${id}&calc`, null]) {
    assert.throws(() => launchFor({ adapter: claude, conversation: { mode: 'resume', id: bad } }), /Conversa inválida/, String(bad));
  }
  assert.throws(() => launchFor({ adapter: claude, conversation: { mode: 'fork', id } }), /Retomada de conversa inválida/);
  assert.deepEqual(launchFor({ adapter: claude }).args, [], 'sem controle de conversa, nada muda');
});
