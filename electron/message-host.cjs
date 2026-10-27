function createMessageHost({ ipcMain, projectHost, store, isMainSender }) {
  async function projectForRequest(event, request) {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a acessar mensagens.');
    if (!request || typeof request !== 'object' || typeof request.cwd !== 'string') throw new Error('Informe uma pasta autorizada.');
    await projectHost.ready;
    if (!projectHost.isAllowedCwd(request.cwd)) throw new Error('Selecione uma pasta autorizada.');
    const project = projectHost.getProjectForCwd(request.cwd);
    if (!project) throw new Error('Projeto não encontrado para a pasta selecionada.');
    return project;
  }

  ipcMain.handle('message:send', async (event, request) => {
    const project = await projectForRequest(event, request);
    return store.sendMessage({
      projectId: project.id,
      fromSessionId: request.fromSessionId,
      toSessionId: request.toSessionId,
      kind: request.kind,
      subject: request.subject,
      body: request.body,
      idempotencyKey: request.idempotencyKey,
    });
  });
  ipcMain.handle('message:list', async (event, request) => {
    const project = await projectForRequest(event, request);
    return { projectId: project.id, items: store.listMessages(project.id) };
  });
  ipcMain.handle('message:mark-read', async (event, request) => {
    const project = await projectForRequest(event, request);
    return store.markMessageRead({ projectId: project.id, messageId: request.messageId, sessionId: request.sessionId });
  });
}

module.exports = { createMessageHost };
