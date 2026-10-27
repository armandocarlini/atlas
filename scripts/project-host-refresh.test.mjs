import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createProjectHost } = require('../electron/project-host.cjs');

test('regressão: refresh com varredura em andamento faz uma nova varredura completa', async (t) => {
  const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-refresh-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'projeto');
  fs.mkdirSync(root);
  const userData = path.join(directory, 'user-data');
  fs.mkdirSync(userData);
  fs.writeFileSync(path.join(userData, 'atlas-projects.json'), JSON.stringify({ roots: [root] }));
  const scans = [];
  const sender = {};
  const handlers = new Map();
  const host = createProjectHost({
    app: { getPath: () => userData },
    dialog: {},
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    getMainWindow: () => ({ isDestroyed: () => false, webContents: sender }),
    store: { registerProject: (project) => scans.push(project.path) },
  });
  await host.ready;
  const before = scans.filter((item) => item === root).length;
  // Varredura iniciada pela interface antes da mudança no disco.
  const earlier = handlers.get('project:refresh')({ sender });
  await new Promise((resolve) => setImmediate(resolve));
  await host.refresh();
  await earlier;
  assert.equal(scans.filter((item) => item === root).length - before, 2, 'refresh não pode devolver a varredura que já estava em andamento');
});

// Descoberta controlada: cada raiz só termina quando o teste libera.
function gatedDiscovery(gated) {
  const gates = new Map();
  const calls = [];
  const discover = (root) => {
    // Raízes fora do teste (como a pasta atual do processo) terminam na hora.
    if (!gated.includes(root)) return Promise.resolve({ repositories: [], errors: [], truncated: false });
    calls.push(root);
    return new Promise((resolve) => {
      const list = gates.get(root) || [];
      list.push(() => resolve({ repositories: [{ id: `repo-${calls.length}`, name: path.basename(root), worktrees: [{ path: root, branch: 'main', status: {} }] }], errors: [], truncated: false }));
      gates.set(root, list);
    });
  };
  // Espera a varredura daquela raiz começar e a libera.
  const release = async (root, which = 'oldest') => {
    for (let i = 0; i < 50 && !gates.get(root)?.length; i += 1) await new Promise((resolve) => setImmediate(resolve));
    const next = which === 'newest' ? gates.get(root)?.pop() : gates.get(root)?.shift();
    if (!next) throw new Error(`sem varredura pendente em ${root}`);
    next();
  };
  return { discover, release, calls };
}

function slowFixture(t) {
  const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-lento-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const rapido = path.join(directory, 'rapido');
  const lento = path.join(directory, 'lento');
  fs.mkdirSync(rapido);
  fs.mkdirSync(lento);
  const userData = path.join(directory, 'user-data');
  fs.mkdirSync(userData);
  fs.writeFileSync(path.join(userData, 'atlas-projects.json'), JSON.stringify({ roots: [rapido, lento] }));
  const gated = gatedDiscovery([rapido, lento]);
  const changes = [];
  const handlers = new Map();
  const sender = {};
  const host = createProjectHost({
    app: { getPath: () => userData },
    dialog: {},
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    getMainWindow: () => ({ isDestroyed: () => false, webContents: sender }),
    store: null,
    onChange: (project) => changes.push(project.path),
    discover: gated.discover,
  });
  return { host, handlers, sender, rapido, lento, changes, ...gated };
}

const settled = async (promise) => {
  let done = false;
  promise.then(() => { done = true; }, () => { done = true; });
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  return done;
};

test('regressão: a lista de projetos não espera a varredura Git de todos', async (t) => {
  const { host, handlers, sender, rapido, lento, changes, release } = slowFixture(t);
  await host.rootsReady;
  const listed = await handlers.get('project:list')({ sender });
  assert.deepEqual(listed.map((project) => [project.path, project.scanning]).filter(([item]) => item === rapido || item === lento), [[rapido, true], [lento, true]], 'projetos publicados antes da varredura');
  assert.equal(await settled(host.ready), false, 'varredura inicial ainda em andamento');
  await release(rapido);
  await new Promise((resolve) => setImmediate(resolve));
  assert(changes.includes(rapido), 'projeto pronto avisa a interface');
  assert.equal(host.getProjects().find((project) => project.path === rapido).scanning, false);
  await release(lento);
  await host.ready;
  assert(changes.includes(lento));
});

test('regressão: um projeto pronto não espera o projeto lento', async (t) => {
  const { host, rapido, lento, release } = slowFixture(t);
  await host.rootsReady;
  const rapidoPronto = host.readyFor(path.join(rapido, 'src'));
  const lentoPronto = host.readyFor(lento);
  const foraDasRaizes = host.readyFor(path.join(path.dirname(rapido), 'outra-pasta'));
  await release(rapido);
  assert.equal(await settled(rapidoPronto), true, 'pasta do projeto rápido liberada');
  assert.equal(await settled(lentoPronto), false);
  assert.equal(await settled(foraDasRaizes), false, 'fora das raízes espera a varredura completa');
  await release(lento);
  assert.equal(await settled(lentoPronto), true);
  assert.equal(await settled(foraDasRaizes), true);
});

test('regressão: revarrer um projeto não revarre os outros e resultado antigo não sobrescreve o novo', async (t) => {
  const { host, rapido, lento, calls, release } = slowFixture(t);
  await host.rootsReady;
  await release(rapido);
  await release(lento);
  await host.ready;
  const before = calls.length;
  // Uma varredura de tudo começa (resultado antigo) e, depois, só o projeto rápido é revarrido.
  const full = host.refresh();
  for (let i = 0; i < 50 && calls.length < before + 2; i += 1) await new Promise((resolve) => setImmediate(resolve));
  const single = host.refreshRoot(rapido);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.slice(before), [rapido, lento, rapido], 'refreshRoot varre só a raiz pedida');
  await release(rapido, 'newest'); // a mais nova (refreshRoot) termina primeiro
  await single;
  const fresh = host.getProjects().find((project) => project.path === rapido).repositories[0].id;
  await release(rapido); // a antiga termina depois
  await release(lento);
  await full;
  assert.equal(host.getProjects().find((project) => project.path === rapido).repositories[0].id, fresh, 'varredura antiga descartada');
  await assert.rejects(host.refreshRoot(path.join(rapido, '..', 'fora')), /fora das pastas autorizadas/);
});
