// Ícones dos CLIs: marcas oficiais publicadas pelo Simple Icons 16.37.0 (CC0 1.0,
// https://simpleicons.org). As marcas pertencem aos seus donos e aparecem só para
// identificar o CLI de cada sessão, na cor oficial; as monocromáticas seguem a tinta do tema.
// O Codex não tem marca publicada lá e usa um ícone neutro.
export const CLI_MARKS = {
  "claude-code": { title: "Claude Code", color: "#d97757", source: "simple-icons/claudecode", path: "M21 10.5h3v3h-3v3h-1.5v3H18v-3h-1.5v3H15v-3H9v3H7.5v-3H6v3H4.5v-3H3v-3H0v-3h3v-6h18Zm-15 0h1.5v-3H6Zm10.5 0H18v-3h-1.5z" },
  "gemini": { title: "Gemini", color: "#8e75b2", source: "simple-icons/googlegemini", path: "M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81" },
  "kimi-code": { title: "Kimi Code", color: null, source: "simple-icons/kimi", path: "M21.765.351C22.998.351 24 1.353 24 2.586S22.998 4.82 21.765 4.82h-1.974c-.15 0-.26-.12-.26-.26V2.586A2.237 2.237 0 0 1 21.765.35M9.41 13.388l8.447-8.377c.16-.16.07-.471-.14-.471h-4.55s-.1.02-.14.06l-9.099 9.029c-.14.14-.35.02-.35-.21V4.81c0-.15-.1-.27-.221-.27H.22c-.12 0-.22.12-.22.27v18.57c0 .15.1.27.22.27h3.137c.12 0 .22-.12.22-.27v-3.79c0-.08.03-.16.08-.21l2.826-2.796c.07-.07.16-.08.241-.03l7.546 5.551a8.9 8.9 0 0 0 4.018 1.493c.12.01.23-.11.23-.27V19.76c0-.14-.08-.25-.19-.26a5.8 5.8 0 0 1-2.355-.942l-6.533-4.73c-.14-.09-.15-.32-.03-.441" },
  "opencode": { title: "OpenCode", color: null, source: "simple-icons/opencode", path: "M22 24H2V0h20zM17 4.8H7v14.4h10z" },
};

const BY_NAME = [[/claude/i, 'claude-code'], [/gemini/i, 'gemini'], [/kimi/i, 'kimi-code'], [/opencode/i, 'opencode'], [/codex/i, 'codex']];

// Qual ícone a sessão mostra: o CLI do adaptador (ou, no histórico antigo, pelo nome do CLI),
// 'terminal' para o PowerShell sem agente e 'agent' para um CLI desconhecido.
export function cliMarkId(session) {
  if (!session) return 'agent';
  if (session.origin === 'terminal') return 'terminal';
  if (session.adapterId && (CLI_MARKS[session.adapterId] || session.adapterId === 'codex')) return session.adapterId;
  const name = typeof session.cli === 'string' ? session.cli : '';
  if (/powershell|pwsh/i.test(name)) return 'terminal';
  return BY_NAME.find(([pattern]) => pattern.test(name))?.[1] || 'agent';
}

// Estado mostrado no selo do ícone. O texto do estado continua ao lado, para não depender de cor.
export function sessionTone(session, hidden = false) {
  if (hidden) return 'hidden';
  if (session?.archived || session?.exited) return 'ended';
  return 'active';
}
