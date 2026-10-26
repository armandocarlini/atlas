# ATLAS

Cockpit local para acompanhar e coordenar agentes de código em múltiplos terminais.

[![CI](https://github.com/armandocarlini/atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/armandocarlini/atlas/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Open source · Windows · Electron + React · Em desenvolvimento**

Projeto criado por [Armando Ciciliano Carlini](https://github.com/armandocarlini) como parte do seu portfólio profissional. O foco é construir uma ferramenta local de trabalho com agentes e demonstrar decisões de arquitetura, interação, segurança e validação com evidências reproduzíveis.

**English:** ATLAS is an open-source, local-first desktop cockpit for AI coding workflows. Interactive PowerShell terminals and read-only Git discovery work today; agent orchestration and persistent collaboration are on the roadmap.

## Estado atual

Esta etapa contém o shell desktop em Electron, terminais PowerShell reais via PTY e descoberta Git somente leitura. As sessões de agentes, tarefas, mensagens e evidências exibidas no cockpit ainda são ilustrativas: adaptadores de harnesses, SQLite e orquestração serão implementados nas próximas etapas.

Já estão implementados:

- PowerShell real com `node-pty` e xterm.js, incluindo ANSI, teclado, resize, seleção e scrollback;
- descoberta de repositórios, branches e worktrees em pastas autorizadas;
- leitura de alterações locais, upstream/ahead/behind e último commit;
- abertura do PowerShell diretamente na worktree selecionada;
- grid de sessões e terminais com foco individual;
- pop-up nativo individual para qualquer terminal/card e reintegração sem encerrar o PTY;
- colunas Navegação e Painéis recolhíveis e reordenáveis;
- abas Tarefas, Mensagens e Evidências reordenáveis dentro da coluna Painéis;
- janela nativa de Acompanhamento `always-on-top`;
- persistência local do layout, aparência, posição e dimensões das janelas;
- cor de destaque e fundo personalizáveis, com presets claros e escuros;
- sincronização de estado e aparência entre janelas.

## Requisitos

- Node.js 22.12 ou superior;
- npm;
- Git disponível no `PATH` para a descoberta de repositórios;
- Windows e Windows PowerShell para o PTY deste marco.

Para reproduzir o ambiente validado e a CI, prefira **Node.js 24 LTS**.

## Clonar em outra máquina

```powershell
git clone https://github.com/armandocarlini/atlas.git
cd atlas
npm ci
npm test
npm run build
npm start
```

Para continuar o desenvolvimento com um agente, comece por [docs/CONTINUIDADE.md](docs/CONTINUIDADE.md). Esse contexto está versionado e acompanha o clone. Preferências locais, credenciais, dados do ai-memory e transcripts de outras máquinas ficam fora do repositório.

## Executar o aplicativo desktop

```powershell
npm ci
npm run dev:desktop
```

O comando inicia o Vite e o Electron juntos. Encerre com `Ctrl+C` no terminal.

## Terminal e continuidade Git

O diretório de inicialização é tratado como projeto local inicial. O botão `+` nas abas de projeto abre o seletor nativo e autoriza outra pasta. As raízes autorizadas ficam no diretório de dados do usuário e são lidas novamente ao abrir o ATLAS.

A descoberta:

- não varre o disco inteiro;
- não segue symlinks/junctions nem entra em `.git`, `node_modules` e diretórios de build;
- reconhece repositórios comuns e worktrees vinculadas;
- usa comandos Git somente leitura, sem `checkout`, `git init` ou alteração do índice;
- apresenta branches e worktrees existentes para retomar o trabalho sem presumir que uma sessão de agente continua viva.

No botão **Terminal**, selecione uma worktree ou diretório autorizado. O PowerShell inicia nesse caminho. O scrollback fica limitado e apenas em memória para suportar foco e pop-ups; ele não é persistido. Fechar o ATLAS encerra seus PTYs filhos.

## Executar no navegador

```powershell
npm run dev
```

O navegador permanece um wireframe ilustrativo. PTY real, descoberta Git e janelas nativas exigem o shell desktop. Pop-ups internos representam a interação, mas não substituem janelas do sistema operacional.

## Build local

```powershell
npm run build
npm start
```

O `npm start` utiliza o conteúdo gerado em `dist`. Execute `npm run build` novamente depois de alterar o código.

## Validação

```powershell
npm test
npm run build
npm run test:desktop
```

O smoke test abre uma instância Electron com preferências isoladas, cria uma fixture Git temporária e usa PowerShells reais. Valida diretório da worktree, Unicode, resize, Ctrl+C, dois streams independentes, pop-ups, reintegração, acompanhamento sempre no topo, temas, persistência de layout e encerramento dos processos. As janelas de teste podem aparecer durante a execução. A fixture é removida ao concluir com sucesso; em caso de falha, seu caminho é registrado para diagnóstico.

Capturas de tela, medições de contraste e resultado ficam em `.atlas-smoke-results/`. A porta local de depuração usada é `9333` (substituível por `ATLAS_SMOKE_PORT`); o controle nativo de teste usa a porta seguinte e um token temporário. Esses serviços existem somente no ponto de entrada de teste.

Veja o [relatório de validação e revisão visual](docs/VALIDACAO_DESKTOP.md). Esta validação cobre o shell local e seus terminais; os adaptadores de agentes e a persistência operacional ainda fazem parte dos próximos marcos.

## Estrutura

```text
electron/
  main.cjs              Janelas e ciclo de vida
  preload.cjs           API IPC estreita e isolada
  project-host.cjs      Pastas autorizadas e projetos
  git-discovery.cjs     Repositórios, branches e worktrees
  terminal-host.cjs     PTYs, streams e scrollback em memória
scripts/                Inicialização desktop
src/
  App.jsx               Cockpit e estado compartilhado
  TerminalView.jsx      Terminal xterm.js
  GitDiscovery.jsx      Árvore Git na navegação
  appearance.js         Cores semânticas e contraste
  useModalFocus.js      Foco e isolamento dos modais
ATLAS_PLANEJAMENTO_ARQUITETURA.md
design-system/          Diretrizes visuais do produto
```

A janela principal e os pop-ups usam `BroadcastChannel` para sincronizar o estado da interface. O processo principal controla PTYs, janelas e persistência. O preload mantém `contextIsolation` e `sandbox` ativos e `nodeIntegration` desativado.

## Privacidade

O ATLAS funciona localmente, sem telemetria ou serviço central obrigatório. Somente pastas autorizadas são descobertas. A entrada digitada no terminal não é registrada pelo ATLAS; a saída permanece somente em um buffer temporário nesta etapa. Dados de agentes, tarefas, mensagens e evidências continuam ilustrativos e não representam integrações ativas.

## Contribuição e licença

Leia [CONTRIBUTING.md](CONTRIBUTING.md) para preparar o ambiente e enviar alterações. Para continuidade por agentes, as regras operacionais estão em [AGENTS.md](AGENTS.md) e no [contrato autônomo da v0.1](docs/AUTONOMIA_V0_1.md). Relatos de vulnerabilidade seguem [SECURITY.md](SECURITY.md). Distribuído sob a [licença MIT](LICENSE).
