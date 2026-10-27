const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Entrada `atlas` no mcp.json do Kimi Code. O arquivo pertence ao usuário:
// só é escrito após consentimento explícito, outros servidores e campos são
// preservados e uma entrada `atlas` que não é do ATLAS nunca é sobrescrita.
const SERVER_NAME = 'atlas';
const BRIDGE_FILE = 'atlas-mcp-bridge.cjs';

function kimiHome(env = process.env) {
  return env.KIMI_CODE_HOME || path.join(os.homedir(), '.kimi-code');
}

// No app empacotado a ponte fica fora do app.asar (asarUnpack): o CLI do agente a
// inicia como processo Node separado, que lê o arquivo diretamente do disco.
function bridgePathFor(directory) {
  return path.join(directory, BRIDGE_FILE).replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
}

function atlasEntry({ execPath, bridgePath }) {
  return { command: execPath, args: [bridgePath], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

function isManaged(entry) {
  return Boolean(entry && typeof entry === 'object' && Array.isArray(entry.args)
    && typeof entry.args[0] === 'string' && path.basename(entry.args[0]) === BRIDGE_FILE);
}

function sameEntry(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readConfig(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, data: { mcpServers: {} } };
    return { exists: true, error: `Não foi possível ler ${file}: ${error.message}` };
  }
  let data;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch (error) {
    return { exists: true, error: `O arquivo ${file} não é JSON válido; corrija-o antes de conectar o ATLAS (${error.message}).` };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { exists: true, error: `O arquivo ${file} precisa ser um objeto JSON.` };
  if (data.mcpServers !== undefined && (!data.mcpServers || typeof data.mcpServers !== 'object' || Array.isArray(data.mcpServers))) {
    return { exists: true, error: `O campo mcpServers de ${file} precisa ser um objeto.` };
  }
  return { exists: true, data: { ...data, mcpServers: { ...(data.mcpServers || {}) } } };
}

function inspect({ home, entry }) {
  const file = path.join(home, 'mcp.json');
  const config = readConfig(file);
  return { config, status: describeStatus(file, config, entry) };
}

function getStatus({ home, entry }) {
  return inspect({ home, entry }).status;
}

function describeStatus(file, config, entry) {
  const base = { file, serverName: SERVER_NAME, expected: entry };
  if (config.error) return { ...base, state: 'invalid', error: config.error };
  const current = config.data.mcpServers[SERVER_NAME];
  if (current === undefined) return { ...base, state: 'absent' };
  if (!isManaged(current)) return { ...base, state: 'conflict', error: `Já existe um servidor "${SERVER_NAME}" em ${file} que não foi criado pelo ATLAS. Renomeie-o para conectar o ATLAS.` };
  return { ...base, state: sameEntry(current, entry) ? 'installed' : 'outdated', current };
}

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Um mcp.json mantido como link simbólico (dotfiles) é atualizado no destino, sem virar arquivo comum.
  let target = file;
  try { target = fs.realpathSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = `${target}.atlas-${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, target);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

// Verificação e escrita usam a mesma leitura do arquivo.
function install({ home, entry }) {
  const { config, status } = inspect({ home, entry });
  if (status.state === 'invalid' || status.state === 'conflict') throw new Error(status.error);
  if (status.state === 'installed') return status;
  config.data.mcpServers[SERVER_NAME] = entry;
  writeAtomic(status.file, config.data);
  return getStatus({ home, entry });
}

function remove({ home, entry }) {
  const { config, status } = inspect({ home, entry });
  if (status.state === 'invalid' || status.state === 'conflict') throw new Error(status.error);
  if (status.state === 'absent') return status;
  delete config.data.mcpServers[SERVER_NAME];
  writeAtomic(status.file, config.data);
  return getStatus({ home, entry });
}

module.exports = { SERVER_NAME, BRIDGE_FILE, bridgePathFor, kimiHome, atlasEntry, isManaged, getStatus, install, remove };
