import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const library = path.dirname(require.resolve('node-pty/lib/windowsTerminal.js'));
const { patchNodePty, PATCHES } = require('./patch-node-pty.cjs');

function loadVendor(file, overrides = {}) {
  const filename = path.join(library, file);
  const nativeRequire = createRequire(filename);
  const exports = {};
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { exports, require: (name) => overrides[name] || nativeRequire(name), process, console, setTimeout, clearTimeout, Buffer, __dirname: library }, { filename });
  return exports;
}

function fixture({ conpty = true } = {}) {
  const Agent = loadVendor('windowsPtyAgent.js').WindowsPtyAgent;
  const socket = new EventEmitter();
  socket.destroy = () => {};
  socket.end = () => {};
  function FakeAgent() {
    this._outSocket = socket;
    this._inSocket = socket;
    this._useConpty = conpty;
    this._useConptyDll = true;
    this._innerPid = 123;
  }
  FakeAgent.prototype = Object.create(Agent.prototype);
  const Terminal = loadVendor('windowsTerminal.js', { './windowsPtyAgent': { WindowsPtyAgent: FakeAgent } }).WindowsTerminal;
  const terminal = new Terminal('fixture.exe', [], { env: {} });
  socket.emit('ready_datapipe');
  const sequence = [];
  terminal.onData((data) => sequence.push(data));
  terminal.onExit((event) => sequence.push(event.exitCode));
  return { socket, terminal, sequence, nativeExit: (code) => Agent.prototype._$onProcessExit.call(terminal._agent, code) };
}

test('ConPTY: socket fecha antes do callback nativo sem emitir saída indefinida', () => {
  const { socket, sequence, nativeExit } = fixture();
  socket.emit('data', 'última saída');
  socket.emit('close');
  assert.deepEqual(sequence, ['última saída']);
  nativeExit(0);
  assert.deepEqual(sequence, ['última saída', 0]);
  nativeExit(0);
  assert.deepEqual(sequence, ['última saída', 0]);
});

test('ConPTY: callback primeiro preserva drenagem até fechar socket, inclusive erro', () => {
  const { socket, sequence, nativeExit } = fixture();
  nativeExit(7);
  assert.deepEqual(sequence, []);
  socket.emit('data', 'saída final');
  socket.emit('close');
  assert.deepEqual(sequence, ['saída final', 7]);
});

test('ConPTY sem confirmação aguarda código nativo', () => {
  const { socket, sequence } = fixture();
  socket.emit('close');
  assert.deepEqual(sequence, []);
});

test('WinPTY não aguarda callback que esse backend não oferece', () => {
  const { socket, terminal, sequence } = fixture({ conpty: false });
  Object.defineProperty(terminal._agent, 'exitCode', { value: undefined });
  socket.emit('close');
  assert.deepEqual(sequence, [undefined]);
});

test('patch instalado tem hashes esperados; aplicação é idempotente e recusa conteúdo desconhecido sem escrita parcial', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-pty-patch-'));
  t.after(() => {
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert(path.basename(resolved).startsWith('atlas-pty-patch-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(directory, 'lib'));
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ version: '1.1.0' }));
  for (const patch of PATCHES) {
    const installed = fs.readFileSync(path.join(library, patch.file), 'utf8');
    assert.equal(createHash('sha256').update(installed).digest('hex'), patch.patchedHash);
    fs.writeFileSync(path.join(directory, 'lib', patch.file), installed.replace(patch.after, patch.before));
  }
  const firstPath = path.join(directory, 'lib', PATCHES[0].file);
  const secondPath = path.join(directory, 'lib', PATCHES[1].file);
  const originalFirst = fs.readFileSync(firstPath, 'utf8');
  const originalSecond = fs.readFileSync(secondPath, 'utf8');
  fs.appendFileSync(secondPath, '\n// unexpected vendor change');
  assert.throws(() => patchNodePty(directory), /inesperado/);
  assert.equal(fs.readFileSync(firstPath, 'utf8'), originalFirst);
  fs.writeFileSync(secondPath, originalSecond);
  patchNodePty(directory);
  const patched = fs.readFileSync(firstPath, 'utf8');
  patchNodePty(directory);
  assert.equal(fs.readFileSync(firstPath, 'utf8'), patched);
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ version: '1.2.0' }));
  assert.throws(() => patchNodePty(directory), /Revisão do patch/);
  assert.equal(fs.readFileSync(firstPath, 'utf8'), patched);
});
