# Plano — instalador Windows (marco 6b)

Objetivo: cumprir o passo 1 do aceite da v0.1 com o ATLAS instalado, sem depender do repositório nem do `npm`.

## Pacote

- electron-builder com alvo NSIS x64 (`electron-builder.yml`). Instalação por usuário (`perMachine: false`, `allowElevation: false`), com escolha de pasta e sem administrador.
- `app.asar` leva `electron/`, `dist/` e o `package.json`. React, xterm e ícones vão no bundle do Vite e ficam fora do pacote.
- `node-pty` fica fora do asar (`asarUnpack`): binários N-API, `conpty.dll` e o `OpenConsole.exe`. `npmRebuild: false` preserva o patch ConPTY aplicado no `postinstall`, conferido pelo smoke.
- A ponte MCP também fica fora do asar: o CLI do agente a inicia como processo Node separado (`ELECTRON_RUN_AS_NODE`). O app empacotado aponta o `mcp.json` para `app.asar.unpacked`.
- Sem assinatura de código e sem ícone próprio nesta versão; o Windows pode mostrar o aviso de editor desconhecido. Nada é publicado: `publish: null`. Na CI, o instalador é só um artefato do workflow, mantido por 14 dias.

## "Abrir no ATLAS"

- O instalador pergunta se deve adicionar a entrada ao menu de pastas do Explorador. A resposta padrão é "não", também na instalação silenciosa (`/S`).
- As chaves, o rótulo e o comando são os mesmos da integração do app (`build/installer.nsh`, conferido por `scripts/installer-config.test.mjs`). Assim, "Aparência e configurações" mostra a entrada como instalada e consegue removê-la.
- Ao atualizar, a entrada só é reescrita se já existia. Desinstalar remove a entrada que aponta para esta instalação e preserva uma que aponte para outro ATLAS, como o de desenvolvimento. Os dados do usuário (`%APPDATA%\atlas`) são mantidos.

## Testes

- Unidade: as chaves, o rótulo e o comando do NSIS batem com a integração do app. Também cobre: consentimento antes de gravar, "não" no modo silencioso, atualização sem regravar, remoção restrita a esta instalação, include em UTF-8 com BOM, `asarUnpack` e caminho da ponte.
- `node scripts/smoke-installer.mjs` valida `release/win-unpacked` sem instalar:
  - arquivos nativos e patch ConPTY;
  - a ponte iniciada pelo executável em modo Node, inerte sem token;
  - o app com perfil isolado (`--user-data-dir`), um PowerShell real em pasta Unicode, o `mcp.json` apontando para a ponte fora do asar e o SQLite com todas as migrations.
- `--install` instala em silêncio numa pasta temporária, repete as verificações no app instalado e desinstala. Também confere que nenhuma entrada do Explorador foi gravada e que os dados foram preservados. Só roda na CI (ou com `--allow-local-install`), porque grava a desinstalação e os atalhos do usuário atual.
- O caminho "sim" da pergunta não é exercitado automaticamente: gravaria a chave real do Explorador, o que os testes não fazem. Ele fica para a demonstração do aceite, com o usuário.
