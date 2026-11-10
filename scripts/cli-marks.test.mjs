import assert from 'node:assert/strict';
import test from 'node:test';
import { CLI_MARKS, cliMarkId, sessionTone } from '../src/cli-marks.js';

test('cada adaptador com marca publicada usa o ícone oficial dele', () => {
  for (const id of ['claude-code', 'gemini', 'kimi-code', 'opencode']) {
    assert.equal(cliMarkId({ adapterId: id, cli: 'qualquer' }), id);
    assert.match(CLI_MARKS[id].path, /^M[\d.\s\-A-Za-z]+/, `${id} tem desenho`);
  }
  assert.equal(CLI_MARKS['claude-code'].color, '#d97757', 'Claude Code no laranja oficial');
  assert.equal(CLI_MARKS.gemini.color, '#8e75b2');
  assert.equal(CLI_MARKS['kimi-code'].color, null, 'marca monocromática segue a tinta do tema');
  assert.equal(CLI_MARKS.opencode.color, null);
});

test('Codex não tem marca publicada e cai no ícone neutro', () => {
  assert.equal(cliMarkId({ adapterId: 'codex', cli: 'Codex' }), 'codex');
  assert.equal(CLI_MARKS.codex, undefined);
});

test('terminal sem agente usa o ícone de terminal, mesmo com nome de CLI', () => {
  assert.equal(cliMarkId({ origin: 'terminal', cli: 'PowerShell' }), 'terminal');
  assert.equal(cliMarkId({ origin: 'terminal', cli: 'Claude Code' }), 'terminal');
  assert.equal(cliMarkId({ cli: 'pwsh' }), 'terminal');
});

test('histórico antigo sem adaptador é reconhecido pelo nome do CLI', () => {
  assert.equal(cliMarkId({ cli: 'Claude Code 2.1' }), 'claude-code');
  assert.equal(cliMarkId({ cli: 'Kimi Code' }), 'kimi-code');
  assert.equal(cliMarkId({ cli: 'OpenCode' }), 'opencode');
  assert.equal(cliMarkId({ cli: 'Gemini CLI' }), 'gemini');
  assert.equal(cliMarkId({ cli: 'codex' }), 'codex');
});

test('CLI desconhecido ou adaptador sem marca não inventa ícone', () => {
  assert.equal(cliMarkId({ cli: 'Fixture Agent' }), 'agent');
  assert.equal(cliMarkId({ adapterId: 'outro', cli: 'Outro CLI' }), 'agent');
  assert.equal(cliMarkId({}), 'agent');
  assert.equal(cliMarkId(null), 'agent');
});

test('selo: ativa, oculta (vence o resto) e encerrada para histórico ou processo encerrado', () => {
  assert.equal(sessionTone({}), 'active');
  assert.equal(sessionTone({ exited: true }), 'ended');
  assert.equal(sessionTone({ archived: true, exited: true }), 'ended');
  assert.equal(sessionTone({ archived: true }, true), 'hidden');
  assert.equal(sessionTone({}, true), 'hidden');
});
