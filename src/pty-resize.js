// Redimensionamento do PTY durante o arraste de divisórias.
// Enquanto o usuário arrasta, o xterm acompanha cada quadro, mas o PTY recebe no máximo um
// resize por intervalo; ao soltar, cada terminal faz o fit final e envia o tamanho definitivo.

export const PTY_RESIZE_INTERVAL = 120;

let resizing = false;
const listeners = new Set();

export function isLayoutResizing() {
  return resizing;
}

export function setLayoutResizing(active) {
  const next = Boolean(active);
  if (next === resizing) return;
  resizing = next;
  for (const listener of [...listeners]) listener(next);
}

export function onLayoutResizing(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function createPtyResizer({
  send, interval = PTY_RESIZE_INTERVAL, now = () => Date.now(),
  setTimer = (callback, wait) => setTimeout(callback, wait), clearTimer = (timer) => clearTimeout(timer),
} = {}) {
  let pending = null;
  let timer = null;
  let lastAt = -Infinity;
  let lastSent = null;

  function cancel() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function dispatch() {
    cancel();
    if (!pending) return;
    const [cols, rows] = pending;
    pending = null;
    if (lastSent && lastSent[0] === cols && lastSent[1] === rows) return;
    lastSent = [cols, rows];
    lastAt = now();
    send(cols, rows);
  }

  return {
    request(cols, rows, { throttle = false } = {}) {
      pending = [cols, rows];
      if (!throttle) return dispatch();
      const wait = interval - (now() - lastAt);
      if (wait <= 0) return dispatch();
      if (timer === null) timer = setTimer(dispatch, wait);
      return undefined;
    },
    flush: dispatch,
    dispose() {
      cancel();
      pending = null;
    },
  };
}
