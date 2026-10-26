import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentSession, mergeAgentSessions } from '../src/session-state.js';

const agent = { id: 'session-a', name: 'Agente', cli: 'Kimi Code', version: '2.3.2', cwd: '/fixture', projectId: 'project-a', state: 'running', ptyId: 'pty-a', origin: 'user' };

test('histórico não recebe terminal ou métricas fictícias nem conclusão para run lost', () => {
  const restored = agentSession({ ...agent, archived: true, runState: 'lost', exit: null });
  assert.equal(restored.id, agent.id);
  assert.equal(restored.ptyId, null);
  assert.match(restored.status, /resultado incerto/);
  assert.equal(restored.tokens, undefined);
  assert.deepEqual(restored.lines, []);
  assert.equal(agentSession(agent).ptyId, 'pty-a');
});

test('carga tardia mescla sessões por UUID e preserva terminal criado durante hidratação', () => {
  const shell = { id: 'shell-a', ptyId: 'shell-pty' };
  const createdWhileLoading = agentSession({ ...agent, id: 'session-b', ptyId: 'pty-b' });
  const current = [shell, agentSession(agent), createdWhileLoading];
  const merged = mergeAgentSessions(current, [agent]);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged[0], shell);
  assert.equal(merged[2].ptyId, 'pty-b');
  assert.deepEqual(mergeAgentSessions(merged, [agent]), merged);
});

test('resultado encerrado distingue sucesso e falha sem depender só de cor', () => {
  assert.match(agentSession({ ...agent, archived: true, runState: 'succeeded' }).status, /código 0/);
  assert.match(agentSession({ ...agent, archived: true, runState: 'failed', exit: { exitCode: 7 } }).status, /código 7/);
  assert.match(agentSession({ ...agent, archived: true, runState: 'failed', exit: { exitCode: 0, signal: 15 } }).status, /falhou.*sinal 15/);
});
