const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const IGNORED_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', '.next', '.nuxt', '.output', '.turbo', '.venv',
  'node_modules', 'dist', 'build', 'coverage', 'target', 'vendor', 'venv',
]);

function idFor(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

async function runGit(cwd, args, options = {}) {
  const { stdout } = await execFileAsync('git', ['--no-optional-locks', '-C', cwd, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeout || 8000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

async function canonicalPath(value) {
  return fs.realpath(path.resolve(value));
}

async function findRepositoryCandidates(rootPath, options) {
  const startedAt = Date.now();
  const queue = [{ directory: rootPath, depth: 0 }];
  const candidates = [];
  const errors = [];
  let visited = 0;
  let truncated = false;

  while (queue.length > 0 && candidates.length < options.maxRepositories) {
    if (Date.now() - startedAt > options.timeoutMs || visited >= options.maxEntries) {
      truncated = true;
      break;
    }

    const { directory, depth } = queue.shift();
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
      visited += entries.length;
    } catch (error) {
      errors.push({ path: directory, message: error.message });
      continue;
    }

    if (entries.some((entry) => entry.name === '.git' && (entry.isDirectory() || entry.isFile()))) {
      candidates.push(directory);
    }

    if (depth >= options.maxDepth) continue;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) continue;
      queue.push({ directory: path.join(directory, entry.name), depth: depth + 1 });
    }
  }

  if (queue.length > 0) truncated = true;
  return { candidates, errors, truncated };
}

function parseWorktrees(output) {
  return output.split(/\r?\n\r?\n/).filter(Boolean).map((record) => {
    const worktree = { path: null, head: null, branch: null, detached: false, bare: false, locked: false, prunable: false };
    for (const line of record.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) worktree.path = line.slice(9);
      else if (line.startsWith('HEAD ')) worktree.head = line.slice(5);
      else if (line.startsWith('branch ')) worktree.branch = line.slice(7).replace(/^refs\/heads\//, '');
      else if (line === 'detached') worktree.detached = true;
      else if (line === 'bare') worktree.bare = true;
      else if (line.startsWith('locked')) worktree.locked = true;
      else if (line.startsWith('prunable')) worktree.prunable = true;
    }
    return worktree;
  });
}

function parseBranches(output) {
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, head, upstream, date, subject] = line.split('\0');
    return { name, head, upstream: upstream || null, lastCommitAt: date || null, subject: subject || '' };
  });
}

function parseStatus(output) {
  const status = { branch: null, upstream: null, ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0, conflicts: 0 };
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('# branch.head ')) status.branch = line.slice(14);
    else if (line.startsWith('# branch.upstream ')) status.upstream = line.slice(18);
    else if (line.startsWith('# branch.ab ')) {
      const [ahead, behind] = line.slice(12).split(' ');
      status.ahead = Math.abs(Number(ahead) || 0);
      status.behind = Math.abs(Number(behind) || 0);
    } else if (line.startsWith('? ')) status.untracked += 1;
    else if (line.startsWith('u ')) status.conflicts += 1;
    else if (/^[12] /.test(line)) {
      const [x, y] = line.slice(2, 4);
      if (x !== '.') status.staged += 1;
      if (y !== '.') status.modified += 1;
    }
  }
  if (status.branch === '(detached)') status.branch = null;
  return status;
}

async function readLastCommit(worktreePath) {
  try {
    const output = await runGit(worktreePath, ['log', '-1', '--format=%H%x00%h%x00%cI%x00%s']);
    const [hash, shortHash, date, subject] = output.trimEnd().split('\0');
    return hash ? { hash, shortHash, date, subject: subject || '' } : null;
  } catch {
    return null;
  }
}

async function inspectRepository(candidatePath) {
  const worktreePath = await canonicalPath(candidatePath);
  const [commonDirOutput, worktreeList, branchList] = await Promise.all([
    runGit(worktreePath, ['rev-parse', '--git-common-dir']),
    runGit(worktreePath, ['worktree', 'list', '--porcelain']),
    runGit(worktreePath, [
      'for-each-ref', 'refs/heads',
      '--format=%(refname:short)%00%(objectname:short)%00%(upstream:short)%00%(committerdate:iso-strict)%00%(subject)',
    ]),
  ]);
  const commonDir = await canonicalPath(path.resolve(worktreePath, commonDirOutput.trim()));
  const records = parseWorktrees(worktreeList);
  const worktrees = await Promise.all(records.filter((record) => !record.bare).map(async (record, index) => {
    const recordPath = path.resolve(record.path || worktreePath);
    let currentPath = recordPath;
    let statusError = null;
    let status = null;
    try {
      currentPath = await canonicalPath(recordPath);
      status = parseStatus(await runGit(currentPath, ['status', '--porcelain=v2', '--branch', '--untracked-files=normal']));
    } catch (error) {
      statusError = error.message;
    }
    return {
      id: idFor(currentPath),
      path: currentPath,
      name: path.basename(currentPath),
      head: record.head,
      branch: status?.branch || record.branch,
      detached: record.detached,
      locked: record.locked,
      prunable: record.prunable,
      isMain: index === 0,
      status,
      statusError,
      lastCommit: statusError ? null : await readLastCommit(currentPath),
    };
  }));
  const mainWorktree = worktrees.find((worktree) => worktree.isMain) || worktrees[0];
  return {
    commonDir,
    repository: {
      id: idFor(commonDir),
      name: path.basename(mainWorktree?.path || worktreePath),
      path: mainWorktree?.path || worktreePath,
      branches: parseBranches(branchList),
      worktrees,
    },
  };
}

async function discoverRepositories(root, options = {}) {
  const settings = { maxDepth: 8, maxEntries: 30000, maxRepositories: 100, timeoutMs: 15000, ...options };
  const rootPath = await canonicalPath(root);
  const found = await findRepositoryCandidates(rootPath, settings);
  const grouped = new Map();
  const errors = [...found.errors];

  for (const candidate of found.candidates) {
    try {
      const { commonDir, repository } = await inspectRepository(candidate);
      if (!grouped.has(commonDir)) grouped.set(commonDir, repository);
    } catch (error) {
      errors.push({ path: candidate, message: error.message });
    }
  }

  return { rootPath, repositories: [...grouped.values()], errors, truncated: found.truncated };
}

module.exports = { discoverRepositories, idFor, parseStatus, parseWorktrees };
