import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleSlash, Clock, Loader2, MinusCircle, TimerOff, XCircle } from 'lucide-react';
import useModalFocus from './useModalFocus.js';

// Suíte de regressão (v0.2): o usuário configura por projeto; o ATLAS roda o
// comando quando um agente pede revisão e mostra o resultado na revisão. Só informa.

const MAX_COMMAND = 300;
const MAX_TIMEOUT_SECONDS = 24 * 60 * 60;

const STATES = {
  queued: { icon: Clock, label: 'Na fila', tone: '' },
  running: { icon: Loader2, label: 'Rodando', tone: '' },
  passed: { icon: CheckCircle2, label: 'Passou', tone: 'success-text' },
  failed: { icon: XCircle, label: 'Falhou', tone: 'danger-text' },
  timeout: { icon: TimerOff, label: 'Prazo esgotado', tone: 'danger-text' },
  cancelled: { icon: CircleSlash, label: 'Parada por você', tone: 'warning-text' },
  error: { icon: AlertTriangle, label: 'Não rodou (erro)', tone: 'danger-text' },
  interrupted: { icon: AlertTriangle, label: 'Interrompida: o ATLAS fechou durante a execução', tone: 'warning-text' },
  skipped: { icon: MinusCircle, label: 'Não executada: tarefa sem worktree', tone: 'warning-text' },
};

const SHORT_LABELS = { queued: 'na fila', running: 'rodando', passed: 'passou', failed: 'falhou', timeout: 'prazo esgotado', cancelled: 'parada', error: 'não rodou', interrupted: 'interrompida', skipped: 'não executada' };

