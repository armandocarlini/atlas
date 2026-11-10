import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
  characterCount, clipboardKeyAction, copiedLabel, imagePasteKey, menuPosition, pasteFromClipboard,
  pasteSequence, pasteTargets, planPaste, quotePaths, quoteSelection, rewriteSelection, sanitizePaste,
  selectionBarPosition,
} from '../src/terminal-clipboard.js';

const require = createRequire(import.meta.url);
const { MAX_COPY_LENGTH, pathsFromUriList, readPasteContent, registerClipboardChannels, trackBracketedPaste } = require('../electron/terminal-clipboard.cjs');

const key = (key, modifiers = {}) => ({ type: 'keydown', key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...modifiers });

test('Ctrl+C copia com seleção e, sem seleção, continua sendo interrupção', () => {
  assert.equal(clipboardKeyAction(key('c', { ctrlKey: true }), true), 'copy');
  assert.equal(clipboardKeyAction(key('c', { ctrlKey: true }), false), null, 'sem seleção, o xterm envia ^C ao processo');
  assert.equal(clipboardKeyAction(key('C', { ctrlKey: true, shiftKey: true }), false), 'copy', 'Ctrl+Shift+C sempre copia');
  assert.equal(clipboardKeyAction(key('C', { ctrlKey: true, shiftKey: true }), true), 'copy');
});

test('Ctrl+V e Ctrl+Shift+V colam pelo ATLAS; Shift+F10 abre o menu', () => {
  assert.equal(clipboardKeyAction(key('v', { ctrlKey: true }), false), 'paste');
  assert.equal(clipboardKeyAction(key('V', { ctrlKey: true, shiftKey: true }), true), 'paste');
  assert.equal(clipboardKeyAction(key('F10', { shiftKey: true }), false), 'menu');
});

test('a decisão vale para keyup da mesma combinação, para nada dela chegar ao PTY', () => {
  assert.equal(clipboardKeyAction({ ...key('v', { ctrlKey: true }), type: 'keyup' }, false), 'paste');
});

test('combinações que pertencem ao CLI passam direto', () => {
  for (const event of [
    key('v', { altKey: true }), // Alt+V: atalho de imagem do Claude Code no Windows
    key('v', { ctrlKey: true, altKey: true }),
    key('c', { ctrlKey: true, metaKey: true }),
    key('c'),
    key('F10'),
    key('F10', { ctrlKey: true, shiftKey: true }),
    key('x', { ctrlKey: true }),
    null,
  ]) assert.equal(clipboardKeyAction(event, true), null, JSON.stringify(event));
});

test('o aviso conta caracteres, não unidades UTF-16, com número em pt-BR', () => {
  assert.equal(characterCount('ação'), 4);
  assert.equal(characterCount('🙂🙂'), 2);
  assert.equal(characterCount(''), 0);
  assert.equal(copiedLabel(1), '1 caractere copiado');
  assert.equal(copiedLabel(42), '42 caracteres copiados');
  assert.equal(copiedLabel(12345), '12.345 caracteres copiados');
});

test('Responder cita cada linha e termina com uma quebra, sem as linhas vazias do fim', () => {
  assert.equal(quoteSelection('Isso, 2,1833.'), '> Isso, 2,1833.\n');
  assert.equal(quoteSelection('linha 1\r\nlinha 2   \r\n\r\n  \n'), '> linha 1\n> linha 2\n');
  assert.equal(quoteSelection('a\n\nb'), '> a\n>\n> b\n', 'linha vazia no meio continua na citação');
  assert.equal(quoteSelection('   \n\n'), '');
  assert.equal(quoteSelection(''), '');
});

test('Reescrever cola o trecho cru, sem espaços e linhas vazias sobrando no fim', () => {
  assert.equal(rewriteSelection('npm test   \r\nok\r\n\r\n'), 'npm test\nok');
  assert.equal(rewriteSelection('  recuo preservado'), '  recuo preservado');
});

test('caminhos de arquivos vão entre aspas, separados por espaço', () => {
  assert.equal(quotePaths(['C:\\Projetos\\um arquivo.txt', 'C:\\dois.txt']), '"C:\\Projetos\\um arquivo.txt" "C:\\dois.txt"');
  assert.equal(quotePaths(['', null, 'C:\\a"b']), '', 'vazio, não texto e aspas no nome são descartados');
  assert.equal(quotePaths(undefined), '');
});

