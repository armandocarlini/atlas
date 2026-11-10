import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeChoice, pendingConfiguration, pickRecommendation, sameAiWorkers } from '../src/agent-functions.js';

const adapters = [
  { id: 'kimi-code', name: 'Kimi Code', status: 'missing' },
  { id: 'opencode', name: 'OpenCode', status: 'available' },
];

test('recomendação só de CLI detectado, na ordem curada', () => {
  const recommendations = { funcoes: { revisar: [
    { adapterId: 'kimi-code', model: 'k', motivo: 'a' },
    { adapterId: 'opencode', model: 'o/forte', motivo: 'b' },
  ] } };
  assert.equal(pickRecommendation(recommendations, 'revisar', adapters).model, 'o/forte');
  assert.equal(pickRecommendation(recommendations, 'testes', adapters), null);
  assert.equal(pickRecommendation(recommendations, 'revisar', null), null, 'adaptadores ainda carregando');
  assert.equal(pickRecommendation({ funcoes: {} }, 'revisar', adapters), null, 'arquivo vazio não recomenda nada');
});

test('aviso conta só Orquestrador e padrão sem CLI', () => {
  assert.equal(pendingConfiguration([
    { kind: 'orchestrator', adapterId: null },
    { kind: 'builtin', adapterId: 'opencode' },
    { kind: 'builtin', adapterId: null },
    { kind: 'custom', adapterId: null },
  ]), 2);
  assert.equal(pendingConfiguration(undefined), 0);
});

test('descrição da escolha salva', () => {
  assert.equal(describeChoice({ adapterId: null }, adapters), 'Não configurada');
  assert.equal(describeChoice({ adapterId: 'opencode', model: 'o/x' }, adapters), 'OpenCode · o/x');
  assert.equal(describeChoice({ adapterId: 'kimi-code', model: null }, adapters), 'Kimi Code · modelo da configuração do CLI');
  assert.equal(describeChoice({ adapterId: 'outro', model: 'm' }, adapters), 'outro · m');
});

test('mesma IA: mesmo CLI e modelo, de outra função; sem modelo de um lado, basta o CLI', () => {
  const workedBy = [
    { adapter: 'claude-code', model: 'Claude-Opus-5-5 ', function: 'implementar' },
    { adapter: 'opencode', model: null, function: 'implementar' },
    { adapter: 'codex', model: 'gpt-a', function: 'revisar' },
  ];
  assert.deepEqual(sameAiWorkers(workedBy, { adapterId: 'claude-code', model: 'claude-opus-5-5' }, 'revisar').map((item) => item.adapter), ['claude-code'], 'maiúsculas e espaços não contam');
  assert.deepEqual(sameAiWorkers(workedBy, { adapterId: 'claude-code', model: 'opus' }, 'revisar'), [], 'apelidos não são reconhecidos como o mesmo modelo');
  assert.deepEqual(sameAiWorkers(workedBy, { adapterId: 'opencode', model: 'x/y' }, 'revisar').map((item) => item.adapter), ['opencode'], 'modelo não registrado: basta o CLI');
  assert.deepEqual(sameAiWorkers(workedBy, { adapterId: 'claude-code', model: '' }, 'revisar').map((item) => item.adapter), ['claude-code'], 'modelo da configuração do CLI: basta o CLI');
  assert.deepEqual(sameAiWorkers(workedBy, { adapterId: 'codex', model: 'gpt-a' }, 'revisar'), [], 'a mesma função não acusa o revisor anterior');
  assert.deepEqual(sameAiWorkers(undefined, { adapterId: 'codex' }, 'revisar'), []);
  assert.deepEqual(sameAiWorkers(workedBy, { adapterId: '' }, 'revisar'), [], 'sem CLI escolhido, sem aviso');
});
