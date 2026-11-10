import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { ensureOrchestratorProfile, ensureClaudeProfile, ensureGeminiProfile, orchestratorInstructions, GEMINI_ORCHESTRATOR_POLICY, GEMINI_ORCHESTRATOR_AUTO_POLICY, PROFILE } = createRequire(import.meta.url)('../electron/orchestrator-profile.cjs');

test('perfil principal é estático, local ao perfil do app e limitado à leitura', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-profile-'));
  t.after(() => {
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert(path.basename(resolved).startsWith('atlas-profile-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const filename = ensureOrchestratorProfile(directory);
  assert.equal(path.dirname(filename), path.join(directory, 'profiles'));
  assert.equal(fs.readFileSync(filename, 'utf8'), PROFILE);
  assert(PROFILE.includes('tools:\n  - Read\n  - Grep\n  - Glob\n  - mcp__atlas__*\nsubagents: []'));
  assert(!/ {2}- mcp__(?!atlas__)/.test(PROFILE), 'somente ferramentas MCP do próprio ATLAS');
  assert(PROFILE.includes('não confiáveis'));
  assert(PROFILE.includes('${base_prompt}'));
  assert(!PROFILE.includes('  - Bash'));
  assert(PROFILE.includes('mcp__atlas__tasks_delegate') && PROFILE.includes('não afirme que ele assumiu'), 'principal delega sem afirmar aceite');
  assert(PROFILE.includes('worktree: true') && PROFILE.includes('remover worktrees'), 'principal conhece a worktree por tarefa e seus limites');
  assert(PROFILE.includes('só o usuário conclui') && PROFILE.includes('estado done'), 'principal não afirma conclusão antes do aceite');
  assert(PROFILE.includes('lastReview.regression') && PROFILE.includes('uma suíte verde não conclui a tarefa'), 'principal lê a suíte como verificação que só informa');
  assert(PROFILE.includes('diferente das que aparecem em workedBy') && PROFILE.includes('pode manter a mesma IA'), 'principal prefere outra IA para revisar, e o usuário decide');
  fs.writeFileSync(filename, 'modified prompt');
  assert.equal(ensureOrchestratorProfile(directory), filename);
  assert.equal(fs.readFileSync(filename, 'utf8'), PROFILE);
});

test('arquivos da principal no Claude Code: instruções, permissões e ponte sem segredo', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-profile-'));
  t.after(() => {
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert(path.basename(resolved).startsWith('atlas-profile-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const entry = { command: 'C:\\ATLAS.exe', args: ['C:\\ponte.cjs'], env: { ELECTRON_RUN_AS_NODE: '1' } };
  const files = ensureClaudeProfile(directory, entry);
  for (const file of Object.values(files)) assert.equal(path.dirname(file), path.join(directory, 'profiles'));
  assert.equal(fs.readFileSync(files.instructions, 'utf8'), `${orchestratorInstructions('mcp__atlas__')}
`);
  const settings = JSON.parse(fs.readFileSync(files.settings, 'utf8'));
  assert.deepEqual(settings.permissions.allow, ['mcp__atlas']);
  assert.deepEqual(settings.permissions.deny, ['Read(**/.env)', 'Read(**/.env.*)']);
  const mcp = JSON.parse(fs.readFileSync(files.mcpConfig, 'utf8'));
  assert.deepEqual(mcp.mcpServers.atlas, {
    command: 'C:\\ATLAS.exe',
    args: ['C:\\ponte.cjs'],
    env: { ELECTRON_RUN_AS_NODE: '1', ATLAS_MCP_ENDPOINT: '${ATLAS_MCP_ENDPOINT}', ATLAS_MCP_TOKEN: '${ATLAS_MCP_TOKEN}' },
  });
  // Arquivo alterado por fora volta ao conteúdo do ATLAS no próximo início.
  fs.writeFileSync(files.settings, '{"permissions":{"allow":["Bash(*)"]}}');
  ensureClaudeProfile(directory, entry);
  assert.deepEqual(JSON.parse(fs.readFileSync(files.settings, 'utf8')), settings);
  assert.equal(ensureClaudeProfile(directory, null).mcpConfig, null, 'sem ponte, sem arquivo MCP');
});

test('principal no Gemini: política nega tudo exceto leitura e ATLAS; prompt próprio com as ferramentas do CLI', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-profile-'));
  t.after(() => {
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert(path.basename(resolved).startsWith('atlas-profile-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const files = ensureGeminiProfile(directory);
  const policy = fs.readFileSync(files.policy, 'utf8');
  assert.equal(policy, GEMINI_ORCHESTRATOR_POLICY);
  const rules = policy.split('[[rule]]').slice(1).map((block) => Object.fromEntries([...block.matchAll(/^(\w+) = (.+)$/gm)].map(([, key, value]) => [key, value])));
  // Regressão de segurança: a primeira regra nega tudo; só leitura de arquivos e a ponte são liberadas.
  assert.deepEqual(rules[0], { toolName: '"*"', decision: '"deny"', priority: '900' });
  const allowed = rules.filter((rule) => rule.decision === '"allow"').map((rule) => rule.mcpName ? 'mcp:' + rule.mcpName : rule.toolName).sort();
  assert.deepEqual(allowed, ['"glob"', '"list_directory"', '"read_file"', 'mcp:"atlas"']);
  for (const tool of ['read_file', 'list_directory', 'glob']) {
    const deny = rules.find((rule) => rule.toolName === '"' + tool + '"' && rule.decision === '"deny"');
    assert.equal(deny.argsPattern, "'\\.env'", tool + ' nega .env');
    assert(Number(deny.priority) > 960, 'negação do .env vence a liberação');
  }
  assert(!/grep|shell|write|replace/.test(policy), 'sem grep, shell nem escrita liberados');
  const prompt = fs.readFileSync(files.systemPrompt, 'utf8');
  assert(prompt.includes('$' + '{AvailableTools}') && prompt.includes(orchestratorInstructions('mcp_atlas_')));
});

test('instruções e arquivos do modo auto: faz o pequeno, avisa que não passa por revisão; .env segue negado', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-profile-'));
  t.after(() => {
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert(path.basename(resolved).startsWith('atlas-profile-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const auto = orchestratorInstructions('x_', { mode: 'auto' });
  assert(auto.includes('pode fazer sozinha alterações pequenas e claras') && auto.includes('não passam pela revisão de tarefa nem pela suíte'));
  assert(!auto.includes('Neste projeto você só coordena'));
  assert(orchestratorInstructions('x_').includes('Neste projeto você só coordena'), 'padrão é só coordena');
  assert(PROFILE.includes('Neste projeto você só coordena'), 'perfil do Kimi segue só coordena');
  const claudeFiles = ensureClaudeProfile(directory, null);
  assert.equal(fs.readFileSync(claudeFiles.instructionsAuto, 'utf8'), orchestratorInstructions('mcp__atlas__', { mode: 'auto' }) + '\n');
  const geminiFiles = ensureGeminiProfile(directory);
  const policy = fs.readFileSync(geminiFiles.policyAuto, 'utf8');
  assert.equal(policy, GEMINI_ORCHESTRATOR_AUTO_POLICY);
  assert(!policy.includes('toolName = "*"\ndecision = "deny"'), 'modo auto sem a negação geral');
  for (const tool of ['read_file', 'grep_search', 'write_file', 'replace']) assert(policy.includes('toolName = "' + tool + '"\nargsPattern = ' + "'\\.env'\ndecision = \"deny\""), tool + ' nega .env');
  assert(policy.includes('mcpName = "atlas"'));
  const prompt = fs.readFileSync(geminiFiles.systemPromptAuto, 'utf8');
  assert(prompt.includes('pode fazer sozinha') && !prompt.includes('com acesso somente de leitura'));
});