test('o conteúdo colado não fecha a colagem protegida antes da hora', () => {
  assert.equal(sanitizePaste('a\x1b[201~rm -rf /\r\x1b[200~b'), 'arm -rf /\rb');
  assert.equal(pasteSequence('x\x1b[201~\n', true), '\x1b[200~x\r\x1b[201~');
});

test('colar sem Enter: com colagem protegida, várias linhas ficam dentro do trecho', () => {
  assert.deepEqual(planPaste('> a\n> b\n', true), { ok: true, text: '> a\n> b\n' });
  assert.equal(pasteSequence('> a\n> b\n', true), '\x1b[200~> a\r> b\r\x1b[201~');
});

test('colar sem Enter: sem colagem protegida, só uma linha e sem a quebra final', () => {
  assert.deepEqual(planPaste('> uma linha\n', false), { ok: true, text: '> uma linha' });
  assert.deepEqual(planPaste('a\nb', false), { ok: false, reason: 'multiline' });
  assert.deepEqual(planPaste('a\r\nb\r\n', false), { ok: false, reason: 'multiline' });
  assert.deepEqual(planPaste('', true), { ok: false, reason: 'empty' });
  assert.equal(pasteSequence('uma linha', false), 'uma linha');
});

test('do clipboard: arquivos antes de texto; só imagem repassa ao CLI o atalho de colar imagem', () => {
  assert.deepEqual(pasteFromClipboard({ files: ['C:\\a b.png'], text: 'ignorado', image: true }), { kind: 'text', text: '"C:\\a b.png"' });
  assert.deepEqual(pasteFromClipboard({ files: [], text: 'log\r\nlinha 2', image: false }), { kind: 'text', text: 'log\r\nlinha 2' });
  // Windows: Alt+V (ESC v), o atalho com que o Claude Code anexa imagem; ^V cru ele ignora.
  assert.deepEqual(pasteFromClipboard({ files: [], text: '', image: true }, 'win32'), { kind: 'forward', data: '\x1bv' });
  assert.deepEqual(pasteFromClipboard({ files: [], text: '', image: true }, 'linux'), { kind: 'forward', data: '\x16' });
  assert.equal(imagePasteKey(undefined), '\x16');
  assert.deepEqual(pasteFromClipboard({ files: [], text: '', image: false }), { kind: 'none' });
  assert.deepEqual(pasteFromClipboard(null), { kind: 'none' });
});

test('destinos de "Enviar para": só sessões com processo vivo, nomeadas como no cabeçalho', () => {
  const functions = { items: [{ slug: 'revisor', name: 'Revisor' }] };
  const targets = pasteTargets([
    { id: 'p', ptyId: 'pty-p', roleKind: 'orchestrator', name: 'Principal ATLAS', cli: 'Claude Code' },
    { id: 'r', ptyId: 'pty-r', roleKind: 'agent', functionSlug: 'revisor', name: 'Agente 2', cli: 'Codex' },
    { id: 's', ptyId: 'pty-s', roleKind: 'terminal', name: 'PowerShell', cli: 'pwsh' },
    { id: 'x', ptyId: 'pty-x', exited: true, name: 'Encerrada' },
    { id: 'h', ptyId: null, archived: true, name: 'Histórico' },
    { id: 'd', ptyId: 'pty-d', demo: true, name: 'Demonstração' },
  ], functions);
  assert.deepEqual(targets, [
    { id: 'p', ptyId: 'pty-p', name: 'Principal', detail: 'Principal ATLAS · Claude Code' },
    { id: 'r', ptyId: 'pty-r', name: 'Revisor', detail: 'Agente 2 · Codex' },
    { id: 's', ptyId: 'pty-s', name: 'PowerShell', detail: 'PowerShell · pwsh' },
  ]);
  assert.deepEqual(pasteTargets(undefined, undefined), []);
});

