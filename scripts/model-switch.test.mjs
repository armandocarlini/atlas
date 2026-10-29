import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canSwitch, modelLabel, switchInstructions } from '../src/model-switch.js';

test('instruções por CLI: Alt+S no Kimi com o aviso do config.toml, /models no OpenCode', () => {
  const kimi = switchInstructions('kimi-code');
  assert.equal(kimi.command, '/model');
  assert(kimi.steps.some((step) => step.includes('Alt+S')));
  assert.match(kimi.warning, /config\.toml/);
  const opencode = switchInstructions('opencode');
  assert.equal(opencode.command, '/models');
  assert.equal(opencode.warning, null);
  assert.equal(switchInstructions('outro').command, null, 'CLI desconhecido recebe orientação genérica');
});

test('rótulo honesto: modelo de início até o usuário informar a troca', () => {
  assert.equal(modelLabel({ model: 'prov/a', currentModel: null }), 'prov/a');
  assert.equal(modelLabel({ model: 'prov/a', currentModel: 'prov/a' }), 'prov/a');
  assert.equal(modelLabel({ model: 'prov/a', currentModel: 'prov/b' }), 'prov/b (informado por você; iniciou com prov/a)');
  assert.equal(modelLabel({ model: null, currentModel: 'prov/b' }), 'prov/b (informado por você; iniciou com o modelo da configuração do CLI)');
  assert.equal(modelLabel({ model: null, currentModel: null }), '');
});

test('principal só troca onde o perfil somente leitura foi verificado; sessão encerrada não troca', () => {
  assert.equal(canSwitch({ roleKind: 'agent', adapterId: 'kimi-code' }).allowed, true);
  assert.equal(canSwitch({ roleKind: 'orchestrator', adapterId: 'opencode' }).allowed, true);
  const kimiPrincipal = canSwitch({ roleKind: 'orchestrator', adapterId: 'kimi-code' });
  assert.equal(kimiPrincipal.allowed, false);
  assert.match(kimiPrincipal.reason, /somente leitura/);
  assert.equal(canSwitch({ roleKind: 'agent', adapterId: 'opencode', exited: true }).allowed, false);
});
