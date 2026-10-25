import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

export default function TerminalView({ terminalId, desktop, theme, onExit }) {
  const containerRef = useRef(null);
  const terminalRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !desktop?.isDesktop || !terminalId) return undefined;

    let disposed = false;
    let attached = false;
    let cursor = 0;
    let frame = null;
    const pending = [];
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 5000,
      screenReaderMode: true,
      rightClickSelectsWord: true,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminalRef.current = terminal;

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
    const unsubscribeExit = desktop.onTerminalExit(terminalId, (exit) => onExit?.(exit));
    // Replaying history can contain old terminal queries (for example device
    // attributes). Their automatic xterm replies must not become new shell input.
    const inputDisposable = terminal.onData((data) => {
      if (attached) desktop.writeTerminal(terminalId, data);
    });
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      if (cols >= 20 && rows >= 5) desktop.resizeTerminal(terminalId, cols, rows);
    });
    const fit = () => {
      if (disposed || !container.clientWidth || !container.clientHeight) return;
      try { fitAddon.fit(); } catch { /* O viewport pode estar em transição. */ }
    };
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    observer.observe(container);
    frame = requestAnimationFrame(fit);

    desktop.attachTerminal(terminalId).then((snapshot) => {
      if (disposed) return;
      cursor = snapshot.cursor;
      terminal.write(snapshot.scrollback, () => {
        if (disposed) return;
        attached = true;
        pending.sort((a, b) => a.sequence - b.sequence).forEach(writeChunk);
        pending.length = 0;
        if (snapshot.exit) onExit?.(snapshot.exit);
      });
    }).catch((attachError) => {
      if (!disposed) setError(attachError.message);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      unsubscribeData();
      unsubscribeExit();
      inputDisposable.dispose();
      resizeDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
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

  return (
    <div className="terminal-view-shell">
      <div ref={containerRef} className="terminal-view" aria-label="Terminal PowerShell interativo" />
      {error && <div className="terminal-error" role="alert">{error}</div>}
    </div>
  );
}
