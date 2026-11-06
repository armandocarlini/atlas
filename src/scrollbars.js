// Barras de rolagem aparecem só enquanto o conteúdo rola e somem logo depois.
// Um único ouvinte em captura cobre qualquer área rolável, inclusive as criadas depois.
export function revealScrollbarsWhileScrolling(root = document, delay = 900) {
  const timers = new WeakMap();
  root.addEventListener('scroll', (event) => {
    const target = event.target === document ? document.scrollingElement : event.target;
    if (!(target instanceof Element)) return;
    target.classList.add('is-scrolling');
    clearTimeout(timers.get(target));
    timers.set(target, setTimeout(() => target.classList.remove('is-scrolling'), delay));
  }, { capture: true, passive: true });
}
