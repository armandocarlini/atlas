const { MAX_FUNCTIONS } = require('./agent-functions.cjs');
const modelRecommendations = require('./model-recommendations.cjs');

// Funções de agente na janela principal: listar, criar, editar e apagar as do
// usuário. Só preenchem a escolha de CLI e modelo; nada é iniciado aqui.
function createAgentFunctionHost({ ipcMain, store, isMainSender, onChange = () => {}, loadRecommendations = modelRecommendations.loadRecommendations }) {
  // Um arquivo de recomendações inválido não derruba as funções: a interface mostra
  // o erro e segue sem recomendação.
  let recommendations = { revisadoEm: null, funcoes: {} };
  let recommendationsError = null;
  try {
    recommendations = loadRecommendations();
  } catch (error) {
    recommendationsError = error.message;
  }

  function requireMain(event) {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a acessar funções de agente.');
  }

  function payload(request) {
    if (!request || typeof request !== 'object') throw new Error('Pedido inválido.');
    return request;
  }

  ipcMain.handle('agent-function:list', async (event) => {
    requireMain(event);
    return { items: store.listFunctions(), maxFunctions: MAX_FUNCTIONS, recommendations, recommendationsError };
  });

  ipcMain.handle('agent-function:create', async (event, request) => {
    requireMain(event);
    const { slug, name, description, adapterId, model } = payload(request);
    const created = store.createFunction({ slug, name, description, adapterId, model });
    onChange();
    return created;
  });

  ipcMain.handle('agent-function:update', async (event, request) => {
    requireMain(event);
    const { id, expectedVersion, ...rest } = payload(request);
    // Só os campos editáveis passam adiante.
    const changes = Object.fromEntries(['name', 'description', 'adapterId', 'model'].filter((key) => key in rest).map((key) => [key, rest[key]]));
    const updated = store.updateFunction({ id, expectedVersion, ...changes });
    onChange();
    return updated;
  });

  ipcMain.handle('agent-function:delete', async (event, request) => {
    requireMain(event);
    const { id, expectedVersion } = payload(request);
    const deleted = store.deleteFunction({ id, expectedVersion });
    onChange();
    return deleted;
  });
}

module.exports = { createAgentFunctionHost };
