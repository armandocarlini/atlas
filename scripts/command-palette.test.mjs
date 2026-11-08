import assert from 'node:assert/strict';
import test from 'node:test';
import { filterCommands, normalize } from '../src/command-filter.js';

const commands = [
  { id: 'a', group: 'Sessões', label: 'Nova sessão de agente', keywords: 'agente cli modelo' },
  { id: 'b', group: 'Layout', label: 'Ocultar navegação', keywords: 'coluna esquerda' },
  { id: 'c', group: 'Projetos', label: 'Ir para ATLAS', keywords: 'projeto repositorio' },
];

test('busca ignora acentos e maiúsculas', () => {
  assert.equal(normalize('Sessão NAVEGAÇÃO'), 'sessao navegacao');
  assert.deepEqual(filterCommands(commands, 'sessao').map((item) => item.id), ['a']);
  assert.deepEqual(filterCommands(commands, 'NAVEGACAO').map((item) => item.id), ['b']);
});

test('todas as palavras precisam aparecer, em qualquer campo', () => {
  assert.deepEqual(filterCommands(commands, 'ir atlas').map((item) => item.id), ['c']);
  assert.deepEqual(filterCommands(commands, 'layout esquerda').map((item) => item.id), ['b']);
  assert.deepEqual(filterCommands(commands, 'atlas modelo'), []);
});

test('busca vazia mostra tudo na ordem original', () => {
  assert.deepEqual(filterCommands(commands, '   ').map((item) => item.id), ['a', 'b', 'c']);
});
