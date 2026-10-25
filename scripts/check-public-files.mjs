import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const forbidden = /(^|\/)(?:\.atlas-local|\.atlas-smoke-results|\.atlas-smoke-fixture|node_modules|dist|release|auth-tokens|\.codex|\.kimi-code|\.ai-memory|backups)(\/|$)|(^|\/)\.env(?:\.|$)|\.(?:pem|key|p12|pfx|sqlite3?|db|log|bak)$/i;
const patterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['GitHub credential', /(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}/],
  ['AWS access key', /AKIA[A-Z0-9]{16}/],
  ['provider secret', /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{30,}/],
  ['personal machine path', /[A-Za-z]:[\\/]+Users[\\/]+(?!Public\b|example\b|user\b)[A-Za-z0-9_.-]+[\\/]/i],
];
const findings = [];
for (const file of files) {
  if (forbidden.test(file) && !file.endsWith('.env.example')) findings.push(`${file}: private/generated file`);
  if (!fs.existsSync(file)) { findings.push(`${file}: tracked file is missing`); continue; }
  if (fs.lstatSync(file).isSymbolicLink()) { findings.push(`${file}: review symbolic link before publication`); continue; }
  const content = fs.readFileSync(file, 'utf8');
  for (const [label, pattern] of patterns) if (pattern.test(content)) findings.push(`${file}: ${label}`);
}
if (findings.length) {
  console.error(findings.join('\n'));
  process.exitCode = 1;
} else console.log(`PASS public file guard: ${files.length} tracked files checked; no matches`);
