import { createPortal } from 'react-dom';
import { ChevronsLeftRight, ExternalLink, ListTodo, MessageSquare, PanelRightClose, ShieldCheck } from 'lucide-react';
import ChromeIconButton from './ChromeIconButton.jsx';
import useFlyout, { flyoutPosition } from './useFlyout.js';

export const PANEL_ICONS = { task: ListTodo, messages: MessageSquare, evidence: ShieldCheck };
const OVERLAY_WIDTH = 360;

export function panelAccessibleName(label, badge) {
  return badge ? `${label}, ${badge} não ${badge === 1 ? 'lida' : 'lidas'}` : label;
}

// Painéis só com ícones: cada seção vira um ícone com selo; clicar abre o painel sobre os
// terminais, ao lado do trilho, sem tirar o processo nem o foco do resto do workspace.
export default function PanelsRail({
  panels, labels, badges = {}, activePanel, onTabChange, style, columnDragOver, columnDragging,
  onColumnPointerDown, onHideColumn, onToggleDetach, onExpand, renderOverlay,
}) {
  const flyout = useFlyout({ initialFocus: '.inspector-tabs button.active' });

  return (
    <aside
      className={`inspector dock-right panels-rail ${columnDragOver ? 'column-drag-over' : ''} ${columnDragging ? 'column-drag-source' : ''}`}
      style={style}
      data-column-id="right"
      data-mode="icons"
      id="atlas-panels"
      aria-label="Coluna de painéis"
    >
      <div className="column-drag-bar" onPointerDown={(event) => onColumnPointerDown(event, 'right')} title="Arrastar coluna de painéis">
        <strong className="visually-hidden">Painéis</strong>
        <ChromeIconButton icon={PanelRightClose} label="Ocultar painéis" className="detach-control" onPointerDown={(event) => event.stopPropagation()} onClick={onHideColumn} aria-expanded="true" aria-controls="atlas-panels" />
      </div>
      <div className="rail-panels" role="group" aria-label="Painéis">
        {panels.map((id) => {
          const Icon = PANEL_ICONS[id];
          const name = panelAccessibleName(labels[id], badges[id]);
          const open = flyout.open?.id === id;
          return <button
            type="button"
            key={id}
            data-panel={id}
            className={`rail-button rail-panel ${activePanel === id ? 'active' : ''}`}
            aria-label={name}
            title={name}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? 'panels-overlay' : undefined}
            onClick={(event) => {
              onTabChange(id);
              flyout.toggle(id, event.currentTarget);
            }}
          >
            <Icon size={17} aria-hidden="true" />
            {badges[id] > 0 && <span className="rail-badge attention" aria-hidden="true">{badges[id]}</span>}
          </button>;
        })}
      </div>
      <div className="rail-footer">
        <ChromeIconButton icon={ChevronsLeftRight} label="Expandir painéis" className="rail-button" onClick={onExpand} />
        <ChromeIconButton icon={ExternalLink} label="Destacar painéis em pop-up" className="rail-button" onClick={onToggleDetach} />
      </div>
      {flyout.open && createPortal(
        <div
          id="panels-overlay"
          ref={flyout.flyoutRef}
          className="rail-flyout panels-overlay"
          role="dialog"
          aria-label={labels[activePanel] || 'Painéis'}
          data-opens={flyoutPosition(flyout.open.rail, OVERLAY_WIDTH).right !== undefined ? 'left' : 'right'}
          style={{ ...flyoutPosition(flyout.open.rail, OVERLAY_WIDTH), height: `calc(100vh - ${Math.round(flyout.open.rail.top)}px)` }}
        >
          {renderOverlay(() => flyout.close())}
        </div>,
        document.body,
      )}
    </aside>
  );
}
