import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, MoreHorizontal } from 'lucide-react';
import { canDismiss, canSnooze, countAnnouncement, itemDescription, snoozeOptions } from './attention-queue.js';

const MENU_WIDTH = 188;

// Menu por item: adiar (1 h, 4 h, amanhã às 9h) e, só onde o host permite, dispensar.
// Teclado: setas, Home/End, Escape e Tab; o foco entra no primeiro item e volta ao gatilho.
function ItemMenu({ item, anchor, onSnooze, onDismiss, onClose }) {
  const menuRef = useRef(null);
  const [position, setPosition] = useState(null);
  const options = canSnooze(item) ? snoozeOptions(new Date()) : [];

  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8);
    const below = rect.bottom + 4;
    const height = menuRef.current?.offsetHeight || 0;
    setPosition({ left, top: below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 4) : below });
    menuRef.current?.querySelector('[role="menuitem"]')?.focus();
  }, [anchor]);

  useEffect(() => {
    function closeOutside(event) {
      if (menuRef.current?.contains(event.target) || anchor.contains(event.target)) return;
      onClose(false);
    }
    function closeOnResize() { onClose(false); }
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('resize', closeOnResize);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('resize', closeOnResize);
    };
  }, [anchor]);

  function handleKey(event) {
    const entries = [...menuRef.current.querySelectorAll('[role="menuitem"]')];
    const index = entries.indexOf(document.activeElement);
    const targets = { ArrowDown: (index + 1) % entries.length, ArrowUp: (index - 1 + entries.length) % entries.length, Home: 0, End: entries.length - 1 };
    if (event.key in targets) {
      event.preventDefault();
      entries[targets[event.key]]?.focus();
    } else if (event.key === 'Escape') {
      // O Escape não atravessa para os painéis e diálogos ao fundo.
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    } else if (event.key === 'Tab') {
      onClose(true);
    }
  }

  return createPortal(
    <div
      ref={menuRef}
      className="attention-menu"
      data-flyout-child=""
      role="menu"
      aria-label={`Ações para ${item.title}`}
      style={{ width: MENU_WIDTH, left: position?.left ?? -9999, top: position?.top ?? -9999 }}
      onKeyDown={handleKey}
    >
      {options.map((option) => <button key={option.id} type="button" role="menuitem" tabIndex={-1} onClick={() => { onClose(true); onSnooze(item, option.until); }}>{option.label}</button>)}
      {canDismiss(item) && <>
        <div className="attention-menu-separator" role="separator" />
        <button type="button" role="menuitem" tabIndex={-1} onClick={() => { onClose(true); onDismiss(item); }}>Dispensar</button>
      </>}
    </div>,
    document.body,
  );
}

function AttentionItem({ item, onOpen, onSnooze, onDismiss }) {
  const [menuAnchor, setMenuAnchor] = useState(null);
  const triggerRef = useRef(null);
  const high = item.urgency === 'alta';
  const description = itemDescription(item);
  const hasMenu = canSnooze(item) || canDismiss(item);

  function closeMenu(returnFocus) {
    setMenuAnchor(null);
    if (returnFocus) triggerRef.current?.focus();
  }

  return (
    <li className={`attention-item ${high ? 'high' : ''}`} data-kind={item.kind} data-item-id={item.id}>
      {/* title e reason são texto de agentes: só texto, nunca markdown nem HTML. */}
      <button type="button" className="attention-open" aria-label={description} title={description} onClick={() => onOpen(item)}>
        <span className="attention-meta">
          <span className="attention-project">{item.projectName}</span>
          {high && <span className="attention-urgency"><AlertTriangle size={11} aria-hidden="true" />Urgente</span>}
        </span>
        <strong>{item.title}</strong>
        {item.reason && <span className="attention-reason">{item.reason}</span>}
      </button>
      {hasMenu && <button
        ref={triggerRef}
        type="button"
        className="attention-more chrome-icon-button"
        aria-label={`Mais ações: ${item.title}`}
        title="Adiar ou dispensar"
        aria-haspopup="menu"
        aria-expanded={Boolean(menuAnchor)}
        onClick={(event) => (menuAnchor ? closeMenu(false) : setMenuAnchor(event.currentTarget))}
      ><MoreHorizontal size={15} aria-hidden="true" /></button>}
      {menuAnchor && <ItemMenu item={item} anchor={menuAnchor} onSnooze={onSnooze} onDismiss={onDismiss} onClose={closeMenu} />}
    </li>
  );
}

// Seção global da navegação: o que exige decisão, de todos os projetos. Não rola com a
// árvore; rola por dentro quando passa da altura dela.
export default function AttentionQueue({ items = [], summary = '', loaded = false, error = '', onOpen, onSnooze, onDismiss, onClearError }) {
  const count = items.length;
  return (
    <section className={`attention-queue ${count ? 'has-items' : ''}`} aria-labelledby="attention-queue-title">
      <div className="attention-heading">
        <h2 id="attention-queue-title">Precisam de mim</h2>
        {count > 0 && <b aria-hidden="true">{count}</b>}
        <span className="visually-hidden" role="status" aria-atomic="true">{loaded ? countAnnouncement(count) : ''}</span>
      </div>
      {error && <p className="attention-error" role="alert">
        <AlertTriangle size={12} aria-hidden="true" /><span>{error}</span>
        {onClearError && <button type="button" className="attention-error-close" onClick={onClearError}>Fechar aviso</button>}
      </p>}
      {summary && <p className="attention-summary">{summary}</p>}
      {count > 0
        ? <ul className="attention-items" aria-label="Itens que precisam de você">
          {items.map((item) => <AttentionItem key={item.id} item={item} onOpen={onOpen} onSnooze={onSnooze} onDismiss={onDismiss} />)}
        </ul>
        : loaded && <p className="attention-empty">Nada precisa de você agora.</p>}
    </section>
  );
}
