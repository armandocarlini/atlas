// Copiar e colar no terminal: decisões puras, testadas em scripts/terminal-clipboard.test.mjs.
// O componente (TerminalView) só liga estas decisões ao xterm e ao clipboard do sistema.

export { pasteSequence, planPaste, sanitizePaste } from '../electron/terminal-paste.js';
// Só imagem no clipboard: o ATLAS repassa ao CLI o atalho de colar imagem, e o próprio CLI lê o
// clipboard e anexa. No Windows o Claude Code só anexa com Alt+V (ESC v); com ^V cru ele não faz
// nada (verificado no Claude Code real, com configuração isolada). ESC v não vai a mais ninguém:
// no PowerShell (PSReadLine) ele digita um "v". Os outros recebem o ^V, como num terminal comum.
const CTRL_V = '\x16';
const ALT_V = '\x1bv';
export function imagePasteKey({ platform, cli } = {}) {
  return platform === 'win32' && cli === 'claude' ? ALT_V : CTRL_V;
}

const countFormat = new Intl.NumberFormat('pt-BR');

function lines(text) {
  const all = String(text ?? '').split(/\r?\n/);
  while (all.length && !all[all.length - 1].trim()) all.pop();
  return all;
}

// Ctrl+C só interrompe sem seleção; com seleção, copia. Ctrl+Shift+C sempre copia.
// Ctrl+V e Ctrl+Shift+V colam pelo ATLAS. Shift+F10 abre o menu de contexto, como no Windows.
// F6 com seleção leva às ações do trecho (no Windows, F6 alterna entre áreas); sem seleção,
// F6 continua indo para o programa.
// Vale para keydown, keypress e keyup: nenhum evento de uma combinação do ATLAS chega ao PTY.
export function clipboardKeyAction(event, hasSelection) {
  if (!event || event.altKey || event.metaKey) return null;
  const key = String(event.key || '').toLowerCase();
  if (event.ctrlKey && key === 'c') return event.shiftKey || hasSelection ? 'copy' : null;
  if (event.ctrlKey && key === 'v') return 'paste';
  if (!event.ctrlKey && event.shiftKey && key === 'f10') return 'menu';
  if (!event.ctrlKey && !event.shiftKey && key === 'f6' && hasSelection) return 'bar';
  return null;
}

// Aviso de foco do terminal (modo 1004): ESC [ I ao ganhar e ESC [ O ao perder o foco.
export const isFocusReport = (data) => data === '\x1b[I' || data === '\x1b[O';

// Movimento por teclado numa barra de ferramentas: setas e Home/End, circulando.
export function toolbarFocusIndex(key, index, count) {
  if (!count) return null;
  const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: count - 1 }[key];
  return next === undefined ? null : (next + count) % count;
}

export function copiedLabel(count) {
  return count === 1 ? '1 caractere copiado' : `${countFormat.format(count)} caracteres copiados`;
}

export function characterCount(text) {
  return [...String(text ?? '')].length;
}

// "Responder": cada linha vira citação e termina com uma quebra, para a resposta começar abaixo.
export function quoteSelection(text) {
  const quoted = lines(text).map((line) => (line.trim() ? `> ${line.trimEnd()}` : '>'));
  return quoted.length ? `${quoted.join('\n')}\n` : '';
}

// "Reescrever" não tem função própria: cola exatamente o que terminal.getSelection() devolve.

// CLI da sessão pelo nome que o ATLAS mostra ("Claude Code", "Codex", "PowerShell"...). Decide o
// atalho de imagem repassado no Ctrl+V; nome desconhecido conta como shell.
const CLI_KINDS = ['claude', 'codex', 'kimi', 'gemini', 'opencode'];
export function terminalCli(name) {
  const value = String(name || '').toLowerCase();
  return CLI_KINDS.find((kind) => value.includes(kind)) || 'shell';
}

// Caminhos de arquivos (arrastados ou copiados no Explorer), como literais de PowerShell. O
// terminal local do ATLAS é Windows PowerShell: aspas duplas expandiriam $, ` e subexpressões.
// Aspas simples preservam o caminho e uma aspa simples interna é representada por duas delas.
export function quotePaths(paths) {
  return (paths || []).filter((item) => typeof item === 'string' && item && !item.includes('"')).map((item) => `'${item.replaceAll("'", "''")}'`).join(' ');
}

// O que fazer com o conteúdo do clipboard lido pelo processo principal.
export function pasteFromClipboard(content, context) {
  const files = Array.isArray(content?.files) ? content.files : [];
  if (files.length) {
    const text = quotePaths(files);
    if (text) return { kind: 'text', text };
  }
  if (typeof content?.text === 'string' && content.text) return { kind: 'text', text: content.text };
  if (content?.image) return { kind: 'forward', data: imagePasteKey(context) };
  return { kind: 'none' };
}

// Sessões abertas que recebem um trecho: as outras com processo vivo, nomeadas como no cabeçalho.
export function pasteTargets(sessions, functions) {
  const names = new Map((functions?.items || []).map((item) => [item.slug, item.name]));
  return (sessions || [])
    .filter((session) => session.ptyId && !session.exited && !session.archived && !session.demo)
    .map((session) => ({
      id: session.id,
      ptyId: session.ptyId,
      name: session.roleKind === 'orchestrator' ? 'Principal' : names.get(session.functionSlug) || session.name,
      detail: [session.name, session.cli].filter(Boolean).join(' · '),
    }));
}

const FLOAT_MARGIN = 6;

function clampFloatingOffset(offset, length, available) {
  const last = Math.max(FLOAT_MARGIN, available - length - FLOAT_MARGIN);
  return Math.round(Math.min(Math.max(FLOAT_MARGIN, offset), last));
}

function pointerOffset(offset, length, available) {
  const preferred = offset + length + FLOAT_MARGIN > available ? offset - length : offset;
  return clampFloatingOffset(preferred, length, available);
}

// O menu abre junto ao ponto e vira para a esquerda ou para cima quando falta espaço.
export function menuPosition({ x, y }, { width, height }, menu) {
  return { left: pointerOffset(x, menu.width, width), top: pointerOffset(y, menu.height, height) };
}

// A barra fica centrada na seleção, acima da primeira linha ou abaixo da última.
export function selectionBarPosition({ x, top, bottom }, { width, height }, bar) {
  const gap = 6;
  const above = top - bar.height - gap;
  return {
    left: clampFloatingOffset(x - bar.width / 2, bar.width, width),
    top: clampFloatingOffset(above >= FLOAT_MARGIN ? above : bottom + gap, bar.height, height),
  };
}

export function sendMenuPosition({ right, top, bottom }, { width, height }, menu) {
  const gap = 4;
  const above = top - gap - FLOAT_MARGIN;
  const below = height - bottom - gap - FLOAT_MARGIN;
  const opensBelow = below >= menu.height || below >= above;
  const maxHeight = Math.floor(opensBelow ? below : above);
  const left = clampFloatingOffset(right - menu.width, menu.width, width);

  // Se nem a primeira opção couber perto da barra, a lista pode ocupar o terminal.
  if (maxHeight < menu.minHeight) return { left, top: clampFloatingOffset(top, menu.height, height) };
  const visibleHeight = Math.min(menu.height, maxHeight);
  return { left, top: Math.round(opensBelow ? bottom + gap : top - gap - visibleHeight), maxHeight };
}
