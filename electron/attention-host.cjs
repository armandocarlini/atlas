// IPC da fila "Precisam de mim" (docs/planos/PLANO_GESTAO_DE_ATENCAO.md). Só a janela
// principal lê e altera; só entram projetos em pastas autorizadas. A ponte MCP não vê a fila.
const MAX_TIMER_MS = 6 * 60 * 60 * 1000;

function createAttentionHost({ ipcMain, projectHost, store, isMainSender, autoNoteFor = () => null, onChange = () => {}, setTimer = setTimeout, clearTimer = clearTimeout, clock = () => Date.now() }) {
  let timer = null;

  function requireMain(event) {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a acessar a fila de atenção.');
  }

  function projectIds() {
    return store.listProjects().filter((project) => projectHost.isAllowedCwd(project.path)).map((project) => project.id);
  }

  function requireRequest(request, fields) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Pedido inválido para a fila de atenção.');
    for (const field of fields) {
      if (typeof request[field] !== 'string' || !request[field] || request[field].length > 160) throw new Error(`Campo inválido: ${field}.`);
    }
    return request;
  }

  // Um adiamento que vence ou um pedido que expira muda a fila sem nenhuma escrita: o
  // renderer é avisado no horário. Prazos longos são revistos a cada 6 h.
  function schedule(nextChangeAt) {
    if (timer) clearTimer(timer);
    timer = null;
    if (!nextChangeAt) return;
    const delay = Math.min(Math.max(Date.parse(nextChangeAt) - clock(), 0) + 50, MAX_TIMER_MS);
    timer = setTimer(() => {
      timer = null;
      try {
        refresh();
        onChange();
      } catch (error) {
        console.error('Não foi possível atualizar a fila de atenção:', error);
      }
    }, delay);
    timer?.unref?.();
  }

  function refresh() {
    const { nextChangeAt, ...view } = store.listAttention({ projectIds: projectIds(), autoNoteFor });
    schedule(nextChangeAt);
    return view;
  }

  ipcMain.handle('attention:list', (event) => {
    requireMain(event);
    return refresh();
  });

  ipcMain.handle('attention:snooze', (event, request) => {
    requireMain(event);
    const { itemId, until } = requireRequest(request, ['itemId', 'until']);
    const result = store.snoozeAttention({ itemId, until, projectIds: projectIds(), autoNoteFor });
    if (result.changed) {
      refresh();
      onChange();
    }
    return result;
  });

  ipcMain.handle('attention:dismiss', (event, request) => {
    requireMain(event);
    const { itemId } = requireRequest(request, ['itemId']);
    const result = store.dismissAttention({ itemId, projectIds: projectIds(), autoNoteFor });
    if (result.changed) onChange();
    return result;
  });

  return {
    refresh,
    dispose() {
      if (timer) clearTimer(timer);
      timer = null;
    },
  };
}

module.exports = { createAttentionHost };
