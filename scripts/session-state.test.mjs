import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentSession, mergeAgentSessions, sessionExit, usesKimi } from '../src/session-state.js';

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

test('snapshot atrasado não substitui nova run nem reabre run já encerrada', () => {
  const latest = agentSession({ ...agent, runAttempt: 2, runStartedAt: '2026-10-26T12:00:00Z' });
  const previous = { ...agent, archived: true, runState: 'lost', runAttempt: 1, runStartedAt: '2026-10-26T12:00:01Z' };
  assert.deepEqual(mergeAgentSessions([latest], [previous]), [latest]);
  const ended = { ...latest, exited: true, status: 'encerrado · código 0' };
  assert.deepEqual(mergeAgentSessions([ended], [{ ...agent, runAttempt: 2, runStartedAt: latest.runStartedAt }]), [ended]);
});

test('saída atrasada do PTY anterior não encerra nova run da mesma sessão', () => {
  const current = [agentSession({ ...agent, ptyId: 'new-pty', runAttempt: 2 })];
  assert.deepEqual(sessionExit(current, agent.id, { ptyId: 'old-pty', exitCode: 0 }), current);
  assert.deepEqual(sessionExit(current, agent.id, { exitCode: 0 }), current);
  assert.equal(sessionExit(current, agent.id, { ptyId: 'new-pty', exitCode: 0 })[0].exited, true);
});

test('regressão: aviso do Kimi só com sessão Kimi no projeto', () => {
  assert.equal(usesKimi([]), false);
  assert.equal(usesKimi([{ cli: 'OpenCode' }, { cli: 'OpenCode', archived: true }]), false, 'sessões OpenCode não pedem a integração do Kimi');
  assert.equal(usesKimi([{ cli: 'OpenCode' }, { cli: 'Kimi Code' }]), true);
  assert.equal(usesKimi([{ cli: 'Kimi Code', archived: true }]), true, 'histórico Kimi: a próxima execução precisa das ferramentas');
  assert.equal(usesKimi([{ cli: undefined }]), false);
});
