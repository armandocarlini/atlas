// Leitura de evidência somente nas homes de fixture dos smokes do Kimi 2.4.
// O produto não consulta journals nem transcripts do CLI.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

function profileSnapshot(home, title = null) {
  const sessions = path.join(home, 'sessions');
  if (!fs.existsSync(sessions)) return null;
  for (const file of fs.readdirSync(sessions, { recursive: true })) {
    if (!file.endsWith(path.join('agents', 'main', 'wire.jsonl'))) continue;
    const journal = path.join(sessions, file);
    const stateFile = path.resolve(path.dirname(journal), '..', '..', 'state.json');
    let state;
    try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { continue; }
    if (!state || typeof state !== 'object' || (title !== null && state.title !== title)) continue;
    const records = fs.readFileSync(journal, 'utf8').split('\n').flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
    let profile;
    for (const record of records) {
      if (!record || typeof record !== 'object' || record.agentId !== 'main') continue;
      if (record.type === 'profile.bind') profile = { ...record };
      if (!profile) continue;
      if (record.type === 'config.update') {
        for (const key of ['profileName', 'modelAlias', 'subagents']) {
          if (record[key] !== undefined) profile[key] = record[key];
        }
      }
      if (record.type === 'tools.set_active_tools') profile.activeToolNames = record.names;
      if (record.type === 'tools.reset_active_tools') profile.activeToolNames = undefined;
    }
    if (profile) return {
      profileName: profile.profileName, activeToolNames: profile.activeToolNames,
      subagents: profile.subagents, model: profile.modelAlias, title: state.title,
      sessionKey: path.relative(sessions, path.dirname(stateFile)),
    };
  }
  return null;
}

function assertPrincipalProfile(snapshot) {
  assert.equal(snapshot.profileName, 'atlas-orchestrator');
  assert(Array.isArray(snapshot.activeToolNames), 'perfil deve declarar as ferramentas permitidas');
  for (const tool of ['Read', 'Grep', 'Glob', 'mcp__atlas__*']) {
    assert(snapshot.activeToolNames.includes(tool), `ferramenta obrigatória: ${tool}`);
  }
  assert(snapshot.activeToolNames.every(tool => ['Read', 'Grep', 'Glob'].includes(tool) || tool.startsWith('mcp__atlas__')), 'principal sem escrita, shell ou MCP alheio');
  assert.deepEqual(snapshot.subagents, []);
}

module.exports = { profileSnapshot, assertPrincipalProfile };
