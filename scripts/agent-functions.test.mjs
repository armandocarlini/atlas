import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { createOperationalStore, migrate, MIGRATIONS } = require('../electron/operational-store.cjs');
const { MAX_FUNCTIONS } = require('../electron/agent-functions.cjs');
const { parseRecommendations, loadRecommendations, recommendFor } = require('../electron/model-recommendations.cjs');
const { createAgentFunctionHost } = require('../electron/agent-function-host.cjs');

function fixture(t) {
  const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-funcoes-')));
  const stores = [];
  t.after(() => {
    stores.forEach((store) => store.close());
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const open = (file = path.join(directory, 'estado.sqlite')) => {
    const store = createOperationalStore({ filename: file });
    stores.push(store);
    return store;
  };
  return { directory, open };
}

const BUILTIN = ['planejar', 'explorar', 'implementar', 'revisar', 'testes'];

test('migration 10 semeia o Orquestrador e as cinco funções padrão, sem CLI nem modelo', (t) => {
  const store = fixture(t).open();
  const items = store.listFunctions();
  assert.deepEqual(items.map((item) => item.slug), ['orquestrador', ...BUILTIN]);
  assert.deepEqual(items.map((item) => item.kind), ['orchestrator', 'builtin', 'builtin', 'builtin', 'builtin', 'builtin']);
  for (const item of items) {
    assert.equal(item.adapterId, null, `${item.slug} nasce sem CLI`);
    assert.equal(item.model, null, `${item.slug} nasce sem modelo`);
    assert(item.description.length > 10);
  }
});

test('migration 10 a partir de um banco v9 preserva runs e acrescenta a auditoria por função', (t) => {
  const { directory, open } = fixture(t);
  const file = path.join(directory, 'v9.sqlite');
  const raw = new DatabaseSync(file);
  migrate(raw, MIGRATIONS.slice(0, 9));
  raw.prepare("INSERT INTO projects (id, name, path, created_at, updated_at) VALUES ('p', 'P', '/fixtures/p', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')").run();
  raw.close();
  const store = open(file);
  assert.equal(store.listProjects().length, 1, 'projeto do v9 preservado');
  assert.equal(store.listFunctions().length, 6);
  const db = new DatabaseSync(file);
  try {
    const columns = db.prepare('PRAGMA table_info(agent_runs)').all().map((column) => column.name);
    assert(columns.includes('function_slug') && columns.includes('function_overridden'));
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
  } finally {
    db.close();
  }
});

test('usuário troca CLI e modelo de uma função padrão, mas não o nome nem apaga', (t) => {
  const store = fixture(t).open();
  const revisar = store.getFunctionBySlug('revisar');
  const updated = store.updateFunction({ id: revisar.id, expectedVersion: revisar.version, adapterId: 'opencode', model: 'nvidia/minimaxai/minimax-m3.1-flash', description: 'Revisa com calma.' });
  assert.equal(updated.adapterId, 'opencode');
  assert.equal(updated.model, 'nvidia/minimaxai/minimax-m3.1-flash');
  assert.equal(updated.description, 'Revisa com calma.');
  assert.equal(updated.version, revisar.version + 1);
  assert.throws(() => store.updateFunction({ id: updated.id, expectedVersion: updated.version, name: 'Auditar' }), /nome das funções padrão é fixo/);
  assert.throws(() => store.deleteFunction({ id: updated.id, expectedVersion: updated.version }), /não podem ser apagados/);
  const orquestrador = store.getFunctionBySlug('orquestrador');
  assert.throws(() => store.deleteFunction({ id: orquestrador.id, expectedVersion: orquestrador.version }), /não podem ser apagados/);
  // Voltar a "não configurada" é permitido.
  const cleared = store.updateFunction({ id: updated.id, expectedVersion: updated.version, adapterId: null, model: null });
  assert.equal(cleared.adapterId, null);
  assert.equal(cleared.model, null);
});

test('versão desatualizada não sobrescreve a função', (t) => {
  const store = fixture(t).open();
  const planejar = store.getFunctionBySlug('planejar');
  store.updateFunction({ id: planejar.id, expectedVersion: planejar.version, adapterId: 'kimi-code', model: 'kimi-k2' });
  assert.throws(() => store.updateFunction({ id: planejar.id, expectedVersion: planejar.version, adapterId: 'opencode' }), /mudou desde que foi aberta/);
  assert.equal(store.getFunctionBySlug('planejar').adapterId, 'kimi-code');
});

test('funções do usuário: criar, validar, limite e apagar', (t) => {
  const store = fixture(t).open();
  const docs = store.createFunction({ slug: 'documentar', name: 'Documentar', description: 'Escreve docs.', adapterId: 'opencode', model: 'openai/gpt-x' });
  assert.equal(docs.kind, 'custom');
  assert.equal(docs.position, 6);
  assert.throws(() => store.createFunction({ slug: 'revisar', name: 'Outra' }), /Já existe uma função com o identificador revisar/);
  assert.throws(() => store.createFunction({ slug: 'orquestrador', name: 'Outra' }), /Já existe/);
  assert.throws(() => store.createFunction({ slug: 'Com Espaço', name: 'X' }), /Identificador/);
  assert.throws(() => store.createFunction({ slug: 'x', name: 'X' }), /Identificador/);
  assert.throws(() => store.createFunction({ slug: 'oculto', name: 'Nome\u202Eoculto' }), /formatação invisível/);
  assert.throws(() => store.createFunction({ slug: 'sem-cli', name: 'Sem CLI', model: 'openai/gpt-x' }), /Escolha o CLI antes do modelo/);
  assert.throws(() => store.createFunction({ slug: 'modelo-ruim', name: 'X', adapterId: 'opencode', model: 'modelo; rm -rf' }), /Modelo inválido/);
  // CLI sem modelo vale (CLI que usa a própria configuração).
  assert.equal(store.createFunction({ slug: 'so-cli', name: 'Só CLI', adapterId: 'kimi-code' }).model, null);
  // 5 padrão + 2 já criadas; o Orquestrador não conta.
  for (let index = 7; index < MAX_FUNCTIONS; index += 1) store.createFunction({ slug: `extra-${index}`, name: `Extra ${index}` });
  assert.throws(() => store.createFunction({ slug: 'uma-a-mais', name: 'Uma a mais' }), new RegExp(`Limite de ${MAX_FUNCTIONS}`));
  const deleted = store.deleteFunction({ id: docs.id, expectedVersion: docs.version });
  assert.deepEqual(deleted, { id: docs.id, deleted: true });
  assert.equal(store.getFunctionBySlug('documentar'), null);
  assert.doesNotThrow(() => store.createFunction({ slug: 'uma-a-mais', name: 'Agora cabe' }));
});

test('apagar uma função do usuário não altera runs que a usaram', (t) => {
  const { directory, open } = fixture(t);
  const file = path.join(directory, 'runs.sqlite');
  const store = open(file);
  const custom = store.createFunction({ slug: 'migrar', name: 'Migrar' });
  store.registerProject({ id: 'p', name: 'P', path: '/fixtures/p' });
  const { id: runId } = store.startSession({ id: 's', projectId: 'p', name: 'A', adapterId: 'opencode', cli: 'OpenCode', version: '1', cwd: '/fixtures/p', origin: 'user', createdAt: '2026-10-29T12:00:00.000Z' });
  const db = new DatabaseSync(file, { timeout: 1000 });
  try {
    db.prepare("UPDATE agent_runs SET function_slug = 'migrar', function_overridden = 0 WHERE id = ?").run(runId);
    store.deleteFunction({ id: custom.id, expectedVersion: custom.version });
    assert.equal(db.prepare('SELECT function_slug FROM agent_runs WHERE id = ?').get(runId).function_slug, 'migrar');
    assert.throws(() => db.prepare("UPDATE agent_runs SET function_overridden = 2 WHERE id = ?").run(runId), /CHECK/);
  } finally {
    db.close();
  }
});

test('backup e restauração preservam as funções configuradas', async (t) => {
  const { directory, open } = fixture(t);
  const store = open(path.join(directory, 'origem.sqlite'));
  const testes = store.getFunctionBySlug('testes');
  store.updateFunction({ id: testes.id, expectedVersion: testes.version, adapterId: 'opencode', model: 'nvidia/x' });
  store.createFunction({ slug: 'seguranca', name: 'Segurança', adapterId: 'kimi-code', model: 'kimi-k2' });
  const destination = path.join(directory, 'backup.sqlite');
  await store.backupTo(destination);
  const restored = open(destination);
  assert.deepEqual(
    restored.listFunctions().map(({ slug, adapterId, model }) => ({ slug, adapterId, model })),
    store.listFunctions().map(({ slug, adapterId, model }) => ({ slug, adapterId, model })),
  );
});

test('recomendações: arquivo versionado válido e vazio até o mantenedor preencher', () => {
  const shipped = loadRecommendations();
  assert.equal(typeof shipped.funcoes, 'object');
  for (const [slug, list] of Object.entries(shipped.funcoes)) assert(Array.isArray(list), slug);
});

test('recomendações inválidas falham com mensagem clara', () => {
  const ok = { revisadoEm: '2026-10-29', funcoes: { revisar: [{ adapterId: 'opencode', model: 'a/b', motivo: 'Bom em revisão.' }] } };
  assert.equal(parseRecommendations(JSON.stringify(ok)).funcoes.revisar[0].model, 'a/b');
  const cases = [
    ['{', /ilegíveis/],
    ['[]', /objeto/],
    [JSON.stringify({ ...ok, extra: 1 }), /campo desconhecido extra/],
    [JSON.stringify({ ...ok, revisadoEm: 'ontem' }), /revisadoEm/],
    [JSON.stringify({ ...ok, funcoes: { 'Revisar Tudo': [] } }), /função Revisar Tudo/],
    [JSON.stringify({ ...ok, funcoes: { revisar: [{ adapterId: 'opencode', model: 'a b', motivo: 'x' }] } }), /revisar\[0\]\.model/],
    [JSON.stringify({ ...ok, funcoes: { revisar: [{ adapterId: 'opencode', model: 'a/b', motivo: '' }] } }), /revisar\[0\]\.motivo/],
    [JSON.stringify({ ...ok, funcoes: { revisar: [{ adapterId: 'opencode', model: 'a/b', motivo: 'x', padrao: true }] } }), /campo desconhecido padrao/],
    [JSON.stringify({ ...ok, funcoes: { revisar: Array(6).fill(ok.funcoes.revisar[0]) } }), /até 5 itens/],
  ];
  for (const [raw, pattern] of cases) assert.throws(() => parseRecommendations(raw), pattern, raw);
});

test('recomendação: primeira disponível nos CLIs detectados, nunca um modelo que o usuário não tem', () => {
  const recommendations = parseRecommendations(JSON.stringify({ revisadoEm: null, funcoes: { revisar: [
    { adapterId: 'kimi-code', model: 'kimi-forte', motivo: 'Primeira opção.' },
    { adapterId: 'opencode', model: 'prov/forte', motivo: 'Segunda opção.' },
  ] } }));
  assert.equal(recommendFor(recommendations, 'revisar', { opencode: ['prov/forte', 'prov/fraco'] }).model, 'prov/forte');
  assert.equal(recommendFor(recommendations, 'revisar', { 'kimi-code': ['kimi-forte'], opencode: ['prov/forte'] }).model, 'kimi-forte');
  assert.equal(recommendFor(recommendations, 'revisar', { opencode: ['prov/fraco'] }), null);
  assert.equal(recommendFor(recommendations, 'testes', { opencode: ['prov/forte'] }), null);
});

function hostFixture(t, options = {}) {
  const store = fixture(t).open();
  const handlers = new Map();
  const main = {};
  let changes = 0;
  createAgentFunctionHost({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    store,
    isMainSender: (event) => event.sender === main,
    onChange: () => { changes += 1; },
    ...options,
  });
  const call = (name, request, sender = main) => handlers.get(name)({ sender }, request);
  return { store, call, changes: () => changes };
}

test('host: só a janela principal lê ou altera funções', async (t) => {
  const { call } = hostFixture(t);
  for (const channel of ['agent-function:list', 'agent-function:create', 'agent-function:update', 'agent-function:delete']) {
    await assert.rejects(call(channel, {}, {}), /não autorizada/, channel);
  }
});

test('host: lista com recomendações, cria, edita só campos editáveis e apaga', async (t) => {
  const { call, changes } = hostFixture(t);
  const listed = await call('agent-function:list');
  assert.equal(listed.items.length, 6);
  assert.equal(listed.maxFunctions, MAX_FUNCTIONS);
  assert.equal(listed.recommendationsError, null);
  const created = await call('agent-function:create', { slug: 'dados', name: 'Dados' });
  // Campos fora da lista editável (kind, slug) são ignorados.
  const updated = await call('agent-function:update', { id: created.id, expectedVersion: created.version, kind: 'builtin', slug: 'outro', adapterId: 'opencode', model: 'a/b' });
  assert.equal(updated.kind, 'custom');
  assert.equal(updated.slug, 'dados');
  assert.equal(updated.model, 'a/b');
  await call('agent-function:delete', { id: updated.id, expectedVersion: updated.version });
  assert.equal(changes(), 3);
  await assert.rejects(call('agent-function:create', null), /Pedido inválido/);
});

test('host: arquivo de recomendações inválido não derruba as funções', async (t) => {
  const { call } = hostFixture(t, { loadRecommendations: () => { throw new Error('Recomendações de modelo inválidas: teste.'); } });
  const listed = await call('agent-function:list');
  assert.equal(listed.items.length, 6);
  assert.deepEqual(listed.recommendations.funcoes, {});
  assert.match(listed.recommendationsError, /inválidas/);
});
