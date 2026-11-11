import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { ChevronDown, Forward, PenLine, Reply } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import { createPtyResizer, isLayoutResizing, onLayoutResizing } from './pty-resize.js';
import './terminal-clipboard.css';
import {
  characterCount, clipboardKeyAction, copiedLabel, menuPosition, pasteFromClipboard, pasteSequence,
  isFocusReport, planPaste, quotePaths, quoteSelection, sanitizePaste, selectionBarPosition,
  toolbarFocusIndex,
} from './terminal-clipboard.js';

const NOTICE_MS = 1800;
// Aviso com ação fica mais tempo, para dar tempo de ler e escolher.
const ACTION_NOTICE_MS = 7000;
// Sem colagem protegida (o Windows PowerShell não tem), cada linha viraria um comando. Nenhum
// substituto é seguro para qualquer programa, então o ATLAS recusa e oferece copiar o trecho.
const multilineRefused = (where) => `Não colado: ${where} executaria cada linha, porque não está em colagem protegida. Copie o trecho (Copiar ou Ctrl+C) e cole onde aceite várias linhas.`;

function useLatest(value) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

// Posiciona um elemento flutuante pelo tamanho real dele, sem sair do terminal.
function useFloating(anchor, place) {
  const ref = useRef(null);
  const [position, setPosition] = useState(null);
  useLayoutEffect(() => {
    if (!anchor || !ref.current) {
      setPosition(null);
      return;
    }
    const box = ref.current.getBoundingClientRect();
    // A âncora traz o ponto (x, y) e o tamanho do terminal (width, height).
    setPosition(place(anchor, anchor, { width: box.width, height: box.height }));
  }, [anchor]);
  const style = position ? { left: position.left, top: position.top } : { left: 0, top: 0, visibility: 'hidden' };
  return [ref, style];
}

