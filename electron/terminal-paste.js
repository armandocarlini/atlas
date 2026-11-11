const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

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
