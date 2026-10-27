import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { ensureOrchestratorProfile, PROFILE } = createRequire(import.meta.url)('../electron/orchestrator-profile.cjs');

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
  fs.writeFileSync(filename, 'modified prompt');
  assert.equal(ensureOrchestratorProfile(directory), filename);
  assert.equal(fs.readFileSync(filename, 'utf8'), PROFILE);
});
