const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

// Criação de worktrees por tarefa (marco 4c-2). Separada da descoberta, que segue
// somente leitura: só roda depois da aprovação explícita do usuário e nunca
// remove, sobrescreve ou reaproveita caminho ou branch existentes.

async function git(cwd, args, { timeout = 15000 } = {}) {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

function shortId(taskId) {
  const slug = String(taskId).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  if (slug.length < 8) throw new Error('Identificador de tarefa inválido para a worktree.');
  return slug;
}

// Único repositório do projeto: o caminho e a branch saem dele, sem escolha do agente.
function repositoryFor(project) {
  const repositories = project?.repositories || [];
  if (repositories.length !== 1) {
    throw new Error(repositories.length ? 'Projeto com mais de um repositório Git: worktree por tarefa não é suportada na v0.1.' : 'O projeto não tem repositório Git para criar a worktree.');
  }
  return repositories[0];
}

function planWorktree({ project, taskId }) {
  const repository = repositoryFor(project);
  const slug = shortId(taskId);
  return {
    repositoryPath: repository.path,
    path: path.join(`${repository.path}.atlas-worktrees`, `task-${slug}`),
    branch: `atlas/task-${slug}`,
  };
}

async function branchExists(repositoryPath, branch) {
  try {
    await git(repositoryPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

async function createWorktree(plan) {
  if (!/^atlas\/task-[a-z0-9]{8}$/.test(plan.branch)) throw new Error('Branch de worktree fora da política.');
  if (fs.existsSync(plan.path)) throw new Error(`O caminho da worktree já existe: ${plan.path}. Nada foi alterado.`);
  let base;
  try {
    base = await git(plan.repositoryPath, ['rev-parse', '--verify', 'HEAD^{commit}']);
  } catch {
    throw new Error('O repositório ainda não tem commit para servir de base à worktree.');
  }
  if (await branchExists(plan.repositoryPath, plan.branch)) throw new Error(`A branch ${plan.branch} já existe. Nada foi alterado.`);
  fs.mkdirSync(path.dirname(plan.path), { recursive: true });
  await git(plan.repositoryPath, ['worktree', 'add', '-b', plan.branch, '--', plan.path, base], { timeout: 60000 });
  return { ...plan, path: fs.realpathSync.native(plan.path), baseCommit: base };
}

module.exports = { planWorktree, createWorktree, repositoryFor };
