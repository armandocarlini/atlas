import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowUp,
  Bell,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  FileCode2,
  Focus,
  FolderGit2,
  GitBranch,
  Grid2X2,
  Inbox,
  Keyboard,
  Layers3,
  ListTodo,
  Maximize2,
  MessageSquare,
  MoreHorizontal,
  Palette,
  Plus,
  Radio,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Terminal,
  TestTube2,
  User,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import TerminalView from './TerminalView.jsx';
import GitDiscovery from './GitDiscovery.jsx';
import { appearanceTokens, contrastInk } from './appearance.js';
import useModalFocus from './useModalFocus.js';
import { agentSession, mergeAgentSessions, sessionExit } from './session-state.js';
import { PersistentTaskPanel, NewTaskModal } from './PersistentTasks.jsx';

const THEME_PRESETS = [
  { name: 'Laranja', color: '#f2994a' },
  { name: 'Petróleo', color: '#35b6c9' },
  { name: 'Azul', color: '#5b9cf5' },
  { name: 'Verde', color: '#4ecb8d' },
  { name: 'Violeta', color: '#a685f2' },
  { name: 'Vermelho', color: '#ef6363' },
];
const BACKGROUND_PRESETS = [
  { name: 'Grafite', background: '#080a0b' },
  { name: 'Preto', background: '#000000' },
  { name: 'Azul-noturno', background: '#111722' },
  { name: 'Névoa', background: '#eef1f4' },
  { name: 'Papel', background: '#f7f4ed' },
];
const DEFAULT_THEME = { name: 'Laranja', color: '#f2994a', background: '#080a0b' };
const INITIAL_DIRECTORY = 'C:\\projetos\\atlas';

function getInitialTheme() {
  try {
    const saved = JSON.parse(localStorage.getItem('atlas-appearance'));
    if (saved?.color && /^#[0-9a-f]{6}$/i.test(saved.color)) {
      return { ...DEFAULT_THEME, ...saved, background: /^#[0-9a-f]{6}$/i.test(saved.background) ? saved.background : DEFAULT_THEME.background };
    }
  } catch { /* Preferência inválida: usa o padrão. */ }
  return DEFAULT_THEME;
}

function getAccentInk(hex) {
  return contrastInk(hex);
}

const DEFAULT_DOCKS = { left: [], right: ['task', 'messages', 'evidence'] };
const DEFAULT_COLUMN_ORDER = ['left', 'center', 'right'];
const COLUMN_LABELS = { left: 'Navegação', center: 'Terminais', right: 'Painéis' };

function setDragPreview(event, title, detail) {
  const preview = document.createElement('div');
  preview.className = 'atlas-drag-preview';
  const heading = document.createElement('strong');
  const caption = document.createElement('span');
  heading.textContent = title;
  caption.textContent = detail;
  preview.append(heading, caption);
  document.body.appendChild(preview);
  event.dataTransfer.setDragImage(preview, 18, 18);
  window.setTimeout(() => preview.remove(), 0);
}

function startPanelDrag(event, panel, label) {
  event.dataTransfer.setData('application/x-atlas-panel', panel);
  event.dataTransfer.effectAllowed = 'move';
  setDragPreview(event, label, 'Reordenar seção na coluna');
}

function getInitialDockLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem('atlas-docks'));
    const valid = (items) => Array.isArray(items) && items.every((id) => ['task', 'messages', 'evidence'].includes(id));
    const validOrder = (items) => Array.isArray(items) && items.length === 3 && DEFAULT_COLUMN_ORDER.every((id) => items.includes(id));
    if (valid(saved?.left) && valid(saved?.right)) {
      const panels = [...new Set([...saved.left, ...saved.right, ...DEFAULT_DOCKS.right])];
      return {
        docks: { left: [], right: panels },
        order: validOrder(saved.order) ? saved.order : DEFAULT_COLUMN_ORDER,
        hidden: { left: Boolean(saved.hidden?.left), right: Boolean(saved.hidden?.right) },
      };
    }
  } catch { /* Layout inválido: restaura o padrão. */ }
  return { docks: DEFAULT_DOCKS, order: DEFAULT_COLUMN_ORDER, hidden: { left: false, right: false } };
}

const initialSessions = [
  {
    id: 'orchestrator',
    demo: true,
    name: 'ORQUESTRADOR',
    role: 'Planejamento e coordenação',
    origin: 'principal',
    cli: 'Claude Code',
    model: 'modelo forte',
    effort: 'high',
    status: 'aguardando você',
    color: '#f2994a',
    task: 'Missão cockpit interativo',
    tokens: '42,8k',
    cost: '—',
    worktree: 'atlas/main',
    lines: [
      { type: 'command', text: '❯ vamos validar o fluxo de colaboração entre sessões manuais e automáticas' },
      { type: 'info', text: 'Vou dividir a validação em três frentes e manter uma única fonte de verdade.' },
      { type: 'success', text: '✓ contexto do projeto e critérios de aceite carregados' },
      { type: 'info', text: '├─ sessão manual · validar entrada, ANSI e resize do terminal' },
      { type: 'info', text: '├─ atlas-core · revisar contratos de mensagens e handoffs' },
      { type: 'info', text: '└─ atlas-qa · preparar cenário de recuperação após restart' },
      { type: 'success', text: '✓ descoberta recebida de sessão manual · mensagem #0184' },
      { type: 'warning', text: '◇ preciso da sua aprovação para iniciar a terceira sessão em uma worktree' },
    ],
  },
  {
    id: 'manual',
    demo: true,
    name: 'exploracao-terminal',
    role: 'Validação de PTY',
    origin: 'manual',
    cli: 'Codex',
    model: 'modelo intermediário',
    effort: 'medium',
    status: 'trabalhando',
    color: '#8b9399',
    task: 'ATL-024 · Validar terminal interativo',
    tokens: '18,2k',
    cost: '—',
    worktree: 'atlas/pty-validation',
    lines: [
      { type: 'command', text: '❯ teste entrada, cores e resize sem perder o stream' },
      { type: 'info', text: '● iniciando matriz PTY · Windows + CLI selecionado' },
      { type: 'success', text: '✓ entrada bidirecional · 24/24 casos' },
      { type: 'success', text: '✓ resize · colunas e linhas propagados' },
      { type: 'info', text: '● verificando sequências ANSI interativas…' },
      { type: 'command', text: '› messages.send({ to: "orchestrator", ref: "ATL-024" })' },
    ],
  },
  {
    id: 'core',
    demo: true,
    name: 'atlas-core',
    role: 'Contratos e persistência',
    origin: 'orquestrador',
    cli: 'Claude Code',
    model: 'modelo intermediário',
    effort: 'high',
    status: 'trabalhando',
    color: '#8b9399',
    task: 'ATL-031 · Mensagens entre sessões',
    tokens: '12,6k',
    cost: '—',
    worktree: 'atlas/session-messages',
    lines: [
      { type: 'info', text: '● revisando invariantes de entrega e leitura' },
      { type: 'command', text: '$ pnpm test messages handoffs' },
      { type: 'success', text: '✓ entrega duplicada preserva idempotência' },
      { type: 'success', text: '✓ handoff não eleva permissões do destinatário' },
      { type: 'info', text: '● 17 testes concluídos · preparando evidências' },
    ],
  },
  {
    id: 'qa',
    demo: true,
    name: 'atlas-qa',
    role: 'Revisão e recuperação',
    origin: 'orquestrador',
    cli: 'Kimi Code',
    model: 'automático',
    effort: 'medium',
    status: 'aguardando aprovação',
    color: '#f2b84b',
    task: 'ATL-033 · Reconciliação após restart',
    tokens: '0',
    cost: '—',
    worktree: 'atlas/restart-recovery',
    lines: [
      { type: 'info', text: 'Sessão planejada pelo orquestrador.' },
      { type: 'warning', text: '◇ aguardando aprovação para criar worktree e iniciar a run' },
      { type: 'info', text: 'Cenário: interromper app · reabrir · reconciliar runs e evidências.' },
    ],
  },
];

const tasks = [
  { id: 'ATL-024', title: 'Validar terminal interativo', status: 'em andamento', group: 'active', owner: 'exploracao-terminal', progress: '3 / 5', description: 'Comprovar entrada, saída, ANSI e resize em um CLI real no Windows.' },
  { id: 'ATL-031', title: 'Mensagens entre sessões', status: 'em revisão', group: 'review', owner: 'atlas-core', progress: '4 / 4', description: 'Persistir mensagens e handoffs com escopo, leitura e idempotência.' },
  { id: 'ATL-033', title: 'Reconciliação após restart', status: 'bloqueada', group: 'blocked', owner: 'atlas-qa', progress: '0 / 3', description: 'Reabrir o aplicativo e reconciliar sessões sem presumir continuidade.' },
  { id: 'ATL-018', title: 'Modelo local de projetos', status: 'concluída', group: 'done', owner: 'orquestrador', progress: '6 / 6', description: 'Cadastrar projetos e caminhos autorizados sem varrer o disco.' },
];

const missions = [
  { name: 'Cockpit interativo', count: 4, color: '#f2994a' },
  { name: 'Persistência local', count: 3, color: '#8b9399' },
  { name: 'Integração Explorer', count: 2, color: '#8b9399' },
  { name: 'Release pública', count: 1, color: '#777f86' },
];

function AtlasMark() {
  return (
    <div className="atlas-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function StatusDot({ color = '#777f86', pulse = false }) {
  return <span className={`status-dot ${pulse ? 'pulse' : ''}`} style={{ '--dot-color': color }} />;
}

function HarnessIntro({ harness, session }) {
  if (harness === 'shell') return null;
  return (
    <div className={`harness-intro ${harness}`}>
      <div>
        <strong>{session.cli}<small>{harness === 'claude' ? 'v2.1' : harness === 'kimi' ? 'CLI' : 'interactive'}</small></strong>
        <span>{session.model} · {session.effort} · {session.worktree}</span>
      </div>
    </div>
  );
}

function SessionCard({ session, selected, focused, onSelect, onFocus, onSend, onPopup, onExit, onRestart, desktop, theme, detached = false, popup = false }) {
  const [draft, setDraft] = useState('');
  const [localLines, setLocalLines] = useState([]);
  const cli = session.cli.toLowerCase();
  const harness = cli.includes('claude') ? 'claude' : cli.includes('kimi') ? 'kimi' : cli.includes('codex') ? 'codex' : 'shell';

  function submit(event) {
    event.preventDefault();
    const value = draft.trim();
    if (!value) return;
    setLocalLines((lines) => [...lines, { type: 'command', text: `❯ ${value}` }]);
    setDraft('');
    onSend(session.name);
  }

  return (
    <article
      className={`session-card ${selected ? 'selected' : ''} ${focused ? 'focused' : ''} ${detached ? 'terminal-detached' : ''} ${popup ? 'terminal-popup-card' : ''}`}
      style={{ '--session-color': session.color }}
      onClick={() => onSelect(session.id)}
    >
      <header className="session-header" title={session.role}>
        <div className="session-identity">
          <StatusDot color={session.color} pulse={session.status === 'trabalhando'} />
          <h3>{session.name}</h3>
          <span className={`origin-badge ${session.origin}`}>{session.origin}</span>
          {session.demo && <span className="origin-badge demo">ilustrativo</span>}
          <span className="session-cli">{session.version ? `${session.cli} ${session.version}` : session.cli}</span>
        </div>
        <div className="session-actions">
          {!session.ptyId && !session.archived && <span className="token-count">{session.tokens} <span>tokens</span></span>}
          {session.roleKind === 'orchestrator' && session.exited && onRestart && <button className="session-control" onClick={(event) => { event.stopPropagation(); onRestart(session); }}>Nova execução</button>}
          {!session.archived && <button className="session-control" onClick={(event) => { event.stopPropagation(); onPopup(session); }}>{detached || popup ? 'Reintegrar' : 'Pop-up'}</button>}
          {!popup && !detached && <button className="session-control" title="Alternar foco" aria-label={`Focar ${session.name}`} onClick={(event) => { event.stopPropagation(); onFocus(session.id); }}>{focused ? 'Grid' : 'Foco'}</button>}
        </div>
      </header>

      {detached ? <div className="detached-terminal-placeholder"><span>Terminal aberto em outra janela.</span><button className="button secondary compact" onClick={() => onPopup(session)}>Reintegrar</button></div> : <>
        <div className={`terminal-window harness-${harness} ${session.ptyId ? 'real-terminal' : ''}`} aria-label={session.archived ? `Histórico de ${session.name}` : `Terminal interativo nativo do ${session.cli}`}>
          {session.archived ? <div className="session-history">
            <strong>Histórico de sessão</strong>
            <p>{session.status}. Nenhum processo está conectado.</p>
            <p>O conteúdo do terminal não foi salvo. Abra uma nova sessão para continuar o trabalho.</p>
            <dl><dt>Diretório</dt><dd>{session.worktree}</dd><dt>Início</dt><dd>{session.createdAt}</dd><dt>Fim registrado</dt><dd>{session.endedAt || 'sem confirmação'}</dd></dl>
          </div> : session.ptyId ? <TerminalView terminalId={session.ptyId} desktop={desktop} theme={{ ...theme, ink: getAccentInk(theme.background) }} onExit={(exit) => onExit(session.id, { ...exit, ptyId: session.ptyId })} /> : <>
            <div className="terminal-lines">
              <HarnessIntro harness={harness} session={session} />
              {[...session.lines, ...localLines].map((line, index) => (
                <div className={`terminal-line ${line.type}`} key={`${session.id}-${index}`}>{line.text}</div>
              ))}
            </div>
            <form className="harness-input" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
              <span aria-hidden="true">❯</span>
              <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Conversar com ${session.cli}…`} aria-label={`Entrada interativa do ${session.cli}`} />
              <kbd>enter ↵</kbd>
            </form>
            <div className="harness-statusbar"><span>{session.cli}</span><span>{session.worktree}</span></div>
          </>}
        </div>
        <footer className="session-footer">
          <div className="session-state"><StatusDot color={session.color} pulse={session.status === 'trabalhando'} /><span>{session.status}</span></div>
          <span className="session-task">{session.ptyId || session.archived ? session.worktree : session.task}</span>
        </footer>
      </>}
    </article>
  );
}

function NewSessionModal({ kind, onClose, onCreate, workingDirectory, worktrees, onDirectoryChange, busy, adapters = null, loadingAdapters = false }) {
  const dialogRef = useModalFocus();
  const [error, setError] = useState('');
  const isTerminal = kind === 'terminal';
  const realAdapters = !isTerminal && Array.isArray(adapters);
  const availableAdapters = realAdapters ? adapters.filter((adapter) => adapter.status === 'available') : [];
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section ref={dialogRef} className="modal" onMouseDown={(event) => event.stopPropagation()} aria-modal="true" role="dialog" aria-labelledby="new-session-title">
        <header>
          <div>
            <span className="eyebrow">NOVA INSTÂNCIA LOCAL</span>
            <h2 id="new-session-title">{isTerminal ? 'Abrir terminal' : 'Criar sessão de agente'}</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="Fechar"><X size={18} /></button>
        </header>
        <form onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setError('');
          const failure = await onCreate({ kind, name: data.get('name'), cli: data.get('cli'), cwd: data.get('cwd') || workingDirectory });
          if (failure) setError(failure);
        }}>
          <label>Nome da {isTerminal ? 'janela' : 'sessão'}<input name="name" defaultValue={isTerminal ? 'powershell-local' : 'nova-investigacao'} autoFocus /></label>
          {!isTerminal && loadingAdapters && <div className="scope-note"><ShieldCheck size={16} /><span>Detectando CLIs de agente no PATH…</span></div>}
          {!isTerminal && !loadingAdapters && (realAdapters
            ? <label>CLI / harness detectado<select name="cli" disabled={!availableAdapters.length}>{adapters.map((adapter) => <option key={adapter.id} value={adapter.id} disabled={adapter.status !== 'available'}>{adapter.name}{adapter.version ? ` ${adapter.version}` : ''}{adapter.status !== 'available' ? ' — não encontrado' : ''}</option>)}</select></label>
            : <label>CLI / harness<select name="cli" defaultValue="Claude Code"><option>Claude Code</option><option>Kimi Code</option><option>Codex</option><option>CLI personalizado</option></select></label>)}
          <label>Worktree ou diretório<select name="cwd" value={workingDirectory} onChange={(event) => onDirectoryChange(event.target.value)}>{worktrees.map((item) => <option value={item.path} key={item.path}>{item.label} — {item.branch || 'diretório autorizado'}</option>)}</select></label>
          <div className="path-input"><FolderGit2 size={15} /><span>{workingDirectory}</span><CheckCircle2 size={15} /></div>
          {!isTerminal && !realAdapters && !loadingAdapters && <div className="form-grid"><label>Modelo<select defaultValue="Automático"><option>Automático</option><option>Modelo forte</option><option>Modelo econômico</option></select></label><label>Vínculo<select defaultValue="Missão atual"><option>Missão atual</option><option>Somente projeto</option><option>Independente</option></select></label></div>}
          {realAdapters && !availableAdapters.length && <div className="scope-note error-note" role="alert"><ShieldCheck size={16} /><span>{adapters[0]?.error || 'Nenhum CLI de agente encontrado no PATH.'}</span></div>}
          <div className="scope-note"><ShieldCheck size={16} /><span>{isTerminal ? 'PowerShell real no diretório selecionado, sem identidade de agente.' : realAdapters ? 'O CLI real inicia interativo neste diretório; permissões e modelo permanecem no harness.' : 'A sessão nascerá registrada e poderá trocar mensagens com outras sessões autorizadas.'}</span></div>
          {error && <div className="scope-note error-note" role="alert"><ShieldCheck size={16} /><span>{error}</span></div>}
          <footer><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button type="submit" className="button primary" disabled={busy || loadingAdapters || (realAdapters && !availableAdapters.length)}><Plus size={15} />{busy ? 'Abrindo…' : isTerminal ? 'Abrir terminal' : 'Criar sessão'}</button></footer>
        </form>
      </section>
    </div>
  );
}

function AppearanceModal({ theme, onChange, onClose }) {
  const dialogRef = useModalFocus();
  const isCustom = !THEME_PRESETS.some((preset) => preset.color === theme.color);
  const isCustomBackground = !BACKGROUND_PRESETS.some((preset) => preset.background === theme.background);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section ref={dialogRef} className="modal appearance-modal" onMouseDown={(event) => event.stopPropagation()} aria-modal="true" role="dialog" aria-labelledby="appearance-title">
        <header>
          <div><span className="eyebrow">PREFERÊNCIAS LOCAIS</span><h2 id="appearance-title">Aparência</h2></div>
          <button className="icon-button" onClick={onClose} title="Fechar" aria-label="Fechar aparência"><X size={18} /></button>
        </header>
        <div className="appearance-content">
          <div className="appearance-intro"><Palette size={18} /><p>Personalize destaque e fundo. Texto, superfícies e bordas se adaptam para preservar a leitura.</p></div>
          <fieldset className="theme-fieldset">
            <legend>Cor de destaque</legend>
            <div className="theme-presets">
              {THEME_PRESETS.map((preset) => <button type="button" key={preset.name} className={`theme-preset ${theme.color === preset.color ? 'active' : ''}`} onClick={() => onChange({ ...theme, ...preset })} aria-pressed={theme.color === preset.color}><span className="theme-swatch" style={{ '--swatch': preset.color }}>{theme.color === preset.color && <Check size={14} />}</span><span>{preset.name}</span></button>)}
            </div>
          </fieldset>
          <label className="custom-color"><span><strong>Destaque personalizado</strong><small>Usado em ações, seleção e foco.</small></span><span className="color-control"><input type="color" value={theme.color} onChange={(event) => onChange({ ...theme, name: 'Personalizada', color: event.target.value })} aria-label="Escolher cor de destaque personalizada" /><code>{theme.color.toUpperCase()}</code>{isCustom && <span className="custom-indicator">ATIVA</span>}</span></label>
          <fieldset className="theme-fieldset">
            <legend>Fundo do cockpit</legend>
            <div className="theme-presets background-presets">
              {BACKGROUND_PRESETS.map((preset) => <button type="button" key={preset.name} className={`theme-preset ${theme.background === preset.background ? 'active' : ''}`} onClick={() => onChange({ ...theme, ...preset })} aria-pressed={theme.background === preset.background}><span className="theme-swatch" style={{ '--swatch': preset.background }}>{theme.background === preset.background && <Check size={14} />}</span><span>{preset.name}</span></button>)}
            </div>
          </fieldset>
          <label className="custom-color"><span><strong>Fundo personalizado</strong><small>Claro, escuro ou qualquer cor hexadecimal.</small></span><span className="color-control"><input type="color" value={theme.background} onChange={(event) => onChange({ ...theme, background: event.target.value })} aria-label="Escolher cor de fundo personalizada" /><code>{theme.background.toUpperCase()}</code>{isCustomBackground && <span className="custom-indicator">ATIVA</span>}</span></label>
          <div className="appearance-preview"><span className="preview-line" /><div><small>PRÉ-VISUALIZAÇÃO</small><strong>O terminal continua em primeiro plano.</strong><p>Destaque e fundo são independentes.</p></div><button className="button primary compact" type="button">Ação principal</button></div>
          <footer><span>Salvo automaticamente neste dispositivo.</span><button type="button" className="button secondary" onClick={onClose}>Concluir</button></footer>
        </div>
      </section>
    </div>
  );
}

const PANEL_LABELS = { task: 'Tarefas', messages: 'Mensagens', evidence: 'Evidências' };

function Inspector({ activeTask, onTaskSelect, tab, onTabChange, panels, onReorderPanel, columnDragOver, columnDragging, onColumnPointerDown, style, detached = false, native = false, onToggleDetach, onPopupPointerDown, onHideColumn, taskPanel }) {
  const [dragOverPanel, setDragOverPanel] = useState(null);
  const activePanel = panels.includes(tab) ? tab : panels[0];
  return (
    <aside
      className={`inspector ${detached ? 'detached-inspector' : 'dock-right'} ${native ? 'native-inspector' : ''} ${columnDragOver ? 'column-drag-over' : ''} ${columnDragging ? 'column-drag-source' : ''}`}
      style={style}
      data-column-id={detached ? undefined : 'right'}
      id={detached ? undefined : 'atlas-panels'}
      aria-label={detached ? 'Acompanhamento destacado dos agentes' : 'Coluna de painéis'}
    >
      <div className="column-drag-bar" onPointerDown={detached ? (native ? undefined : onPopupPointerDown) : (event) => onColumnPointerDown(event, 'right')}>
        <strong>{detached ? 'Acompanhamento' : 'Painéis'}</strong>
        {!detached && <span>Arrastar coluna</span>}
        <div className="column-bar-actions" onPointerDown={(event) => event.stopPropagation()}>
          {!detached && <button type="button" className="detach-control" onClick={onHideColumn} aria-expanded="true" aria-controls="atlas-panels">Ocultar</button>}
          <button
            type="button"
            className="detach-control"
            onClick={onToggleDetach}
            title={detached ? 'Reintegrar Painéis ao ATLAS' : 'Destacar Painéis; no app desktop, a janela fica sempre no topo'}
          >{detached ? 'Reintegrar' : 'Pop-up'}</button>
        </div>
      </div>
      {panels.length > 0 ? <>
        <div className="inspector-dockbar">
          <div className="inspector-tabs" style={{ gridTemplateColumns: `repeat(${panels.length}, minmax(0, 1fr))` }}>
            {panels.map((id) => (
              <button
                className={`${activePanel === id ? 'active' : ''} ${dragOverPanel === id ? 'panel-drag-over' : ''}`}
                onClick={() => onTabChange(id)}
                key={id}
                draggable
                onDragStart={(event) => startPanelDrag(event, id, PANEL_LABELS[id])}
                onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDragOverPanel(id); }}
                onDragLeave={() => setDragOverPanel(null)}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const panel = event.dataTransfer.getData('application/x-atlas-panel');
                  if (panel) onReorderPanel(panel, id);
                  setDragOverPanel(null);
                }}
                title={`Arrastar para reordenar ${PANEL_LABELS[id]} dentro da coluna`}
              >{PANEL_LABELS[id]}{id === 'messages' && <span className="tab-badge">2</span>}</button>
            ))}
          </div>
        </div>
        <div className="dock-panel-content">
      {activePanel === 'task' && (taskPanel || <>
        <section className="task-overview">
          <div className="section-kicker"><span>TAREFA SELECIONADA</span><span className={`task-status ${activeTask.group}`}>{activeTask.status}</span></div>
          <span className="task-id">{activeTask.id}</span>
          <h2>{activeTask.title}</h2>
          <p>{activeTask.description}</p>
          <div className="task-owner"><div className="mini-avatar"><Bot size={14} /></div><div><span>Responsável</span><strong>{activeTask.owner}</strong></div><ChevronRight size={15} /></div>
          <div className="criteria-head"><span>Critérios de aceite</span><strong>{activeTask.progress}</strong></div>
          <div className="progress-track"><span style={{ width: activeTask.group === 'done' ? '100%' : activeTask.group === 'review' ? '88%' : activeTask.group === 'active' ? '60%' : '12%' }} /></div>
          <ul className="criteria-list">
            <li className="complete"><Check size={13} /><span>Contexto e escopo persistidos</span></li>
            <li className="complete"><Check size={13} /><span>Evidências vinculadas à run</span></li>
            <li className={activeTask.group === 'done' || activeTask.group === 'review' ? 'complete' : ''}>{activeTask.group === 'done' || activeTask.group === 'review' ? <Check size={13} /> : <Circle size={11} />}<span>Revisão dos resultados</span></li>
          </ul>
          <button className="button review-button"><ShieldCheck size={15} />Abrir revisão<ChevronRight size={14} /></button>
        </section>
        <section className="task-queue">
          <div className="section-title"><span>NESTA MISSÃO</span><button><ListTodo size={14} /></button></div>
          {tasks.map((task) => <button className={`queue-item ${activeTask.id === task.id ? 'active' : ''}`} key={task.id} onClick={() => onTaskSelect(task)}><StatusDot color={task.group === 'done' ? '#7dbb91' : task.group === 'review' ? '#a685f2' : task.group === 'blocked' ? '#d98ca7' : '#f2994a'} /><span><small>{task.id}</small><strong>{task.title}</strong></span><ChevronRight size={13} /></button>)}
        </section>
      </>)}

      {activePanel === 'messages' && <section className="messages-panel">
        {taskPanel && <p className="scope-note">Mensagens ilustrativas · integração pendente.</p>}
        <div className="section-kicker"><span>COLABORAÇÃO</span><span>2 não lidas</span></div>
        <h2>Mensagens entre sessões</h2>
        <div className="message-card unread"><div className="message-route"><span>exploracao-terminal</span><Send size={12} /><span>orquestrador</span></div><p>Resize e entrada validados. Encontrei uma divergência no tratamento de sequências ANSI.</p><small>ATL-024 · agora · mensagem #0184</small></div>
        <div className="message-card unread"><div className="message-route"><span>atlas-core</span><Send size={12} /><span>orquestrador</span></div><p>Contratos revisados. Handoff pronto para revisão com 17 testes registrados.</p><small>ATL-031 · 2 min · handoff #0042</small></div>
        <div className="message-card"><div className="message-route"><span>orquestrador</span><Send size={12} /><span>atlas-core</span></div><p>Priorize o caso de entrega duplicada antes de submeter a revisão.</p><small>ATL-031 · 8 min · lida</small></div>
      </section>}

      {activePanel === 'evidence' && <section className="evidence-panel">
        {taskPanel && <p className="scope-note">Evidências ilustrativas · integração pendente.</p>}
        <div className="section-kicker"><span>ENTREGA VERIFICÁVEL</span><ShieldCheck size={15} /></div>
        <h2>{activeTask.id}</h2>
        <div className="evidence-item"><GitBranch size={16} /><div><strong>Worktree e diff</strong><span>atlas/session-messages</span><small>base 8f31a2c · 6 arquivos alterados</small></div><ChevronRight size={14} /></div>
        <div className="evidence-item"><TestTube2 size={16} /><div><strong>Testes de contrato</strong><span className="success-text">17 aprovados</span><small>node 24 · ambiente local</small></div><ChevronRight size={14} /></div>
        <div className="evidence-item"><FileCode2 size={16} /><div><strong>Handoff estruturado</strong><span>handoff #0042</span><small>objetivo, decisões e próximos passos</small></div><ChevronRight size={14} /></div>
        <div className="evidence-note"><ShieldCheck size={17} /><p>Uma run concluída não marca a tarefa como pronta automaticamente.</p></div>
      </section>}
        </div>
      </> : null}
    </aside>
  );
}

export default function App() {
  const [sessions, setSessions] = useState(() => window.atlasDesktop?.isDesktop ? [] : initialSessions);
  const [selectedId, setSelectedId] = useState('orchestrator');
  const [focusId, setFocusId] = useState(null);
  const [activeProject, setActiveProject] = useState('ATLAS');
  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [selectedWorktree, setSelectedWorktree] = useState('');
  const [workingDirectory, setWorkingDirectory] = useState(INITIAL_DIRECTORY);
  const [creatingTerminal, setCreatingTerminal] = useState(false);
  const [adapters, setAdapters] = useState(null);
  const projectSelectionRef = useRef(false);
  const [detachedTerminals, setDetachedTerminals] = useState([]);
  const [activeMission, setActiveMission] = useState('Cockpit interativo');
  const [activeTask, setActiveTask] = useState(tasks[0]);
  const [taskState, setTaskState] = useState({ projectId: null, projectName: '', items: [], loading: false, error: '' });
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [orchestratorStatus, setOrchestratorStatus] = useState({ loading: false, error: '' });
  const [inspectorTab, setInspectorTab] = useState('task');
  const [initialDockLayout] = useState(getInitialDockLayout);
  const [docks, setDocks] = useState(initialDockLayout.docks);
  const [columnOrder, setColumnOrder] = useState(initialDockLayout.order);
  const [hiddenColumns, setHiddenColumns] = useState(initialDockLayout.hidden || { left: false, right: false });
  const [columnDrag, setColumnDrag] = useState(null);
  const columnDragRef = useRef(null);
  const [panelsDetached, setPanelsDetached] = useState(false);
  const [popupPosition, setPopupPosition] = useState({ x: Math.max(16, window.innerWidth - 388), y: 96 });
  const popupDragRef = useRef(null);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState('');
  const [theme, setTheme] = useState(getInitialTheme);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const desktop = window.atlasDesktop;
  const isNativePanelWindow = desktop?.windowKind === 'panels';
  const isNativeTerminalWindow = desktop?.windowKind === 'terminal';
  const isSecondaryWindow = isNativePanelWindow || isNativeTerminalWindow;
  const panelChannelRef = useRef(null);
  const panelStateRef = useRef(null);
  panelStateRef.current = { activeTask, inspectorTab, docks, theme, sessions, selectedId, taskState };

  const currentProject = useMemo(() => {
    const equal = (left, right) => left.toLowerCase() === right.toLowerCase();
    return projects.find((project) => equal(project.path, workingDirectory))
      || projects.find((project) => project.repositories.some((repo) => repo.worktrees.some((worktree) => !worktree.statusError && equal(worktree.path, workingDirectory))));
  }, [projects, workingDirectory]);
  const projectSessions = useMemo(() => {
    const scoped = desktop?.isDesktop ? sessions.filter((session) => session.projectId === currentProject?.id) : sessions;
    return scoped.sort((left, right) => Number(right.roleKind === 'orchestrator') - Number(left.roleKind === 'orchestrator'));
  }, [sessions, currentProject?.id]);
  const visibleSessions = useMemo(() => focusId ? projectSessions.filter((session) => session.id === focusId) : projectSessions, [focusId, projectSessions]);
  const displayedColumnOrder = columnDrag?.previewOrder || columnOrder;
  const worktreeOptions = useMemo(() => {
    const options = projects.flatMap((project) => [
      { path: project.path, label: project.name, branch: 'pasta autorizada' },
      ...project.repositories.flatMap((repository) => repository.worktrees.filter((worktree) => !worktree.statusError).map((worktree) => ({ path: worktree.path, label: `${repository.name} / ${worktree.name}`, branch: worktree.branch }))),
    ]);
    return [...new Map(options.map((item) => [item.path.toLowerCase(), item])).values()];
  }, [projects]);

  useEffect(() => {
    if (!desktop?.isDesktop) return undefined;
    const channel = new BroadcastChannel('atlas-panels');
    panelChannelRef.current = channel;

    if (isSecondaryWindow) {
      channel.onmessage = ({ data }) => {
        if (data.type !== 'state' || !data.state) return;
        setActiveTask(data.state.activeTask);
        setInspectorTab(data.state.inspectorTab);
        setDocks(data.state.docks);
        setTheme(data.state.theme);
        setSessions(data.state.sessions);
        setSelectedId(data.state.selectedId);
        if (data.state.taskState) setTaskState(data.state.taskState);
      };
      channel.postMessage({ type: 'ready' });
    } else {
      channel.onmessage = ({ data }) => {
        if (data.type === 'ready') {
          channel.postMessage({ type: 'state', state: panelStateRef.current });
        } else if (data.type === 'task') {
          const task = tasks.find((item) => item.id === data.taskId);
          if (task) setActiveTask(task);
        } else if (data.type === 'tab' && PANEL_LABELS[data.tab]) {
          setInspectorTab(data.tab);
        } else if (data.type === 'reorder') {
          reorderPanel(data.panel, data.target);
        } else if (data.type === 'session-exit') {
          updateSessionExit(data.sessionId, data.exit, false);
        }
      };
    }

    return () => {
      channel.close();
      panelChannelRef.current = null;
    };
  }, [isSecondaryWindow]);

  useEffect(() => {
    if (isSecondaryWindow || !panelChannelRef.current) return;
    panelChannelRef.current.postMessage({ type: 'state', state: panelStateRef.current });
  }, [activeTask, inspectorTab, docks, theme, sessions, selectedId, taskState, isSecondaryWindow]);

  useEffect(() => {
    if (!desktop?.isDesktop || isSecondaryWindow) return undefined;
    const unsubscribePanels = desktop.onPanelsClosed(() => setPanelsDetached(false));
    const unsubscribeTerminals = desktop.onTerminalWindowClosed(({ sessionId }) => {
      setDetachedTerminals((current) => current.filter((id) => id !== sessionId));
    });
    return () => { unsubscribePanels(); unsubscribeTerminals(); };
  }, [isSecondaryWindow]);

  useEffect(() => {
    if (!desktop?.isDesktop || isSecondaryWindow) return undefined;
    let active = true;
    setProjectsLoading(true);
    Promise.all([desktop.listProjects(), desktop.getTerminalDefaults()]).then(([items, defaults]) => {
      if (!active) return;
      setProjects((current) => current.length ? current : items);
      if (items[0] && !projectSelectionRef.current) setActiveProject(items[0].name);
      if (defaults?.cwd) setWorkingDirectory((current) => current === INITIAL_DIRECTORY ? defaults.cwd : current);
    }).catch((error) => notify(`Não foi possível descobrir os projetos: ${error.message}`)).finally(() => {
      if (active) setProjectsLoading(false);
    });
    return () => { active = false; };
  }, [isSecondaryWindow]);

  useEffect(() => {
    if (!desktop?.isDesktop || isSecondaryWindow) return undefined;
    let active = true;
    desktop.listAgents().then((agents) => {
      if (active) setSessions((current) => mergeAgentSessions(current, agents));
    }).catch((error) => notify(`Não foi possível carregar as sessões: ${error.message}`));
    return () => { active = false; };
  }, [isSecondaryWindow, projects, workingDirectory]);

  useEffect(() => {
    if (!desktop?.isDesktop || isSecondaryWindow || !currentProject) return undefined;
    let active = true;
    setOrchestratorStatus({ projectId: currentProject.id, loading: true, error: '' });
    desktop.openOrchestrator({ cwd: workingDirectory }).then((agent) => {
      if (!active) return;
      setSessions((current) => mergeAgentSessions(current, [agent]));
      setSelectedId((current) => current === 'orchestrator' ? agent.id : current);
      setOrchestratorStatus({ projectId: currentProject.id, loading: false, error: '' });
    }).catch((error) => { if (active) setOrchestratorStatus({ projectId: currentProject.id, loading: false, error: error.message }); });
    return () => { active = false; };
  }, [isSecondaryWindow, currentProject?.id]);

  useEffect(() => { setFocusId(null); }, [currentProject?.id]);

  async function restartOrchestrator(session) {
    const projectId = session?.projectId || currentProject?.id;
    setOrchestratorStatus({ projectId, loading: true, error: '' });
    try {
      if (session) {
        await desktop.closeTerminalWindow(session.id);
        setDetachedTerminals((current) => current.filter((id) => id !== session.id));
      }
      const agent = await desktop.openOrchestrator({ cwd: session?.worktree || workingDirectory, startNewRun: true });
      setSessions((current) => mergeAgentSessions(current, [agent]));
      setOrchestratorStatus((state) => state.projectId === projectId ? { projectId, loading: false, error: '' } : state);
    } catch (error) { setOrchestratorStatus((state) => state.projectId === projectId ? { projectId, loading: false, error: error.message } : state); }
  }

  useEffect(() => {
    if (!desktop?.isDesktop || isSecondaryWindow) return undefined;
    const samePath = (left, right) => left.toLowerCase() === right.toLowerCase();
    const project = projects.find((item) => samePath(item.path, workingDirectory))
      || projects.find((item) => item.repositories.some((repo) => repo.worktrees.some((worktree) => !worktree.statusError && samePath(worktree.path, workingDirectory))));
    let active = true;
    setTaskState({ projectId: project?.id || null, projectName: project?.name || '', items: [], loading: Boolean(project), error: '' });
    if (project) desktop.listTasks({ cwd: workingDirectory }).then((state) => {
      if (active) setTaskState({ ...state, loading: false, error: '' });
    }).catch((error) => {
      if (active) setTaskState({ projectId: project.id, projectName: project.name, items: [], loading: false, error: error.message });
    });
    return () => { active = false; };
  }, [isSecondaryWindow, projects, workingDirectory]);

  async function createTask(request) {
    try {
      const task = await desktop.createTask(request);
      setTaskState((state) => state.projectId === task.projectId ? { ...state, items: [...state.items.filter((item) => item.id !== task.id), task] } : state);
      setTaskModalOpen(false);
      notify('Tarefa criada no backlog');
      return null;
    } catch (error) {
      return error.message;
    }
  }

  const persistentTaskPanel = desktop?.isDesktop ? <PersistentTaskPanel state={taskState} onNew={isSecondaryWindow ? undefined : () => setTaskModalOpen(true)} /> : null;

  useEffect(() => {
    document.body.classList.toggle('native-panel-window', Boolean(isNativePanelWindow));
    document.body.classList.toggle('native-terminal-window', Boolean(isNativeTerminalWindow));
    return () => document.body.classList.remove('native-panel-window', 'native-terminal-window');
  }, [isNativePanelWindow, isNativeTerminalWindow]);

  useEffect(() => {
    const root = document.documentElement;
    Object.entries(appearanceTokens(theme)).forEach(([key, value]) => root.style.setProperty(key, value));
    localStorage.setItem('atlas-appearance', JSON.stringify(theme));
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('atlas-docks', JSON.stringify({ ...docks, order: columnOrder, hidden: hiddenColumns }));
  }, [docks, columnOrder, hiddenColumns]);

  useEffect(() => {
    function handleKey(event) {
      if (event.key === 'Escape') {
        if (columnDragRef.current) cancelColumnDrag();
        setModal(null);
        setAppearanceOpen(false);
      }
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault();
        setModal(null);
        setAppearanceOpen(true);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('pointermove', handleColumnPointerMove);
      window.removeEventListener('pointerup', finishColumnDrag);
      window.removeEventListener('pointercancel', cancelColumnDrag);
      window.removeEventListener('pointermove', handlePopupPointerMove);
      window.removeEventListener('pointerup', finishPopupDrag);
      window.removeEventListener('pointercancel', finishPopupDrag);
    };
  }, []);

  useEffect(() => {
    if (modal !== 'session' || !desktop?.isDesktop) return undefined;
    let active = true;
    setAdapters(null);
    desktop.listAdapters()
      .then((items) => { if (active) setAdapters(items); })
      .catch(() => { if (active) setAdapters([]); });
    return () => { active = false; };
  }, [modal]);

  function notify(message) {
    setToast(message);
    window.clearTimeout(window.__atlasToast);
    window.__atlasToast = window.setTimeout(() => setToast(''), 2600);
  }

  function reorderPanel(panel, target) {
    if (!PANEL_LABELS[panel] || !PANEL_LABELS[target] || panel === target) return;
    setDocks((current) => {
      const remaining = current.right.filter((id) => id !== panel);
      remaining.splice(remaining.indexOf(target), 0, panel);
      return { left: [], right: remaining };
    });
    setInspectorTab(panel);
    notify(`Ordem das seções atualizada`);
  }

  function beginColumnDrag(event, column) {
    if (event.button !== 0 || columnDragRef.current) return;
    event.preventDefault();
    const source = event.currentTarget.closest('[data-column-id]');
    if (!source) return;
    const rect = source.getBoundingClientRect();
    const session = {
      column,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: Math.min(rect.height, window.innerHeight - 16),
      originalOrder: [...columnOrder],
      previewOrder: [...columnOrder],
      target: null,
      moved: false,
    };
    columnDragRef.current = session;
    setColumnDrag(session);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handleColumnPointerMove);
    window.addEventListener('pointerup', finishColumnDrag);
    window.addEventListener('pointercancel', cancelColumnDrag);
  }

  function handleColumnPointerMove(event) {
    const session = columnDragRef.current;
    if (!session) return;
    if (!session.moved && Math.hypot(event.clientX - session.startX, event.clientY - session.startY) < 5) return;
    session.moved = true;
    session.x = Math.max(8, Math.min(event.clientX - session.offsetX, window.innerWidth - session.width - 8));
    session.y = Math.max(8, Math.min(event.clientY - session.offsetY, window.innerHeight - session.height - 8));

    const targetElement = document.elementsFromPoint(event.clientX, event.clientY)
      .map((element) => element.closest?.('[data-column-id]'))
      .find(Boolean);
    if (targetElement) {
      const target = targetElement.dataset.columnId;
      const rect = targetElement.getBoundingClientRect();
      const insertAfter = event.clientX > rect.left + rect.width / 2;
      const remaining = session.previewOrder.filter((id) => id !== session.column);
      const targetIndex = remaining.indexOf(target);
      if (targetIndex >= 0) {
        remaining.splice(targetIndex + (insertAfter ? 1 : 0), 0, session.column);
        session.previewOrder = remaining;
        session.target = target;
      }
    } else {
      session.target = null;
    }
    setColumnDrag({ ...session, previewOrder: [...session.previewOrder] });
  }

  function cleanupColumnDrag() {
    window.removeEventListener('pointermove', handleColumnPointerMove);
    window.removeEventListener('pointerup', finishColumnDrag);
    window.removeEventListener('pointercancel', cancelColumnDrag);
    columnDragRef.current = null;
    setColumnDrag(null);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  function cancelColumnDrag() {
    if (columnDragRef.current) cleanupColumnDrag();
  }

  function finishColumnDrag() {
    const session = columnDragRef.current;
    if (!session) return;
    if (session.moved) {
      setColumnOrder(session.previewOrder);
      notify(`Coluna ${COLUMN_LABELS[session.column]} reposicionada`);
    }
    cleanupColumnDrag();
  }

  async function toggleDetachedPanels() {
    if (columnDragRef.current) cancelColumnDrag();

    if (desktop?.isDesktop) {
      if (isNativePanelWindow || panelsDetached) {
        await desktop.closePanels();
        return;
      }
      const opened = await desktop.openPanels();
      if (opened) {
        setPanelsDetached(true);
        notify('Painéis destacados em janela sempre no topo');
      } else {
        notify('Não foi possível destacar os painéis');
      }
      return;
    }

    setPanelsDetached(!panelsDetached);
    notify(panelsDetached ? 'Painéis reintegrados ao workspace' : 'Painéis destacados em pop-up');
  }

  function beginPopupDrag(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    const windowElement = event.currentTarget.closest('.detached-panels-window');
    if (!windowElement) return;
    const rect = windowElement.getBoundingClientRect();
    popupDragRef.current = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, width: rect.width, height: rect.height };
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePopupPointerMove);
    window.addEventListener('pointerup', finishPopupDrag);
    window.addEventListener('pointercancel', finishPopupDrag);
  }

  function handlePopupPointerMove(event) {
    const session = popupDragRef.current;
    if (!session) return;
    setPopupPosition({
      x: Math.max(8, Math.min(event.clientX - session.offsetX, window.innerWidth - session.width - 8)),
      y: Math.max(8, Math.min(event.clientY - session.offsetY, window.innerHeight - session.height - 8)),
    });
  }

  function finishPopupDrag() {
    popupDragRef.current = null;
    window.removeEventListener('pointermove', handlePopupPointerMove);
    window.removeEventListener('pointerup', finishPopupDrag);
    window.removeEventListener('pointercancel', finishPopupDrag);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  async function refreshProjects() {
    setProjectsLoading(true);
    try {
      setProjects(await desktop.refreshProjects());
    } catch (error) {
      notify(`Falha ao atualizar repositórios: ${error.message}`);
    } finally {
      setProjectsLoading(false);
    }
  }

  async function addProject() {
    if (!desktop?.isDesktop) {
      notify('A descoberta Git real está disponível no aplicativo desktop');
      return;
    }
    setProjectsLoading(true);
    try {
      const items = await desktop.addProject();
      if (items) setProjects(items);
    } catch (error) {
      notify(`Não foi possível autorizar a pasta: ${error.message}`);
    } finally {
      setProjectsLoading(false);
    }
  }

  function selectWorktree(project, _repository, worktree) {
    projectSelectionRef.current = true;
    setActiveProject(project.name);
    setSelectedWorktree(worktree.path);
    setWorkingDirectory(worktree.path);
    notify(`${worktree.name} selecionada para o próximo terminal`);
  }

  function updateSessionExit(sessionId, exit, broadcast = true) {
    setSessions((current) => sessionExit(current, sessionId, exit));
    if (broadcast && isSecondaryWindow) panelChannelRef.current?.postMessage({ type: 'session-exit', sessionId, exit });
  }

  async function toggleTerminalPopup(session) {
    if (desktop?.isDesktop) {
      if (isNativeTerminalWindow) {
        await desktop.closeTerminalWindow();
        return;
      }
      if (detachedTerminals.includes(session.id)) {
        await desktop.closeTerminalWindow(session.id);
        setDetachedTerminals((current) => current.filter((id) => id !== session.id));
      } else {
        const opened = await desktop.openTerminalWindow(session.id, session.ptyId || null);
        if (opened) setDetachedTerminals((current) => [...new Set([...current, session.id])]);
        else notify('Não foi possível destacar o terminal');
      }
      return;
    }
    setDetachedTerminals((current) => current.includes(session.id) ? current.filter((id) => id !== session.id) : [...current, session.id]);
  }

  function toggleHiddenColumn(column) {
    setHiddenColumns((current) => ({ ...current, [column]: !current[column] }));
  }

  function resetLayout() {
    if (desktop?.isDesktop && !isNativePanelWindow) desktop.closePanels();
    detachedTerminals.forEach((id) => desktop?.isDesktop && desktop.closeTerminalWindow(id));
    setDocks({ left: [], right: ['task', 'messages', 'evidence'] });
    setColumnOrder(DEFAULT_COLUMN_ORDER);
    setHiddenColumns({ left: false, right: false });
    setDetachedTerminals([]);
    setPanelsDetached(false);
    setInspectorTab('task');
    notify('Layout padrão restaurado');
  }

  function focusSession(id) {
    const target = projectSessions.find((session) => session.id === id) || projectSessions[0];
    if (!target) { setFocusId(null); return; }
    setFocusId((current) => current === target.id ? null : target.id);
    setSelectedId(target.id);
  }

  async function createSession({ kind, name, cli, cwd }) {
    let id = `${kind}-${Date.now()}`;
    const isTerminal = kind === 'terminal';
    let pty = null;
    let agent = null;
    if (desktop?.isDesktop) {
      setCreatingTerminal(true);
      try {
        if (isTerminal) pty = await desktop.createTerminal({ cwd });
        else agent = await desktop.createAgent({ adapterId: cli, name, cwd });
      } catch (error) {
        setCreatingTerminal(false);
        return isTerminal ? `Não foi possível iniciar o PowerShell: ${error.message}` : error.message;
      }
      setCreatingTerminal(false);
    }
    if (agent) id = agent.id;
    const session = agent ? agentSession(agent) : {
      id,
      projectId: currentProject?.id,
      ptyId: pty?.id || agent?.ptyId || null,
      name: agent?.name || name || (isTerminal ? 'terminal-local' : 'nova-sessao'),
      role: isTerminal ? 'Shell sem identidade de agente' : agent ? 'Sessão de agente criada pelo usuário' : 'Sessão criada pelo usuário',
      origin: isTerminal ? 'terminal' : 'manual',
      cli: agent?.cli || (isTerminal ? 'PowerShell' : cli),
      version: agent?.version || null,
      model: isTerminal || agent ? null : 'automático',
      effort: isTerminal ? 'local' : agent ? null : 'medium',
      status: pty || agent ? 'em execução' : 'pronto',
      color: isTerminal ? '#8d959d' : '#4ecb8d',
      task: isTerminal ? activeProject : 'Missão cockpit interativo',
      tokens: '0',
      cost: '—',
      worktree: pty?.cwd || agent?.cwd || cwd || 'atlas/main',
      lines: isTerminal ? [
        { type: 'info', text: 'Windows PowerShell · terminal local ilustrativo' },
        { type: 'command', text: `PS ${cwd}>` },
      ] : [
        { type: 'success', text: '✓ sessão registrada no projeto ATLAS' },
        { type: 'info', text: 'Caixa de mensagens e contexto de missão disponíveis.' },
        { type: 'command', text: '❯ aguardando sua primeira instrução' },
      ],
    };
    setSessions((current) => [...current.filter((item) => item.id !== id), session]);
    setSelectedId(id);
    setFocusId(null);
    setModal(null);
    notify(pty ? 'PowerShell conectado ao PTY' : agent ? `${agent.cli} ${agent.version} iniciado na worktree selecionada` : isTerminal ? 'Terminal ilustrativo adicionado ao grid' : 'Sessão manual conectada à missão');
    return null;
  }

  function getColumnStyle(column) {
    const dragging = columnDrag?.moved && columnDrag.column === column;
    return {
      order: displayedColumnOrder.indexOf(column),
      ...(dragging ? {
        position: 'fixed',
        left: columnDrag.x,
        top: columnDrag.y,
        width: columnDrag.width,
        height: columnDrag.height,
        zIndex: 60,
        pointerEvents: 'none',
        margin: 0,
      } : {}),
    };
  }

  if (isNativePanelWindow) {
    return (
      <div className="native-panels-shell">
        <Inspector
          activeTask={activeTask}
          taskPanel={persistentTaskPanel}
          onTaskSelect={(task) => {
            setActiveTask(task);
            panelChannelRef.current?.postMessage({ type: 'task', taskId: task.id });
          }}
          tab={inspectorTab}
          onTabChange={(tab) => {
            setInspectorTab(tab);
            panelChannelRef.current?.postMessage({ type: 'tab', tab });
          }}
          panels={docks.right}
          onReorderPanel={(panel, target) => {
            reorderPanel(panel, target);
            panelChannelRef.current?.postMessage({ type: 'reorder', panel, target });
          }}
          detached
          native
          onToggleDetach={toggleDetachedPanels}
        />
      </div>
    );
  }

  if (isNativeTerminalWindow) {
    const popupSession = sessions.find((session) => session.id === desktop.sessionId);
    return (
      <div className="native-terminal-shell">
        {popupSession ? <SessionCard
          session={popupSession}
          selected
          popup
          desktop={desktop}
          theme={theme}
          onSelect={setSelectedId}
          onFocus={() => {}}
          onSend={(name) => notify(`Instrução ilustrativa registrada para ${name}`)}
          onPopup={toggleTerminalPopup}
          onExit={updateSessionExit}
        /> : <div className="terminal-window-loading">Carregando terminal…</div>}
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="brand"><AtlasMark /><strong>ATLAS</strong><span>0.1 · local</span></div>
        <div className="titlebar-center"><Radio size={12} /><span>AMBIENTE LOCAL</span></div>
        <div className="title-actions">{!desktop?.isDesktop && <><button className="text-control" title="Buscar">Buscar</button><button className="text-control notification-button" title="Notificações" aria-label="Notificações, 2 não lidas">Alertas <span>2</span></button></>}<button className="text-control" title="Aparência e configurações" onClick={() => setAppearanceOpen(true)}>Aparência</button><div className="user-avatar" aria-label="Perfil local">A</div></div>
      </header>

      <nav className="project-tabs" aria-label="Projetos">
        <button className="home-tab" title="Visão geral">Início</button>
        {(desktop?.isDesktop ? projects : ['ATLAS', 'Exemplo API', 'Exemplo UI'].map((name) => ({ name }))).map((project) => <button key={project.id || project.name} className={`project-tab ${activeProject === project.name ? 'active' : ''}`} onClick={() => { projectSelectionRef.current = true; setActiveProject(project.name); if (project.path) setWorkingDirectory(project.path); }}><StatusDot color={project.name === activeProject ? 'var(--accent)' : '#8b9399'} /><span>{project.name}</span>{project.repositories && <small>{project.repositories.length}</small>}</button>)}
        <button className="add-project" title="Autorizar pasta de projeto" aria-label="Autorizar pasta de projeto" onClick={addProject}>+</button>
        <div className="workspace-path"><FolderGit2 size={13} /><span>{workingDirectory}</span></div>
        <div className="demo-label">{desktop?.isDesktop ? 'SESSÕES LOCAIS' : 'AGENTES ILUSTRATIVOS'}</div>
      </nav>

      <div className="workspace-body">
        {columnDrag?.moved && <div
          className="column-drag-placeholder"
          data-column-id={columnDrag.column}
          style={{ order: displayedColumnOrder.indexOf(columnDrag.column), width: columnDrag.width, flex: `0 0 ${columnDrag.width}px` }}
          aria-hidden="true"
        />}
        {!hiddenColumns.left && <div
          className={`left-dock-zone ${columnDrag?.target === 'left' ? 'column-drag-over' : ''} ${columnDrag?.moved && columnDrag.column === 'left' ? 'column-drag-source' : ''}`}
          style={getColumnStyle('left')}
          data-column-id="left"
        >
          <div className="column-drag-bar" onPointerDown={(event) => beginColumnDrag(event, 'left')}>
            <strong>Navegação</strong><span>Arrastar coluna</span>
            <button type="button" className="detach-control" onPointerDown={(event) => event.stopPropagation()} onClick={() => toggleHiddenColumn('left')} aria-expanded="true" aria-controls="atlas-navigation">Ocultar</button>
          </div>
          <aside className="sidebar" id="atlas-navigation">
            <div className="sidebar-primary">
              <button className="active"><Grid2X2 size={15} /><span>Cockpit</span><kbd>1</kbd></button>
              <button onClick={() => setInspectorTab('task')} title="Abrir Tarefas"><ListTodo size={15} /><span>Tarefas</span><small>{desktop?.isDesktop ? taskState.items.length : 8}</small></button>
              {!desktop?.isDesktop && <><button><Inbox size={15} /><span>Pendências</span><small className="amber">3</small></button><button><Workflow size={15} /><span>Execuções</span><small>4</small></button></>}
            </div>
            {!desktop?.isDesktop && <div className="sidebar-section">
              <div className="sidebar-heading"><span>MISSÕES</span><button><Plus size={13} /></button></div>
              <div className="mission-list">
                {missions.map((mission) => <button key={mission.name} className={activeMission === mission.name ? 'active' : ''} onClick={() => setActiveMission(mission.name)}><StatusDot color={mission.color} pulse={activeMission === mission.name} /><span>{mission.name}</span><small>{mission.count}</small></button>)}
              </div>
            </div>}
            <GitDiscovery projects={projects} selectedWorktree={selectedWorktree} onSelect={selectWorktree} onRefresh={refreshProjects} loading={projectsLoading} />
            <div className="sidebar-section pinned-section">
              <div className="sidebar-heading"><span>ATALHOS</span></div>
              <button className="sidebar-link"><Keyboard size={14} /><span>Comandos e teclas</span><kbd>?</kbd></button>
              <button className="sidebar-link"><GitBranch size={14} /><span>Worktrees</span><small>{worktreeOptions.length}</small></button>
              <button className="sidebar-link"><Activity size={14} /><span>Eventos</span></button>
            </div>
            <div className="sidebar-bottom">
              <div className="local-card"><div><ShieldCheck size={15} /><strong>Local e privado</strong></div><p>Git + PTY local<br />Nenhuma telemetria ativa</p><span><StatusDot color="#7dbb91" />Núcleo disponível</span></div>
              <button className="workspace-settings" onClick={resetLayout}><span>Restaurar layout</span></button>
              <button className="workspace-settings" onClick={() => setAppearanceOpen(true)}><Palette size={14} /><span>Aparência e configurações</span><ChevronRight size={13} /></button>
            </div>
          </aside>
        </div>}

        <main
          className={`cockpit ${columnDrag?.target === 'center' ? 'column-drag-over' : ''} ${columnDrag?.moved && columnDrag.column === 'center' ? 'column-drag-source' : ''}`}
          style={getColumnStyle('center')}
          data-column-id="center"
        >
          <div className="column-drag-bar" onPointerDown={(event) => beginColumnDrag(event, 'center')}>
            <strong>Terminais</strong><span>Arrastar coluna</span>
          </div>
          <div className="cockpit-toolbar">
            <div className="mission-title"><div className="mission-symbol"><Zap size={16} /></div><div><span>{desktop?.isDesktop ? 'PROJETO ATIVO' : 'MISSÃO ATIVA'}</span><h1>{desktop?.isDesktop ? currentProject?.name || activeProject : activeMission}</h1></div><button className="icon-button subtle"><ChevronDown size={15} /></button></div>
            <div className="toolbar-actions">
              {hiddenColumns.left && <button className="button secondary compact" onClick={() => toggleHiddenColumn('left')} aria-expanded="false" aria-controls="atlas-navigation">Navegação</button>}
              {hiddenColumns.right && <button className="button secondary compact" onClick={() => toggleHiddenColumn('right')} aria-expanded="false" aria-controls="atlas-panels">Painéis</button>}
              <button className="button secondary compact" onClick={() => setModal('terminal')}><SquareTerminal size={14} />Terminal</button>
              <button className="button primary compact" onClick={() => setModal('session')}><Plus size={14} />Sessão</button>
              <span className="toolbar-divider" />
              <button className={`icon-button ${focusId ? 'active' : ''}`} title="Exibir grid" onClick={() => setFocusId(null)}><Grid2X2 size={15} /></button>
              <button className="icon-button" title="Modo de foco" onClick={() => focusSession(selectedId)}><Maximize2 size={15} /></button>
            </div>
          </div>
          <div className="mission-subbar">
            <div><StatusDot color="#f2994a" /><span>{projectSessions.length} sessões neste projeto</span></div>
            <span>{desktop?.isDesktop ? 'Histórico e sessões locais' : 'Wireframe ilustrativo'}</span>
          </div>

          {desktop?.isDesktop && orchestratorStatus.projectId === currentProject?.id && orchestratorStatus.loading && <p className="scope-note" role="status">Abrindo sessão principal…</p>}
          {desktop?.isDesktop && orchestratorStatus.projectId === currentProject?.id && orchestratorStatus.error && <div className="scope-note error-note" role="alert"><span>{orchestratorStatus.error}</span><button className="button secondary compact" onClick={() => restartOrchestrator()}>Tentar novamente</button></div>}

          <div className={`session-grid ${focusId ? 'focus-mode' : ''}`}>
            {visibleSessions.map((session) => <SessionCard
              key={session.id}
              session={session}
              selected={selectedId === session.id}
              focused={focusId === session.id}
              detached={detachedTerminals.includes(session.id)}
              desktop={desktop}
              theme={theme}
              onSelect={setSelectedId}
              onFocus={focusSession}
              onPopup={toggleTerminalPopup}
              onExit={updateSessionExit}
              onRestart={restartOrchestrator}
              onSend={(name) => notify(`Instrução ilustrativa registrada para ${name}`)}
            />)}
            {!focusId && <button className="empty-session" onClick={() => setModal('session')}><span><Plus size={19} /></span><strong>Nova sessão de agente</strong><small>Manual, no diretório selecionado</small></button>}
          </div>
        </main>

        {!panelsDetached && !hiddenColumns.right && <Inspector
          activeTask={activeTask} onTaskSelect={setActiveTask}
          taskPanel={persistentTaskPanel}
          tab={inspectorTab} onTabChange={setInspectorTab}
          panels={docks.right} onReorderPanel={reorderPanel}
          columnDragOver={columnDrag?.target === 'right'}
          columnDragging={columnDrag?.moved && columnDrag.column === 'right'}
          onColumnPointerDown={beginColumnDrag}
          onToggleDetach={toggleDetachedPanels}
          onHideColumn={() => toggleHiddenColumn('right')}
          style={getColumnStyle('right')}
        />}
      </div>

      <footer className="statusbar">
        <div><span className="statusbar-brand"><AtlasMark />{activeProject}</span><span><GitBranch size={11} />{worktreeOptions.find((item) => item.path === selectedWorktree)?.branch || 'projeto local'}</span><span><ShieldCheck size={11} />escopo autorizado</span></div>
        <div><span>Git somente leitura</span><span>Scrollback em memória</span><span className="statusbar-mode">MANUAL</span></div>
      </footer>

      {panelsDetached && !desktop?.isDesktop && <div className="detached-panels-window" style={{ left: popupPosition.x, top: popupPosition.y }}>
        <Inspector
          activeTask={activeTask} onTaskSelect={setActiveTask}
          taskPanel={persistentTaskPanel}
          tab={inspectorTab} onTabChange={setInspectorTab}
          panels={docks.right} onReorderPanel={reorderPanel}
          detached onToggleDetach={toggleDetachedPanels}
          onPopupPointerDown={beginPopupDrag}
        />
      </div>}

      {!desktop?.isDesktop && detachedTerminals.map((id, index) => {
        const session = sessions.find((item) => item.id === id);
        return session ? <div className="detached-terminal-window" style={{ right: 24 + index * 24, top: 72 + index * 24 }} key={id}><SessionCard session={session} selected popup desktop={desktop} theme={theme} onSelect={setSelectedId} onFocus={() => {}} onPopup={toggleTerminalPopup} onExit={updateSessionExit} onSend={(name) => notify(`Instrução ilustrativa registrada para ${name}`)} /></div> : null;
      })}

      {modal && <NewSessionModal kind={modal} onClose={() => setModal(null)} onCreate={createSession} workingDirectory={workingDirectory} worktrees={worktreeOptions.length ? worktreeOptions : [{ path: workingDirectory, label: 'Diretório atual', branch: 'autorizado' }]} onDirectoryChange={(cwd) => { setWorkingDirectory(cwd); setSelectedWorktree(cwd); }} busy={creatingTerminal} adapters={desktop?.isDesktop ? adapters : undefined} loadingAdapters={Boolean(desktop?.isDesktop && modal === 'session' && adapters === null)} />}
      {appearanceOpen && <AppearanceModal theme={theme} onChange={setTheme} onClose={() => setAppearanceOpen(false)} />}
      {taskModalOpen && <NewTaskModal projectName={taskState.projectName} cwd={workingDirectory} onCreate={createTask} onClose={() => setTaskModalOpen(false)} />}
      {toast && <div className="toast" role="status"><CheckCircle2 size={15} />{toast}</div>}
    </div>
  );
}
