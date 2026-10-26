const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

// node-pty 1.1.0 can close the ConPTY output pipe before the native exit callback.
// Keep this driver fix version/hash-bound; remove it when upstream fixes ordering.
const PATCHES = [{
  file: 'windowsPtyAgent.js',
  originalHash: '8636d16b38266112204061a22b135734177c242837982fd3a4055be726efa64a',
  patchedHash: '064477902515e6edf4b556f1208c5930d659829a5ac0cd25692fd9ea687d6745',
  before: '        this._exitCode = exitCode;\n        if (!this._useConptyDll) {',
  after: '        this._exitCode = exitCode;\n        this._outSocket.emit(\'atlas_native_exit\', exitCode);\n        if (!this._useConptyDll) {',
}, {
  file: 'windowsTerminal.js',
  originalHash: 'c3a65716f53fed0135a8a633373d5f9c2ab092544d651f27ef0a67096dd3bcd9',
  patchedHash: 'af5037727c7f79c76ff12bef67b61203c7d76ce4e91eb399b983c143c36b40fb',
  before: `            _this._socket.on('close', function () {
                _this.emit('exit', _this._agent.exitCode);
                _this._close();
            });`,
  after: `            _this._socket.on('close', function () {
                var emitConfirmedExit = function () {
                    _this.emit('exit', _this._agent.exitCode);
                    _this._close();
                };
                if (_this._agent._useConpty && _this._agent.exitCode === undefined) {
                    _this._socket.once('atlas_native_exit', emitConfirmedExit);
                } else {
                    emitConfirmedExit();
                }
            });`,
}];

const hash = (content) => createHash('sha256').update(content).digest('hex');

function patchNodePty(packageDirectory = path.dirname(require.resolve('node-pty/package.json'))) {
  const metadata = JSON.parse(fs.readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'));
  if (metadata.version !== '1.1.0') throw new Error('Revisão do patch ConPTY exigida para esta versão de node-pty.');
  // Validate every file before writing any. Unknown upstream content must fail closed.
  const plans = PATCHES.map((patch) => {
    const filename = path.join(packageDirectory, 'lib', patch.file);
    const content = fs.readFileSync(filename, 'utf8');
    if (hash(content) === patch.patchedHash) return null;
    if (hash(content) !== patch.originalHash || content.split(patch.before).length !== 2) throw new Error(`Conteúdo node-pty inesperado: ${patch.file}. Revise o patch ConPTY.`);
    const updated = content.replace(patch.before, patch.after);
    if (hash(updated) !== patch.patchedHash) throw new Error(`Hash do patch ConPTY inválido: ${patch.file}.`);
    return { filename, updated };
  });
  for (const plan of plans.filter(Boolean)) fs.writeFileSync(plan.filename, plan.updated);
}

if (require.main === module) {
  patchNodePty();
  console.log('PASS node-pty 1.1.0: ordem de saída ConPTY verificada por SHA-256');
}
module.exports = { patchNodePty, PATCHES };
