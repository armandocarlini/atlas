import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { test } from 'node:test';
import completion from './smoke-completion.cjs';

test('saída incompleta, forçada ou não zero não pode aprovar um diagnóstico', () => {
  const clean = { exited: true, code: 0, forced: false };
  assert.doesNotThrow(() => completion.assertCleanExit(clean));
  for (const invalid of [{ exited: false }, { forced: true }, { code: 1 }]) {
    assert.throws(() => completion.assertCleanExit({ ...clean, ...invalid }));
  }
});

test('chamada tardia ao provedor grava falha em vez de JSON de sucesso', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-smoke-completion-'));
  t.after(() => {
    const target = fs.realpathSync.native(root);
    assert.equal(path.dirname(target).toLowerCase(), fs.realpathSync.native(os.tmpdir()).toLowerCase());
    assert(path.basename(target).startsWith('atlas-smoke-completion-'));
    fs.rmSync(target, { recursive: true, force: true });
  });
  let requests = 0;
  const server = createServer((_request, response) => { requests += 1; response.end('fixture'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await (await fetch(`http://127.0.0.1:${server.address().port}`)).text();
  } finally { await new Promise(resolve => server.close(resolve)); }
  const file = path.join(root, 'result.json');
  assert.throws(() => completion.publishSmokeResult(file, { passed: true }, requests), /provedor/);
  const result = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(result.passed, false);
  assert.match(result.error, /provedor/);
  assert.throws(() => completion.publishSmokeResult(file, { passed: false, error: 'falha original' }, requests));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).originalError, 'falha original');
});
