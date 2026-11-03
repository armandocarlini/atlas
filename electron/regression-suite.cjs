const { randomUUID } = require('node:crypto');

// Suíte de regressão (v0.2, item 3). O usuário configura, por projeto, o comando
// de testes e o prazo; só ele liga, desliga ou altera. Ao pedir revisão, o ATLAS
// roda o comando na worktree da tarefa e anexa o resultado como evidência do
// sistema. O resultado só informa: a conclusão continua sendo do usuário.

const MAX_COMMAND = 300;
const MIN_TIMEOUT_SECONDS = 60;
const MAX_TIMEOUT_SECONDS = 24 * 60 * 60;
const FINAL_STATES = new Set(['passed', 'failed', 'timeout', 'cancelled', 'error', 'interrupted', 'skipped']);

const SUITE_SELECT = `SELECT project_id AS projectId, enabled, command, timeout_seconds AS timeoutSeconds, version, updated_at AS updatedAt
  FROM regression_suites`;
const RUN_SELECT = `SELECT id, project_id AS projectId, task_id AS taskId, review_id AS reviewId, state, command,
  timeout_seconds AS timeoutSeconds, worktree_path AS worktreePath, cancel_requested AS cancelRequested, exit_code AS exitCode,
  log_path AS logPath, log_bytes AS logBytes, log_sha256 AS logSha256, log_truncated AS logTruncated, log_tail AS logTail,
  error, created_at AS createdAt, started_at AS startedAt, finished_at AS finishedAt, version FROM regression_runs`;

const suiteRow = (row) => row && { ...row, enabled: row.enabled === 1 };
const runRow = (row) => row && { ...row, cancelRequested: row.cancelRequested === 1, logTruncated: row.logTruncated === null ? null : row.logTruncated === 1 };

function suiteCommand(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_COMMAND) throw new Error(`Comando: informe um comando com até ${MAX_COMMAND} caracteres.`);
  if (/[\p{Cc}\p{Cf}]/u.test(value)) throw new Error('Comando: use uma linha só, sem caracteres de controle ou formatação invisível.');
  return value.trim();
}

// O prazo é escolha explícita do usuário: `null` é "sem prazo"; ausente é erro.
function suiteTimeout(value) {
  if (value === null) return null;
  if (value === undefined) throw new Error('Prazo: escolha um prazo ou "sem prazo".');
  if (!Number.isInteger(value) || value < MIN_TIMEOUT_SECONDS || value > MAX_TIMEOUT_SECONDS) throw new Error('Prazo: escolha de 1 minuto a 24 horas, ou "sem prazo".');
  return value;
}

