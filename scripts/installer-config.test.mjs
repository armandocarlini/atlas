import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { openCommand, KEY_NAME, LABEL } = require('../electron/explorer-integration.cjs');
const { bridgePathFor, BRIDGE_FILE } = require('../electron/kimi-mcp-config.cjs');

const nsh = fs.readFileSync(path.join(root, 'build/installer.nsh'));
const text = nsh.toString('utf8');
const define = (name) => text.match(new RegExp(`^!define ${name} (.+)$`, 'm'))?.[1].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
const config = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');

test('instalador grava as mesmas chaves, rótulo e comando da integração do app', () => {
  assert.equal(define('ATLAS_OPEN_LABEL'), LABEL);
  assert.equal(define('ATLAS_OPEN_KEY'), `Software\\Classes\\Directory\\shell\\${KEY_NAME}`);
  assert.equal(define('ATLAS_OPEN_BACKGROUND_KEY'), `Software\\Classes\\Directory\\Background\\shell\\${KEY_NAME}`);
  // Mesmo texto que o app compara para mostrar a entrada como instalada, não desatualizada.
  assert.equal(define('ATLAS_OPEN_COMMAND'), openCommand({ execPath: '$INSTDIR\\${APP_EXECUTABLE_FILENAME}' }));
  assert.match(config, /^\s+executableName: ATLAS$/m);
});

test('instalador só grava com consentimento e preserva a escolha nas atualizações', () => {
  // Regressão: NSIS lê o include como ANSI sem BOM e corromperia os acentos.
  assert.deepEqual([...nsh.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const install = text.slice(text.indexOf('!macro customInstall'), text.indexOf('!macroend', text.indexOf('!macro customInstall')));
  assert.match(install, /MessageBox MB_YESNO[^\n]*\/SD IDNO IDNO atlasOpenDone/, 'silencioso responde não');
  assert(install.indexOf('MessageBox') < install.lastIndexOf('atlasWriteOpenKey'), 'grava só depois da pergunta');
  assert.match(install, /\$\{if\} \$\{isUpdated\}[\s\S]*StrCmp \$0 "" atlasOpenDone/, 'atualização sem entrada não grava');
  const uninstall = text.slice(text.indexOf('!macro customUnInstall'));
  assert.match(uninstall, /\$\{ifNot\} \$\{isUpdated\}/, 'atualização não remove a entrada');
  assert.match(text, /StrCmp \$0 '\$\{ATLAS_OPEN_COMMAND\}' 0 \+2\s+DeleteRegKey HKCU "\$\{KEY\}"/, 'remove só a entrada desta instalação');
  assert.doesNotMatch(text, /HKLM|HKCR/, 'sem chaves de máquina');
});

test('pacote mantém binários nativos e a ponte MCP fora do asar e não publica release', () => {
  assert.match(config, /asarUnpack:\s+- node_modules\/node-pty\/\*\*\s+- electron\/atlas-mcp-bridge\.cjs/);
  assert.match(config, /^npmRebuild: false$/m);
  assert.match(config, /^publish: null$/m);
  assert.match(config, /perMachine: false/);
  assert.match(config, /allowElevation: false/);
  assert.equal(bridgePathFor('C:\\Programas\\ATLAS\\resources\\app.asar\\electron'), path.join('C:\\Programas\\ATLAS\\resources\\app.asar.unpacked\\electron', BRIDGE_FILE));
  assert.equal(bridgePathFor(path.join(root, 'electron')), path.join(root, 'electron', BRIDGE_FILE), 'desenvolvimento usa o arquivo do repositório');
  assert(!bridgePathFor('C:\\app.asar-dev\\electron').includes('unpacked'), 'pasta de nome parecido não é trocada');
});
