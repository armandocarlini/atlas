import { useRef } from 'react';
import {
  SIDEBAR_SPLIT, TERMINAL_MIN, TRACK_KEYBOARD_STEP, TRACK_KEYBOARD_STEP_LARGE,
  equalTracks, normalizeTracks, resizeTracks, trackBoundaries,
} from './track-layout.js';
import { setLayoutResizing } from './pty-resize.js';

const DRAG_THRESHOLD = 3;

function defaultTracks(layout, shape, axis) {
  if (layout === 'sidebar' && shape.split && axis === 'columns') return normalizeTracks(SIDEBAR_SPLIT, 2);
  return equalTracks(shape[axis]);
}

function label(layout, axis, index) {
  if (layout === 'sidebar' && axis === 'columns') return 'Divisão entre a principal e os agentes';
  if (layout === 'sidebar') return `Divisão entre os agentes ${index + 1} e ${index + 2}`;
  return axis === 'columns' ? `Divisão entre as colunas de terminais ${index + 1} e ${index + 2}` : `Divisão entre as linhas de terminais ${index + 1} e ${index + 2}`;
}

function TrackResizer({ boundary, layout, shape, tracks, pixels, onPreview, onCommit }) {
  const dragRef = useRef(null);
  const { axis, index } = boundary;
  const vertical = axis === 'columns';
  const min = vertical ? TERMINAL_MIN.width : TERMINAL_MIN.height;
  const sizes = pixels[axis];
  const pair = sizes[index] + sizes[index + 1];
  const withAxis = (next) => ({ ...tracks, [axis]: next });

  function end(commit = true) {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    document.body.classList.remove('is-resizing-columns', 'is-resizing-rows');
    setLayoutResizing(false);
    if (drag.moved) onCommit(commit ? drag.last : drag.original);
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      className={`track-resizer ${vertical ? 'vertical' : 'horizontal'}`}
      data-axis={axis}
      data-index={index}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={label(layout, axis, index)}
      aria-valuemin={Math.round(Math.min(min, pair / 2))}
      aria-valuemax={Math.round(Math.max(pair - min, pair / 2))}
      aria-valuenow={Math.round(sizes[index])}
      aria-valuetext={`${Math.round(sizes[index])} de ${Math.round(pair)} pixels`}
      title={`${label(layout, axis, index)}. Arraste, use as setas ou dê duplo clique para dividir igualmente.`}
      style={vertical
        ? { left: boundary.left, top: boundary.top, height: boundary.size }
        : { top: boundary.top, left: boundary.left, width: boundary.size }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { origin: vertical ? event.clientX : event.clientY, start: [...sizes], moved: false, last: tracks, original: tracks };
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag) return;
        const delta = (vertical ? event.clientX : event.clientY) - drag.origin;
        if (!drag.moved) {
          if (Math.abs(delta) < DRAG_THRESHOLD) return;
          drag.moved = true;
          setLayoutResizing(true);
          document.body.classList.add(vertical ? 'is-resizing-columns' : 'is-resizing-rows');
        }
        drag.last = withAxis(resizeTracks(drag.start, index, delta, min));
        onPreview(drag.last);
      }}
      onPointerUp={() => end(true)}
      onPointerCancel={() => end(false)}
      onLostPointerCapture={() => end(true)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={() => onCommit(withAxis(defaultTracks(layout, shape, axis)))}
      onKeyDown={(event) => {
        const back = vertical ? 'ArrowLeft' : 'ArrowUp';
        const forward = vertical ? 'ArrowRight' : 'ArrowDown';
        let delta = null;
        if (event.key === back || event.key === forward) delta = (event.key === forward ? 1 : -1) * (event.shiftKey ? TRACK_KEYBOARD_STEP_LARGE : TRACK_KEYBOARD_STEP);
        else if (event.key === 'Home') delta = -pair;
        else if (event.key === 'End') delta = pair;
        else if (event.key === 'Enter') {
          event.preventDefault();
          onCommit(withAxis(defaultTracks(layout, shape, axis)));
          return;
        } else if (event.key === 'Escape' && dragRef.current) {
          event.preventDefault();
          event.stopPropagation();
          end(false);
          return;
        }
        if (delta === null) return;
        event.preventDefault();
        event.stopPropagation();
        onCommit(withAxis(resizeTracks(sizes, index, delta, min)));
      }}
    />
  );
}

export default function TrackResizers({ layout, count, terminalTracks }) {
  const { shape, tracks, pixels, preview, commit } = terminalTracks;
  if (!tracks) return null;
  return trackBoundaries({ layout, shape, count, pixels }).map((boundary) => <TrackResizer
    key={`${boundary.axis}-${boundary.index}`}
    boundary={boundary}
    layout={layout}
    shape={shape}
    tracks={tracks}
    pixels={pixels}
    onPreview={preview}
    onCommit={commit}
  />);
}
