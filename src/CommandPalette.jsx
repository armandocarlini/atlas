import React, { useMemo, useState } from 'react';
import useModalFocus from './useModalFocus.js';
import { filterCommands } from './command-filter.js';

// Paleta de comandos (Ctrl Shift P ou F1): tudo o que a barra tinha em botões, num só lugar.
export default function CommandPalette({ commands, onClose }) {
  const dialogRef = useModalFocus();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const results = useMemo(() => filterCommands(commands, query), [commands, query]);
  const current = Math.min(active, Math.max(0, results.length - 1));

  function run(command) {
    if (!command) return;
    onClose();
    // Depois de fechar, para o foco não voltar ao controle antigo por cima da ação.
    window.setTimeout(command.run, 0);
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((current + 1) % Math.max(1, results.length)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((current - 1 + results.length) % Math.max(1, results.length)); }
    else if (event.key === 'Enter') { event.preventDefault(); run(results[current]); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
  }

  let lastGroup = null;
  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={onClose}>
      <section ref={dialogRef} className="modal command-palette" role="dialog" aria-modal="true" aria-label="Paleta de comandos" onMouseDown={(event) => event.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="palette-input">
          <input
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActive(0); }}
            placeholder="Buscar comando, projeto ou sessão…"
            aria-label="Buscar comando"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results[current] ? `palette-${results[current].id}` : undefined}
            autoComplete="off"
            spellCheck="false"
          />
          <kbd>Esc</kbd>
        </div>
        <ul id="palette-list" role="listbox" aria-label="Comandos">
          {results.map((command, index) => {
            const heading = command.group !== lastGroup ? command.group : null;
            lastGroup = command.group;
            return (
              <React.Fragment key={command.id}>
                {heading && <li className="palette-group" role="presentation">{heading}</li>}
                <li
                  id={`palette-${command.id}`}
                  role="option"
                  aria-selected={index === current}
                  className={index === current ? 'active' : ''}
                  onMouseMove={() => setActive(index)}
                  onClick={() => run(command)}
                >
                  <span>{command.label}</span>
                  {command.hint && <small>{command.hint}</small>}
                  {command.shortcut && <kbd>{command.shortcut}</kbd>}
                </li>
              </React.Fragment>
            );
          })}
          {!results.length && <li className="palette-empty" role="presentation">Nenhum comando para "{query}".</li>}
        </ul>
      </section>
    </div>
  );
}
