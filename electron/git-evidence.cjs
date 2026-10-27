const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

// Retrato Git coletado pelo próprio ATLAS (verificação do sistema, não declaração
// do agente). Somente leitura. O agente escreve dentro da worktree, inclusive no
// arquivo `.git` dela: por isso o diretório Git é resolvido a partir do repositório
// principal e passado explicitamente, e configurações que executam comandos
// (fsmonitor, diff externo, textconv) ficam desligadas.
const SAFE_CONFIG = ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'diff.external='];

const samePath = (left, right) => (process.platform === 'win32'
  ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
  : path.resolve(left) === path.resolve(right));

const realpath = (value) => {
  try {
    return fs.realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
};

// Diretório administrativo da worktree dentro do `.git` do repositório principal,
// conferido pelo arquivo `gitdir` que o próprio Git mantém lá.
function resolveWorktreeGitDir(repositoryPath, worktreePath, common = path.join(repositoryPath, '.git')) {
  if (!fs.statSync(common, { throwIfNoEntry: false })?.isDirectory()) throw new Error('Repositório principal sem diretório .git.');
  const expected = path.join(realpath(worktreePath), '.git');
  const admin = path.join(common, 'worktrees');
  for (const entry of fs.readdirSync(admin, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pointer = path.join(admin, entry.name, 'gitdir');
    let target;
    try {
      target = fs.readFileSync(pointer, 'utf8').trim();
    } catch {
      continue;
    }
    if (samePath(realpath(path.dirname(target)) + path.sep + '.git', expected) || samePath(target, expected)) return path.join(admin, entry.name);
  }
  throw new Error('A worktree não está registrada no repositório principal.');
}

function safeText(value, max = 200) {
  return String(value).replace(/[\p{Cc}\p{Cf}]+/gu, ' ').trim().slice(0, max);
}

async function git(gitDir, workTree, args) {
  const { stdout } = await execFileAsync('git', ['--no-optional-locks', ...SAFE_CONFIG, `--git-dir=${gitDir}`, `--work-tree=${workTree}`, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024, cwd: workTree,
  });
  return stdout;
}

function parseShortstat(output) {
  const number = (pattern) => Number(output.match(pattern)?.[1] || 0);
  return { files: number(/(\d+) files? changed/), insertions: number(/(\d+) insertions?\(\+\)/), deletions: number(/(\d+) deletions?\(-\)/) };
}

async function collectGitEvidence({ repositoryPath, path: worktreePath, branch, baseCommit }) {
  if (!/^[0-9a-f]{7,64}$/i.test(baseCommit || '')) throw new Error('Commit-base inválido para a evidência.');
  const gitDir = resolveWorktreeGitDir(repositoryPath, worktreePath);
  const [head, current, committed, status, commits] = await Promise.all([
    git(gitDir, worktreePath, ['rev-parse', '--verify', 'HEAD^{commit}']),
    git(gitDir, worktreePath, ['branch', '--show-current']),
    git(gitDir, worktreePath, ['diff', '--no-ext-diff', '--no-textconv', '--shortstat', baseCommit, 'HEAD', '--']),
    git(gitDir, worktreePath, ['status', '--porcelain=v1', '--untracked-files=normal', '--ignore-submodules=all']),
    git(gitDir, worktreePath, ['rev-list', '--count', `${baseCommit}..HEAD`]),
  ]);
  return {
    worktreePath,
    expectedBranch: branch,
    // Nome de branch escolhido pelo agente: só caracteres visíveis.
    branch: safeText(current.trim(), 250),
    baseCommit,
    headCommit: head.trim(),
    commits: Number(commits.trim()),
    diff: parseShortstat(committed),
    uncommittedFiles: status.split('\n').filter(Boolean).length,
  };
}

// Motivo fixo do sistema e trecho técnico separado: a saída do Git pode conter texto
// vindo da worktree e não pode aparecer como verificação do ATLAS.
function unavailableEvidence(error, worktreePath) {
  return { unavailable: 'O ATLAS não conseguiu ler a worktree registrada da tarefa.', worktreePath, detail: safeText(String(error?.message || error).split('\n').find((line) => line.trim()) || '') };
}

module.exports = { collectGitEvidence, parseShortstat, resolveWorktreeGitDir, unavailableEvidence, SAFE_CONFIG };
