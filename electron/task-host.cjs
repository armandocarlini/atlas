const gitEvidence = require('./git-evidence.cjs');

function createTaskHost({ ipcMain, projectHost, store, isMainSender, onChange = () => {}, collectGitEvidence = gitEvidence.collectGitEvidence }) {
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
    return { projectId: project.id, projectName: project.name, items: store.listTasks(project.id), handoffs: store.listHandoffs(project.id), reviews: store.listReviews(project.id), evidence: store.listEvidence(project.id) };
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
  // Só o usuário decide a revisão: aceitar conclui a tarefa, pedir ajustes devolve ao responsável.
  ipcMain.handle('task:review-decide', async (event, request) => {
    const project = await projectForRequest(event, request);
    const reviewId = requireId(request.reviewId, 'Revisão');
    let currentGit;
    if (request.decision === 'accept') {
      const review = store.getReview(project.id, reviewId);
      const worktree = review && store.listWorktrees(project.id).find((item) => item.taskId === review.taskId);
      if (worktree) {
        try {
          currentGit = await collectGitEvidence(worktree);
        } catch (error) {
          currentGit = gitEvidence.unavailableEvidence(error, worktree.path);
        }
      }
    }
    const result = store.decideReview({ projectId: project.id, reviewId, decision: request.decision, note: request.note, currentGit });
    onChange(project.id);
    return result;
  });
  ipcMain.handle('task:release', async (event, request) => {
    const project = await projectForRequest(event, request);
    const task = store.releaseTask({ projectId: project.id, taskId: requireId(request.taskId, 'Tarefa'), actor: 'user' });
    onChange(project.id);
    return task;
  });
}

module.exports = { createTaskHost };
