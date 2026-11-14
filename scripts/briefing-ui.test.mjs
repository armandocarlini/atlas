import assert from 'node:assert/strict';
import { test } from 'node:test';
import { briefingDestination, briefingCanSend } from '../src/briefing.js';

const principal = { id: 'p', role: 'orchestrator', name: 'Principal', terminalId: 'pty-principal' };
const worker = { id: 'w', role: 'agent', name: 'Revisor', terminalId: 'pty-worker' };
const external = { id: 'e', role: 'agent', name: 'Externo', external: true, terminalId: 'ignored' };

test('o compositor fica sem destino quando só existem outros agentes ou sessões externas', () => {
  const target = briefingDestination([worker, external], undefined);
  assert.equal(target, null);
  assert.equal(briefingCanSend(target, 'Olá'), false);
  assert.equal(briefingDestination([worker, external], external.id), null);
});

test('a principal é a escolha inicial e trocar de destino troca o PTY da prévia', () => {
  assert.equal(briefingDestination([worker, principal], undefined).terminalId, 'pty-principal');
  assert.equal(briefingDestination([worker, principal], worker.id).terminalId, 'pty-worker');
  assert.equal(briefingDestination([principal], worker.id), null);
  assert.equal(briefingDestination([principal], ''), null);
  assert.equal(briefingCanSend(principal, 'Olá'), true);
  assert.equal(briefingCanSend(principal, ' '), false);
  assert.equal(briefingCanSend(principal, 'a'.repeat(4001)), false);
});
