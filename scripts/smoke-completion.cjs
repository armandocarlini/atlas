const assert = require('node:assert/strict');
const fs = require('node:fs');

function assertCleanExit({ exited, code, forced }) {
  assert.equal(exited, true, 'O CLI precisa encerrar antes de aprovar o smoke.');
  assert.equal(forced, false, 'Encerramento forçado não comprova saída limpa.');
  assert.equal(code, 0, 'O CLI precisa sair com código zero.');
}

// Chamado só após encerrar processos, fechar o provedor e verificar a fixture.
// Uma chamada tardia ao provedor nunca deixa um artefato de sucesso.
function publishSmokeResult(filename, result, modelRequests) {
  const error = modelRequests === 0 ? null : new Error('O smoke consultou o provedor fictício.');
  const outcome = error ? { ...result, passed: false, error: error.message, ...(result.error ? { originalError: result.error } : {}) } : result;
  fs.writeFileSync(filename, JSON.stringify(outcome, null, 2));
  if (error) throw error;
}

module.exports = { assertCleanExit, publishSmokeResult };
