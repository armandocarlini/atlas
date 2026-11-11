import { useEffect, useRef, useState } from 'react';
import { Activity, MoreHorizontal, PanelLeft, PanelRight, SquareTerminal } from 'lucide-react';

// Barra dos Terminais em coluna estreita: os controles de visualização, o estado e o PowerShell
// vão para o menu "⋯", com os mesmos nomes acessíveis da barra completa.
export default function ToolbarOverflow({ hiddenColumns, onToggleColumn, layout, onLayout, statusOpen, onStatus, onTerminal }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const frame = requestAnimationFrame(() => rootRef.current?.querySelector('.toolbar-overflow-popover button, .toolbar-overflow-popover select')?.focus());
    function closeOutside(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function closeEscape(event) {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, [open]);

  const run = (action) => () => {
    setOpen(false);
    triggerRef.current?.focus();
    action();
  };

  return (
    <div className="toolbar-overflow" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="chrome-icon-button toolbar-overflow-trigger"
        aria-label="Mais controles dos terminais"
        title="Mais controles dos terminais"
        aria-expanded={open}
        aria-controls="toolbar-overflow-popover"
        onClick={() => setOpen((current) => !current)}
      ><MoreHorizontal size={16} aria-hidden="true" /></button>
      {open && <div id="toolbar-overflow-popover" className="toolbar-overflow-popover session-menu-popover" role="group" aria-label="Mais controles dos terminais">
        <button type="button" className="session-menu-item" data-panel="left" aria-pressed={!hiddenColumns.left} onClick={run(() => onToggleColumn('left'))}>
          <PanelLeft size={14} aria-hidden="true" />{hiddenColumns.left ? 'Mostrar navegação' : 'Ocultar navegação'}
        </button>
        <button type="button" className="session-menu-item" data-panel="right" aria-pressed={!hiddenColumns.right} onClick={run(() => onToggleColumn('right'))}>
          <PanelRight size={14} aria-hidden="true" />{hiddenColumns.right ? 'Mostrar painéis' : 'Ocultar painéis'}
        </button>
        <label className="toolbar-overflow-field">
          <span>Layout</span>
          <select className="terminal-layout-select" aria-label="Layout dos terminais" value={layout} onChange={(event) => { setOpen(false); triggerRef.current?.focus(); onLayout(event.target.value); }}>
            <option value="grid">Grade</option>
            <option value="spotlight">Destaque</option>
            <option value="sidebar">Principal + agentes</option>
            <option value="tabs">Abas</option>
          </select>
        </label>
        <button type="button" className="session-menu-item" aria-pressed={statusOpen} onClick={run(onStatus)}>
          <Activity size={14} aria-hidden="true" />Estado do projeto
        </button>
        <button type="button" className="session-menu-item" onClick={run(onTerminal)}>
          <SquareTerminal size={14} aria-hidden="true" />Abrir terminal PowerShell
        </button>
      </div>}
    </div>
  );
}
