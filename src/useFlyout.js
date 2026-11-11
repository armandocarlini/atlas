import { useEffect, useRef, useState } from 'react';

const FOCUSABLE = 'button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex="0"]';

// Posição de um painel que sai de um trilho estreito: ao lado do trilho, para dentro da janela.
export function flyoutPosition(rail, width, viewportWidth = window.innerWidth, viewportHeight = window.innerHeight) {
  if (!rail) return { top: 0, left: 0, width };
  const opensLeft = rail.left + rail.width / 2 > viewportWidth / 2;
  const top = Math.max(0, rail.top);
  const size = Math.min(width, Math.max(240, (opensLeft ? rail.left : viewportWidth - rail.right) - 8));
  return opensLeft
    ? { top, right: Math.max(0, viewportWidth - rail.left), width: size, maxHeight: viewportHeight - top }
    : { top, left: rail.right, width: size, maxHeight: viewportHeight - top };
}

// Destino seguro quando o botão de origem sumiu (o trilho virou a árvore completa no resize):
// a área dos terminais, que aceita foco.
const SAFE_FOCUS = '#terminal-workspace';

// Painel não modal aberto a partir de um botão: foco entra ao abrir, Esc fecha e devolve o foco
// ao botão, clique fora fecha. O conteúdo atrás continua utilizável. Se o foco estava dentro do
// painel quando ele fecha (clique fora sem destino focável, resize), ele volta ao botão ou ao
// destino seguro, nunca ao body.
export default function useFlyout({ initialFocus } = {}) {
  const [open, setOpen] = useState(null);
  const flyoutRef = useRef(null);
  const triggerRef = useRef(null);
  const restorePending = useRef(false);

  function restoreFocus() {
    const trigger = triggerRef.current;
    if (trigger?.isConnected) trigger.focus();
    else document.querySelector(SAFE_FOCUS)?.focus();
  }

  function close(returnFocus = true) {
    const focusInside = Boolean(flyoutRef.current?.contains(document.activeElement));
    setOpen(null);
    if (returnFocus) restoreFocus();
    // O foco só cai no body quando o React remove o painel; quem decide é o efeito abaixo, que roda
    // depois do commit (o botão pode ter sido trocado na mesma renderização: trilho -> árvore).
    else if (focusInside) restorePending.current = true;
  }

  useEffect(() => {
    if (open || !restorePending.current) return;
    restorePending.current = false;
    if (!document.activeElement || document.activeElement === document.body) restoreFocus();
  }, [open]);

  function toggle(id, trigger) {
    if (open?.id === id) return close();
    triggerRef.current = trigger;
    const rail = trigger.closest('[data-column-id]')?.getBoundingClientRect() || trigger.getBoundingClientRect();
    return setOpen({ id, rail: { left: rail.left, right: rail.right, top: rail.top, width: rail.width, bottom: rail.bottom } });
  }

  useEffect(() => {
    if (!open) return undefined;
    const frame = requestAnimationFrame(() => {
      const flyout = flyoutRef.current;
      if (!flyout || flyout.contains(document.activeElement)) return;
      const preferred = initialFocus ? flyout.querySelector(initialFocus) : null;
      (preferred || flyout.querySelector(FOCUSABLE))?.focus();
    });
    function closeOutside(event) {
      if (flyoutRef.current?.contains(event.target) || triggerRef.current?.contains(event.target)) return;
      close(false);
    }
    function closeEscape(event) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.stopPropagation();
      close(true);
    }
    function closeOnResize() { close(false); }
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    window.addEventListener('resize', closeOnResize);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
      window.removeEventListener('resize', closeOnResize);
    };
  }, [open?.id]);

  return { open, toggle, close, flyoutRef };
}