test('a barra fica acima da seleção, sem cobrir o trecho nem sair do terminal', () => {
  const area = { width: 600, height: 300 };
  const bar = { width: 240, height: 32 };
  // Seleção das linhas 120–160: a barra termina 6px acima da primeira.
  assert.deepEqual(selectionBarPosition({ x: 300, top: 120, bottom: 160 }, area, bar), { left: 180, top: 82 });
  assert.deepEqual(selectionBarPosition({ x: 10, top: 120, bottom: 160 }, area, bar), { left: 6, top: 82 }, 'não sai pela esquerda');
  assert.deepEqual(selectionBarPosition({ x: 590, top: 120, bottom: 160 }, area, bar), { left: 354, top: 82 }, 'não sai pela direita');
  assert.deepEqual(selectionBarPosition({ x: 300, top: 20, bottom: 60 }, area, bar), { left: 180, top: 66 }, 'sem espaço acima, vai abaixo da última linha');
  assert.deepEqual(selectionBarPosition({ x: 300, top: 10, bottom: 290 }, area, bar), { left: 180, top: 262 }, 'seleção da tela toda: dentro do terminal');
});

test('o menu de contexto vira para caber no terminal', () => {
  const area = { width: 600, height: 300 };
  const menu = { width: 210, height: 120 };
  assert.deepEqual(menuPosition({ x: 40, y: 30 }, area, menu), { left: 40, top: 30 });
  assert.deepEqual(menuPosition({ x: 500, y: 250 }, area, menu), { left: 290, top: 130 });
});

test('colagem protegida: acompanha liga/desliga do modo 2004, mesmo partido entre chunks', () => {
  let state = { enabled: false, tail: '' };
  state = trackBracketedPaste(state, 'prompt \x1b[?2004h');
  assert.equal(state.enabled, true);
  state = trackBracketedPaste(state, 'saída qualquer');
  assert.equal(state.enabled, true, 'sequência antiga no resto do chunk não é reaplicada');
  state = trackBracketedPaste(state, 'fim \x1b[?20');
  assert.equal(state.enabled, true);
  state = trackBracketedPaste(state, '04l');
  assert.equal(state.enabled, false, 'sequência partida entre dois chunks');
  state = trackBracketedPaste(state, '\x1b[?1004;2004h\x1b[?25l');
  assert.equal(state.enabled, true, 'vários modos na mesma sequência');
  state = trackBracketedPaste(state, '\x1b[?1049l\x1b[?20045l');
  assert.equal(state.enabled, true, 'outros modos não mexem na colagem protegida');
  assert.ok(state.tail.length <= 32);
});

test('lista de arquivos do Explorer (text/uri-list) vira caminhos locais', () => {
  const list = 'file:///C:/Projetos/Ana/um%20arquivo.txt\r\nfile:///C:/dois.txt\r\n# comentário\r\nhttps://exemplo.com/x\r\n';
  assert.deepEqual(pathsFromUriList(list, 'win32'), ['C:\\Projetos\\Ana\\um arquivo.txt', 'C:\\dois.txt']);
  assert.deepEqual(pathsFromUriList('file:///home/ana/a%20b.txt', 'linux'), ['/home/ana/a b.txt']);
  assert.deepEqual(pathsFromUriList('', 'win32'), []);
  assert.deepEqual(pathsFromUriList('file://servidor/compartilhado/x.txt', 'linux'), [], 'caminho de outro host não vira caminho local');
});

function fakeClipboard({ text = '', items = [] } = {}) {
  const written = [];
  return {
    written,
    readText: async () => text,
    writeText: async (value) => { written.push(value); },
    read: async () => items.map((entry) => ({
      types: Object.keys(entry),
      getType: async (type) => ({ text: async () => entry[type] }),
    })),
  };
}

test('o processo principal lê arquivos, depois texto, depois só avisa que há imagem', async () => {
  const files = fakeClipboard({ items: [{ 'text/uri-list': 'file:///C:/a.txt\r\nfile:///C:/b%20c.txt' }] });
  const expected = process.platform === 'win32' ? ['C:\\a.txt', 'C:\\b c.txt'] : ['/C:/a.txt', '/C:/b c.txt'];
  assert.deepEqual(await readPasteContent(files), { files: expected, text: '', image: false });
  assert.deepEqual(await readPasteContent(fakeClipboard({ text: 'linha 1\r\nlinha 2', items: [{ 'text/plain': 'x' }] })), { files: [], text: 'linha 1\r\nlinha 2', image: false });
  assert.deepEqual(await readPasteContent(fakeClipboard({ items: [{ 'image/png': 'png' }] })), { files: [], text: '', image: true });
  assert.deepEqual(await readPasteContent(fakeClipboard()), { files: [], text: '', image: false });
});

