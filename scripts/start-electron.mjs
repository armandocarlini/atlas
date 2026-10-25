import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.', ...process.argv.slice(2)], {
  env,
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error('Não foi possível iniciar o Electron:', error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
