import { useLayoutEffect, useRef, useState } from 'react';
import {
  TERMINAL_MIN, columnTracksToTemplate, gridPlacement, gridShape, pixelTracks, saveTracks, shapeKey, sidebarShape, tracksFor, tracksToTemplate,
} from './track-layout.js';

const sameNumbers = (left, right) => left.length === right.length && left.every((value, index) => Math.abs(value - right[index]) < 0.5);

// Trilhas da Grade e de Principal + agentes: forma pela largura do contêiner, tamanhos salvos por
// layout e forma, e os px reais lidos do CSS para posicionar as divisórias.
export default function useTerminalTracks({ layout, count, saved, onSave }) {
  const gridRef = useRef(null);
  const [width, setWidth] = useState(null);
  const [pixels, setPixels] = useState({ columns: [], rows: [] });
  const [live, setLive] = useState(null);

  const shape = !count ? null : layout === 'grid' ? gridShape(count, width) : layout === 'sidebar' ? sidebarShape(count, width) : null;
  const key = shape ? `${layout}:${shapeKey(layout, shape)}` : null;
  const base = shape ? tracksFor(saved, layout, shape) : null;
  const tracks = live?.key === key ? live.tracks : base;
  const style = tracks ? {
    gridTemplateColumns: columnTracksToTemplate(tracks.columns),
    gridTemplateRows: tracksToTemplate(tracks.rows, TERMINAL_MIN.height),
    gridAutoRows: `minmax(${TERMINAL_MIN.height}px, 1fr)`,
  } : undefined;

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return undefined;
    const measure = () => {
      setWidth(grid.clientWidth);
      const computed = getComputedStyle(grid);
      const next = { columns: pixelTracks(computed.gridTemplateColumns), rows: pixelTracks(computed.gridTemplateRows) };
      setPixels((current) => (sameNumbers(current.columns, next.columns) && sameNumbers(current.rows, next.rows) ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [style?.gridTemplateColumns, style?.gridTemplateRows, layout, count]);

  function placement(index) {
    if (!shape) return undefined;
    if (layout === 'grid') {
      const item = gridPlacement(count, shape.columns)[index];
      return item ? { gridColumn: `${item.column + 1} / span ${item.span}`, gridRow: `${item.row + 1}` } : undefined;
    }
    if (!shape.split) return { gridColumn: '1', gridRow: `${index + 1}` };
    return index === 0 ? { gridColumn: '1', gridRow: `1 / span ${shape.rows}` } : { gridColumn: '2', gridRow: `${index}` };
  }

  return {
    gridRef,
    shape,
    tracks,
    pixels,
    style,
    placement,
    preview(next) {
      setLive({ key, tracks: next });
    },
    commit(next) {
      setLive(null);
      if (shape) onSave(saveTracks(saved, layout, shape, next));
    },
  };
}
