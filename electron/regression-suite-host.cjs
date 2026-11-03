const fs = require('node:fs');
const path = require('node:path');
const { waitForCwd } = require('./project-host.cjs');

// Suíte de regressão na janela principal: só o usuário lê e altera a configuração,
// para a suíte e abre o log. Não existe ferramenta MCP equivalente.

// Sugestão só para a raiz do projeto com `scripts.test` no package.json. Nunca é
// gravada sem o usuário escolher "Usar sugestão".
function suggestCommand(projectPath, readFile = fs.readFileSync) {
  try {
    const manifest = JSON.parse(readFile(path.join(projectPath, 'package.json'), 'utf8'));
    return typeof manifest?.scripts?.test === 'string' && manifest.scripts.test.trim() ? 'npm test' : null;
  } catch {
    return null;
  }
}

// O log só abre se o arquivo real estiver dentro da pasta de logs do ATLAS.
function insideLogs(logsDir, logPath) {
  if (typeof logPath !== 'string' || !logPath) return null;
  try {
    const root = fs.realpathSync(logsDir);
    const file = fs.realpathSync(logPath);
    const relative = path.relative(root, file);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? file : null;
  } catch {
    return null;
  }
}

function createRegressionSuiteHost({ ipcMain, projectHost, store, runner, logsDir, shell, isMainSender, onChange = () => {}, readFile }) {
  async function projectForRequest(event, request) {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a acessar a suíte de regressão.');
    if (!request || typeof request !== 'object' || typeof request.cwd !== 'string') throw new Error('Informe uma pasta autorizada.');
    await waitForCwd(projectHost, request.cwd);
    if (!projectHost.isAllowedCwd(request.cwd)) throw new Error('Selecione uma pasta autorizada.');
    const project = projectHost.getProjectForCwd(request.cwd);
    if (!project) throw new Error('Projeto não encontrado para a pasta selecionada.');
    return project;
  }

  function runFor(project, id) {
    const run = typeof id === 'string' && id ? store.getRegressionRun(id) : null;
    if (!run || run.projectId !== project.id) throw new Error('Execução da suíte não encontrada neste projeto.');
    return run;
  }

  ipcMain.handle('regression-suite:get', async (event, request) => {
    const project = await projectForRequest(event, request);
    return { suite: store.getRegressionSuite(project.id), suggestion: suggestCommand(project.path, readFile) };
  });

  ipcMain.handle('regression-suite:set', async (event, request) => {
    const project = await projectForRequest(event, request);
    const { enabled, command, timeoutSeconds, expectedVersion = null } = request;
    const suite = store.setRegressionSuite({ projectId: project.id, enabled, command, timeoutSeconds, expectedVersion });
    onChange(project.id);
    return suite;
  });

  // Inclui o trecho final do log, lido sob demanda.
  ipcMain.handle('regression-run:get', async (event, request) => {
    const project = await projectForRequest(event, request);
    return runFor(project, request.id);
  });

  ipcMain.handle('regression-run:cancel', async (event, request) => {
    const project = await projectForRequest(event, request);
    const run = store.cancelRegressionRun({ projectId: project.id, id: runFor(project, request.id).id });
    runner.cancel(run.id);
    onChange(project.id);
    return run;
  });

  ipcMain.handle('regression-run:open-log', async (event, request) => {
    const project = await projectForRequest(event, request);
    const file = insideLogs(logsDir, runFor(project, request.id).logPath);
    if (!file) throw new Error('O arquivo de log não foi encontrado na pasta de logs do ATLAS.');
    if (request.reveal) {
      shell.showItemInFolder(file);
      return { opened: file };
    }
    const failure = await shell.openPath(file);
    if (failure) throw new Error(`Não foi possível abrir o log: ${failure}`);
    return { opened: file };
  });
}

module.exports = { createRegressionSuiteHost, suggestCommand, insideLogs };
