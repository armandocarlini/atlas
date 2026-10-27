function createTaskHost({ ipcMain, projectHost, store, isMainSender, onChange = () => {} }) {
  async function projectForRequest(event, request) {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a acessar tarefas.');
    if (!request || typeof request !== 'object' || typeof request.cwd !== 'string') throw new Error('Informe uma pasta autorizada.');
    await projectHost.ready;
    if (!projectHost.isAllowedCwd(request.cwd)) throw new Error('Selecione uma pasta autorizada.');
    const project = projectHost.getProjectForCwd(request.cwd);
    if (!project) throw new Error('Projeto não encontrado para a pasta selecionada.');
    return project;
  }

  function requireId(value, label) {
    if (typeof value !== 'string' || !value) throw new Error(`${label} inválido.`);
    return value;
  }

  ipcMain.handle('task:list', async (event, request) => {
    const project = await projectForRequest(event, request);
    return { projectId: project.id, projectName: project.name, items: store.listTasks(project.id), handoffs: store.listHandoffs(project.id) };
  });
  ipcMain.handle('task:create', async (event, request) => {
    const project = await projectForRequest(event, request);
    return store.createTask({ projectId: project.id, title: request.title, description: request.description, acceptance: request.acceptance, idempotencyKey: request.idempotencyKey });
  });
  // Decisões do usuário sobre a delegação: cancelar uma oferta aberta ou devolver
  // a tarefa para `ready`, invalidando o claim do responsável atual.
  ipcMain.handle('task:cancel-handoff', async (event, request) => {
    const project = await projectForRequest(event, request);
    const handoff = store.cancelHandoff({ projectId: project.id, handoffId: requireId(request.handoffId, 'Handoff'), actor: 'user' });
    onChange(project.id);
    return handoff;
  });
  ipcMain.handle('task:release', async (event, request) => {
    const project = await projectForRequest(event, request);
    const task = store.releaseTask({ projectId: project.id, taskId: requireId(request.taskId, 'Tarefa'), actor: 'user' });
    onChange(project.id);
    return task;
  });
}

module.exports = { createTaskHost };