export function regressionLabel(state, exitCode, { short = false } = {}) {
  const label = (short ? SHORT_LABELS[state] : STATES[state]?.label) || state;
  return state === 'failed' && Number.isInteger(exitCode) ? `${label} (exit ${exitCode})` : label;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${seconds % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function formatTimeout(seconds) {
  if (seconds === null || seconds === undefined) return 'sem prazo';
  return seconds % 3600 === 0 ? `${seconds / 3600} h` : `${Math.round(seconds / 60)} min`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// Estado discreto na subbarra do projeto, com o caminho para configurar.
export function RegressionSuiteStatus({ suite, onManage }) {
  if (!suite) return null;
  const label = suite.loading ? 'verificando…' : suite.error ? 'indisponível' : suite.suite?.enabled ? `ligada · ${formatTimeout(suite.suite.timeoutSeconds)}` : 'desligada';
  return <span className="regression-status" role="status">
    <span>Suíte de regressão: {label}</span>
    {!suite.loading && <button type="button" className="link-button" onClick={onManage}>Configurar</button>}
  </span>;
}

function initialTimeout(suite) {
  if (!suite) return { mode: '', amount: '', unit: 'min' };
  if (suite.timeoutSeconds === null) return { mode: 'none', amount: '', unit: 'min' };
  return suite.timeoutSeconds % 3600 === 0
    ? { mode: 'limit', amount: String(suite.timeoutSeconds / 3600), unit: 'h' }
    : { mode: 'limit', amount: String(Math.round(suite.timeoutSeconds / 60)), unit: 'min' };
}

// Prazo escolhido: segundos, `null` para "sem prazo", ou um erro para mostrar.
function chosenTimeout({ mode, amount, unit }) {
  if (mode === 'none') return { value: null };
  if (mode !== 'limit') return { error: 'Escolha um prazo ou "sem prazo".' };
  const number = Number(amount);
  const seconds = number * (unit === 'h' ? 3600 : 60);
  if (!amount.trim() || !Number.isInteger(number) || seconds < 60 || seconds > MAX_TIMEOUT_SECONDS) return { error: 'Use um número inteiro de 1 minuto a 24 horas.' };
  return { value: seconds };
}

export function RegressionSuiteModal({ desktop, cwd, projectName, onClose, onSaved }) {
  const dialogRef = useModalFocus();
  const [loaded, setLoaded] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [command, setCommand] = useState('');
  const [timeout, setTimeoutChoice] = useState({ mode: '', amount: '', unit: 'min' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scope] = useState({ cwd, projectName });

  useEffect(() => {
    let active = true;
    desktop.getRegressionSuite({ cwd: scope.cwd }).then((result) => {
      if (!active) return;
      setLoaded(result);
      setEnabled(Boolean(result.suite?.enabled));
      setCommand(result.suite?.command || '');
      setTimeoutChoice(initialTimeout(result.suite));
    }).catch((failure) => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [desktop, scope.cwd]);

  // Os campos só existem depois da leitura; o foco vai para o comando quando chegam.
  useEffect(() => {
    if (loaded) dialogRef.current?.querySelector('[name=command]')?.focus();
  }, [loaded, dialogRef]);

  const timeoutChoice = chosenTimeout(timeout);
  const ready = Boolean(loaded) && command.trim() && !timeoutChoice.error;

  async function submit(event) {
    event.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError('');
    try {
      const suite = await desktop.setRegressionSuite({ cwd: scope.cwd, enabled, command: command.trim(), timeoutSeconds: timeoutChoice.value, expectedVersion: loaded.suite?.version ?? null });
      onSaved(suite);
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
    }
  }

  return <div className="modal-backdrop" onKeyDown={(event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === ',') { event.preventDefault(); event.stopPropagation(); }
    if (event.key === 'Escape' && !busy) onClose();
  }}>
    <section className="modal regression-modal" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="regression-title" aria-describedby="regression-summary">
      <header><div><span className="eyebrow">{scope.projectName}</span><h2 id="regression-title">Suíte de regressão</h2></div><button type="button" className="session-control" disabled={busy} onClick={onClose}>Fechar</button></header>
      <form onSubmit={submit} aria-busy={busy || !loaded}>
        <p id="regression-summary" className="regression-intro">Quando um agente pede revisão, o ATLAS roda este comando na worktree da tarefa e anexa o resultado à revisão. O resultado só informa: você decide se conclui.</p>
        {!loaded && !error && <p role="status">Carregando configuração…</p>}
        {loaded && <>
          <label className="regression-switch">
            <input type="checkbox" role="switch" name="enabled" checked={enabled} disabled={busy} onChange={(event) => setEnabled(event.target.checked)} />
            <span>Rodar a suíte quando um agente pedir revisão</span>
          </label>
          <label>Comando
            <input name="command" value={command} maxLength={MAX_COMMAND} disabled={busy} spellCheck={false} autoComplete="off" aria-describedby="regression-command-help" onChange={(event) => setCommand(event.target.value)} />
          </label>
          <div id="regression-command-help" className="regression-help">
            {loaded.suggestion
              ? <span>O <code>package.json</code> do projeto tem um script de testes. <button type="button" className="link-button" disabled={busy} onClick={() => setCommand(loaded.suggestion)}>Usar sugestão: {loaded.suggestion}</button></span>
              : <span>Uma linha, como você digitaria no terminal do sistema.</span>}
          </div>
          <fieldset className="regression-timeout" disabled={busy}>
            <legend>Prazo</legend>
            <label className="regression-choice"><input type="radio" name="timeout-mode" value="limit" checked={timeout.mode === 'limit'} onChange={() => setTimeoutChoice((current) => ({ ...current, mode: 'limit' }))} /><span>Parar depois de</span></label>
            <div className="regression-amount">
              <input name="timeout-amount" type="number" min={1} step={1} inputMode="numeric" aria-label="Prazo" value={timeout.amount} disabled={busy || timeout.mode !== 'limit'} onChange={(event) => setTimeoutChoice((current) => ({ ...current, amount: event.target.value }))} />
              <select name="timeout-unit" aria-label="Unidade do prazo" value={timeout.unit} disabled={busy || timeout.mode !== 'limit'} onChange={(event) => setTimeoutChoice((current) => ({ ...current, unit: event.target.value }))}>
                <option value="min">minutos</option>
                <option value="h">horas</option>
              </select>
            </div>
            <label className="regression-choice"><input type="radio" name="timeout-mode" value="none" checked={timeout.mode === 'none'} onChange={() => setTimeoutChoice((current) => ({ ...current, mode: 'none' }))} /><span>Sem prazo (pare pela revisão, em "Parar suíte")</span></label>
            {timeout.mode === 'limit' && timeoutChoice.error && timeout.amount !== '' && <p className="field-error" role="alert">{timeoutChoice.error}</p>}
          </fieldset>
          <p className="regression-warning"><AlertTriangle size={14} aria-hidden="true" /><span>O comando roda no shell do sistema com as suas permissões, sobre o código que o agente escreveu. Configure só um comando em que você confia. Os agentes veem apenas se a suíte passou ou falhou.</span></p>
        </>}
        {error && <p className="error-note" role="alert">{error}</p>}
        <footer><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancelar</button><button type="submit" className="button primary" disabled={busy || !ready}>{busy ? 'Salvando…' : 'Salvar'}</button></footer>
      </form>
    </section>
  </div>;
}

// Bloco da revisão: estado da execução (ao vivo pela fila) e resultado final
// gravado como evidência do sistema. `actions` existe só na janela principal.
export function RegressionRunEvidence({ run, evidence, actions }) {
  const result = evidence?.payload;
  const id = result?.regressionRunId || run?.id;
  const state = result?.state || run?.state;
  const [tail, setTail] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  if (!state) return null;
  const meta = STATES[state] || { icon: AlertTriangle, label: state, tone: '' };
  const Icon = meta.icon;
  const active = state === 'queued' || state === 'running';
  const stopping = active && run?.cancelRequested;
  const logPath = result?.logPath || run?.logPath;
  const duration = formatDuration(result?.durationMs);
  const testFiles = result?.testFiles;

  async function act(name, action) {
    if (busy) return;
    setBusy(name);
    setError('');
    try {
      const failure = await action();
      if (failure) setError(failure);
    } finally {
      setBusy('');
    }
  }

  async function loadTail(open) {
    if (!open || tail !== null || !actions) return;
    try {
      const full = await actions.load(id);
      setTail(full?.logTail ?? '');
    } catch (failure) {
      setError(failure.message);
    }
  }

  return <div className="handoff-text regression-evidence">
    <span>Suíte de regressão (verificada pelo ATLAS)</span>
    <div className="regression-result">
      <p className={`regression-state ${meta.tone}`}><Icon size={14} aria-hidden="true" /><strong>{regressionLabel(state, result?.exitCode)}</strong></p>
      <dl className="evidence-git">
        <dt>Comando</dt><dd><code>{result?.command || run?.command}</code></dd>
        <dt>Prazo</dt><dd>{formatTimeout(result ? result.timeoutSeconds : run?.timeoutSeconds)}</dd>
        {duration && <><dt>Duração</dt><dd>{duration}</dd></>}
        {Number.isFinite(result?.logBytes) && <><dt>Log</dt><dd>{formatBytes(result.logBytes)}{result.logTruncated ? ' (cortado no teto de 1 GB)' : ''}</dd></>}
      </dl>
      {result?.error && <p className="evidence-detail">{result.error}</p>}
      {result?.worktreeChanged === true && <p className="task-warning">A suíte alterou a worktree ao rodar (por exemplo, arquivos gerados pelos testes). O aceite exige a worktree igual à do pedido de revisão; confira o log.</p>}
      {testFiles?.total > 0 && <div className="task-warning regression-test-files">
        <p>O diff do agente altera {testFiles.total === 1 ? '1 arquivo ligado' : `${testFiles.total} arquivos ligados`} aos testes. Um verde aqui não é garantia: o que a suíte verifica pode ter mudado.</p>
        <ul>{testFiles.files.map((file) => <li key={file}><code>{file}</code></li>)}</ul>
        {testFiles.total > testFiles.files.length && <p>e mais {testFiles.total - testFiles.files.length}.</p>}
      </div>}
      {(state === 'passed' || state === 'failed') && (result?.worktreeChanged === null || testFiles === null) && <p className="evidence-detail">O ATLAS não conseguiu ler o Git da worktree para {testFiles === null ? 'listar os arquivos de teste alterados' : 'conferir se a suíte alterou a worktree'}.</p>}
      {actions && logPath && !active && <details className="regression-log" onToggle={(event) => loadTail(event.currentTarget.open)}>
        <summary>Trecho final do log</summary>
        {tail === null ? <p role="status">Carregando…</p> : tail ? <pre tabIndex={0} aria-label="Trecho final do log da suíte">{tail}</pre> : <p>O log está vazio.</p>}
      </details>}
      {actions && (active || logPath) && <div className="review-actions">
        {active && (stopping
          ? <span className="regression-stopping" role="status">Parando…</span>
          : <button type="button" className="button secondary danger compact" disabled={Boolean(busy)} onClick={() => act('stop', () => actions.cancel(id))}>{busy === 'stop' ? 'Parando…' : 'Parar suíte'}</button>)}
        {!active && logPath && <>
          <button type="button" className="button secondary compact" disabled={Boolean(busy)} onClick={() => act('reveal', () => actions.openLog(id, true))}>Mostrar na pasta</button>
          <button type="button" className="button secondary compact" disabled={Boolean(busy)} onClick={() => act('open', () => actions.openLog(id, false))}>Abrir log completo</button>
        </>}
      </div>}
      {error && <p className="error-note" role="alert">{error}</p>}
    </div>
  </div>;
}
