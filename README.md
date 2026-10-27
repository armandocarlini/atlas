# ATLAS

Cockpit local para acompanhar e coordenar agentes de código em múltiplos terminais.

[![CI](https://github.com/armandocarlini/atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/armandocarlini/atlas/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Open source · Windows · Electron + React · Em desenvolvimento**

Projeto criado por [Armando Ciciliano Carlini](https://github.com/armandocarlini) como parte do seu portfólio profissional. O foco é construir uma ferramenta local de trabalho com agentes e demonstrar decisões de arquitetura, interação, segurança e validação com evidências reproduzíveis.

**English:** ATLAS is an open-source, local-first desktop cockpit for AI coding workflows. It runs real Kimi Code and OpenCode sessions in interactive terminals, with a read-only planning orchestrator per project, user-approved agent requests, persistent tasks, messages, per-task Git worktrees and review with evidence, all stored locally in SQLite.

## Estado atual

Esta etapa contém o shell desktop em Electron, terminais PowerShell reais via PTY e descoberta Git somente leitura. O ATLAS detecta o Kimi Code e o OpenCode no `PATH`, deixa o usuário escolher CLI e modelo em cada sessão e abre uma sessão principal real de planejamento no projeto autorizado, além das sessões manuais. A base SQLite registra projetos, identidade de sessões, runs, tarefas e eventos no processo principal. No desktop, o painel Tarefas cria e lista tarefas reais do projeto selecionado, com critérios de aceite e estado inicial `backlog`, e o painel Mensagens registra descobertas estruturadas entre sessões reais do projeto, com entrega e leitura persistidas. Com o consentimento explícito do usuário, o ATLAS registra o servidor MCP `atlas` no `mcp.json` do Kimi. Cada sessão iniciada pelo ATLAS recebe então ferramentas restritas ao próprio projeto para listar sessões e tarefas e ler, marcar e enviar mensagens; fora do ATLAS a entrada fica inerte. A sessão principal pode pedir novos agentes; cada pedido aparece no workspace com propósito, validade e política, e o agente só é iniciado, com origem `orchestrator`, depois da aprovação do usuário. A principal também delega tarefas existentes por handoff: o agente de destino aceita ou recusa pelas ferramentas do ATLAS, informa progresso e bloqueios, e o painel Tarefas mostra oferta, responsável e bloqueio, com cancelar oferta e devolver tarefa. Delegar não amplia permissões nem conclui tarefas. Para trabalho isolado, a principal pode pedir o agente com uma worktree Git da tarefa: na aprovação, o ATLAS cria a worktree em `<repositório>.atlas-worktrees/task-…`, na branch `atlas/task-…`, e o agente nasce nela; o ATLAS nunca remove worktrees ou branches. O agente responsável pede revisão com resumo e comandos executados; o ATLAS anexa um retrato Git da worktree coletado por ele mesmo, e só o usuário conclui a tarefa ou pede ajustes no painel Tarefas. A aba Evidências mostra as revisões reais do projeto. Merge continua manual. No Windows, a entrada opcional "Abrir no ATLAS" no menu de pastas do Explorador é adicionada ou removida em "Aparência e configurações", com confirmação; uma pasta nova só vira projeto depois de você confirmar, e o ATLAS não roda `git init`. Os quatro cards de demonstração aparecem somente no navegador e não representam integrações ativas.

Já estão implementados:

- sessões de agente com o Kimi Code e o OpenCode reais, detectados pelo `PATH`, com CLI e modelo escolhidos pelo usuário em cada sessão e iniciados em PTY interativo, com versão, diretório e estado (`running`/`exited`) visíveis;
- ponte MCP local do ATLAS (named pipe, sem porta de rede) com token por run, instalada só após consentimento e removível pela interface;

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

- Node.js 24 ou superior (SQLite embutido usado nos testes e no núcleo);
- npm;
- Git disponível no `PATH` para a descoberta de repositórios;
- Windows e Windows PowerShell para o PTY deste marco.

Para reproduzir o ambiente validado e a CI, prefira **Node.js 24 LTS**.

O `npm ci` aplica uma correção local de ordem de saída no `node-pty` 1.1.0, com versão e hashes verificados. Ela evita anunciar encerramento ConPTY antes do exit code nativo. Atualizar essa dependência exige revisar/remover o patch conforme [docs/historico/planos/PLANO_TAREFAS.md](docs/historico/planos/PLANO_TAREFAS.md).

## Clonar em outra máquina

```powershell
git clone https://github.com/armandocarlini/atlas.git
cd atlas
npm ci
npm test
npm run build
npm start
```

Para continuar o desenvolvimento com um agente, comece por [AGENTS.md](AGENTS.md) e [docs/CONTEXTO.md](docs/CONTEXTO.md). Esse contexto está versionado e acompanha o clone. Preferências locais, credenciais, dados do ai-memory e transcripts de outras máquinas ficam fora do repositório.

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

## Instalador Windows

```powershell
npm run dist:win
```

Gera `release/ATLAS-Setup-<versão>.exe`, um instalador por usuário que dispensa administrador. Ele pergunta se deve adicionar "Abrir no ATLAS" ao menu de pastas do Explorador; a resposta padrão é não. A desinstalação remove essa entrada e preserva os dados do usuário. O instalador não é assinado. A CI gera o mesmo arquivo como artefato do workflow, sem publicar release. `node scripts/smoke-installer.mjs` valida o app empacotado sem instalar; a variante `--install` instala e desinstala de verdade e só roda na CI.

## Sessões de agente

O botão **Sessão** lista os CLIs de agente detectados no `PATH`: Kimi Code e OpenCode. Nada vem pré-selecionado. Você escolhe o CLI e, entre os modelos que ele informa, o modelo da sessão; no Kimi são os aliases do `config.toml`, no OpenCode a saída de `opencode models`. A sessão inicia o CLI real e interativo na worktree ou pasta autorizada escolhida, com `--model`, sem flags de autonomia e sem prompt inicial; as permissões continuam no harness. O card exibe nome, CLI com versão, modelo e diretório, e o estado operacional é apenas `running` ou `exited` — nada é inferido do conteúdo do terminal.

Projetos, sessões, runs e eventos são registrados em `atlas.sqlite`, no diretório de dados do aplicativo, sem transcripts. Uma sessão possui identidade própria e uma run representa a tentativa concreta de execução. Ao fechar o aplicativo, seus PTYs são interrompidos; runs sem saída confirmada ficam `lost`, com motivo explícito. Após crash, a próxima abertura reconcilia runs que ficaram ativas. Sessões anteriores de projetos e diretórios ainda autorizados reaparecem como histórico, com resultado e datas, sem abrir processo ou simular uma conversa. O aplicativo aceita uma única instância por perfil para impedir reconciliação concorrente de processos vivos.

## Sessão principal de planejamento

Ao abrir um projeto autorizado sem principal anterior, o desktop não inicia nada sozinho: **Escolher agente** pede o CLI e o modelo da principal. A principal abre com um perfil de planejamento do ATLAS que permite apenas leitura e as ferramentas do ATLAS: `--agent-file` no Kimi e o agente `atlas-orchestrator` no OpenCode. Esse perfil é injetado só nesta run, sem gravar configuração. Não há flags de autonomia nem prompt inicial. A principal aparece antes das sessões manuais do projeto e não substitui seu terminal.

Há uma identidade principal por projeto. Depois de saída ou interrupção, **Nova execução** pede de novo o CLI e o modelo, que podem mudar, e cria outra tentativa com essa identidade, sem prometer retomada da conversa nativa. Se estiver em pop-up, o ATLAS reintegra a janela antes de conectar o novo PTY. Abrir novamente um projeto com histórico não ressuscita processos automaticamente. A delegação de tarefas acontece por handoff e exige o aceite do agente de destino.

## Tarefas do projeto

No desktop, selecione o projeto ou uma de suas worktrees e abra **Tarefas → Nova tarefa**. Informe título e critérios de aceite; a descrição é opcional. A tarefa entra no backlog e permanece após reinício. O comando de criação usa chave de idempotência para tolerar envio repetido sem duplicar a tarefa. Trocar de projeto altera a lista; a janela de acompanhamento recebe o mesmo estado para leitura. Execução, atribuição, revisão e conclusão ainda não estão disponíveis neste incremento.

## Mensagens entre sessões

Uma sessão manual real pode enviar uma **descoberta estruturada** à principal do projeto pelo botão **Descoberta** no card da sessão. Assunto e conteúdo são registrados no banco do projeto com comando idempotente (`message.send`), entrega por destinatário e eventos `message.sent`/`message.read` na trilha de auditoria. O painel **Mensagens** lista as mensagens reais do projeto selecionado com rota, data e estado de leitura; clicar em uma mensagem não lida a marca como lida. Nada é digitado no terminal do destinatário: neste incremento a mensagem é um registro visível para o usuário, não uma entrada para o modelo. Mensagens não concedem permissões nem executam ações, e projetos isolam listagem, leitura e chaves de idempotência.

## Validação

```powershell
npm test
npm run build
npm run test:agent
npm run test:desktop
```

`npm run test:agent` cobre a descoberta de adaptadores e o ciclo de vida das sessões com duplos de teste. O smoke real do adaptador é opt-in e exige o Kimi Code instalado:

```powershell
npm run smoke:agent
```

Ele inicia o CLI real em uma fixture temporária com `KIMI_CODE_HOME` isolado, envia somente `/status` e `/exit` (sem prompts ao modelo e sem consumo de tokens) e confirma o encerramento limpo com código 0. Depois fecha e reabre o Electron no mesmo perfil e verifica a identidade e o resultado preservados, sem recriar PTY.

O smoke real do OpenCode inicia a principal e um agente com um modelo listado, confere a ponte do ATLAS conectada e o perfil `atlas-orchestrator`, e não envia prompts. As pastas do OpenCode (`XDG_*`) ficam na fixture, e a configuração e as credenciais reais são conferidas por hash:

```powershell
npm run smoke:opencode
```

Para validar também uma conversa curta na principal, com o provedor já configurado no Kimi:

```powershell
npm run smoke:orchestrator
```

Esse teste opt-in usa a configuração/autenticação existente do harness, sem copiar credenciais ou alterar preferências. O diretório e o perfil Electron são temporários; um único prompt curto é digitado pelo xterm e pode consumir tokens do provedor. Os testes padrão não chamam o modelo.

O smoke test abre uma instância Electron com preferências isoladas, cria uma fixture Git temporária e usa PowerShells reais. Valida diretório da worktree, Unicode, resize, Ctrl+C, dois streams independentes, pop-ups, reintegração, acompanhamento sempre no topo, temas, persistência de layout e encerramento dos processos. As janelas de teste podem aparecer durante a execução. A fixture é removida ao concluir com sucesso; em caso de falha, seu caminho é registrado para diagnóstico.

Capturas de tela, medições de contraste e resultado ficam em `.atlas-smoke-results/`. A porta local de depuração usada é `9333` (substituível por `ATLAS_SMOKE_PORT`); o controle nativo de teste usa a porta seguinte e um token temporário. Esses serviços existem somente no ponto de entrada de teste.

Veja o [relatório de validação e revisão visual](docs/historico/VALIDACAO_DESKTOP.md). O relatório original cobre o shell local e seus terminais; os incrementos posteriores de adaptadores e da base operacional estão registrados em [docs/CONTINUIDADE.md](docs/CONTINUIDADE.md).

## Estrutura

```text
electron/
  main.cjs              Janelas e ciclo de vida
  preload.cjs           API IPC estreita e isolada
  project-host.cjs      Pastas autorizadas e projetos
  git-discovery.cjs     Repositórios, branches e worktrees
  pty-transport.cjs     Transporte PTY compartilhado e scrollback em memória
  terminal-host.cjs     Terminais PowerShell
  agent-adapters.cjs    Metadados e descoberta de CLIs de agente
  agent-host.cjs        Identidade e ciclo de vida das sessões de agente
  operational-store.cjs SQLite, migrations, runs e eventos persistentes
  task-host.cjs         Tarefas em escopo autorizado; cancelar oferta e devolver tarefa
  task-delegation.cjs   Handoffs, claim com fencing, progresso e bloqueio de tarefas
  worktree-manager.cjs  Worktree Git por tarefa, criada só após aprovação
  task-review.cjs       Revisão, evidências e conclusão decidida pelo usuário
  git-evidence.cjs      Retrato Git somente leitura da worktree da tarefa
  open-path-host.cjs    "Abrir no ATLAS": caminho validado, instância única e confirmação
  explorer-integration.cjs Entrada opcional do Explorador no registro do usuário
build/installer.nsh     Pergunta e remoção da entrada do Explorador no instalador
electron-builder.yml    Pacote e instalador NSIS por usuário
  message-host.cjs      Envio, listagem e leitura de mensagens entre sessões
  mcp-host.cjs          Ferramentas do ATLAS por sessão via pipe local e token por run
  atlas-mcp-bridge.cjs  Servidor MCP stdio iniciado pelo Kimi; inerte fora do ATLAS
  kimi-mcp-config.cjs   Entrada atlas no mcp.json do Kimi, sem tocar outros servidores
  integration-host.cjs  IPC de consentimento para conectar ou remover a integração
  agent-request-host.cjs Aprovação de agentes pedidos pela principal, com política
  orchestrator-profile.cjs Perfil de planejamento somente de leitura
scripts/                Inicialização desktop, testes e smokes
src/
  App.jsx               Cockpit e estado compartilhado
  TerminalView.jsx      Terminal xterm.js
  GitDiscovery.jsx      Árvore Git na navegação
  PersistentTasks.jsx   Painel e modal de tarefas reais, com execução delegada
  SessionMessages.jsx   Painel e modal de mensagens reais
  KimiIntegration.jsx   Status, aviso e diálogo de consentimento da integração MCP
  AgentRequests.jsx     Pedidos de agente da principal aguardando decisão
  appearance.js         Cores semânticas e contraste
  useModalFocus.js      Foco e isolamento dos modais
ATLAS_PLANEJAMENTO_ARQUITETURA.md
design-system/          Diretrizes visuais do produto
```

A janela principal e os pop-ups usam `BroadcastChannel` para sincronizar o estado da interface. O processo principal controla PTYs, janelas e persistência. O preload mantém `contextIsolation` e `sandbox` ativos e `nodeIntegration` desativado.

## Privacidade

O ATLAS funciona localmente, sem telemetria ou serviço central obrigatório. Somente pastas autorizadas são descobertas e somente nelas os CLIs de agente são iniciados. A entrada digitada no terminal não é registrada pelo ATLAS; a saída permanece somente em um buffer temporário nesta etapa. Tarefas, mensagens, revisões e evidências são gravadas no banco local. Os exemplos do navegador continuam ilustrativos.

## Contribuição e licença

Leia [CONTRIBUTING.md](CONTRIBUTING.md) para preparar o ambiente e enviar alterações. Para continuidade por agentes, as regras operacionais estão em [AGENTS.md](AGENTS.md), com o estado atual em [docs/CONTEXTO.md](docs/CONTEXTO.md) e o plano em [docs/ROADMAP.md](docs/ROADMAP.md). Relatos de vulnerabilidade seguem [SECURITY.md](SECURITY.md). Distribuído sob a [licença MIT](LICENSE).
