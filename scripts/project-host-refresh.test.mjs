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
