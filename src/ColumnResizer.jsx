import { useRef, useState } from 'react';
import { columnMode, dividerColumns, dividerRange, keyboardResize, resizeAtDivider } from './column-layout.js';
import { setLayoutResizing } from './pty-resize.js';

const LABELS = { left: 'Navegação', center: 'Terminais', right: 'Painéis' };
const CONTROLS = { left: 'atlas-navigation', center: 'terminal-workspace', right: 'atlas-panels' };
const MODE_LABELS = { full: 'completa', compact: 'compacta', narrow: 'abas com ícones', icons: 'só ícones' };
const DRAG_THRESHOLD = 3;

// Divisória entre duas colunas visíveis vizinhas. Arraste 1:1 com captura do ponteiro, setas do
// teclado (Shift para passos maiores), Home/End nos limites, duplo clique volta ao padrão e Esc
// durante o arraste devolve a largura de antes.
export default function ColumnResizer({ visible, index, widths, available, order, onChange, onReset }) {
  const dragRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const divider = dividerColumns(visible, index);
  const range = dividerRange({ visible, index, start: widths, available });
  if (!divider || !range) return null;

  const label = divider.controls.length === 1
    ? `Largura de ${LABELS[range.column]}`
    : `Divisão entre ${LABELS[divider.before]} e ${LABELS[divider.after]}`;
  const mode = MODE_LABELS[columnMode(range.column, range.now)];

  function finish(event, revert = false) {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (revert && drag.moved) onChange(drag.start);
    if (event?.currentTarget?.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    document.body.classList.remove('is-resizing-columns');
    setDragging(false);
    setLayoutResizing(false);
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      className={`column-resizer ${dragging ? 'is-dragging' : ''}`}
      style={{ order: order.indexOf(divider.before) * 2 + 1 }}
      data-resizer={`${divider.before}-${divider.after}`}
      aria-orientation="vertical"
      aria-label={label}
      aria-controls={divider.controls.map((column) => CONTROLS[column]).join(' ')}
      aria-valuemin={range.min}
      aria-valuemax={Math.round(range.max)}
      aria-valuenow={Math.round(range.now)}
      aria-valuetext={`${Math.round(range.now)} pixels, ${mode}`}
      title={`${label}. Arraste, use as setas ou dê duplo clique para o padrão.`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { x: event.clientX, start: { ...widths }, moved: false };
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag) return;
        const delta = event.clientX - drag.x;
        if (!drag.moved) {
          if (Math.abs(delta) < DRAG_THRESHOLD) return;
          drag.moved = true;
          setDragging(true);
          setLayoutResizing(true);
          document.body.classList.add('is-resizing-columns');
        }
        onChange(resizeAtDivider({ visible, index, start: drag.start, delta, available }));
      }}
      onPointerUp={(event) => finish(event)}
      onPointerCancel={(event) => finish(event, true)}
      onLostPointerCapture={(event) => finish(event)}
      onDoubleClick={() => onReset(divider.controls)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && dragRef.current) {
          event.preventDefault();
          event.stopPropagation();
          finish(null, true);
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          onReset(divider.controls);
          return;
        }
        const next = keyboardResize({ visible, index, start: widths, key: event.key, shift: event.shiftKey, available });
        if (!next) return;
        event.preventDefault();
        onChange(next);
      }}
    />
  );
}
