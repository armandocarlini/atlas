import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { navigationMode, panelsMode, resolveColumnWidths, terminalsMode, visibleColumns } from './column-layout.js';

// Estado das larguras das colunas: as salvas (desejadas) e as efetivas, que cedem quando a
// janela estreita e voltam quando ela alarga. A área é medida no próprio workspace.
export default function useColumnLayout({ initialWidths, order, hidden }) {
  const bodyRef = useRef(null);
  const [widths, setWidths] = useState(initialWidths || { left: null, right: null });
  const [available, setAvailable] = useState(null);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return undefined;
    const measure = () => setAvailable(Math.round(body.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  const visible = visibleColumns(order, hidden);
  const effective = useMemo(
    () => resolveColumnWidths({ order, hidden, widths, available }),
    [order.join(), hidden.left, hidden.right, widths.left, widths.right, available],
  );

  return {
    bodyRef,
    widths,
    effective,
    visible,
    available,
    modes: {
      left: navigationMode(effective.left),
      right: panelsMode(effective.right),
      center: terminalsMode(effective.center),
    },
    apply(partial) {
      setWidths((current) => ({ ...current, ...partial }));
    },
    reset(columns = ['left', 'right']) {
      setWidths((current) => ({ ...current, ...Object.fromEntries(columns.map((column) => [column, null])) }));
    },
  };
}
