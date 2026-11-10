import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Bell,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  FileCode2,
  Focus,
  FolderGit2,
  GitBranch,
  Layers3,
  ListTodo,
  MessageSquare,
  MoreHorizontal,
  Palette,
  Plus,
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
} from 'lucide-react';
import TerminalView from './TerminalView.jsx';
import WorkspaceTree from './WorkspaceTree.jsx';
import SessionGlyph from './SessionGlyph.jsx';
import { OVERLAY_BARS, effectiveBackground } from './window-overlay.js';
import { appearanceTokens, contrastInk, isPreviousDefaultTheme, visibleAccent } from './appearance.js';
import useModalFocus from './useModalFocus.js';
import CommandPalette from './CommandPalette.jsx';
import { atlasDecisions } from './atlas-panel.js';
import { nextVisibleSessionId, normalizeTerminalLayout, sessionsInLayout, visibleWorkspaceSessions, workspaceSessions } from './workspace-layout.js';
import { agentSession, mergeAgentSessions, restoreSummary, sessionExit, terminalSession, usesGemini, usesKimi } from './session-state.js';
import { AgentChoice } from './AgentChoice.jsx';
import { PersistentTaskPanel, NewTaskModal, TaskEvidencePanel } from './PersistentTasks.jsx';
import { SessionMessagesPanel, NewMessageModal } from './SessionMessages.jsx';
import { KimiIntegrationModal, KimiIntegrationNotice, KimiIntegrationStatus } from './KimiIntegration.jsx';

// Integrações MCP que dependem de consentimento: métodos da ponte do preload por CLI.
const INTEGRATION_CLIS = {
  kimi: { name: 'Kimi', get: 'getKimiIntegration', install: 'installKimiIntegration', remove: 'removeKimiIntegration' },
  gemini: { name: 'Gemini', get: 'getGeminiIntegration', install: 'installGeminiIntegration', remove: 'removeGeminiIntegration' },
};
import { AgentRequestsPanel } from './AgentRequests.jsx';
import { RegressionSuiteModal, RegressionSuiteStatus } from './RegressionSuite.jsx';
import { AgentFunctionsModal } from './AgentFunctions.jsx';
import { ModelSwitchModal } from './ModelSwitch.jsx';
import { canSwitch, modelLabel } from './model-switch.js';
import { choiceFromFunction, describeChoice, pendingConfiguration, pickRecommendation, startChoices } from './agent-functions.js';
import { OpenFolderModal, ExplorerIntegrationSection } from './OpenFolder.jsx';

// Mensagem de erro do processo principal sem o prefixo técnico do IPC do Electron.
function cleanIpcError(error) {
  return String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

const THEME_PRESETS = [
  { name: 'Marfim', color: '#e6dcc8' },
  { name: 'Ouro', color: '#c8a76b' },
  { name: 'Laranja', color: '#f2994a' },
  { name: 'Petróleo', color: '#35b6c9' },
  { name: 'Azul', color: '#5b9cf5' },
  { name: 'Verde', color: '#4ecb8d' },
  { name: 'Violeta', color: '#a685f2' },
  { name: 'Vermelho', color: '#ef6363' },
];
const BACKGROUND_PRESETS = [
  { name: 'Obsidiana', background: '#09090a' },
  { name: 'Grafite', background: '#080a0b' },
  { name: 'Preto', background: '#000000' },
  { name: 'Azul-noturno', background: '#111722' },
  { name: 'Névoa', background: '#eef1f4' },
  { name: 'Papel', background: '#f7f4ed' },
];
const DEFAULT_THEME = { name: 'Marfim', color: '#e6dcc8', background: '#09090a' };
const INITIAL_DIRECTORY = 'C:\\projetos\\atlas';

function getInitialTheme() {
  try {
    const saved = JSON.parse(localStorage.getItem('atlas-appearance'));
    if (isPreviousDefaultTheme(saved)) return DEFAULT_THEME;
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
  return { docks: DEFAULT_DOCKS, order: DEFAULT_COLUMN_ORDER, hidden: { left: false, right: true } };
}

function getInitialTerminalWorkspace() {
  try {
    const saved = JSON.parse(localStorage.getItem('atlas-terminal-workspace'));
    return {
      layout: normalizeTerminalLayout(saved?.layout),
      hiddenSessionIds: Array.isArray(saved?.hiddenSessionIds) ? saved.hiddenSessionIds.filter((id) => typeof id === 'string') : [],
    };
  } catch {
    return { layout: 'grid', hiddenSessionIds: [] };
  }
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

// A estátua do logo é a marca do ATLAS (imagem em src/assets, sem rede).
function AtlasMark() {
  return <span className="atlas-statue-mark" aria-hidden="true" />;
}

const ORBIT_PATH = 'M0 332a320 92 0 1 0 640 0a320 92 0 1 0-640 0';
// Projeto sem sessões: o Atlas recebe o usuário. O movimento respeita "reduzir movimento" pelo CSS.
function AtlasWelcome({ projectName, launcher = null }) {
  return (
    <div className={`atlas-welcome ${launcher ? 'with-launcher' : ''}`}>
      <div className="atlas-welcome-stage" aria-hidden="true">
        <span className="atlas-statue" />
        <svg viewBox="0 0 640 955"><g transform="rotate(-14 320 332)"><path d={ORBIT_PATH} /><path d="M70 332a250 66 0 1 0 500 0a250 66 0 1 0-500 0" transform="rotate(36 320 332)" /></g></svg>
      </div>
      <div className="atlas-welcome-wordmark" aria-hidden="true">ATLAS</div>
      <h2 id="atlas-welcome-title">{launcher ? `Como começar em ${projectName}?` : `Nenhuma sessão em ${projectName}`}</h2>
      <p>{launcher ? 'Escolha a função. O CLI e o modelo vêm dela, e você confirma antes de qualquer agente iniciar.' : 'Abra um terminal ou uma sessão de agente. Nenhum agente começa sem a sua confirmação, e é você quem escolhe o CLI e o modelo.'}</p>
      {launcher}
    </div>
  );
}

// Projeto sem sessões vivas: em vez de reabrir terminais, o usuário escolhe a função.
// Cada opção só abre o diálogo preenchido; nenhuma sessão inicia sem confirmação.
function StartLauncher({ functions, adapters, principalWaiting, onPrincipal, onFunction, onTerminal }) {
  const { principal, agents } = startChoices(functions?.items);
  const meta = (item) => item?.adapterId ? describeChoice(item, adapters) : 'Não configurada';
  const row = ({ slug, name, description, item, onClick, lead = false, state = null }) => (
    <li key={slug}>
      <button type="button" className={`start-choice ${lead ? 'principal' : ''}`} data-function={slug} title={description || undefined} onClick={onClick}>
        <span className="start-choice-text">
          <strong>{name}{state && <span className="start-choice-state">{state}</span>}</strong>
          {description && <span>{description}</span>}
        </span>
        <small className={item?.adapterId ? '' : 'pending'}>{meta(item)}</small>
        <ChevronRight size={15} aria-hidden="true" />
      </button>
    </li>
  );
  return (
    <nav className="start-launcher" aria-labelledby="atlas-welcome-title">
      <ul>{row({ slug: 'orquestrador', name: 'Sessão principal', description: 'Planeja e delega; pede agentes com a sua aprovação.', item: principal, onClick: onPrincipal, lead: true, state: principalWaiting ? 'ainda não iniciada' : null })}</ul>
      {agents.length > 0 && <>
        <h3 className="start-launcher-label" id="start-agents-label">Agente com função</h3>
        <ul aria-labelledby="start-agents-label">
          {agents.map((item) => row({ slug: item.slug, name: item.name, description: item.description, item, onClick: () => onFunction(item.slug) }))}
        </ul>
      </>}
      <div className="start-launcher-secondary">
        <button type="button" className="text-control" data-function="" onClick={() => onFunction('')}><Plus size={14} />Agente sem função</button>
        <button type="button" className="text-control" onClick={onTerminal}><SquareTerminal size={14} />Terminal</button>
      </div>
    </nav>
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

function SessionActions({ session, onFocus, onPopup, onHide, onRestart, onSendDiscovery, onSwitchModel, focused, detached, popup }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const actions = [
    session.roleKind === 'orchestrator' && session.exited && onRestart && { id: 'restart', label: 'Nova execução', run: () => onRestart(session) },
    onSwitchModel && session.ptyId && !session.exited && { id: 'model', label: 'Trocar modelo', run: () => onSwitchModel(session), disabled: !canSwitch(session).allowed, title: canSwitch(session).allowed ? 'Informe o modelo trocado no terminal' : canSwitch(session).reason },
    onSendDiscovery && session.roleKind === 'agent' && !session.archived && { id: 'discovery', label: 'Enviar descoberta', run: () => onSendDiscovery(session) },
    !session.archived && { id: 'popup', label: detached || popup ? 'Reintegrar' : 'Abrir em pop-up', run: () => onPopup(session) },
    !popup && !detached && { id: 'focus', label: focused ? 'Voltar à grade' : 'Focar terminal', run: () => onFocus(session.id), ariaLabel: `Focar ${session.name}` },
    !popup && !detached && onHide && { id: 'hide', label: 'Ocultar terminal', run: () => onHide(session.id), ariaLabel: `Ocultar ${session.name} sem encerrar o processo` },
  ].filter(Boolean);

  useEffect(() => {
    if (!open) return undefined;
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
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, [open]);

  if (!actions.length) return null;
  return <div className="session-menu" ref={rootRef}>
    <button ref={triggerRef} type="button" className="session-control session-menu-trigger" aria-label={`Ações de ${session.name}`} title="Ações do terminal" aria-expanded={open} aria-controls={`session-actions-${session.id}`} onClick={(event) => { event.stopPropagation(); setOpen((current) => !current); }}><MoreHorizontal size={15} aria-hidden="true" /></button>
    {open && <div id={`session-actions-${session.id}`} className="session-menu-popover" aria-label={`Ações de ${session.name}`}>
      {actions.map((action) => <button
        type="button"
        className="session-menu-item"
        key={action.id}
        data-action={action.id}
        disabled={action.disabled}
        title={action.title}
        aria-label={action.ariaLabel}
        onClick={(event) => { event.stopPropagation(); setOpen(false); action.run(); }}
      >{action.label}</button>)}
    </div>}
  </div>;
}

function SessionCard({ session, selected, focused, onSelect, onFocus, onSend, onPopup, onHide, onExit, onRestart, onSendDiscovery, atlasConnected = false, desktop, theme, detached = false, popup = false, functions = null, onSetFunction, onSwitchModel, tabbed = false }) {
  const [draft, setDraft] = useState('');
  const [localLines, setLocalLines] = useState([]);
  const cli = session.cli.toLowerCase();
  const harness = cli.includes('claude') ? 'claude' : cli.includes('kimi') ? 'kimi' : cli.includes('codex') ? 'codex' : 'shell';
  const agentFunctions = (functions?.items || []).filter((item) => item.kind !== 'orchestrator');
  const functionLabel = (functions?.items || []).find((item) => item.slug === session.functionSlug)?.name || session.functionSlug;
  const displayName = session.roleKind === 'orchestrator' ? 'Principal' : functionLabel || session.name;
  const headerDetails = [session.name, session.origin, session.status, session.version ? `${session.cli} ${session.version}` : session.cli, modelLabel(session), atlasConnected && !session.exited ? 'ATLAS conectado' : ''].filter(Boolean).join(' · ');

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
      id={`terminal-panel-${session.id}`}
      role={tabbed ? 'tabpanel' : undefined}
      aria-labelledby={tabbed ? `terminal-tab-${session.id}` : undefined}
      data-session-id={session.id}
      data-session-name={session.name}
      className={`session-card ${selected ? 'selected' : ''} ${focused ? 'focused' : ''} ${detached ? 'terminal-detached' : ''} ${popup ? 'terminal-popup-card' : ''}`}
      style={{ '--session-color': session.color }}
      onClick={() => onSelect(session.id)}
    >
      <header className="session-header" title={headerDetails}>
        <div className="session-identity">
          <SessionGlyph session={session} />
          {onSetFunction && session.roleKind === 'agent' && !session.exited && agentFunctions.length
            ? <select className="session-function" aria-label={`Função de ${session.name}`} value={session.functionSlug || ''} onClick={(event) => event.stopPropagation()} onChange={(event) => onSetFunction(session, event.target.value)}>
              <option value="">Sem função</option>
              {agentFunctions.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}
            </select>
            : <h3>{displayName}</h3>}
          {session.demo && <span className="origin-badge demo">ilustrativo</span>}
        </div>
        <div className="session-actions">
          <SessionActions session={session} onFocus={onFocus} onPopup={onPopup} onHide={onHide} onRestart={onRestart} onSendDiscovery={onSendDiscovery} onSwitchModel={onSwitchModel} focused={focused} detached={detached} popup={popup} />
        </div>
      </header>

      {detached ? <div className="detached-terminal-placeholder"><span>Terminal aberto em outra janela.</span><button className="button secondary compact" onClick={() => onPopup(session)}>Reintegrar</button></div> : <>
        <div className={`terminal-window harness-${harness} ${session.ptyId ? 'real-terminal' : ''}`} aria-label={session.archived ? `Histórico de ${session.name}` : `Terminal interativo nativo do ${session.cli}`}>
          {session.archived ? <div className="session-history">
            <strong>Histórico de sessão</strong>
            <p>{session.status}. Nenhum processo está conectado.</p>
            <p>O conteúdo do terminal não foi salvo. Abra uma nova sessão para continuar o trabalho.</p>
            <dl><dt>Diretório</dt><dd>{session.worktree}</dd><dt>Início</dt><dd>{session.createdAt}</dd><dt>Fim registrado</dt><dd>{session.endedAt || 'sem confirmação'}</dd></dl>
          </div> : session.ptyId ? <TerminalView terminalId={session.ptyId} desktop={desktop} theme={{ ...theme, color: visibleAccent(theme.color, theme.background), ink: getAccentInk(theme.background) }} onExit={(exit) => onExit(session.id, { ...exit, ptyId: session.ptyId })} /> : <>
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
      </>}
    </article>
  );
}

function NewSessionModal({ kind, onClose, onCreate, workingDirectory, worktrees, onDirectoryChange, busy, adapters = null, loadingAdapters = false, functions = null, initialFunction = '' }) {
  const dialogRef = useModalFocus();
  const [error, setError] = useState('');
  const isTerminal = kind === 'terminal';
  const realAdapters = !isTerminal && Array.isArray(adapters);
  // Função opcional: só preenche CLI e modelo com o que o usuário salvou nela. Vinda da
  // tela inicial, já chega escolhida; o usuário ainda confirma ou troca tudo.
  const agentFunctions = (functions?.items || []).filter((item) => item.kind !== 'orchestrator');
  const startFunction = !isTerminal && agentFunctions.some((item) => item.slug === initialFunction) ? initialFunction : '';
  const [choice, setChoice] = useState(() => choiceFromFunction(agentFunctions.find((item) => item.slug === startFunction) || null));
  const [functionSlug, setFunctionSlug] = useState(startFunction);
  function selectFunction(slug) {
    setFunctionSlug(slug);
    setChoice(choiceFromFunction(agentFunctions.find((item) => item.slug === slug) || null));
  }
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
          if (realAdapters && !choice.ready) return;
          const failure = await onCreate({ kind, name: data.get('name'), cli: realAdapters ? choice.adapterId : data.get('cli'), model: realAdapters ? choice.model || null : null, functionSlug: realAdapters ? functionSlug || null : null, cwd: data.get('cwd') || workingDirectory });
          if (failure) setError(failure);
        }}>
          <label>Nome da {isTerminal ? 'janela' : 'sessão'}<input name="name" defaultValue={isTerminal ? 'powershell-local' : 'nova-investigacao'} autoFocus /></label>
          {!isTerminal && realAdapters && agentFunctions.length > 0 && <label>Usar função
            <select name="function" value={functionSlug} onChange={(event) => selectFunction(event.target.value)} disabled={busy}>
              <option value="">Sem função</option>
              {agentFunctions.map((item) => <option key={item.slug} value={item.slug}>{item.name}{item.adapterId ? '' : ' (não configurada)'}</option>)}
            </select>
          </label>}
          {!isTerminal && (realAdapters || loadingAdapters)
            ? <AgentChoice key={functionSlug || 'none'} adapters={loadingAdapters ? null : adapters} value={choice} onChange={setChoice} disabled={busy} recommendation={functionSlug ? pickRecommendation(functions?.recommendations, functionSlug, adapters) : null} />
            : !isTerminal && <label>CLI / harness<select name="cli" defaultValue="Claude Code"><option>Claude Code</option><option>Kimi Code</option><option>Codex</option><option>CLI personalizado</option></select></label>}
          <label>Worktree ou diretório<select name="cwd" value={workingDirectory} onChange={(event) => onDirectoryChange(event.target.value)}>{worktrees.map((item) => <option value={item.path} key={item.path}>{item.label} — {item.branch || 'diretório autorizado'}</option>)}</select></label>
          <div className="path-input"><FolderGit2 size={15} /><span>{workingDirectory}</span><CheckCircle2 size={15} /></div>
          {!isTerminal && !realAdapters && !loadingAdapters && <div className="form-grid"><label>Modelo<select defaultValue="Automático"><option>Automático</option><option>Modelo forte</option><option>Modelo econômico</option></select></label><label>Vínculo<select defaultValue="Missão atual"><option>Missão atual</option><option>Somente projeto</option><option>Independente</option></select></label></div>}
          <div className="scope-note"><ShieldCheck size={16} /><span>{isTerminal ? 'PowerShell real no diretório selecionado, sem identidade de agente.' : realAdapters ? 'O CLI escolhido inicia interativo neste diretório, com o modelo escolhido; as permissões continuam no harness.' : 'A sessão nascerá registrada e poderá trocar mensagens com outras sessões autorizadas.'}</span></div>
          {error && <div className="scope-note error-note" role="alert"><ShieldCheck size={16} /><span>{error}</span></div>}
          <footer><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button type="submit" className="button primary" disabled={busy || loadingAdapters || (realAdapters && !choice.ready)}><Plus size={15} />{busy ? 'Abrindo…' : isTerminal ? 'Abrir terminal' : 'Criar sessão'}</button></footer>
        </form>
      </section>
    </div>
  );
}

// `mode`: modo salvo no projeto ('coordinate' ou 'auto'); null enquanto carrega.
function OrchestratorChoiceModal({ adapters, previousCli, busy, error, onClose, onStart, functions = null, mode = null }) {
  const dialogRef = useModalFocus();
  const orchestrator = (functions?.items || []).find((item) => item.kind === 'orchestrator') || null;
  const [choice, setChoice] = useState(() => choiceFromFunction(orchestrator));
  // "Principal só coordena": ligada por padrão; só o usuário desliga, e vale para esta e as próximas runs.
  const [coordinateOnly, setCoordinateOnly] = useState(mode !== 'auto');
  useEffect(() => { if (mode) setCoordinateOnly(mode !== 'auto'); }, [mode]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section ref={dialogRef} className="modal" onMouseDown={(event) => event.stopPropagation()} aria-modal="true" role="dialog" aria-labelledby="orchestrator-choice-title">
        <header>
          <div>
            <span className="eyebrow">SESSÃO PRINCIPAL</span>
            <h2 id="orchestrator-choice-title">Escolher o agente da principal</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="Fechar" aria-label="Fechar"><X size={18} /></button>
        </header>
        <form onSubmit={(event) => { event.preventDefault(); if (choice.ready && !busy && mode) onStart({ ...choice, orchestratorMode: coordinateOnly ? 'coordinate' : 'auto' }); }}>
          <p className="agent-choice-note">{orchestrator?.adapterId ? 'Preenchido com o que você salvou para o Orquestrador. Confirme ou troque.' : 'Recomendado: o modelo mais capaz que você tiver; o Orquestrador planeja e delega, e um erro dele se espalha pelos agentes. Salve a escolha em Funções de agente para vir preenchida.'}</p>
          <AgentChoice adapters={adapters} value={choice} onChange={setChoice} disabled={busy} recommendation={pickRecommendation(functions?.recommendations, 'orquestrador', adapters)} />
          <label className="regression-switch orchestrator-mode-switch">
            <input type="checkbox" role="switch" name="coordinate-only" checked={coordinateOnly} disabled={busy || !mode} aria-describedby="orchestrator-mode-help" onChange={(event) => setCoordinateOnly(event.target.checked)} />
            <span>Principal só coordena</span>
          </label>
          <p id="orchestrator-mode-help" className={`agent-choice-note${coordinateOnly ? '' : ' orchestrator-mode-warning'}`} role={coordinateOnly ? undefined : 'note'}>{coordinateOnly
            ? 'Ela só lê e delega: todo trabalho com escrita vai para um agente, que passa pela revisão e pela suíte.'
            : 'Ela pode fazer sozinha alterações pequenas e claras na pasta do projeto, com as aprovações do CLI, e delega o resto. Essas edições não passam pela revisão de tarefa nem pela suíte de regressão, e o shell do CLI consegue ler o .env. Vale para este projeto até você ligar de novo.'}</p>
          <div className="scope-note"><ShieldCheck size={16} /><span>{coordinateOnly ? 'A principal planeja e delega: abre somente leitura, com as ferramentas do ATLAS deste projeto.' : 'A principal planeja, delega e faz o que é pequeno, com as ferramentas do ATLAS deste projeto.'}{previousCli ? ` A execução anterior usou ${previousCli}; a identidade, as tarefas e as mensagens continuam.` : ''}</span></div>
          {error && <div className="scope-note error-note" role="alert"><ShieldCheck size={16} /><span>{error}</span></div>}
          <footer><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" className="button primary" disabled={busy || !choice.ready || !mode}>{busy ? 'Iniciando…' : 'Iniciar principal'}</button></footer>
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
          {window.atlasDesktop?.isDesktop && window.atlasDesktop.getExplorerIntegration && <ExplorerIntegrationSection desktop={window.atlasDesktop} />}
          <div className="appearance-preview"><span className="preview-line" /><div><small>PRÉ-VISUALIZAÇÃO</small><strong>O terminal continua em primeiro plano.</strong><p>Destaque e fundo são independentes.</p></div><button className="button primary compact" type="button">Ação principal</button></div>
          <footer><span>Salvo automaticamente neste dispositivo.</span><button type="button" className="button secondary" onClick={onClose}>Concluir</button></footer>
        </div>
      </section>
    </div>
  );
}

const PANEL_LABELS = { task: 'Tarefas', messages: 'Mensagens', evidence: 'Evidências' };

function Inspector({ activeTask, onTaskSelect, tab, onTabChange, panels, onReorderPanel, columnDragOver, columnDragging, onColumnPointerDown, style, detached = false, native = false, onToggleDetach, onPopupPointerDown, onHideColumn, taskPanel, messagesPanel, evidencePanel, unreadMessages }) {
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
              >{PANEL_LABELS[id]}{id === 'messages' && (messagesPanel ? (unreadMessages > 0 && <span className="tab-badge">{unreadMessages}</span>) : <span className="tab-badge">2</span>)}</button>
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

      {activePanel === 'messages' && (messagesPanel || <section className="messages-panel">
        <div className="section-kicker"><span>COLABORAÇÃO</span><span>2 não lidas</span></div>
        <h2>Mensagens entre sessões</h2>
        <div className="message-card unread"><div className="message-route"><span>exploracao-terminal</span><Send size={12} /><span>orquestrador</span></div><p>Resize e entrada validados. Encontrei uma divergência no tratamento de sequências ANSI.</p><small>ATL-024 · agora · mensagem #0184</small></div>
        <div className="message-card unread"><div className="message-route"><span>atlas-core</span><Send size={12} /><span>orquestrador</span></div><p>Contratos revisados. Handoff pronto para revisão com 17 testes registrados.</p><small>ATL-031 · 2 min · handoff #0042</small></div>
        <div className="message-card"><div className="message-route"><span>orquestrador</span><Send size={12} /><span>atlas-core</span></div><p>Priorize o caso de entrega duplicada antes de submeter a revisão.</p><small>ATL-031 · 8 min · lida</small></div>
      </section>)}

      {activePanel === 'evidence' && (evidencePanel || <section className="evidence-panel">
        <div className="section-kicker"><span>ENTREGA VERIFICÁVEL</span><ShieldCheck size={15} /></div>
        <h2>{activeTask.id}</h2>
        <div className="evidence-item"><GitBranch size={16} /><div><strong>Worktree e diff</strong><span>atlas/session-messages</span><small>base 8f31a2c · 6 arquivos alterados</small></div><ChevronRight size={14} /></div>
        <div className="evidence-item"><TestTube2 size={16} /><div><strong>Testes de contrato</strong><span className="success-text">17 aprovados</span><small>node 24 · ambiente local</small></div><ChevronRight size={14} /></div>
        <div className="evidence-item"><FileCode2 size={16} /><div><strong>Handoff estruturado</strong><span>handoff #0042</span><small>objetivo, decisões e próximos passos</small></div><ChevronRight size={14} /></div>
        <div className="evidence-note"><ShieldCheck size={17} /><p>Uma run concluída não marca a tarefa como pronta automaticamente.</p></div>
      </section>)}
        </div>
      </> : null}
    </aside>
  );
}

export default function App() {
  const [sessions, setSessions] = useState(() => window.atlasDesktop?.isDesktop ? [] : initialSessions);
  const [selectedId, setSelectedId] = useState('orchestrator');
  const [focusId, setFocusId] = useState(null);
  const [initialTerminalWorkspace] = useState(getInitialTerminalWorkspace);
  const [terminalLayout, setTerminalLayout] = useState(initialTerminalWorkspace.layout);
  const [hiddenSessionIds, setHiddenSessionIds] = useState(initialTerminalWorkspace.hiddenSessionIds);
  const [statusOpen, setStatusOpen] = useState(false);
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
  const [taskState, setTaskState] = useState({ projectId: null, projectName: '', items: [], handoffs: [], loading: false, error: '' });
  const taskScope = useRef({ projectId: null, cwd: '' });
  const taskReloadSequence = useRef(0);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [openFolderRequest, setOpenFolderRequest] = useState(null);
  const [messageState, setMessageState] = useState({ projectId: null, items: [], loading: false, error: '' });
  const [messageModal, setMessageModal] = useState(null);
  const [orchestratorStatus, setOrchestratorStatus] = useState({ loading: false, error: '' });
  // Escolha do CLI e do modelo da principal: aberta pelo usuário, nunca preenchida.
  const [orchestratorChoice, setOrchestratorChoice] = useState(null);
  // Integrações MCP por consentimento, por CLI: { kimi, gemini }.
  const [integrations, setIntegrations] = useState({});
  const kimiIntegration = integrations.kimi || null;
  const geminiIntegration = integrations.gemini || null;
  // O status do Gemini aparece na área de estado com o CLI detectado, com sessão do Gemini
  // no projeto ou com a integração conectada (para poder removê-la).
  const geminiDetected = Array.isArray(adapters) && adapters.some((adapter) => adapter.id === 'gemini' && adapter.status === 'available');
  const [regressionSuite, setRegressionSuite] = useState(null);
  const [regressionModalOpen, setRegressionModalOpen] = useState(false);
  // CLI cujo diálogo de consentimento está aberto ('kimi' ou 'gemini').
  const [integrationModal, setIntegrationModal] = useState(null);
  const [integrationNoticeDismissed, setIntegrationNoticeDismissed] = useState({});
  const [toolConnections, setToolConnections] = useState({});
  const [agentRequestState, setAgentRequestState] = useState({ projectId: null, items: [], policy: null, error: '' });
  const [agentRequestErrors, setAgentRequestErrors] = useState({});
  const agentRequestSequence = useRef(0);
  const agentRequestScope = useRef({ projectId: null, cwd: '' });
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
  const [modalFunction, setModalFunction] = useState('');
  const [restoreTick, setRestoreTick] = useState(0);
  const [terminalRestoreError, setTerminalRestoreError] = useState('');
  // Histórico aberto pela árvore nesta execução; na abertura, só sessões vivas aparecem.
  const [revealedHistoryIds, setRevealedHistoryIds] = useState([]);
  const [toast, setToast] = useState('');
  const [theme, setTheme] = useState(getInitialTheme);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [functionsOpen, setFunctionsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Sessão cujo modelo o usuário está trocando no CLI (painel de orientação e registro).
  const [modelSwitch, setModelSwitch] = useState(null);
  // Funções de agente: o aviso na barra lateral conta as que ainda pedem CLI e modelo.
  const [agentFunctions, setAgentFunctions] = useState({ items: [], recommendations: null });
  const desktop = window.atlasDesktop;
  const isNativePanelWindow = desktop?.windowKind === 'panels';
  const isNativeTerminalWindow = desktop?.windowKind === 'terminal';
  const isSecondaryWindow = isNativePanelWindow || isNativeTerminalWindow;
  const panelChannelRef = useRef(null);
  const panelStateRef = useRef(null);
  panelStateRef.current = { activeTask, inspectorTab, docks, theme, sessions, selectedId, taskState, messageState };

  const currentProject = useMemo(() => {
    const equal = (left, right) => left.toLowerCase() === right.toLowerCase();
    return projects.find((project) => equal(project.path, workingDirectory))
      || projects.find((project) => project.repositories.some((repo) => repo.worktrees.some((worktree) => !worktree.statusError && equal(worktree.path, workingDirectory))));
  }, [projects, workingDirectory]);
  const projectSessions = useMemo(() => {
    const scoped = desktop?.isDesktop ? sessions.filter((session) => session.projectId === currentProject?.id) : sessions;
    return scoped.sort((left, right) => Number(right.roleKind === 'orchestrator') - Number(left.roleKind === 'orchestrator'));
  }, [sessions, currentProject?.id]);
  const openSessions = useMemo(() => workspaceSessions(projectSessions, revealedHistoryIds), [projectSessions, revealedHistoryIds]);
  const unhiddenSessions = useMemo(() => visibleWorkspaceSessions(openSessions, hiddenSessionIds), [openSessions, hiddenSessionIds]);
  const visibleSessions = useMemo(() => sessionsInLayout(openSessions, { layout: terminalLayout, selectedId, focusId, hiddenSessionIds }), [openSessions, terminalLayout, selectedId, focusId, hiddenSessionIds]);
  const navigationProjects = useMemo(() => desktop?.isDesktop ? projects : ['ATLAS', 'Exemplo API', 'Exemplo UI'].map((id) => ({ id, name: id, path: '', repositories: [] })), [projects, desktop?.isDesktop]);
  const navigationSessions = useMemo(() => desktop?.isDesktop ? sessions : sessions.map((session) => ({ ...session, projectId: 'ATLAS' })), [sessions, desktop?.isDesktop]);
  const projectDecisions = atlasDecisions({
    requests: desktop?.isDesktop ? agentRequestState.items : [],
    tasks: desktop?.isDesktop ? taskState.items : [],
    reviews: desktop?.isDesktop ? taskState.reviews || [] : [],
    needsPrincipal: Boolean(desktop?.isDesktop && orchestratorStatus.projectId === currentProject?.id && orchestratorStatus.needsChoice),
  });
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
        if (data.state.messageState) setMessageState(data.state.messageState);
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
  }, [activeTask, inspectorTab, docks, theme, sessions, selectedId, taskState, messageState, isSecondaryWindow]);

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
      // Projetos já atualizados por `project:changed` antes desta resposta prevalecem.
      setProjects((current) => items.map((item) => current.find((project) => project.id === item.id && !project.scanning) || item));
      if (items[0] && !projectSelectionRef.current) setActiveProject(items[0].name);
      if (defaults?.cwd) setWorkingDirectory((current) => current === INITIAL_DIRECTORY ? defaults.cwd : current);
    }).catch((error) => notify(`Não foi possível descobrir os projetos: ${error.message}`)).finally(() => {
      if (active) setProjectsLoading(false);
    });
    return () => { active = false; };
  }, [isSecondaryWindow]);

  // A varredura Git de cada projeto termina no seu tempo; a janela não espera todas.
  useEffect(() => {
    if (!desktop?.isDesktop || isSecondaryWindow || !desktop.onProjectChanged) return undefined;
    return desktop.onProjectChanged((project) => {
      if (!project?.id) return;
      setProjects((current) => current.some((item) => item.id === project.id)
        ? current.map((item) => (item.id === project.id ? project : item))
        : [...current, project]);
    });
  }, [isSecondaryWindow]);

  useEffect(() => {
    if (!desktop?.isDesktop || isSecondaryWindow || !desktop.getKimiIntegration) return undefined;
    let active = true;
    for (const cli of Object.keys(INTEGRATION_CLIS)) {
      const api = INTEGRATION_CLIS[cli];
      if (!desktop[api.get]) continue;
      setIntegrations((current) => ({ ...current, [cli]: { loading: true } }));
      desktop[api.get]().then((status) => {
        if (active) setIntegrations((current) => ({ ...current, [cli]: status }));
      }).catch((error) => {
        if (active) setIntegrations((current) => ({ ...current, [cli]: { state: 'invalid', error: error.message, file: '', entryText: '' } }));
      });
    }
    const unsubscribe = desktop.onAtlasToolsConnection?.(({ sessionId, connected }) => {
      setToolConnections((current) => ({ ...current, [sessionId]: connected }));
    });
    return () => { active = false; unsubscribe?.(); };
  }, [isSecondaryWindow]);

  async function refreshIntegration(cli) {
    const status = await desktop[INTEGRATION_CLIS[cli].get]();
    setIntegrations((current) => ({ ...current, [cli]: status }));
  }

  // Ações do diálogo de consentimento: a confirmação parte só daqui. Após falha,
  // o estado é relido para que área de estado e diálogo reflitam o arquivo atual.
  async function changeIntegration(cli, method) {
    try {
      return await desktop[INTEGRATION_CLIS[cli][method]]({ confirm: true });
    } catch (error) {
      await refreshIntegration(cli).catch(() => {});
      throw new Error(cleanIpcError(error));
    }
  }

  async function installIntegration(cli) {
    const status = await changeIntegration(cli, 'install');
    setIntegrations((current) => ({ ...current, [cli]: status }));
    setIntegrationModal(null);
    notify(`Ferramentas do ATLAS conectadas ao ${INTEGRATION_CLIS[cli].name}. Inicie uma nova execução para carregá-las.`);
  }

  async function removeIntegration(cli) {
    const status = await changeIntegration(cli, 'remove');
    setIntegrations((current) => ({ ...current, [cli]: status }));
    setIntegrationModal(null);
    setIntegrationNoticeDismissed((current) => ({ ...current, [cli]: true }));
    notify(`Integração do ATLAS removida da configuração do ${INTEGRATION_CLIS[cli].name}.`);
  }

  useEffect(() => {
    if (!desktop?.isDesktop || isSecondaryWindow) return undefined;
    let active = true;
    desktop.listAgents().then((agents) => {
      if (active) setSessions((current) => mergeAgentSessions(current, agents));
    }).catch((error) => notify(`Não foi possível carregar as sessões: ${error.message}`));
    return () => { active = false; };
  }, [isSecondaryWindow, projects, workingDirectory, restoreTick]);

  useEffect(() => {
    if (!desktop?.isDesktop || isSecondaryWindow) return undefined;
    let active = true;
    desktop.listTerminals().then(({ terminals, failed }) => {
      if (!active) return;
      setSessions((current) => {
        const ids = new Set(current.map((item) => item.id));
        return [...current, ...terminals.filter((item) => !ids.has(item.sessionId)).map(terminalSession)];
      });
      if (failed.length) setTerminalRestoreError(`Não foi possível reabrir ${failed.map(({ name, error }) => `${name} (${error})`).join(', ')}`);
    }).catch((error) => {
      if (active) setTerminalRestoreError(cleanIpcError(error));
    });
    return () => { active = false; };
  }, [isSecondaryWindow]);

  // Continuidade: as sessões abertas no último fechamento voltam sozinhas (AGENTS.md). Quando a
  // retomada termina, a interface recarrega as sessões e a principal e diz o que voltou.
  useEffect(() => {
    if (!desktop?.isDesktop || isSecondaryWindow || !desktop.getRestoreStatus) return undefined;
    let handled = false;
    const apply = (result) => {
      if (handled || !result) return;
      handled = true;
      setRestoreTick((tick) => tick + 1);
      const message = restoreSummary(result);
      if (message) notify(message, 7000);
    };
    const unsubscribe = desktop.onAgentsRestored?.(apply);
    desktop.getRestoreStatus().then((status) => { if (!status?.pending) apply(status?.result); }).catch(() => {});
    return () => unsubscribe?.();
  }, [isSecondaryWindow]);

  useEffect(() => {
    if (!desktop?.isDesktop || isSecondaryWindow || !currentProject) return undefined;
    let active = true;
    setOrchestratorStatus({ projectId: currentProject.id, loading: true, error: '' });
    desktop.openOrchestrator({ cwd: workingDirectory }).then((agent) => {
      if (!active) return;
      if (agent.needsChoice) {
        setOrchestratorStatus({ projectId: currentProject.id, loading: false, error: '', needsChoice: true, previousCli: agent.previousCli });
        return;
      }
      setSessions((current) => mergeAgentSessions(current, [agent]));
      setSelectedId((current) => current === 'orchestrator' ? agent.id : current);
      setOrchestratorStatus({ projectId: currentProject.id, loading: false, error: '' });
    }).catch((error) => { if (active) setOrchestratorStatus({ projectId: currentProject.id, loading: false, error: cleanIpcError(error) }); });
    return () => { active = false; };
  }, [isSecondaryWindow, currentProject?.id, restoreTick]);

  useEffect(() => { setFocusId(null); }, [currentProject?.id]);

  // Nova execução da principal: o usuário escolhe o CLI e o modelo de novo, e
  // pode trocar os dois; a identidade, as tarefas e as mensagens continuam.
  function openOrchestratorChoice(session) {
    const cwd = session?.worktree || currentProject?.path || workingDirectory;
    setOrchestratorChoice({ projectId: session?.projectId || currentProject?.id, cwd, previousCli: session?.cli || orchestratorStatus.previousCli || null, session: session || null, busy: false, error: '', mode: null });
    // Modo salvo no projeto; sem ele o diálogo não inicia, para não trocar o modo em silêncio.
    desktop.getOrchestratorMode({ cwd })
      .then(({ mode }) => setOrchestratorChoice((current) => current && current.cwd === cwd ? { ...current, mode } : current))
      .catch((error) => setOrchestratorChoice((current) => current && current.cwd === cwd ? { ...current, error: cleanIpcError(error) } : current));
  }

  async function startOrchestrator(choice) {
    const target = orchestratorChoice;
    if (!target || target.busy) return;
    setOrchestratorChoice({ ...target, busy: true, error: '' });
    try {
      if (target.session) {
        await desktop.closeTerminalWindow(target.session.id);
        setDetachedTerminals((current) => current.filter((id) => id !== target.session.id));
      }
      const agent = await desktop.openOrchestrator({ cwd: target.cwd, startNewRun: true, adapterId: choice.adapterId, model: choice.model || null, orchestratorMode: choice.orchestratorMode });
      setSessions((current) => mergeAgentSessions(current, [agent]));
      setOrchestratorStatus((state) => state.projectId === target.projectId ? { projectId: target.projectId, loading: false, error: '' } : state);
      setOrchestratorChoice(null);
      // Uma principal já em execução volta como está; só uma run nova confirma a escolha.
      const started = agent.state === 'running' && agent.runAttempt !== target.session?.runAttempt && agent.adapterId === choice.adapterId && (agent.model || '') === (choice.model || '');
      notify(started ? `Sessão principal iniciada com ${agent.cli}${agent.model ? ` · ${agent.model}` : ''}` : `A sessão principal já estava em execução com ${agent.cli}`);
    } catch (error) {
      setOrchestratorChoice((current) => current && { ...current, busy: false, error: cleanIpcError(error) });
    }
  }

  useEffect(() => {
    if (!desktop?.isDesktop || isSecondaryWindow) return undefined;
    const samePath = (left, right) => left.toLowerCase() === right.toLowerCase();
    const project = projects.find((item) => samePath(item.path, workingDirectory))
      || projects.find((item) => item.repositories.some((repo) => repo.worktrees.some((worktree) => !worktree.statusError && samePath(worktree.path, workingDirectory))));
    let active = true;
    const taskSequence = ++taskReloadSequence.current;
    setTaskState({ projectId: project?.id || null, projectName: project?.name || '', items: [], handoffs: [], loading: Boolean(project), error: '' });
    setMessageState({ projectId: project?.id || null, items: [], loading: Boolean(project), error: '' });
    if (project) desktop.listTasks({ cwd: workingDirectory }).then((state) => {
      if (active && taskSequence === taskReloadSequence.current) setTaskState({ ...state, loading: false, error: '' });
    }).catch((error) => {
      if (active) setTaskState({ projectId: project.id, projectName: project.name, items: [], handoffs: [], loading: false, error: error.message });
    });
    if (project) desktop.listMessages({ cwd: workingDirectory }).then((state) => {
      if (active) setMessageState({ ...state, loading: false, error: '' });
    }).catch((error) => {
      if (active) setMessageState({ projectId: project.id, items: [], loading: false, error: error.message });
    });
    // Atualizar a lista de projetos não apaga os motivos de falha ainda não dispensados.
    if ((project?.id || null) !== agentRequestScope.current.projectId) {
      setAgentRequestState({ projectId: project?.id || null, items: [], policy: null, error: '' });
      setAgentRequestErrors({});
    }
    if (project && desktop.listAgentRequests) reloadAgentRequests(workingDirectory);
    else agentRequestSequence.current += 1;
    return () => { active = false; };
  }, [isSecondaryWindow, projects, workingDirectory]);

  agentRequestScope.current = { projectId: agentRequestState.projectId, cwd: workingDirectory };

  // Respostas atrasadas de outro projeto ou de carga anterior são descartadas.
  function reloadAgentRequests(cwd = agentRequestScope.current.cwd) {
    const sequence = ++agentRequestSequence.current;
    return desktop.listAgentRequests({ cwd }).then((state) => {
      if (sequence === agentRequestSequence.current) setAgentRequestState({ ...state, error: '' });
    }).catch((error) => {
      if (sequence === agentRequestSequence.current) setAgentRequestState((current) => ({ ...current, error: cleanIpcError(error) }));
    });
  }

  useEffect(() => {
    if (!desktop?.isDesktop || isSecondaryWindow || !desktop.onAgentRequestsChanged) return undefined;
    return desktop.onAgentRequestsChanged(({ projectId }) => {
      if (projectId && projectId === agentRequestScope.current.projectId) reloadAgentRequests();
    });
  }, [isSecondaryWindow]);

  // Pedidos expiram no host sem aviso; recarregar no vencimento retira o cartão da fila.
  useEffect(() => {
    const deadlines = agentRequestState.items.filter((request) => request.state === 'pending').map((request) => Date.parse(request.expiresAt)).filter(Number.isFinite);
    if (!deadlines.length) return undefined;
    const timer = setTimeout(() => reloadAgentRequests(), Math.max(0, Math.min(...deadlines) - Date.now()) + 1000);
    return () => clearTimeout(timer);
  }, [agentRequestState]);

  function clearAgentRequestError(requestId) {
    setAgentRequestErrors((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== requestId)));
  }

  async function approveAgentRequest(request, choice) {
    clearAgentRequestError(request.id);
    try {
      const { agent, recordError } = await desktop.approveAgentRequest({ cwd: workingDirectory, requestId: request.id, payloadHash: request.payloadHash, adapterId: choice.adapterId, model: choice.model || null, functionSlug: choice.functionSlug || null });
      setSessions((current) => mergeAgentSessions(current, [agent]));
      // O usuário pode ter trocado de projeto durante o spawn.
      if (agentRequestScope.current.projectId === request.projectId) setSelectedId(agent.id);
      notify(recordError
        ? `Agente ${agent.name} iniciado, mas o pedido não foi registrado como atendido: ${recordError}`
        : `Agente ${agent.name} iniciado a pedido da sessão principal`);
    } catch (error) {
      setAgentRequestErrors((current) => ({ ...current, [request.id]: cleanIpcError(error) }));
    } finally {
      await reloadAgentRequests();
    }
  }

  async function rejectAgentRequest(request) {
    clearAgentRequestError(request.id);
    try {
      await desktop.rejectAgentRequest({ cwd: workingDirectory, requestId: request.id });
      notify(`Pedido de agente ${request.name} recusado`);
    } catch (error) {
      setAgentRequestErrors((current) => ({ ...current, [request.id]: cleanIpcError(error) }));
    } finally {
      await reloadAgentRequests();
    }
  }

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

  taskScope.current = { projectId: taskState.projectId, cwd: workingDirectory };

  // Ofertas, aceites e bloqueios chegam pelos agentes (MCP) ou pelo fim de uma run.
  function reloadTasks() {
    const sequence = ++taskReloadSequence.current;
    const { projectId, cwd } = taskScope.current;
    if (!projectId) return Promise.resolve();
    return desktop.listTasks({ cwd }).then((state) => {
      if (sequence === taskReloadSequence.current && state.projectId === taskScope.current.projectId) setTaskState({ ...state, loading: false, error: '' });
    }).catch((error) => {
      if (sequence === taskReloadSequence.current) setTaskState((current) => ({ ...current, error: cleanIpcError(error) }));
    });
  }

  useEffect(() => {
    if (!desktop?.isDesktop || isSecondaryWindow || !desktop.onTasksChanged) return undefined;
    return desktop.onTasksChanged(({ projectId }) => {
      if (projectId && projectId === taskScope.current.projectId) reloadTasks();
    });
  }, [isSecondaryWindow]);

  async function cancelHandoff(handoff) {
    try {
      await desktop.cancelHandoff({ cwd: workingDirectory, handoffId: handoff.id });
      notify(`Oferta da tarefa ${handoff.taskTitle} cancelada`);
      return null;
    } catch (error) {
      return cleanIpcError(error);
    } finally {
      await reloadTasks();
    }
  }

  async function decideReview(review, decision, note) {
    try {
      await desktop.decideReview({ cwd: workingDirectory, reviewId: review.id, decision, note });
      notify(decision === 'accept' ? 'Tarefa concluída após sua revisão' : 'Ajustes pedidos ao responsável');
      return null;
    } catch (error) {
      return cleanIpcError(error);
    } finally {
      await reloadTasks();
    }
  }

  async function releaseTask(task) {
    try {
      await desktop.releaseTask({ cwd: workingDirectory, taskId: task.id });
      notify(`Tarefa ${task.title} devolvida para pronta`);
      return null;
    } catch (error) {
      return cleanIpcError(error);
    } finally {
      await reloadTasks();
    }
  }

  async function sendDiscovery(request) {
    const from = messageModal?.session;
    const to = projectSessions.find((session) => session.roleKind === 'orchestrator');
    if (!from || !to || from.id === to.id) return 'Selecione uma sessão manual e a principal do projeto.';
    try {
      const message = await desktop.sendMessage({ ...request, cwd: workingDirectory, fromSessionId: from.id, toSessionId: to.id });
      setMessageState((state) => state.projectId === message.projectId ? { ...state, items: [...state.items.filter((item) => item.id !== message.id), { ...message, fromName: from.name, toName: to.name }] } : state);
      setMessageModal(null);
      notify('Descoberta registrada para a sessão principal');
      return null;
    } catch (error) {
      return error.message;
    }
  }

  async function markMessageRead(message) {
    try {
      await desktop.markMessageRead({ cwd: workingDirectory, messageId: message.id, sessionId: message.toSessionId });
      setMessageState((state) => state.projectId === message.projectId
        ? { ...state, items: state.items.map((item) => item.id === message.id && !item.readAt ? { ...item, readAt: new Date().toISOString() } : item) }
        : state);
    } catch (error) {
      notify(`Não foi possível marcar a mensagem como lida: ${error.message}`);
    }
  }

  // Suíte de regressão do projeto: configuração na área de estado, execução na revisão.
  // Só a janela principal configura, para a suíte ou abre o log.
  useEffect(() => {
    if (!desktop?.isDesktop || isSecondaryWindow || !desktop.getRegressionSuite || !taskState.projectId) {
      setRegressionSuite(null);
      return undefined;
    }
    let active = true;
    setRegressionSuite({ projectId: taskState.projectId, loading: true });
    desktop.getRegressionSuite({ cwd: taskScope.current.cwd }).then((result) => {
      if (active) setRegressionSuite({ projectId: taskState.projectId, suite: result.suite });
    }).catch((error) => {
      if (active) setRegressionSuite({ projectId: taskState.projectId, error: cleanIpcError(error) });
    });
    return () => { active = false; };
  }, [isSecondaryWindow, taskState.projectId]);

  const regressionActions = desktop?.isDesktop && !isSecondaryWindow && desktop.getRegressionRun ? {
    load: (id) => desktop.getRegressionRun({ cwd: workingDirectory, id }),
    async cancel(id) {
      try {
        await desktop.cancelRegressionRun({ cwd: workingDirectory, id });
        notify('Suíte de regressão parada');
        return null;
      } catch (error) {
        return cleanIpcError(error);
      } finally {
        await reloadTasks();
      }
    },
    async openLog(id, reveal) {
      try {
        await desktop.openRegressionLog({ cwd: workingDirectory, id, reveal });
        return null;
      } catch (error) {
        return cleanIpcError(error);
      }
    },
  } : undefined;

  const persistentTaskPanel = desktop?.isDesktop ? <PersistentTaskPanel state={taskState} onNew={isSecondaryWindow ? undefined : () => setTaskModalOpen(true)} onCancelHandoff={isSecondaryWindow ? undefined : cancelHandoff} onRelease={isSecondaryWindow ? undefined : releaseTask} onDecideReview={isSecondaryWindow ? undefined : decideReview} regressionActions={regressionActions} /> : null;
  const taskEvidencePanel = desktop?.isDesktop ? <TaskEvidencePanel state={taskState} regressionActions={regressionActions} /> : null;
  const sessionMessagesPanel = desktop?.isDesktop ? <SessionMessagesPanel state={messageState} readOnly={isSecondaryWindow} onMarkRead={markMessageRead} /> : null;

  useEffect(() => {
    document.body.classList.toggle('native-panel-window', Boolean(isNativePanelWindow));
    document.body.classList.toggle('native-terminal-window', Boolean(isNativeTerminalWindow));
    return () => document.body.classList.remove('native-panel-window', 'native-terminal-window');
  }, [isNativePanelWindow, isNativeTerminalWindow]);

  useEffect(() => {
    const root = document.documentElement;
    const tokens = appearanceTokens(theme);
    Object.entries(tokens).forEach(([key, value]) => root.style.setProperty(key, value));
    localStorage.setItem('atlas-appearance', JSON.stringify(theme));
  }, [theme]);

  // Barra única em toda janela: os controles do sistema usam a cor real da barra em que
  // ficam e a tinta do tema. No pop-up, o cabeçalho só existe depois que a sessão chega.
  const overlayBarReady = !isNativeTerminalWindow || sessions.some((session) => session.id === desktop?.sessionId);
  useEffect(() => {
    if (desktop?.windowChrome !== 'overlay') return undefined;
    const frame = requestAnimationFrame(() => {
      const tokens = appearanceTokens(theme);
      const bar = document.querySelector(OVERLAY_BARS[isNativeTerminalWindow ? 'terminal' : isNativePanelWindow ? 'panels' : 'main']);
      const color = effectiveBackground(bar, (node) => getComputedStyle(node), tokens['--surface']);
      desktop.setTitleBarOverlay?.({ color, symbolColor: tokens['--text'] });
    });
    return () => cancelAnimationFrame(frame);
  }, [theme, overlayBarReady]);

  useEffect(() => {
    const overlay = desktop?.windowChrome === 'overlay';
    document.documentElement.classList.toggle('window-overlay', overlay);
    return () => document.documentElement.classList.remove('window-overlay');
  }, []);

  useEffect(() => {
    localStorage.setItem('atlas-docks', JSON.stringify({ ...docks, order: columnOrder, hidden: hiddenColumns }));
  }, [docks, columnOrder, hiddenColumns]);

  useEffect(() => {
    if (!isSecondaryWindow) localStorage.setItem('atlas-terminal-workspace', JSON.stringify({ layout: terminalLayout, hiddenSessionIds }));
  }, [terminalLayout, hiddenSessionIds, isSecondaryWindow]);

  useEffect(() => {
    function handleKey(event) {
      if (event.key === 'Escape') {
        if (columnDragRef.current) cancelColumnDrag();
        // Escape fecha primeiro o diálogo, preservando o estado que o abriu.
        if (!event.composedPath().some((node) => node.getAttribute?.('role') === 'dialog')) setStatusOpen(false);
        setModal(null);
        setAppearanceOpen(false);
        setFunctionsOpen(false);
        setModelSwitch(null);
      }
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault();
        setModal(null);
        setAppearanceOpen(true);
      }
    }
    // Paleta de comandos: Ctrl Shift P ou F1. Em captura, para funcionar com o foco no terminal;
    // nenhum dos dois é atalho comum de shell, tmux ou dos CLIs.
    function handlePaletteKey(event) {
      const combo = (event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.code === 'KeyP';
      if (!combo && !(event.key === 'F1' && !event.ctrlKey && !event.shiftKey && !event.altKey)) return;
      event.preventDefault();
      event.stopPropagation();
      setPaletteOpen((open) => !open);
    }
    window.addEventListener('keydown', handleKey);
    window.addEventListener('keydown', handlePaletteKey, true);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('keydown', handlePaletteKey, true);
      window.removeEventListener('pointermove', handleColumnPointerMove);
      window.removeEventListener('pointerup', finishColumnDrag);
      window.removeEventListener('pointercancel', cancelColumnDrag);
      window.removeEventListener('pointermove', handlePopupPointerMove);
      window.removeEventListener('pointerup', finishPopupDrag);
      window.removeEventListener('pointercancel', finishPopupDrag);
    };
  }, []);

  useEffect(() => {
    // Janelas de terminal destacadas não leem funções: só a principal tem acesso.
    if (!desktop?.isDesktop || isSecondaryWindow || !desktop.listAgentFunctions) return undefined;
    let active = true;
    const load = () => desktop.listAgentFunctions().then((result) => { if (active) setAgentFunctions({ items: result.items, recommendations: result.recommendations }); }).catch(() => {});
    load();
    const unsubscribe = desktop.onAgentFunctionsChanged?.(load);
    return () => { active = false; unsubscribe?.(); };
  }, []);

  const needsAdapters = modal === 'session' || functionsOpen || Boolean(orchestratorChoice) || agentRequestState.items.some((request) => request.state === 'pending');
  const sessionModalOpen = modal === 'session';
  useEffect(() => {
    if (!needsAdapters || !desktop?.isDesktop) return undefined;
    let active = true;
    if (sessionModalOpen) setAdapters(null);
    desktop.listAdapters()
      .then((items) => { if (active) setAdapters(items); })
      .catch(() => { if (active) setAdapters([]); });
    return () => { active = false; };
  }, [needsAdapters, sessionModalOpen]);

  function notify(message, duration = 2600) {
    setToast(message);
    window.clearTimeout(window.__atlasToast);
    window.__atlasToast = window.setTimeout(() => setToast(''), duration);
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

  // "Abrir no ATLAS": pedidos chegam do processo principal; o renderer busca o mais recente.
  useEffect(() => {
    if (!desktop?.isDesktop || isSecondaryWindow || !desktop.takeOpenPath) return undefined;
    const pull = () => desktop.takeOpenPath().then((request) => {
      if (!request) return;
      if (request.kind === 'error') notify(request.message);
      else if (request.kind === 'known') openProjectFromRequest(request.projectName, request.cwd);
      // Um pedido novo substitui o anterior, que é descartado no processo principal.
      else setOpenFolderRequest((current) => {
        if (current && current.id !== request.id) desktop.dismissOpenPath({ id: current.id }).catch(() => {});
        return request;
      });
    }).catch((error) => notify(cleanIpcError(error)));
    pull();
    return desktop.onOpenPathRequested(pull);
  }, [isSecondaryWindow]);

  function openProjectFromRequest(projectName, cwd) {
    projectSelectionRef.current = true;
    setActiveProject(projectName);
    setWorkingDirectory(cwd);
    notify(`${projectName} aberto pelo Explorador de Arquivos`);
  }

  async function authorizeOpenFolder(request) {
    try {
      const { projects: items, path: directory } = await desktop.authorizeOpenPath({ id: request.id });
      setProjects(items);
      const samePath = (left, right) => left.toLowerCase() === right.toLowerCase();
      const project = items.find((item) => samePath(item.path, directory));
      setOpenFolderRequest((current) => (current?.id === request.id ? null : current));
      openProjectFromRequest(project?.name || request.name, directory);
      return null;
    } catch (error) {
      return cleanIpcError(error);
    }
  }

  function cancelOpenFolder(request) {
    desktop.dismissOpenPath({ id: request.id }).catch(() => {});
    setOpenFolderRequest((current) => (current?.id === request.id ? null : current));
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

  function selectProject(project) {
    projectSelectionRef.current = true;
    setActiveProject(project.name);
    if (project.path) setWorkingDirectory(project.path);
  }

  function openSessionModal(functionSlug = '') {
    setModalFunction(functionSlug || '');
    setModal('session');
  }

  function selectSessionTerminal(id) {
    const session = sessions.find((item) => item.id === id);
    const project = navigationProjects.find((item) => item.id === session?.projectId);
    if (project && project.id !== currentProject?.id) selectProject(project);
    setStatusOpen(false);
    if (session?.archived) setRevealedHistoryIds((current) => current.includes(id) ? current : [...current, id]);
    setHiddenSessionIds((current) => current.filter((sessionId) => sessionId !== id));
    if (terminalLayout === 'spotlight') setFocusId(id);
    setSelectedId(id);
    window.setTimeout(() => document.querySelector(`[data-session-id="${id}"] .xterm-helper-textarea`)?.focus(), 0);
  }

  function handleTerminalTabKey(event, index) {
    const last = unhiddenSessions.length - 1;
    const targets = { ArrowLeft: index === 0 ? last : index - 1, ArrowRight: index === last ? 0 : index + 1, Home: 0, End: last };
    if (!(event.key in targets)) return;
    event.preventDefault();
    const session = unhiddenSessions[targets[event.key]];
    setHiddenSessionIds((current) => current.filter((id) => id !== session.id));
    if (terminalLayout === 'spotlight') setFocusId(session.id);
    setSelectedId(session.id);
    window.setTimeout(() => document.getElementById(`terminal-tab-${session.id}`)?.focus(), 0);
  }

  function changeTerminalLayout(layout) {
    const mode = normalizeTerminalLayout(layout);
    setTerminalLayout(mode);
    if (mode === 'spotlight') setFocusId((unhiddenSessions.find((session) => session.id === selectedId) || unhiddenSessions[0])?.id || null);
    else setFocusId(null);
  }

  function hideSession(id) {
    if (sessions.find((item) => item.id === id)?.archived) {
      // Histórico não tem processo: ocultar fecha o card, e ele continua na árvore.
      const nextOpen = revealedHistoryIds.filter((sessionId) => sessionId !== id);
      const nextId = nextVisibleSessionId(workspaceSessions(projectSessions, nextOpen), hiddenSessionIds);
      setRevealedHistoryIds(nextOpen);
      if (selectedId === id) setSelectedId(nextId);
      if (focusId === id) setFocusId(nextId);
      window.setTimeout(() => document.getElementById(`tree-session-${id}`)?.focus(), 0);
      notify('Histórico fechado; ele continua na árvore');
      return;
    }
    const nextHidden = [...new Set([...hiddenSessionIds, id])];
    const nextId = nextVisibleSessionId(openSessions, nextHidden);
    setHiddenSessionIds(nextHidden);
    window.setTimeout(() => document.getElementById(nextId ? `tree-session-${nextId}` : 'restore-hidden-sessions')?.focus(), 0);
    if (selectedId === id) setSelectedId(nextId);
    if (focusId === id) setFocusId(nextId);
    notify('Sessão ocultada; o processo continua e pode ser restaurado na árvore');
  }

  function restoreProjectSessions() {
    const ids = new Set(openSessions.map((session) => session.id));
    setHiddenSessionIds((current) => current.filter((id) => !ids.has(id)));
  }

  function openDecision(decision) {
    if (decision.kind === 'request') openAgentRequest(decision.targetId);
    else if (decision.kind === 'review') openTaskPanel(decision.targetId);
    else openOrchestratorChoice();
  }

  // Comandos da paleta: as mesmas ações dos botões, sem ocupar a tela.
  function paletteCommands() {
    const commands = [
      { id: 'new-session', group: 'Sessões', label: 'Nova sessão de agente', keywords: 'agente cli modelo', run: () => openSessionModal() },
      { id: 'new-terminal', group: 'Sessões', label: 'Novo terminal', keywords: 'powershell shell', run: () => setModal('terminal') },
    ];
    if (desktop?.isDesktop && !isSecondaryWindow) commands.push({ id: 'new-task', group: 'Sessões', label: 'Nova tarefa', keywords: 'backlog', run: () => setTaskModalOpen(true) });
    commands.push(
      { id: 'layout-grid', group: 'Layout', label: 'Layout: grade', keywords: 'grid automatico panes', run: () => changeTerminalLayout('grid') },
      { id: 'layout-spotlight', group: 'Layout', label: 'Layout: terminal em destaque', keywords: 'foco spotlight maximizar', run: () => changeTerminalLayout('spotlight') },
      { id: 'layout-sidebar', group: 'Layout', label: 'Layout: principal e agentes', keywords: 'sidebar dividir principal', run: () => changeTerminalLayout('sidebar') },
      { id: 'layout-tabs', group: 'Layout', label: 'Layout: abas de terminal', keywords: 'subtabs abas', run: () => changeTerminalLayout('tabs') },
      { id: 'toggle-status', group: 'Layout', label: 'Estado do projeto e integrações', keywords: 'suite regressao mcp status', run: () => setStatusOpen((open) => !open) },
      { id: 'toggle-left', group: 'Layout', label: hiddenColumns.left ? 'Mostrar navegação' : 'Ocultar navegação', keywords: 'coluna esquerda sidebar', run: () => toggleHiddenColumn('left') },
      { id: 'toggle-right', group: 'Layout', label: hiddenColumns.right ? 'Mostrar painéis' : 'Ocultar painéis', keywords: 'coluna direita tarefas mensagens evidencias', run: () => toggleHiddenColumn('right') },
      { id: 'restore-sessions', group: 'Layout', label: 'Restaurar sessões ocultas', keywords: 'terminais ocultos processos', run: restoreProjectSessions },
      { id: 'reset-layout', group: 'Layout', label: 'Restaurar layout padrão', run: resetLayout },
      { id: 'appearance', group: 'Preferências', label: 'Aparência e configurações', keywords: 'tema cor fundo', shortcut: 'Ctrl ,', run: () => setAppearanceOpen(true) },
    );
    if (desktop?.isDesktop && desktop.listAgentFunctions) commands.push({ id: 'functions', group: 'Preferências', label: 'Funções de agente', keywords: 'cli modelo orquestrador', run: () => setFunctionsOpen(true) });
    commands.push({ id: 'add-project', group: 'Projetos', label: 'Autorizar pasta de projeto', keywords: 'adicionar repositorio', run: addProject });
    (desktop?.isDesktop ? projects : ['ATLAS', 'Exemplo API', 'Exemplo UI'].map((name) => ({ name }))).forEach((project) => commands.push({ id: `project-${project.id || project.name}`, group: 'Projetos', label: `Ir para ${project.name}`, hint: project.path, keywords: 'projeto repositorio', run: () => selectProject(project) }));
    projectSessions.forEach((session) => commands.push({ id: `session-${session.id}`, group: 'Terminais', label: `Ir para ${session.name}`, hint: modelLabel(session) ? `${session.cli} · ${modelLabel(session)}` : session.cli, keywords: 'terminal sessao agente', run: () => selectSessionTerminal(session.id) }));
    return commands;
  }

  // Painel do Atlas: leva ao cartão do pedido ou à tarefa, onde a decisão acontece.
  function openAgentRequest(requestId) {
    const card = document.getElementById(`agent-request-${requestId}`)?.closest('.agent-request');
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    card?.querySelector('select, button')?.focus({ preventScroll: true });
  }

  function openTaskPanel() {
    setHiddenColumns((current) => current.right ? { ...current, right: false } : current);
    setInspectorTab('task');
  }

  function toggleHiddenColumn(column) {
    setHiddenColumns((current) => ({ ...current, [column]: !current[column] }));
  }

  function resetLayout() {
    if (desktop?.isDesktop && !isNativePanelWindow) desktop.closePanels();
    detachedTerminals.forEach((id) => desktop?.isDesktop && desktop.closeTerminalWindow(id));
    setDocks({ left: [], right: ['task', 'messages', 'evidence'] });
    setColumnOrder(DEFAULT_COLUMN_ORDER);
    setHiddenColumns({ left: false, right: true });
    setDetachedTerminals([]);
    setPanelsDetached(false);
    setInspectorTab('task');
    setTerminalLayout('grid');
    setHiddenSessionIds([]);
    setFocusId(null);
    setStatusOpen(false);
    notify('Layout padrão restaurado');
  }

  function focusSession(id) {
    const target = sessions.find((session) => session.id === id) || projectSessions[0];
    const project = navigationProjects.find((item) => item.id === target?.projectId);
    if (project && project.id !== currentProject?.id) selectProject(project);
    if (!target) { setFocusId(null); return; }
    if (terminalLayout === 'spotlight' && focusId === target.id) {
      changeTerminalLayout('grid');
      return;
    }
    setHiddenSessionIds((current) => current.filter((sessionId) => sessionId !== target.id));
    setTerminalLayout('spotlight');
    setFocusId(target.id);
    setSelectedId(target.id);
  }

  async function setSessionFunction(session, functionSlug) {
    try {
      const agent = await desktop.setAgentFunction({ sessionId: session.id, functionSlug: functionSlug || null });
      setSessions((current) => mergeAgentSessions(current, [agent]));
      notify(functionSlug ? `Função de ${session.name} trocada` : `${session.name} ficou sem função`);
    } catch (error) {
      notify(cleanIpcError(error));
    }
  }

  async function createSession({ kind, name, cli, model, functionSlug = null, cwd }) {
    const isTerminal = kind === 'terminal';
    let pty = null;
    let agent = null;
    if (desktop?.isDesktop) {
      setCreatingTerminal(true);
      try {
        if (isTerminal) pty = await desktop.createTerminal({ cwd, name });
        else agent = await desktop.createAgent({ adapterId: cli, model, name, cwd, functionSlug });
      } catch (error) {
        setCreatingTerminal(false);
        return isTerminal ? `Não foi possível iniciar o PowerShell: ${error.message}` : error.message;
      }
      setCreatingTerminal(false);
    }
    const session = agent ? agentSession(agent) : pty ? terminalSession(pty) : {
      id: `${kind}-${Date.now()}`,
      projectId: currentProject?.id,
      name: name || (isTerminal ? 'terminal-local' : 'nova-sessao'),
      role: isTerminal ? 'Shell sem identidade de agente' : 'Sessão criada pelo usuário',
      origin: isTerminal ? 'terminal' : 'manual',
      cli: isTerminal ? 'PowerShell' : cli,
      model: isTerminal ? null : 'automático',
      effort: isTerminal ? 'local' : 'medium',
      status: 'pronto',
      color: isTerminal ? '#8d959d' : '#4ecb8d',
      task: isTerminal ? activeProject : 'Missão cockpit interativo',
      tokens: '0',
      cost: '—',
      worktree: cwd || 'atlas/main',
      lines: isTerminal ? [
        { type: 'info', text: 'Windows PowerShell · terminal local ilustrativo' },
        { type: 'command', text: `PS ${cwd}>` },
      ] : [
        { type: 'success', text: '✓ sessão registrada no projeto ATLAS' },
        { type: 'info', text: 'Caixa de mensagens e contexto de missão disponíveis.' },
        { type: 'command', text: '❯ aguardando sua primeira instrução' },
      ],
    };
    setSessions((current) => [...current.filter((item) => item.id !== session.id), session]);
    setSelectedId(session.id);
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
          messagesPanel={sessionMessagesPanel}
          evidencePanel={taskEvidencePanel}
          unreadMessages={messageState.items.filter((message) => !message.readAt).length}
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
      <a className="skip-link" href="#terminal-workspace">Ir para os terminais</a>
      <header className="titlebar">
        <div className="brand" title="ATLAS 0.1 · local"><AtlasMark /><strong>ATLAS</strong></div>
        <div className="titlebar-context"><span>{desktop?.isDesktop ? currentProject?.name || activeProject : activeMission}</span><small>{openSessions.length ? `${unhiddenSessions.length} de ${openSessions.length} sessões visíveis` : 'Nenhuma sessão aberta'}</small></div>
        <div className="title-actions">
          <div className="workspace-path" title={workingDirectory}><span>{workingDirectory}</span></div>
          {!desktop?.isDesktop && <div className="demo-label">AGENTES ILUSTRATIVOS</div>}
          <button className="text-control palette-trigger" title="Paleta de comandos (Ctrl Shift P ou F1)" onClick={() => setPaletteOpen(true)}>Comandos <kbd>Ctrl Shift P</kbd></button>
          <button className="text-control" title="Aparência e configurações (Ctrl ,)" onClick={() => setAppearanceOpen(true)}>Aparência</button>
        </div>
      </header>

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
            <WorkspaceTree
              projects={navigationProjects}
              sessions={navigationSessions}
              activeProjectId={desktop?.isDesktop ? currentProject?.id : activeProject}
              workingDirectory={workingDirectory}
              selectedSessionId={selectedId}
              hiddenSessionIds={hiddenSessionIds}
              decisions={projectDecisions}
              onSelectProject={selectProject}
              onSelectWorktree={selectWorktree}
              onSelectSession={selectSessionTerminal}
              onFocusSession={focusSession}
              onDecision={openDecision}
              onAddProject={addProject}
              onRefresh={refreshProjects}
              loading={projectsLoading || projects.some((project) => project.scanning)}
            />
            <div className="sidebar-bottom">
              <button className="workspace-settings" onClick={resetLayout}><span>Restaurar layout</span></button>
              {desktop?.isDesktop && desktop.listAgentFunctions && <button className="workspace-settings" onClick={() => setFunctionsOpen(true)}><Workflow size={14} /><span>Funções de agente</span>{pendingConfiguration(agentFunctions.items) > 0 && <small className="functions-pending">{pendingConfiguration(agentFunctions.items)} a configurar</small>}<ChevronRight size={13} /></button>}
              <button className="workspace-settings" onClick={() => setAppearanceOpen(true)}><Palette size={14} /><span>Aparência e configurações</span><ChevronRight size={13} /></button>
            </div>
          </aside>
        </div>}

        <main
          id="terminal-workspace"
          tabIndex={-1}
          className={`cockpit ${columnDrag?.target === 'center' ? 'column-drag-over' : ''} ${columnDrag?.moved && columnDrag.column === 'center' ? 'column-drag-source' : ''}`}
          style={getColumnStyle('center')}
          data-column-id="center"
        >
          <div className="cockpit-toolbar">
            <div className="terminal-project-title" onPointerDown={(event) => beginColumnDrag(event, 'center')} title="Arrastar coluna de terminais"><span>{desktop?.isDesktop ? currentProject?.name || activeProject : activeMission}</span><small>{workingDirectory}</small></div>
            <div className="toolbar-actions">
              <button className="workspace-panel-toggle" data-panel="left" aria-label={`${hiddenColumns.left ? 'Mostrar' : 'Ocultar'} navegação`} aria-pressed={!hiddenColumns.left} aria-expanded={!hiddenColumns.left} aria-controls="atlas-navigation" onClick={() => toggleHiddenColumn('left')}>Navegação</button>
              <button className="workspace-panel-toggle" data-panel="right" aria-label={`${hiddenColumns.right ? 'Mostrar' : 'Ocultar'} painéis`} aria-pressed={!hiddenColumns.right} aria-expanded={!hiddenColumns.right} aria-controls="atlas-panels" onClick={() => toggleHiddenColumn('right')}>Painéis</button>
              <select className="terminal-layout-select" aria-label="Layout dos terminais" value={terminalLayout} onChange={(event) => changeTerminalLayout(event.target.value)}>
                <option value="grid">Grade</option>
                <option value="spotlight">Destaque</option>
                <option value="sidebar">Principal + agentes</option>
                <option value="tabs">Abas</option>
              </select>
              <button className="button secondary compact" aria-expanded={statusOpen} aria-controls="workspace-status" onClick={() => setStatusOpen((current) => !current)}>Estado</button>
              <button className="button secondary compact" onClick={() => setModal('terminal')}><SquareTerminal size={14} />Terminal</button>
              <button className="button primary compact" onClick={() => openSessionModal()}><Plus size={14} />Sessão</button>
            </div>
          </div>
          {statusOpen && <section id="workspace-status" className="workspace-status-popover" aria-label="Estado do projeto">
            <div className="workspace-status-heading"><strong>{projectSessions.length} sessões neste projeto</strong><button type="button" className="icon-button subtle" aria-label="Fechar estado do projeto" onClick={() => setStatusOpen(false)}><X size={14} /></button></div>
            <div className="workspace-status-items">
              {regressionSuite?.projectId === currentProject?.id && <RegressionSuiteStatus suite={regressionSuite} onManage={() => setRegressionModalOpen(true)} />}
              {desktop?.isDesktop && !isSecondaryWindow && kimiIntegration
                ? <KimiIntegrationStatus status={kimiIntegration} onManage={() => setIntegrationModal('kimi')} />
                : <span>{desktop?.isDesktop ? 'Histórico e sessões locais' : 'Wireframe ilustrativo'}</span>}
              {desktop?.isDesktop && !isSecondaryWindow && geminiIntegration && (geminiDetected || geminiIntegration.state === 'installed' || usesGemini(projectSessions)) && <KimiIntegrationStatus cli="Gemini" status={geminiIntegration} onManage={() => setIntegrationModal('gemini')} />}
            </div>
          </section>}

          <div className="workspace-notices">
          {terminalRestoreError && <div className="scope-note error-note" role="alert"><span>{terminalRestoreError}</span><button className="button secondary compact" onClick={() => setTerminalRestoreError('')}>Dispensar aviso</button></div>}
          {desktop?.isDesktop && !isSecondaryWindow && !integrationNoticeDismissed.kimi && usesKimi(projectSessions) && <KimiIntegrationNotice status={kimiIntegration} onReview={() => setIntegrationModal('kimi')} onDismiss={() => setIntegrationNoticeDismissed((current) => ({ ...current, kimi: true }))} />}
          {desktop?.isDesktop && !isSecondaryWindow && !integrationNoticeDismissed.gemini && usesGemini(projectSessions) && <KimiIntegrationNotice cli="Gemini" status={geminiIntegration} onReview={() => setIntegrationModal('gemini')} onDismiss={() => setIntegrationNoticeDismissed((current) => ({ ...current, gemini: true }))} />}
          {desktop?.isDesktop && !isSecondaryWindow && <AgentRequestsPanel state={agentRequestState} sessions={projectSessions} adapters={adapters} functions={agentFunctions} errors={agentRequestErrors} onApprove={approveAgentRequest} onReject={rejectAgentRequest} onDismiss={(request) => clearAgentRequestError(request.id)} />}

          {desktop?.isDesktop && orchestratorStatus.projectId === currentProject?.id && orchestratorStatus.loading && <p className="scope-note" role="status">Abrindo sessão principal…</p>}
          {desktop?.isDesktop && orchestratorStatus.projectId === currentProject?.id && orchestratorStatus.error && <div className="scope-note error-note" role="alert"><span>{orchestratorStatus.error}</span><button className="button secondary compact" onClick={() => openOrchestratorChoice()}>Tentar novamente</button></div>}
          {desktop?.isDesktop && orchestratorStatus.projectId === currentProject?.id && orchestratorStatus.needsChoice && openSessions.length > 0 && <div className="scope-note orchestrator-choice-note" role="status"><span>A sessão principal deste projeto ainda não foi iniciada. Escolha o CLI e o modelo que vão planejar e delegar.</span><button className="button primary compact" onClick={() => openOrchestratorChoice()}>Escolher agente</button></div>}
          </div>

          {(terminalLayout === 'spotlight' || terminalLayout === 'tabs') && unhiddenSessions.length > 0 && <div className="terminal-subtabs" role="tablist" aria-label="Sessões visíveis">
            {unhiddenSessions.map((session, index) => <button
              type="button"
              role="tab"
              id={`terminal-tab-${session.id}`}
              aria-controls={`terminal-panel-${session.id}`}
              aria-selected={visibleSessions[0]?.id === session.id}
              tabIndex={visibleSessions[0]?.id === session.id ? 0 : -1}
              className={visibleSessions[0]?.id === session.id ? 'active' : ''}
              key={session.id}
              onClick={() => selectSessionTerminal(session.id)}
              onKeyDown={(event) => handleTerminalTabKey(event, index)}
            >{session.roleKind === 'orchestrator' ? 'Principal' : session.name}</button>)}
          </div>}

          <div className={`session-grid layout-${terminalLayout} ${terminalLayout === 'spotlight' ? 'focus-mode' : ''} ${!visibleSessions.length ? 'is-empty' : ''}`} style={{ '--sidebar-rows': Math.max(1, unhiddenSessions.length - 1) }}>
            {!visibleSessions.length && (unhiddenSessions.length === 0 && openSessions.length > 0
              ? <div className="sessions-hidden-empty" role="status"><SquareTerminal size={24} /><h2>Todos os terminais estão ocultos</h2><p>Os processos continuam em execução. Restaure as sessões sem iniciar novos processos.</p><button id="restore-hidden-sessions" className="button primary" onClick={restoreProjectSessions}>Restaurar sessões</button></div>
              : <AtlasWelcome
                projectName={desktop?.isDesktop ? currentProject?.name || activeProject : activeMission}
                launcher={<StartLauncher
                  functions={desktop?.isDesktop ? agentFunctions : null}
                  adapters={adapters}
                  principalWaiting={Boolean(desktop?.isDesktop && orchestratorStatus.projectId === currentProject?.id && orchestratorStatus.needsChoice)}
                  onPrincipal={() => desktop?.isDesktop ? openOrchestratorChoice() : openSessionModal('')}
                  onFunction={openSessionModal}
                  onTerminal={() => setModal('terminal')}
                />}
              />)}
            {visibleSessions.map((session) => <SessionCard
              key={session.id}
              session={session}
              tabbed={terminalLayout === 'tabs' || terminalLayout === 'spotlight'}
              selected={selectedId === session.id}
              focused={terminalLayout === 'spotlight' && focusId === session.id}
              detached={detachedTerminals.includes(session.id)}
              desktop={desktop}
              theme={theme}
              onSelect={setSelectedId}
              onFocus={focusSession}
              onHide={hideSession}
              onPopup={toggleTerminalPopup}
              onExit={updateSessionExit}
              onRestart={openOrchestratorChoice}
              atlasConnected={toolConnections[session.id] ?? session.atlasTools}
              onSendDiscovery={desktop?.isDesktop && projectSessions.some((session) => session.roleKind === 'orchestrator') ? (session) => setMessageModal({ session }) : undefined}
              functions={agentFunctions}
              onSetFunction={desktop?.isDesktop && desktop.setAgentFunction ? setSessionFunction : undefined}
              onSwitchModel={desktop?.isDesktop && desktop.declareAgentModel ? setModelSwitch : undefined}
              onSend={(name) => notify(`Instrução ilustrativa registrada para ${name}`)}
            />)}
          </div>
        </main>

        {!panelsDetached && !hiddenColumns.right && <Inspector
          activeTask={activeTask} onTaskSelect={setActiveTask}
          taskPanel={persistentTaskPanel}
          messagesPanel={sessionMessagesPanel}
          evidencePanel={taskEvidencePanel}
          unreadMessages={messageState.items.filter((message) => !message.readAt).length}
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

      {panelsDetached && !desktop?.isDesktop && <div className="detached-panels-window" style={{ left: popupPosition.x, top: popupPosition.y }}>
        <Inspector
          activeTask={activeTask} onTaskSelect={setActiveTask}
          taskPanel={persistentTaskPanel}
          messagesPanel={sessionMessagesPanel}
          evidencePanel={taskEvidencePanel}
          unreadMessages={messageState.items.filter((message) => !message.readAt).length}
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

      {orchestratorChoice && <OrchestratorChoiceModal adapters={adapters} functions={agentFunctions} previousCli={orchestratorChoice.previousCli} busy={orchestratorChoice.busy} error={orchestratorChoice.error} mode={orchestratorChoice.mode} onClose={() => { if (!orchestratorChoice.busy) setOrchestratorChoice(null); }} onStart={startOrchestrator} />}
      {modal && <NewSessionModal key={`${modal}:${modalFunction}`} kind={modal} initialFunction={modal === 'session' ? modalFunction : ''} onClose={() => { setModal(null); setModalFunction(''); }} onCreate={createSession} workingDirectory={workingDirectory} worktrees={worktreeOptions.length ? worktreeOptions : [{ path: workingDirectory, label: 'Diretório atual', branch: 'autorizado' }]} onDirectoryChange={(cwd) => { setWorkingDirectory(cwd); setSelectedWorktree(cwd); }} busy={creatingTerminal} adapters={desktop?.isDesktop ? adapters : undefined} functions={desktop?.isDesktop ? agentFunctions : null} loadingAdapters={Boolean(desktop?.isDesktop && modal === 'session' && adapters === null)} />}
      {modelSwitch && <ModelSwitchModal session={modelSwitch} desktop={desktop} onClose={() => setModelSwitch(null)}
        onGoToTerminal={() => {
          const id = modelSwitch.id;
          setModelSwitch(null);
          setSelectedId(id);
          window.setTimeout(() => document.querySelector(`[data-session-id="${id}"] .xterm-helper-textarea`)?.focus(), 0);
        }}
        onDeclared={(agent) => {
          setSessions((current) => mergeAgentSessions(current, [agent]));
          setModelSwitch(null);
          notify(`Modelo de ${agent.name} registrado: ${agent.currentModel}`);
        }} />}
      {functionsOpen && <AgentFunctionsModal desktop={desktop} adapters={adapters} onClose={() => setFunctionsOpen(false)} />}
      {paletteOpen && <CommandPalette commands={paletteCommands()} onClose={() => setPaletteOpen(false)} />}
      {appearanceOpen && <AppearanceModal theme={theme} onChange={setTheme} onClose={() => setAppearanceOpen(false)} />}
      {openFolderRequest && <OpenFolderModal key={openFolderRequest.id} request={openFolderRequest} onAuthorize={authorizeOpenFolder} onCancel={cancelOpenFolder} />}
      {regressionModalOpen && regressionSuite?.projectId && <RegressionSuiteModal desktop={desktop} cwd={workingDirectory} projectName={taskState.projectName} onClose={() => setRegressionModalOpen(false)} onSaved={(suite) => {
        setRegressionSuite((current) => current?.projectId === suite.projectId ? { projectId: suite.projectId, suite } : current);
        setRegressionModalOpen(false);
        notify(suite.enabled ? 'Suíte de regressão ligada' : 'Suíte de regressão desligada');
      }} />}
      {taskModalOpen && <NewTaskModal projectName={taskState.projectName} cwd={workingDirectory} onCreate={createTask} onClose={() => setTaskModalOpen(false)} />}
      {integrationModal && integrations[integrationModal] && !integrations[integrationModal].loading && <KimiIntegrationModal key={integrationModal} cli={INTEGRATION_CLIS[integrationModal].name} status={integrations[integrationModal]} onInstall={() => installIntegration(integrationModal)} onRemove={() => removeIntegration(integrationModal)} onRefresh={() => refreshIntegration(integrationModal)} onClose={() => setIntegrationModal(null)} />}
      {messageModal && <NewMessageModal projectName={currentProject?.name || activeProject} fromName={messageModal.session.name} toName={projectSessions.find((session) => session.roleKind === 'orchestrator')?.name || 'principal'} onSend={sendDiscovery} onClose={() => setMessageModal(null)} />}
      {toast && <div className="toast" role="status"><CheckCircle2 size={15} />{toast}</div>}
    </div>
  );
}
