import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const config = require('../electron/kimi-mcp-config.cjs');

function harness(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-kimi-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const entry = config.atlasEntry({ execPath: '/opt/atlas/electron', bridgePath: '/opt/atlas/electron/atlas-mcp-bridge.cjs' });
  const file = path.join(home, 'mcp.json');
  return { home, entry, file, read: () => JSON.parse(fs.readFileSync(file, 'utf8')), write: (value) => fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)) };
}

const leftovers = (home) => fs.readdirSync(home).filter((name) => name.endsWith('.tmp'));

test('home segue KIMI_CODE_HOME e cai para ~/.kimi-code', () => {
  assert.equal(config.kimiHome({ KIMI_CODE_HOME: '/isolado' }), '/isolado');
  assert.equal(config.kimiHome({}), path.join(os.homedir(), '.kimi-code'));
});

test('sem arquivo: estado absent e instalação cria somente a entrada atlas', (t) => {
  const { home, entry, read } = harness(t);
  assert.equal(config.getStatus({ home, entry }).state, 'absent');
  const status = config.install({ home, entry });
  assert.equal(status.state, 'installed');
  assert.deepEqual(read(), { mcpServers: { atlas: entry } });
  assert.deepEqual(entry.env, { ELECTRON_RUN_AS_NODE: '1' });
  assert.deepEqual(leftovers(home), []);
});

test('instalação preserva outros servidores e campos e é idempotente', (t) => {
  const { home, entry, read, write, file } = harness(t);
  write({ mcpServers: { github: { url: 'https://example.invalid/mcp', enabledTools: ['a'] } }, extra: { keep: true } });
  config.install({ home, entry });
  const before = fs.readFileSync(file, 'utf8');
  assert.equal(config.install({ home, entry }).state, 'installed');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(read(), { mcpServers: { github: { url: 'https://example.invalid/mcp', enabledTools: ['a'] }, atlas: entry }, extra: { keep: true } });
});

test('entrada própria com outro caminho fica outdated e a reinstalação atualiza', (t) => {
  const { home, entry, write, read } = harness(t);
  write({ mcpServers: { atlas: config.atlasEntry({ execPath: '/antigo/electron', bridgePath: '/antigo/atlas-mcp-bridge.cjs' }) } });
  assert.equal(config.getStatus({ home, entry }).state, 'outdated');
  assert.equal(config.install({ home, entry }).state, 'installed');
  assert.deepEqual(read().mcpServers.atlas, entry);
});

test('entrada atlas alheia é conflito e nunca é sobrescrita nem removida', (t) => {
  const { home, entry, write, file } = harness(t);
  write({ mcpServers: { atlas: { command: 'outro-servidor', args: ['--x'] } } });
  const original = fs.readFileSync(file, 'utf8');
  assert.equal(config.getStatus({ home, entry }).state, 'conflict');
  assert.throws(() => config.install({ home, entry }), /não foi criado pelo ATLAS/);
  assert.throws(() => config.remove({ home, entry }), /não foi criado pelo ATLAS/);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('JSON inválido, raiz não objeto e mcpServers inválido não são reescritos', (t) => {
  const { home, entry, write, file } = harness(t);
  for (const content of ['{ invalido', '[]', '{"mcpServers": []}', '{"mcpServers": "x"}']) {
    write(content);
    const status = config.getStatus({ home, entry });
    assert.equal(status.state, 'invalid', content);
    assert.throws(() => config.install({ home, entry }));
    assert.equal(fs.readFileSync(file, 'utf8'), content);
  }
  assert.deepEqual(leftovers(home), []);
});

test('BOM UTF-8 é aceito na leitura', (t) => {
  const { home, entry, write } = harness(t);
  write(`﻿${JSON.stringify({ mcpServers: {} })}`);
  assert.equal(config.install({ home, entry }).state, 'installed');
});

test('remoção apaga só a entrada do ATLAS e preserva o restante', (t) => {
  const { home, entry, write, read } = harness(t);
  write({ mcpServers: { github: { command: 'gh-mcp' } } });
  config.install({ home, entry });
  assert.equal(config.remove({ home, entry }).state, 'absent');
  assert.deepEqual(read(), { mcpServers: { github: { command: 'gh-mcp' } } });
  assert.equal(config.remove({ home, entry }).state, 'absent');
  assert.deepEqual(leftovers(home), []);
});

test('falha de escrita não deixa temporário nem altera o original', (t) => {
  const { home, entry, write, file } = harness(t);
  write({ mcpServers: {} });
  const original = fs.readFileSync(file, 'utf8');
  const rename = fs.renameSync;
  fs.renameSync = () => { throw new Error('disco cheio simulado'); };
  try {
    assert.throws(() => config.install({ home, entry }), /disco cheio simulado/);
  } finally {
    fs.renameSync = rename;
  }
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.deepEqual(leftovers(home), []);
});

test('mcp.json mantido como link é atualizado no destino resolvido, sem substituir o link', (t) => {
  const { home, entry } = harness(t);
  const realDirectory = path.join(home, 'dotfiles');
  fs.mkdirSync(realDirectory);
  const realFile = path.join(realDirectory, 'mcp.json');
  const linkFile = path.join(home, 'mcp.json');
  fs.writeFileSync(realFile, JSON.stringify({ mcpServers: { github: { command: 'gh-mcp' } } }));
  fs.writeFileSync(linkFile, fs.readFileSync(realFile));
  const realpath = fs.realpathSync;
  // Simula o link sem exigir privilégio de symlink no Windows.
  fs.realpathSync = (target, ...rest) => (path.resolve(target) === path.resolve(linkFile) ? realFile : realpath(target, ...rest));
  try {
    config.install({ home, entry });
  } finally {
    fs.realpathSync = realpath;
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(realFile, 'utf8')).mcpServers.atlas, entry);
  assert.deepEqual(JSON.parse(fs.readFileSync(linkFile, 'utf8')), { mcpServers: { github: { command: 'gh-mcp' } } }, 'o caminho do link não foi substituído por arquivo comum');
  assert.deepEqual(fs.readdirSync(realDirectory).filter((name) => name.endsWith('.tmp')), []);
});
