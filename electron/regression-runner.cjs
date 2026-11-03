const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn, execFile } = require('node:child_process');

// Executor da suíte de regressão: uma execução por vez, na worktree da tarefa,
// com o comando que o usuário configurou. O log completo vai para um arquivo;
// o banco guarda caminho, tamanho, SHA-256 e o trecho final. Sem nova tentativa
// automática: prazo, parada, falha de gravação ou fechamento nunca viram `passed`.

const TAIL_BYTES = 64 * 1024;
const MAX_LOG_BYTES = 1024 ** 3;
const EXIT_DRAIN_MS = 2000;

// Credenciais do ATLAS não passam para a suíte; o resto do ambiente é o do usuário.
function suiteEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !/^ATLAS_/i.test(key) && key.toUpperCase() !== 'OPENCODE_CONFIG_CONTENT'));
}

// O comando é do usuário e roda como se ele o digitasse num terminal.
function shellInvocation(command, platform, env) {
  if (platform === 'win32') {
    return { file: env.ComSpec || env.COMSPEC || 'cmd.exe', args: ['/d', '/s', '/c', `"${command}"`], options: { windowsVerbatimArguments: true, windowsHide: true } };
  }
  return { file: '/bin/sh', args: ['-c', command], options: { detached: true } };
}

function defaultKillTree(child, platform) {
  if (platform === 'win32') {
    execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* já saiu */ }
  }
}

// Trecho para a interface: sem sequências ANSI nem controles além de quebra de linha e tab.
function readableTail(buffer) {
  return buffer.toString('utf8')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\p{Cf}|[^\P{Cc}\n\t]/gu, '');
}

function createRegressionRunner({
  store, logsDir, onChange = () => {}, env = process.env, platform = process.platform,
  spawnImpl = spawn, killTree = defaultKillTree, maxLogBytes = MAX_LOG_BYTES, tailBytes = TAIL_BYTES, onError = console.error,
  secondMs = 1000, // testes encurtam o prazo sem mudar a regra de 1 minuto a 24 horas
}) {
  let current = null;
  let stopped = false;
  let idle = Promise.resolve();

  const logPathFor = (run) => path.join(logsDir, run.projectId, `${run.id}.log`);

  function notify(projectId) {
    try { onChange(projectId); } catch (error) { onError(error); }
  }

  function finish(id, projectId, result) {
    if (stopped) return;
    try {
      store.finishRegressionRun({ id, ...result });
    } catch (error) {
      onError(error);
    }
    notify(projectId);
  }

  function execute(queued) {
    const logPath = logPathFor(queued);
    const run = store.startRegressionRun({ id: queued.id, logPath });
    if (!run) return Promise.resolve();
    notify(run.projectId);
    let fd;
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fd = fs.openSync(logPath, 'wx');
    } catch (error) {
      finish(run.id, run.projectId, { state: 'error', error: `Não foi possível criar o arquivo de log: ${error.code || error.message}.` });
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const hash = createHash('sha256');
      let tail = Buffer.alloc(0);
      let total = 0;
      let written = 0;
      let truncated = false;
      let writeError = null;
      let timedOut = false;
      let child;
      let timer = null;
      let settled = false;
      let drain = null;

      const write = (buffer) => {
        fs.writeSync(fd, buffer);
        hash.update(buffer);
        written += buffer.length;
      };
      const stop = () => {
        if (child?.pid) killTree(child, platform);
      };

      function onData(chunk) {
        total += chunk.length;
        tail = Buffer.concat([tail, chunk]);
        if (tail.length > tailBytes) tail = tail.subarray(tail.length - tailBytes);
        if (writeError || truncated) return;
        try {
          const room = maxLogBytes - written;
          if (chunk.length <= room) {
            write(chunk);
          } else {
            write(chunk.subarray(0, room));
            truncated = true;
            write(Buffer.from(`\n[ATLAS] log cortado em ${maxLogBytes} bytes; a suíte continuou rodando.\n`));
          }
        } catch (error) {
          writeError = error;
          stop();
        }
      }

      function settle({ exitCode = null, spawnError = null }) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(drain);
        try { fs.closeSync(fd); } catch (error) { writeError ||= error; }
        if (stopped) {
          resolve();
          return;
        }
        const cancelled = store.getRegressionRun(run.id)?.cancelRequested;
        const logs = { logBytes: total, logSha256: hash.digest('hex'), logTruncated: truncated, logTail: readableTail(tail) };
        let result;
        if (spawnError) result = { state: 'error', error: `O shell não iniciou: ${spawnError.code || spawnError.message}.` };
        else if (writeError) result = { state: 'error', exitCode, error: `Falha ao gravar o log: ${writeError.code || writeError.message}.` };
        else if (cancelled) result = { state: 'cancelled', exitCode, error: 'Parada pelo usuário.' };
        else if (timedOut) result = { state: 'timeout', exitCode, error: `Prazo de ${run.timeoutSeconds} s esgotado.` };
        else result = { state: exitCode === 0 ? 'passed' : 'failed', exitCode };
        finish(run.id, run.projectId, { ...logs, ...result });
        resolve();
      }

      const shell = shellInvocation(run.command, platform, env);
      try {
        child = spawnImpl(shell.file, shell.args, { ...shell.options, cwd: run.worktreePath, env: suiteEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error) {
        settle({ spawnError: error });
        return;
      }
      current = { id: run.id, stop };
      // O usuário pode ter pedido para parar entre o início e o spawn.
      if (store.getRegressionRun(run.id)?.cancelRequested) stop();
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.once('error', (error) => settle({ spawnError: error }));
      child.once('close', (code) => settle({ exitCode: Number.isInteger(code) ? code : null }));
      // Um processo filho que herdou os pipes pode mantê-los abertos depois que o
      // shell saiu: o resultado é o do shell, e os pipes são fechados após um respiro.
      child.once('exit', (code) => {
        drain = setTimeout(() => {
          child.stdout?.destroy();
          child.stderr?.destroy();
          settle({ exitCode: Number.isInteger(code) ? code : null });
        }, EXIT_DRAIN_MS);
      });
      if (run.timeoutSeconds) {
        timer = setTimeout(() => {
          timedOut = true;
          stop();
        }, run.timeoutSeconds * secondMs);
      }
    });
  }

  // Processa a fila até esvaziar; chamadas concorrentes reaproveitam o mesmo ciclo.
  function pump() {
    if (stopped) return Promise.resolve();
    if (current) return idle;
    const next = store.nextQueuedRegressionRun();
    if (!next) return Promise.resolve();
    current = { id: next.id, stop: () => {} };
    idle = Promise.resolve()
      .then(() => execute(next))
      .catch(onError)
      .then(() => {
        current = null;
        return pump();
      });
    return idle;
  }

  return {
    // Depois de enfileirar uma execução no store.
    notify: pump,
    // Depois de o store registrar o pedido do usuário para parar.
    cancel(id) {
      if (current?.id === id) current.stop();
    },
    // Fechamento do ATLAS: encerra o processo sem gravar; a reconciliação do
    // store marca `interrupted`.
    shutdown() {
      stopped = true;
      current?.stop();
    },
    get idle() { return idle; },
    logPathFor,
  };
}

module.exports = { createRegressionRunner, suiteEnv, shellInvocation, readableTail, TAIL_BYTES, MAX_LOG_BYTES };