// Menu de contexto e lista de sessões: setas, Home/End, Escape e Tab, como um menu do Windows.
function MenuList({ menuRef, label, items, className, style, onClose, autoFocus = true }) {
  const listRef = useRef(null);
  // O menu nasce invisível enquanto é medido; só dá para focar depois de posicionado.
  const placed = style?.visibility !== 'hidden';
  useEffect(() => {
    if (autoFocus && placed) listRef.current?.querySelector('[role="menuitem"]:not([disabled])')?.focus();
  }, [autoFocus, placed]);

  function onKeyDown(event) {
    const enabled = [...listRef.current.querySelectorAll('[role="menuitem"]:not([disabled])')];
    const index = enabled.indexOf(document.activeElement);
    const move = { ArrowDown: index + 1, ArrowUp: index < 0 ? enabled.length - 1 : index - 1, Home: 0, End: enabled.length - 1 }[event.key];
    if (move !== undefined) {
      event.preventDefault();
      enabled[(move + enabled.length) % enabled.length]?.focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }

  return <div
    ref={(node) => { listRef.current = node; if (menuRef) menuRef.current = node; }}
    role="menu"
    aria-label={label}
    className={className}
    style={style}
    onKeyDown={onKeyDown}
    onMouseDown={(event) => event.preventDefault()}
    onClick={(event) => event.stopPropagation()}
  >
    {items.map((item) => item.separator
      ? <div key={item.key} role="separator" className="terminal-menu-separator" />
      : <button key={item.key} type="button" role="menuitem" className="terminal-menu-item" disabled={item.disabled} title={item.title} onClick={() => { onClose(); item.run(); }}>
        <span>{item.label}</span>{item.shortcut && <kbd aria-hidden="true">{item.shortcut}</kbd>}
      </button>)}
  </div>;
}

export default function TerminalView({ terminalId, desktop, theme, onExit, pasteTargets = [], cli = 'shell' }) {
  const shellRef = useRef(null);
  const containerRef = useRef(null);
  const terminalRef = useRef(null);
  const actionsRef = useRef({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [bar, setBar] = useState(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [menu, setMenu] = useState(null);
  const [dropping, setDropping] = useState(false);
  const targets = pasteTargets.filter((target) => target.ptyId !== terminalId);
  const onExitRef = useLatest(onExit);
  const cliRef = useLatest(cli);
  const [barRef, barStyle] = useFloating(bar, selectionBarPosition);
  const [menuRef, menuStyle] = useFloating(menu, menuPosition);

  useEffect(() => {
    const container = containerRef.current;
    const shell = shellRef.current;
    if (!container || !desktop?.isDesktop || !terminalId) return undefined;

    let disposed = false;
    let attached = false;
    let cursor = 0;
    let frame = null;
    let noticeTimer = null;
    let selectingWithMouse = false;
    const pending = [];
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 5000,
      screenReaderMode: true,
      // O botão direito abre o menu sem trocar a seleção atual por uma palavra.
      rightClickSelectsWord: false,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminalRef.current = terminal;

    const announce = (text, action = null) => {
      clearTimeout(noticeTimer);
      setNotice({ text, action, key: Date.now() });
      noticeTimer = setTimeout(() => { if (!disposed) setNotice(null); }, action ? ACTION_NOTICE_MS : NOTICE_MS);
    };
    const hideBar = () => {
      setBar(null);
      setSendOpen(false);
    };
    const area = () => {
      const rect = shell.getBoundingClientRect();
      return { rect, width: rect.width, height: rect.height };
    };
    const pointerPoint = (clientX, clientY) => {
      const { rect, width, height } = area();
      return { x: clientX - rect.left, y: clientY - rect.top, width, height };
    };
    // Linhas da seleção em pixels, para a barra não cobrir o trecho selecionado.
    const selectionAnchor = (point) => {
      const range = terminal.getSelectionPosition();
      const screen = container.querySelector('.xterm-screen');
      if (!range || !screen || !terminal.rows) return { ...point, top: point.y, bottom: point.y };
      const box = screen.getBoundingClientRect();
      const offset = box.top - area().rect.top;
      const cell = box.height / terminal.rows;
      const first = Math.max(0, range.start.y - terminal.buffer.active.viewportY);
      const last = Math.min(terminal.rows - 1, range.end.y - terminal.buffer.active.viewportY);
      return { ...point, top: offset + first * cell, bottom: offset + (last + 1) * cell };
    };
    // Teclado (Shift+F10 ou tecla Menu): o menu abre junto ao cursor do terminal.
    const cursorPoint = () => {
      const { rect, width, height } = area();
      const screen = container.querySelector('.xterm-screen');
      if (!screen || !terminal.cols || !terminal.rows) return { x: 16, y: 16, width, height };
      const box = screen.getBoundingClientRect();
      const buffer = terminal.buffer.active;
      return {
        x: box.left - rect.left + buffer.cursorX * (box.width / terminal.cols),
        y: box.top - rect.top + (buffer.cursorY + 1) * (box.height / terminal.rows),
        width,
        height,
      };
    };

    const copyText = (text) => {
      if (!text) return;
      desktop.writeClipboardText(text)
        .then((ok) => { if (!disposed && ok) announce(copiedLabel(characterCount(text))); })
        .catch(() => { if (!disposed) announce('Não foi possível copiar para a área de transferência.'); });
    };
    const copySelection = () => copyText(terminal.getSelection());
    const refuseMultiline = (where, text) => announce(multilineRefused(where), { label: 'Copiar', run: () => copyText(text) });
    // Ctrl+V e "Colar": arquivos viram caminhos entre aspas, texto vai como colagem do terminal,
    // e só imagem repassa ao CLI o atalho de colar imagem; o CLI lê o clipboard e anexa.
    const pasteClipboard = () => {
      if (!attached) return;
      desktop.readClipboardForPaste().then((content) => {
        if (disposed) return;
        const plan = pasteFromClipboard(content, { platform: desktop.platform, cli: cliRef.current });
        if (plan.kind === 'text') terminal.paste(sanitizePaste(plan.text));
        else if (plan.kind === 'forward') desktop.writeTerminal(terminalId, plan.data);
      }).catch(() => { if (!disposed) announce('Não foi possível ler a área de transferência.'); });
    };
    // Responder e Reescrever: o trecho vai para a entrada deste terminal, sem Enter.
    const insertHere = (text) => {
      if (!attached) return;
      const plan = planPaste(text, terminal.modes.bracketedPasteMode);
      if (!plan.ok) {
        if (plan.reason === 'multiline') refuseMultiline('este terminal', text);
        return;
      }
      terminal.clearSelection();
      terminal.paste(plan.text);
      terminal.focus();
    };
    // Outra sessão: a citação vai para a entrada do terminal dela, sem Enter.
    const sendTo = async (target, text) => {
      try {
        const mode = await desktop.getTerminalInputMode(target.ptyId);
        if (disposed) return;
        if (!mode) {
          announce(`${target.name} não está mais em execução.`);
          return;
        }
        const plan = planPaste(text, mode.bracketedPaste);
        if (!plan.ok) {
          if (plan.reason === 'multiline') refuseMultiline(target.name, text);
          return;
        }
        desktop.writeTerminal(target.ptyId, pasteSequence(plan.text, mode.bracketedPaste));
        terminal.clearSelection();
        terminal.focus();
        announce(`Citação colada em ${target.name}, sem enviar.`);
      } catch {
        if (!disposed) announce(`Não foi possível colar em ${target.name}.`);
      }
    };
    const openMenu = (point) => {
      hideBar();
      setMenu({ ...point, hasSelection: terminal.hasSelection() });
    };
    // F6 com seleção: a barra aparece (se ainda não estava) junto da seleção e recebe o foco.
    const openBarFromKeyboard = () => {
      setMenu(null);
      setSendOpen(false);
      const { width, height } = area();
      setBar({ ...selectionAnchor({ x: width / 2, y: 0, width, height }), keyboard: Date.now() });
    };
    actionsRef.current = {
      copy: copySelection,
      paste: pasteClipboard,
      selectAll: () => terminal.selectAll(),
      reply: () => insertHere(quoteSelection(terminal.getSelection())),
      // Reescrever cola exatamente o que foi selecionado; a normalização fica só no Responder.
      rewrite: () => insertHere(terminal.getSelection()),
      send: (target) => sendTo(target, quoteSelection(terminal.getSelection())),
      focus: () => terminal.focus(),
    };

    terminal.attachCustomKeyEventHandler((event) => {
      const action = clipboardKeyAction(event, terminal.hasSelection());
      if (!action) return true;
      if (event.type === 'keydown') {
        event.preventDefault();
        if (action === 'copy') {
          copySelection();
          // Como no Windows Terminal: depois de copiar, o próximo Ctrl+C volta a interromper.
          terminal.clearSelection();
        } else if (action === 'paste') pasteClipboard();
        else if (action === 'bar') openBarFromKeyboard();
        else openMenu(cursorPoint());
      }
      return false;
    });

    const writeChunk = (payload) => {
      if (payload.sequence <= cursor) return;
      terminal.write(payload.data);
      cursor = payload.sequence;
    };
    const unsubscribeData = desktop.onTerminalData(terminalId, (payload) => {
      if (disposed) return;
      if (!attached) pending.push(payload);
      else writeChunk(payload);
    });
    const unsubscribeExit = desktop.onTerminalExit(terminalId, (exit) => onExitRef.current?.(exit));
    // Replaying history can contain old terminal queries (for example device
    // attributes). Their automatic xterm replies must not become new shell input.
    const inputDisposable = terminal.onData((data) => {
      if (attached) desktop.writeTerminal(terminalId, data);
      // Digitar some com a barra; o aviso de foco (modo 1004, que PowerShell e CLIs ligam) não é
      // digitação: ele sai justamente quando o foco vai para a barra ou para a lista.
      if (!isFocusReport(data)) hideBar();
    });
    const selectionDisposable = terminal.onSelectionChange(() => {
      if (!terminal.hasSelection()) hideBar();
    });
    // Durante o arraste de uma divisória, o xterm acompanha cada quadro e o PTY recebe o tamanho
    // com throttle; ao soltar, o fit final envia o tamanho definitivo na hora.
    const ptyResizer = createPtyResizer({ send: (cols, rows) => desktop.resizeTerminal(terminalId, cols, rows) });
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      if (cols >= 20 && rows >= 5) ptyResizer.request(cols, rows, { throttle: isLayoutResizing() });
    });
    const fit = () => {
      if (disposed || !container.clientWidth || !container.clientHeight) return;
      try { fitAddon.fit(); } catch { /* O viewport pode estar em transição. */ }
    };
    const unsubscribeLayout = onLayoutResizing((active) => {
      // A barra fica presa à seleção: com a divisória em movimento, o trecho muda de lugar.
      if (active) hideBar();
      if (active || disposed) return;
      cancelAnimationFrame(frame);
      fit();
      ptyResizer.flush();
    });
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    observer.observe(container);
    frame = requestAnimationFrame(fit);

    // Copiar ao selecionar, como no Windows Terminal; a barra de ações aparece junto do mouse.
    const onMouseDown = (event) => {
      selectingWithMouse = event.button === 0;
    };
    const onMouseUp = (event) => {
      if (!selectingWithMouse || event.button !== 0) return;
      selectingWithMouse = false;
      const point = pointerPoint(event.clientX, event.clientY);
      // O xterm conclui a seleção no mesmo mouseup; lemos depois dele.
      setTimeout(() => {
        if (disposed || !terminal.hasSelection()) return;
        copySelection();
        setSendOpen(false);
        setBar(selectionAnchor(point));
      }, 0);
    };
    const onContextMenu = (event) => {
      event.preventDefault();
      event.stopPropagation();
      // Tecla Menu: sem coordenadas do mouse, abre junto ao cursor.
      openMenu(event.clientX || event.clientY ? pointerPoint(event.clientX, event.clientY) : cursorPoint());
    };
    const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
    const onDragOver = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = attached ? 'copy' : 'none';
      setDropping(true);
    };
    const onDragLeave = (event) => {
      if (!shell.contains(event.relatedTarget)) setDropping(false);
    };
    // Arquivos do Explorer: os caminhos entre aspas, na entrada, sem Enter.
    const onDrop = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDropping(false);
      if (!attached) return;
      const text = quotePaths([...event.dataTransfer.files].map((file) => desktop.getPathForFile(file)));
      if (!text) return;
      terminal.paste(text);
      terminal.focus();
    };
    container.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);
    container.addEventListener('contextmenu', onContextMenu, true);
    container.addEventListener('wheel', hideBar, { passive: true });
    shell.addEventListener('dragover', onDragOver);
    shell.addEventListener('dragleave', onDragLeave);
    shell.addEventListener('drop', onDrop);

    desktop.attachTerminal(terminalId).then((snapshot) => {
      if (disposed) return;
      cursor = snapshot.cursor;
      terminal.write(snapshot.scrollback, () => {
        if (disposed) return;
        attached = true;
        pending.sort((a, b) => a.sequence - b.sequence).forEach(writeChunk);
        pending.length = 0;
        if (snapshot.exit) onExitRef.current?.(snapshot.exit);
      });
    }).catch((attachError) => {
      if (!disposed) setError(attachError.message);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      clearTimeout(noticeTimer);
      observer.disconnect();
      unsubscribeLayout();
      ptyResizer.dispose();
      unsubscribeData();
      unsubscribeExit();
      inputDisposable.dispose();
      selectionDisposable.dispose();
      resizeDisposable.dispose();
      container.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      container.removeEventListener('contextmenu', onContextMenu, true);
      container.removeEventListener('wheel', hideBar);
      shell.removeEventListener('dragover', onDragOver);
      shell.removeEventListener('dragleave', onDragLeave);
      shell.removeEventListener('drop', onDrop);
      terminal.dispose();
      terminalRef.current = null;
      actionsRef.current = {};
    };
  }, [terminalId, desktop]);

  useEffect(() => {
    if (!terminalRef.current || !theme) return;
    terminalRef.current.options.theme = {
      background: theme.background,
      foreground: theme.ink,
      cursor: theme.color,
      cursorAccent: theme.background,
      selectionBackground: `${theme.color}55`,
    };
  }, [theme]);

  useEffect(() => {
    if (!menu) return undefined;
    const closeOutside = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenu(null);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [menu]);

  // F6 abriu a barra: o foco vai para o primeiro botão assim que ela estiver posicionada.
  const barPlaced = barStyle.visibility !== 'hidden';
  useEffect(() => {
    if (bar?.keyboard && barPlaced) barRef.current?.querySelector('button')?.focus();
  }, [bar?.keyboard, barPlaced]);

  const run = (name, ...args) => actionsRef.current[name]?.(...args);
  const closeMenu = () => {
    setMenu(null);
    run('focus');
  };
  // Barra como barra de ferramentas do Windows: setas e Home/End entre os botões; Escape e Tab
  // devolvem o foco ao terminal (a seleção continua); seta para baixo abre "Colar em outra sessão".
  const onBarKeyDown = (event) => {
    if (event.target.closest('[role="menu"]')) return;
    const buttons = [...barRef.current.querySelectorAll(':scope > button')];
    const next = toolbarFocusIndex(event.key, buttons.indexOf(document.activeElement), buttons.length);
    if (next !== null) {
      event.preventDefault();
      buttons[next].focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      setSendOpen(false);
      run('focus');
    } else if (event.key === 'ArrowDown' && event.target.getAttribute('aria-haspopup') === 'menu') {
      event.preventDefault();
      setSendOpen(true);
    }
  };
  // A lista recebe o foco ao abrir (mouse ou teclado) e o devolve ao botão ao fechar; escolher uma
  // sessão leva o foco de volta ao terminal depois de colar.
  const closeSendMenu = () => {
    setSendOpen(false);
    barRef.current?.querySelector('[aria-haspopup="menu"]')?.focus();
  };
  const sendItems = targets.map((target) => ({ key: `send-${target.id}`, label: `Colar em ${target.name}`, title: target.detail, run: () => run('send', target) }));
  const menuItems = menu ? [
    { key: 'copy', label: 'Copiar', shortcut: 'Ctrl+C', disabled: !menu.hasSelection, run: () => run('copy') },
    { key: 'paste', label: 'Colar', shortcut: 'Ctrl+V', run: () => run('paste') },
    { key: 'select-all', label: 'Selecionar tudo', run: () => run('selectAll') },
    ...(menu.hasSelection ? [
      { key: 'separator', separator: true },
      { key: 'reply', label: 'Responder', run: () => run('reply') },
      { key: 'rewrite', label: 'Reescrever', run: () => run('rewrite') },
      ...sendItems,
    ] : []),
  ] : [];

  return (
    <div ref={shellRef} className={`terminal-view-shell ${dropping ? 'dropping' : ''}`}>
      <div ref={containerRef} className="terminal-view" aria-label="Terminal interativo. Shift+F10 abre o menu de copiar e colar; com texto selecionado, F6 leva às ações do trecho." />
      {bar && <div
        ref={barRef}
        role="toolbar"
        aria-label="Ações do trecho selecionado"
        aria-keyshortcuts="F6"
        className="terminal-selection-bar"
        style={barStyle}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onBarKeyDown}
      >
        <button type="button" onClick={() => run('reply')} title="Colar como citação na entrada deste terminal, sem enviar"><span>Responder</span><Reply size={14} aria-hidden="true" /></button>
        <button type="button" onClick={() => run('rewrite')} title="Colar o trecho na entrada deste terminal, sem enviar"><span>Reescrever</span><PenLine size={13} aria-hidden="true" /></button>
        {targets.length > 0 && <button type="button" aria-haspopup="menu" aria-expanded={Boolean(sendOpen)} onClick={() => setSendOpen((open) => !open)} title="Colar como citação na entrada de outra sessão, sem enviar"><span>Colar em outra sessão</span><Forward size={13} aria-hidden="true" /><ChevronDown className="terminal-bar-chevron" size={12} aria-hidden="true" /></button>}
        {sendOpen && <MenuList
          label="Colar a citação em"
          className="terminal-context-menu terminal-send-menu"
          items={targets.map((target) => ({ key: target.id, label: target.name, title: target.detail, run: () => run('send', target) }))}
          onClose={closeSendMenu}
          autoFocus
        />}
      </div>}
      {menu && <MenuList menuRef={menuRef} label="Copiar e colar" className="terminal-context-menu" style={menuStyle} items={menuItems} onClose={closeMenu} />}
      <div className="terminal-notice-region" role="status" aria-live="polite">
        {notice && <span key={notice.key} className={`terminal-notice ${notice.action ? 'has-action' : ''}`}>
          <span>{notice.text}</span>
          {notice.action && <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { notice.action.run(); run('focus'); }}>{notice.action.label}</button>}
        </span>}
      </div>
      {error && <div className="terminal-error" role="alert">{error}</div>}
    </div>
  );
}
