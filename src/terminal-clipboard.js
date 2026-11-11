// Copiar e colar no terminal: decisões puras, testadas em scripts/terminal-clipboard.test.mjs.
// O componente (TerminalView) só liga estas decisões ao xterm e ao clipboard do sistema.

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
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

// "Reescrever": o trecho cru, sem as linhas vazias do fim que o xterm costuma trazer.
export function rewriteSelection(text) {
  return lines(text).map((line) => line.trimEnd()).join('\n');
}

// Caminhos de arquivos (arrastados ou copiados no Explorer) entre aspas, separados por espaço.
export function quotePaths(paths) {
  return (paths || []).filter((item) => typeof item === 'string' && item && !item.includes('"')).map((item) => `"${item}"`).join(' ');
}

// O conteúdo colado não pode fechar a colagem protegida antes da hora.
export function sanitizePaste(text) {
  return String(text ?? '').replaceAll(PASTE_START, '').replaceAll(PASTE_END, '');
}

// Colar sem Enter: com colagem protegida (bracketed paste), quebras de linha ficam dentro do
// trecho e o CLI não envia nada. Sem ela, cada quebra executaria uma linha, então só passa
// texto de uma linha, sem a quebra final.
export function planPaste(text, bracketed) {
  const clean = sanitizePaste(text);
  if (!clean) return { ok: false, reason: 'empty' };
  if (bracketed) return { ok: true, text: clean };
  const single = clean.replace(/\r?\n$/, '');
  if (/[\r\n]/.test(single)) return { ok: false, reason: 'multiline' };
  return { ok: true, text: single };
}

// Sequência enviada ao PTY de outra sessão, no mesmo formato do terminal.paste do xterm.
export function pasteSequence(text, bracketed) {
  const body = sanitizePaste(text).replace(/\r?\n/g, '\r');
  return bracketed ? `${PASTE_START}${body}${PASTE_END}` : body;
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

// Menu de contexto: abre no ponto e vira para a esquerda/para cima quando não cabe.
export function menuPosition({ x, y }, { width, height }, menu) {
  const margin = 6;
  const left = x + menu.width + margin > width ? Math.max(margin, x - menu.width) : x;
  const top = y + menu.height + margin > height ? Math.max(margin, y - menu.height) : y;
  return { left: Math.round(left), top: Math.round(top) };
}

// Posição da barra de seleção: centrada no ponto onde o mouse soltou, acima da primeira linha
// selecionada (`top`) ou, sem espaço, abaixo da última (`bottom`), sem cobrir o trecho nem sair
// do terminal.
export function selectionBarPosition({ x, top, bottom }, { width, height }, bar) {
  const margin = 6;
  const gap = 6;
  const left = Math.min(Math.max(margin, x - bar.width / 2), Math.max(margin, width - bar.width - margin));
  const above = top - bar.height - gap;
  const below = Math.min(bottom + gap, Math.max(margin, height - bar.height - margin));
  return { left: Math.round(left), top: Math.round(above >= margin ? above : below) };
}
