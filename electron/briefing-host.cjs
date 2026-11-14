const { buildBriefing } = require('./briefing.cjs');
const { pasteSequence, planPaste, sanitizePaste } = require('./terminal-paste.js');

const ID = /^[a-z0-9_-]{1,160}$/i;
const UNCERTAIN = 'Não foi possível confirmar o envio. Confira o terminal antes de tentar novamente.';

function createBriefingHost({ ipcMain, store, projectHost, agentHost, terminalHost, transport, readAttention }) {
  function requireMain(event) {
    if (!terminalHost.isMainSender(event)) throw new Error('Janela não autorizada a acessar o Briefing.');
  }

  function activeTerminal(sessionId, projectId, runId) {
    const agent = agentHost.getAgent(sessionId);
    if (agent?.state !== 'running' || agent.projectId !== projectId || agent.runId !== runId || agent.external) return null;
    const terminal = transport.get(agent.ptyId);
    if (terminal?.meta?.kind !== 'agent' || terminal.meta.agentId !== sessionId || terminal.exit || terminal.closing) return null;
    return terminal;
  }

  ipcMain.handle('briefing:get', (event) => {
    requireMain(event);
    const attention = readAttention();
    const { events, sessions, principalProjectIds } = store.briefingSources(attention.projects.map(({ projectId }) => projectId), attention.lastVisitAt);
    const functions = new Map(store.listFunctions().map(({ slug, name }) => [slug, name]));
    const live = new Map();
    for (const row of sessions) {
      let session = live.get(row.id);
      if (!session) {
        if (!projectHost.isAllowedCwd(row.cwd)) continue;
        const agent = agentHost.getAgent(row.id);
        const external = row.attachment === 'external' && agent?.state === 'running' && agent.runId === row.runId;
        const terminal = activeTerminal(row.id, row.projectId, row.runId);
        if (!external && !terminal) continue;
        session = { ...row, external, terminalId: terminal?.id, functionName: functions.get(row.functionSlug) ?? row.functionSlug, tasks: [] };
        live.set(row.id, session);
      }
      if (row.taskId) session.tasks.push({ id: row.taskId, title: row.taskTitle });
    }
    return { ...attention, briefing: buildBriefing({ ...attention, events, sessions: [...live.values()], principalProjectIds }) };
  });

  ipcMain.handle('briefing:send', (event, request) => {
    requireMain(event);
    const { projectId, sessionId, text, idempotencyKey } = request ?? {};
    if (![projectId, sessionId, idempotencyKey].every((value) => typeof value === 'string' && ID.test(value))) {
      throw new Error('Projeto, sessão ou chave de envio inválida.');
    }
    const project = store.listProjects().find(({ id }) => id === projectId);
    if (!project || !projectHost.isAllowedCwd(project.path)) throw new Error('O projeto não está autorizado.');
    if (typeof text !== 'string') throw new Error('Escreva uma mensagem para enviar.');
    if (text.length > 8000 || Array.from(text).length > 4000) throw new Error('A mensagem deve ter até 4000 caracteres.');
    const clean = sanitizePaste(text).replace(/\r\n?/g, '\n')
      .replace(/[\p{Cc}\p{Cf}]/gu, (character) => ['\n', '\u200c', '\u200d'].includes(character) ? character : '');
    if (!clean.trim()) throw new Error('Escreva uma mensagem para enviar.');
    const previous = store.getBriefingReceipt(projectId, idempotencyKey);
    if (previous) {
      const { sent, ...receipt } = previous;
      if (receipt.sessionId !== sessionId) throw new Error('A chave de envio já foi usada com outro destino.');
      if (!sent) throw new Error(UNCERTAIN);
      return receipt;
    }

    const session = store.getSession(sessionId);
    if (!session && terminalHost.hasSession(sessionId)) throw new Error('Um terminal PowerShell comum não recebe mensagens do Briefing.');
    if (!session || session.removed_at) throw new Error('A sessão foi excluída ou não existe.');
    if (session.project_id !== projectId) throw new Error('A sessão pertence a outro projeto.');
    if (!['orchestrator', 'agent'].includes(session.role)) throw new Error('O destino precisa ser uma sessão de agente.');
    if (!projectHost.isAllowedCwd(session.cwd)) throw new Error('A pasta da sessão não está autorizada.');
    if (session.attachment === 'external') throw new Error('A sessão externa não tem terminal no ATLAS para receber a mensagem.');
    const agent = agentHost.getAgent(session.id);
    const run = agent?.runId ? store.getBriefingRun(agent.runId) : null;
    if (run?.state !== 'running' || run.session_id !== session.id) throw new Error('A sessão está encerrada.');
    const terminal = activeTerminal(session.id, projectId, run.id);
    if (!terminal) throw new Error('O terminal da sessão não está disponível.');
    const bracketed = Boolean(terminal.bracketedPaste?.enabled);
    const plan = planPaste(clean, bracketed);
    if (!plan.ok) throw new Error('O terminal está sem colagem protegida. Envie uma única linha.');

    // A reserva persiste antes de escrever. Depois de uma queda ou escrita parcial,
    // a mesma chave não repete a entrada num PTY cujo resultado é desconhecido.
    const receipt = store.reserveBriefingSend({ projectId, sessionId, runId: run.id, length: Array.from(plan.text).length, key: idempotencyKey });
    try {
      terminal.process.write(pasteSequence(plan.text, bracketed));
      terminal.process.write('\r');
      store.confirmBriefingSend(projectId, idempotencyKey);
    } catch {
      throw new Error(UNCERTAIN);
    }
    return receipt;
  });
}

module.exports = { createBriefingHost };
