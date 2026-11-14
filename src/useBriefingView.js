import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export default function useBriefingView({ enabled, ready, hasProjects, blocked }) {
  const [open, setOpen] = useState(false);
  const initialized = useRef(false);
  const heading = useRef(null);
  const returnFocus = useRef(null);
  const restoreOnClose = useRef(false);

  const show = useCallback((event) => {
    returnFocus.current = event?.currentTarget ?? document.activeElement;
    initialized.current = true;
    setOpen(true);
  }, []);
  const close = useCallback((restoreFocus = true) => {
    initialized.current = true;
    restoreOnClose.current = restoreFocus !== false;
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!enabled || !ready || initialized.current) return;
    initialized.current = true;
    if (hasProjects) show();
  }, [enabled, ready, hasProjects, show]);

  useLayoutEffect(() => {
    if (open) {
      heading.current?.focus();
      return;
    }
    if (!restoreOnClose.current) return;
    restoreOnClose.current = false;
    const trigger = returnFocus.current;
    if (trigger?.isConnected && trigger !== document.body && !trigger.closest('.briefing')) trigger.focus();
    else document.getElementById('terminal-workspace')?.focus();
  }, [open]);

  useLayoutEffect(() => {
    if (!enabled) return undefined;
    function keydown(event) {
      if (blocked || event.defaultPrevented || event.isComposing || event.key !== 'Escape' || !open) return;
      // No terminal interativo, Esc pertence ao CLI mesmo se o xterm não consumir o evento.
      if (event.target.closest?.('.briefing-terminal')) return;
      if (document.querySelector('[aria-modal="true"], .rail-flyout, [role="menu"], select:open')) return;
      event.preventDefault();
      close();
    }
    function shortcut(event) {
      if (blocked || event.defaultPrevented || event.isComposing || document.querySelector('[aria-modal="true"]')) return;
      if (event.key === 'Escape' && open && event.target.closest?.('.briefing-terminal[data-read-only="true"]') && !document.querySelector('.rail-flyout, [role="menu"]')) {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey || event.code !== 'KeyB') return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (open) close();
      else show();
    }
    window.addEventListener('keydown', keydown);
    window.addEventListener('keydown', shortcut, true);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keydown', shortcut, true);
    };
  }, [enabled, open, blocked, close, show]);

  return { open: enabled && open, show, close, heading };
}
