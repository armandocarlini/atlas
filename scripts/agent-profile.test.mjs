import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { ensureOrchestratorProfile, ensureClaudeProfile, orchestratorInstructions, PROFILE } = createRequire(import.meta.url)('../electron/orchestrator-profile.cjs');

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
