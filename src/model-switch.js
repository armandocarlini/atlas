// Troca de modelo dentro do CLI (v0.2). O usuário troca no terminal do agente; o
// ATLAS só orienta e registra o modelo que ele informar. Nada é digitado no terminal.

// Passos verificados nos próprios CLIs (Kimi Code 2.3.3/2.4.0, OpenCode 1.18.21).
const STEPS = {
  'kimi-code': {
    command: '/model',
    steps: ['No terminal da sessão, digite /model e escolha o modelo.', 'Confirme com Alt+S para trocar só nesta sessão.'],
    warning: 'Enter também troca, mas grava o modelo como padrão no seu config.toml do Kimi.',
    note: 'Se a sessão já tem conversa, o Kimi pergunta se deve compactar o histórico para o modelo novo.',
  },
  opencode: {
    command: '/models',
    steps: ['No terminal da sessão, digite /models e escolha o modelo.', 'F2 alterna entre os modelos usados recentemente.'],
    warning: null,
    note: 'O modelo novo vale para as próximas mensagens da mesma conversa.',
  },
};

export function switchInstructions(adapterId) {
  return STEPS[adapterId] || { command: null, steps: ['Use o comando de troca de modelo do próprio CLI, no terminal da sessão.'], warning: null, note: null };
}

// Modelo atual mostrado no card: o informado pelo usuário, ou o de início.
export function modelLabel(session) {
  if (session.currentModel && session.currentModel !== session.model) return `${session.currentModel} (informado por você; iniciou com ${session.model || 'o modelo da configuração do CLI'})`;
  return session.model || '';
}

// Principal: só onde o perfil somente leitura foi verificado depois da troca.
const ORCHESTRATOR_VERIFIED = new Set(['opencode']);

export function canSwitch(session) {
  if (session.archived || session.exited) return { allowed: false, reason: 'A sessão não está em execução.' };
  if (session.roleKind === 'orchestrator' && !ORCHESTRATOR_VERIFIED.has(session.adapterId)) {
    return { allowed: false, reason: 'Ainda não verificamos se a principal continua somente leitura depois de trocar o modelo neste CLI.' };
  }
  return { allowed: true, reason: '' };
}