function createRegressionSuites({ db, now, event, transaction, recordEvidence }) {
  const getSuite = (projectId) => suiteRow(db.prepare(`${SUITE_SELECT} WHERE project_id = ?`).get(projectId)) || null;
  const getRun = (id) => runRow(db.prepare(`${RUN_SELECT} WHERE id = ?`).get(id)) || null;

  // Fecha a execução e grava a evidência imutável com o resultado final. O trecho
  // do log fica só em `regression_runs`: a evidência vai inteira em cada
  // atualização da lista de tarefas, e o trecho é lido sob demanda.
  function finish(run, { state, exitCode = null, logBytes = null, logSha256 = null, logTruncated = null, logTail = null, error = null, worktreeChanged = null, testFiles = null }, at) {
    db.prepare(`UPDATE regression_runs SET state = ?, exit_code = ?, log_bytes = ?, log_sha256 = ?, log_truncated = ?, log_tail = ?, error = ?,
      finished_at = ?, version = version + 1 WHERE id = ?`)
      .run(state, exitCode, logBytes, logSha256, logTruncated === null ? null : Number(logTruncated), logTail, error, at, run.id);
    const durationMs = run.startedAt ? Date.parse(at) - Date.parse(run.startedAt) : null;
    recordEvidence({
      projectId: run.projectId, taskId: run.taskId, reviewId: run.reviewId, kind: 'regression_run', source: 'system',
      payload: { regressionRunId: run.id, state, command: run.command, timeoutSeconds: run.timeoutSeconds, exitCode, durationMs, logPath: run.logPath, logBytes, logSha256, logTruncated, error, worktreeChanged, testFiles },
      at,
    });
    event({ projectId: run.projectId, type: 'regression.finished', payload: { regressionRunId: run.id, reviewId: run.reviewId, state, exitCode }, correlationId: run.reviewId, at });
    return getRun(run.id);
  }

  return {
    getRegressionSuite: getSuite,
    getRegressionRun: getRun,
    // Sem o trecho do log: a lista acompanha cada atualização da interface.
    listRegressionRuns: (projectId) => db.prepare(`${RUN_SELECT} WHERE project_id = ? ORDER BY created_at, rowid`).all(projectId)
      .map((row) => { const { logTail, ...rest } = runRow(row); return rest; }),
    nextQueuedRegressionRun: () => runRow(db.prepare(`${RUN_SELECT} WHERE state = 'queued' ORDER BY created_at, rowid LIMIT 1`).get()) || null,

    // Só o usuário configura (IPC da janela principal). `expectedVersion` é null na criação.
    setRegressionSuite({ projectId, enabled, command, timeoutSeconds, expectedVersion = null }) {
      if (typeof enabled !== 'boolean') throw new Error('Informe se a suíte fica ligada.');
      const fields = { command: suiteCommand(command), timeoutSeconds: suiteTimeout(timeoutSeconds) };
      return transaction(db, () => {
        if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId)) throw new Error('Projeto não encontrado.');
        const current = getSuite(projectId);
        if ((current?.version ?? null) !== expectedVersion) throw new Error('A configuração da suíte mudou desde que foi aberta. Recarregue e tente de novo.');
        const at = now();
        if (current) {
          db.prepare('UPDATE regression_suites SET enabled = ?, command = ?, timeout_seconds = ?, version = version + 1, updated_at = ? WHERE project_id = ?')
            .run(Number(enabled), fields.command, fields.timeoutSeconds, at, projectId);
        } else {
          db.prepare('INSERT INTO regression_suites (project_id, enabled, command, timeout_seconds, version, updated_at) VALUES (?, ?, ?, ?, 1, ?)')
            .run(projectId, Number(enabled), fields.command, fields.timeoutSeconds, at);
        }
        event({ projectId, type: 'regression.configured', payload: { enabled, command: fields.command, timeoutSeconds: fields.timeoutSeconds, actor: 'user' }, at });
        return getSuite(projectId);
      });
    },

    // Chamado depois que a revisão foi gravada. Suíte desligada ou ausente: nada.
    // Tarefa sem worktree: execução `skipped`, para a ausência não parecer sucesso.
    // O comando e o prazo valem como estavam no pedido.
    enqueueRegressionRun({ projectId, taskId, reviewId, worktreePath }) {
      return transaction(db, () => {
        const suite = getSuite(projectId);
        if (!suite?.enabled) return null;
        const id = randomUUID();
        const at = now();
        db.prepare(`INSERT INTO regression_runs (id, project_id, task_id, review_id, state, command, timeout_seconds, worktree_path, created_at, version)
          VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, 1)`).run(id, projectId, taskId, reviewId, suite.command, suite.timeoutSeconds, worktreePath || null, at);
        event({ projectId, type: 'regression.queued', payload: { regressionRunId: id, reviewId }, correlationId: reviewId, at });
        if (!worktreePath) return finish(getRun(id), { state: 'skipped', error: 'Suíte não executada: a tarefa não tem worktree registrada pelo ATLAS.' }, at);
        return getRun(id);
      });
    },

    startRegressionRun({ id, logPath }) {
      return transaction(db, () => {
        const run = getRun(id);
        if (!run || run.state !== 'queued') return null;
        db.prepare("UPDATE regression_runs SET state = 'running', log_path = ?, started_at = ?, version = version + 1 WHERE id = ?").run(logPath, now(), id);
        return getRun(id);
      });
    },

    finishRegressionRun({ id, ...result }) {
      if (!FINAL_STATES.has(result.state) || ['skipped', 'interrupted'].includes(result.state)) throw new Error('Resultado de suíte inválido.');
      return transaction(db, () => {
        const run = getRun(id);
        if (!run) throw new Error('Execução da suíte não encontrada.');
        if (FINAL_STATES.has(run.state)) return run;
        return finish(run, result, now());
      });
    },

    // Só o usuário para a suíte. Na fila: encerra já. Rodando: marca o pedido, e
    // o executor encerra o processo e grava `cancelled`.
    cancelRegressionRun({ projectId, id }) {
      return transaction(db, () => {
        const run = getRun(id);
        if (!run || run.projectId !== projectId) throw new Error('Execução da suíte não encontrada neste projeto.');
        if (FINAL_STATES.has(run.state)) throw new Error('A suíte já terminou.');
        event({ projectId, type: 'regression.cancel_requested', payload: { regressionRunId: id, actor: 'user' }, correlationId: run.reviewId, at: now() });
        if (run.state === 'queued') return finish(run, { state: 'cancelled', error: 'Parada pelo usuário antes de começar.' }, now());
        db.prepare('UPDATE regression_runs SET cancel_requested = 1, version = version + 1 WHERE id = ?').run(id);
        return getRun(id);
      });
    },

    // Fechamento ou reinício do ATLAS: nada é repetido sozinho, e o que estava
    // na fila ou rodando vira `interrupted`, nunca `passed`.
    reconcileRegressionRuns(reason = 'application_restarted') {
      return transaction(db, () => {
        const pending = db.prepare(`${RUN_SELECT} WHERE state IN ('queued', 'running')`).all().map(runRow);
        const at = now();
        for (const run of pending) finish(run, { state: 'interrupted', error: reason === 'application_closed' ? 'O ATLAS foi fechado antes de a suíte terminar.' : 'O ATLAS reiniciou antes de a suíte terminar.' }, at);
        return pending.length;
      });
    },
  };
}

module.exports = { createRegressionSuites, MAX_COMMAND, MIN_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS };
