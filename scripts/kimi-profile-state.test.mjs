import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import state from './kimi-profile-state.cjs';

const { profileSnapshot, assertPrincipalProfile } = state;
const bound = { type: 'profile.bind', agentId: 'main', profileName: 'atlas-orchestrator', modelAlias: 'fixture-a', activeToolNames: ['Read'], subagents: [] };

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-kimi-state-'));
  t.after(() => {
    const target = fs.realpathSync.native(home);
    assert.equal(path.dirname(target).toLowerCase(), fs.realpathSync.native(os.tmpdir()).toLowerCase());
    assert(path.basename(target).startsWith('atlas-kimi-state-'));
    fs.rmSync(target, { recursive: true, force: true });
  });
  return home;
}

function writeSession(home, id, title, records) {
  const folder = path.join(home, 'sessions', 'workspace', id);
  const agent = path.join(folder, 'agents', 'main');
  fs.mkdirSync(agent, { recursive: true });
  fs.writeFileSync(path.join(folder, 'state.json'), JSON.stringify({ title }));
  fs.writeFileSync(path.join(agent, 'wire.jsonl'), records.map(record => JSON.stringify(record)).join('\n') + '\n{"partial":');
}

test('seleciona a sessão pelo título exato sem confundir outra run', t => {
  const home = fixture(t);
  writeSession(home, 'old', 'old title', [bound]);
  writeSession(home, 'current', 'current title', [{ ...bound, modelAlias: 'fixture-b' }]);
  const current = profileSnapshot(home, 'current title');
  assert.equal(current.model, 'fixture-b');
  assert.equal(current.sessionKey, path.join('workspace', 'current'));
  assert.equal(profileSnapshot(home, 'current'), null);
});

test('observa troca de modelo e permissão posterior sem confiar só no bind inicial', t => {
  const home = fixture(t);
  writeSession(home, 'current', 'title', [bound, null,
    { type: 'config.update', agentId: 'main', modelAlias: 'fixture-b' },
    { type: 'tools.set_active_tools', agentId: 'main', names: ['Read', 'Bash'] },
    { type: 'profile.bind', agentId: 'other', profileName: 'agent', activeToolNames: ['Write'] },
  ]);
  const current = profileSnapshot(home, 'title');
  assert.equal(current.profileName, 'atlas-orchestrator');
  assert.equal(current.model, 'fixture-b');
  assert.deepEqual(current.activeToolNames, ['Read', 'Bash']);
});

test('reset de ferramentas não reaproveita uma lista anterior de leitura', t => {
  const home = fixture(t);
  writeSession(home, 'current', 'title', [bound, { type: 'tools.reset_active_tools', agentId: 'main' }]);
  assert.equal(profileSnapshot(home, 'title').activeToolNames, undefined);
});

test('ausência de sessão ou perfil não é evidência de leitura', t => {
  const home = fixture(t);
  assert.equal(profileSnapshot(home), null);
  writeSession(home, 'current', 'title', [{ type: 'config.update', agentId: 'main', modelAlias: 'fixture-b' }]);
  assert.equal(profileSnapshot(home, 'title'), null);
});

test('perfil de leitura sem ferramentas ATLAS não comprova integração', () => {
  const profile = { ...bound, activeToolNames: ['Read', 'Grep', 'Glob', 'mcp__atlas__*'] };
  assert.doesNotThrow(() => assertPrincipalProfile(profile));
  assert.throws(() => assertPrincipalProfile({ ...profile, activeToolNames: ['Read', 'Grep', 'Glob'] }), /mcp__atlas__/);
});

test('perfil da principal recusa shell, servidores alheios e subagentes', () => {
  const profile = { ...bound, activeToolNames: ['Read', 'Grep', 'Glob', 'mcp__atlas__*'] };
  for (const tool of ['Bash', 'mcp__other__write']) {
    assert.throws(() => assertPrincipalProfile({ ...profile, activeToolNames: [...profile.activeToolNames, tool] }));
  }
  assert.throws(() => assertPrincipalProfile({ ...profile, subagents: ['worker'] }));
});
