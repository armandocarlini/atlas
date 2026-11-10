import { Bot, Braces, SquareTerminal } from 'lucide-react';
import { CLI_MARKS, cliMarkId, sessionTone } from './cli-marks.js';

const TONE_LABELS = { active: 'ativa', hidden: 'oculta', ended: 'encerrada' };

// Identidade da sessão: o ícone oficial do CLI (ou de terminal) com um selo de estado no canto,
// como a presença de um avatar. O estado também vai em texto para leitores de tela.
export default function SessionGlyph({ session, hidden = false, size = 16, announce = true }) {
  const id = cliMarkId(session);
  const mark = CLI_MARKS[id];
  const tone = sessionTone(session, hidden);
  const Fallback = id === 'terminal' ? SquareTerminal : id === 'codex' ? Braces : Bot;
  return (
    <span
      className={`session-glyph tone-${tone}`}
      data-cli={id}
      style={{ '--glyph-size': `${size}px`, ...(mark?.color ? { '--mark-color': mark.color } : {}) }}
    >
      {mark
        ? <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={mark.path} /></svg>
        : <Fallback aria-hidden="true" focusable="false" strokeWidth={1.75} />}
      <span className="session-glyph-badge" aria-hidden="true" />
      {announce && <span className="visually-hidden">{mark?.title || (id === 'terminal' ? 'Terminal' : id === 'codex' ? 'Codex' : 'Agente')}, {TONE_LABELS[tone]}</span>}
    </span>
  );
}
