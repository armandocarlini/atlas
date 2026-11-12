import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

// Retomada da conversa ao reabrir o ATLAS (docs/planos/PLANO_CONTINUIDADE_SESSOES.md).
const { ADAPTERS, launchFor, conversationSupport } = createRequire(import.meta.url)('../electron/agent-adapters.cjs');
const adapter = (id) => ({ ...ADAPTERS.find((item) => item.id === id), executable: `C:\\cli\\${id}.exe`, version: '1.0.0' });
const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
const claudeProfile = { mcpConfig: 'C:\\perfil\\mcp.json', settings: 'C:\\perfil\\settings.json', instructions: 'C:\\perfil\\principal.md', instructionsAuto: 'C:\\perfil\\auto.md' };
const geminiProfile = { policy: 'C:\\perfil\\policy.toml', systemPrompt: 'C:\\perfil\\system.md', systemPromptAuto: 'C:\\perfil\\system-auto.md' };

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

test('prompt inicial fixo só na run criada pela aprovação, seguro para o cmd.exe e nunca no Kimi', () => {
  const { AGENT_KICKOFF_PROMPT, CMD_SAFE_VALUE } = createRequire(import.meta.url)('../electron/agent-adapters.cjs');
  assert.match(AGENT_KICKOFF_PROMPT, CMD_SAFE_VALUE, 'o texto passa pelo cmd.exe nos shims .cmd');
  assert(AGENT_KICKOFF_PROMPT.includes('handoffs_pending') && AGENT_KICKOFF_PROMPT.includes('messages_unread'));
  const claude = adapter('claude-code');
  const bridge = { command: 'C:\\atlas\\electron.exe', args: ['C:\\atlas\\bridge.cjs'], env: {} };
  // O -- encerra o --mcp-config, que aceita vários valores.
  assert.deepEqual(launchFor({ adapter: claude, model: 'opus', claudeProfile, bridge, conversation: { mode: 'new', id }, kickoff: true }).args,
    ['--model', 'opus', '--mcp-config', claudeProfile.mcpConfig, '--session-id', id, '--', AGENT_KICKOFF_PROMPT]);
  assert.deepEqual(launchFor({ adapter: adapter('codex'), kickoff: true }).args.slice(-2), ['--', AGENT_KICKOFF_PROMPT]);
  assert.deepEqual(launchFor({ adapter: adapter('gemini'), kickoff: true }).args.slice(-2), ['-i', AGENT_KICKOFF_PROMPT]);
  assert.deepEqual(launchFor({ adapter: adapter('opencode'), kickoff: true }).args.slice(-2), ['--prompt', AGENT_KICKOFF_PROMPT]);
  assert(!launchFor({ adapter: adapter('kimi-code'), kickoff: true }).args.includes(AGENT_KICKOFF_PROMPT), 'o -p do Kimi não é interativo');
  assert(!launchFor({ adapter: claude, conversation: { mode: 'new', id } }).args.includes(AGENT_KICKOFF_PROMPT), 'sessão manual não recebe prompt');
  assert(!launchFor({ adapter: claude, conversation: { mode: 'resume', id }, kickoff: true }).args.includes(AGENT_KICKOFF_PROMPT), 'retomar conversa não repete o prompt');
  assert(!launchFor({ adapter: claude, role: 'orchestrator', claudeProfile, kickoff: true }).args.includes(AGENT_KICKOFF_PROMPT), 'a principal não recebe o prompt de agente');
});