test('só janelas do ATLAS usam o clipboard, e só texto válido é gravado', async () => {
  const handlers = new Map();
  const clipboard = fakeClipboard({ text: 'ok' });
  registerClipboardChannels({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, clipboard, isAllowedSender: (event) => event.allowed });
  const read = handlers.get('clipboard:read-paste');
  const write = handlers.get('clipboard:write-text');
  await assert.rejects(read({ allowed: false }), /não autorizada/);
  await assert.rejects(write({ allowed: false }, 'x'), /não autorizada/);
  assert.equal((await read({ allowed: true })).text, 'ok');
  for (const value of ['', 12, null, { text: 'x' }, 'x'.repeat(MAX_COPY_LENGTH + 1)]) assert.equal(await write({ allowed: true }, value), false);
  assert.equal(await write({ allowed: true }, 'log copiado'), true);
  assert.deepEqual(clipboard.written, ['log copiado']);
});

test('fiação: preload expõe só leitura para colar, gravação de texto e caminho de arquivo', () => {
  const preload = fs.readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  assert.match(preload, /readClipboardForPaste: \(\) => ipcRenderer\.invoke\('clipboard:read-paste'\)/);
  assert.match(preload, /writeClipboardText: \(text\) => ipcRenderer\.invoke\('clipboard:write-text', text\)/);
  assert.match(preload, /webUtils\.getPathForFile\(file\)/);
  assert.match(preload, /getTerminalInputMode: \(terminalId\) => ipcRenderer\.invoke\('terminal:input-mode', terminalId\)/);
  const main = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /registerClipboardChannels\(\{[\s\S]*isAllowedSender: \(event\) => terminalHost\.isMainSender\(event\) \|\| Boolean\(getPopupEntry\(event\.sender\)\)/);
  const view = fs.readFileSync(new URL('../src/TerminalView.jsx', import.meta.url), 'utf8');
  assert.match(view, /rightClickSelectsWord: false/, 'botão direito não troca a seleção por uma palavra');
  assert.match(view, /attachCustomKeyEventHandler/);
});

test('terminal:input-mode informa a colagem protegida só a quem pode escrever naquele terminal', () => {
  // O transporte carrega o node-pty nativo; o canal não precisa dele.
  const ptyPath = require.resolve('node-pty');
  const cached = require.cache[ptyPath];
  require.cache[ptyPath] = { id: ptyPath, filename: ptyPath, loaded: true, exports: {} };
  try {
    delete require.cache[require.resolve('../electron/pty-transport.cjs')];
    const { registerTransportChannels } = require('../electron/pty-transport.cjs');
    const handlers = new Map();
    const records = new Map([
      ['vivo', { bracketedPaste: { enabled: true, tail: '' }, exit: null, closing: false }],
      ['sem-modo', { bracketedPaste: { enabled: false, tail: '' }, exit: null, closing: false }],
      ['fim', { bracketedPaste: { enabled: true, tail: '' }, exit: { exitCode: 0 }, closing: false }],
    ]);
    registerTransportChannels({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), on: () => {} },
      transport: { get: (id) => records.get(id) },
      isMainSender: (event) => event.main,
      getPopupPtyId: (sender) => sender.pty,
      onStop: () => {},
    });
    const mode = handlers.get('terminal:input-mode');
    const main = { main: true, sender: {} };
    assert.deepEqual(mode(main, 'vivo'), { bracketedPaste: true });
    assert.deepEqual(mode(main, 'sem-modo'), { bracketedPaste: false });
    assert.equal(mode(main, 'fim'), null, 'terminal encerrado não recebe colagem');
    assert.equal(mode(main, 'inexistente'), null);
    assert.deepEqual(mode({ main: false, sender: { pty: 'vivo' } }, 'vivo'), { bracketedPaste: true }, 'pop-up do próprio terminal');
    assert.equal(mode({ main: false, sender: { pty: 'vivo' } }, 'sem-modo'), null, 'pop-up não alcança outra sessão');
  } finally {
    if (cached) require.cache[ptyPath] = cached;
    else delete require.cache[ptyPath];
    delete require.cache[require.resolve('../electron/pty-transport.cjs')];
  }
});
