function createTaskHost({ ipcMain, projectHost, store, isMainSender }) {
  async function projectForRequest(event, request) {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a acessar tarefas.');
    if (!request || typeof request !== 'object' || typeof request.cwd !== 'string') throw new Error('Informe uma pasta autorizada.');
    await projectHost.ready;
    if (!projectHost.isAllowedCwd(request.cwd)) throw new Error('Selecione uma pasta autorizada.');
    const project = projectHost.getProjectForCwd(request.cwd);
    if (!project) throw new Error('Projeto não encontrado para a pasta selecionada.');
    return project;
  }

  ipcMain.handle('task:list', async (event, request) => {
    const project = await projectForRequest(event, request);
    return { projectId: project.id, projectName: project.name, items: store.listTasks(project.id) };
  });
  ipcMain.handle('task:create', async (event, request) => {
    const project = await projectForRequest(event, request);
    return store.createTask({ projectId: project.id, title: request.title, description: request.description, acceptance: request.acceptance, idempotencyKey: request.idempotencyKey });
  });
}

module.exports = { createTaskHost };
