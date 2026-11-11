const { fileURLToPath } = require('node:url');

// Clipboard do sistema para os terminais do ATLAS. O renderer não acessa o clipboard direto:
// pede ao processo principal só o que a colagem e a cópia precisam.
const MAX_COPY_LENGTH = 8 * 1024 * 1024;
const MODE_TAIL = 32;

// Colagem protegida (bracketed paste, modo DEC 2004): o programa no PTY liga e desliga pela
// saída. Guardamos o estado para colar em outra sessão sem que uma quebra de linha vire Enter.
// `tail` cobre a sequência partida entre dois chunks.
function trackBracketedPaste(state, chunk) {
  const text = `${state.tail}${chunk}`;
  let enabled = state.enabled;
  for (const match of text.matchAll(/\x1bc|(?:\x1b\[|\x9b)(?:!p|\?([\d;]+)([hl]))/g)) {
    // Sequência inteira no resto do chunk anterior: já foi contada.
    if (match.index + match[0].length <= state.tail.length) continue;
    if (!match[1]) enabled = false;
    else if (match[1].split(';').some((mode) => Number(mode) === 2004)) enabled = match[2] === 'h';
  }
  return { enabled, tail: text.slice(-MODE_TAIL) };
}

// Explorer (CF_HDROP) chega como text/uri-list: um file:/// por linha. Só caminhos locais.
function pathsFromUriList(list, platform = process.platform) {
  return String(list || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && /^file:\/\//i.test(line))
    .map((line) => {
      try {
        return fileURLToPath(line, { windows: platform === 'win32' });
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// Arquivos têm prioridade (o Explorer não põe texto junto); depois texto; por fim, se há
// imagem, só avisa: quem lê a imagem é o próprio CLI, quando recebe o atalho.
async function readPasteContent(clipboard) {
  const items = await clipboard.read();
  const types = new Set(items.flatMap((item) => item.types || []));
  if (types.has('text/uri-list')) {
    const item = items.find((entry) => entry.types.includes('text/uri-list'));
    const files = pathsFromUriList(await (await item.getType('text/uri-list')).text());
    if (files.length) return { files, text: '', image: false };
  }
  const text = await clipboard.readText();
  if (text) return { files: [], text, image: false };
  return { files: [], text: '', image: [...types].some((type) => type.startsWith('image/')) };
}

function registerClipboardChannels({ ipcMain, clipboard, isAllowedSender }) {
  ipcMain.handle('clipboard:read-paste', async (event) => {
    if (!isAllowedSender(event)) throw new Error('Janela não autorizada a ler o clipboard.');
    return readPasteContent(clipboard);
  });
  ipcMain.handle('clipboard:write-text', async (event, text) => {
    if (!isAllowedSender(event)) throw new Error('Janela não autorizada a gravar no clipboard.');
    if (typeof text !== 'string' || !text || text.length > MAX_COPY_LENGTH) return false;
    await clipboard.writeText(text);
    return true;
  });
}

module.exports = { MAX_COPY_LENGTH, pathsFromUriList, trackBracketedPaste, readPasteContent, registerClipboardChannels };
