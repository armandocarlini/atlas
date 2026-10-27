# Continuidade do desenvolvimento

Última atualização: 26/10/2026.

## Objetivo e critérios de qualidade

O ATLAS é um projeto público e open source de [Armando Ciciliano Carlini](https://github.com/armandocarlini), parte de seu portfólio profissional. O repositório é `armandocarlini/atlas`, a licença é MIT e o desenvolvimento deve manter uma apresentação profissional, decisões documentadas e validação reproduzível.

A visão completa está em `ATLAS_PLANEJAMENTO_ARQUITETURA.md`. O produto deve ser um cockpit desktop local, com orquestrador interativo, terminais de agentes visíveis, colaboração e estado persistente. Recursos ainda planejados não devem aparecer como entregues.

## Estado ao trocar de máquina

O shell Electron funciona com PowerShell real via node-pty/ConPTY e xterm.js. Há descoberta Git somente leitura em pastas autorizadas, branches/worktrees existentes, escolha de diretório para novos terminais, foco/grid, pop-up individual e reintegração preservando o PTY. As colunas laterais podem ser ocultadas; aparência e layout são salvos localmente. O acompanhamento usa uma janela nativa sempre no topo.

O primeiro adaptador de agente real está integrado: o ATLAS descobre o Kimi Code pelo `PATH` (`electron/agent-adapters.cjs`), inicia o CLI interativo em PTY compartilhado (`electron/pty-transport.cjs`) e registra identidade, versão, diretório e estado `running`/`exited` em memória (`electron/agent-host.cjs`). O modal de nova sessão lista somente CLIs detectados e mostra erros inline sem perder os campos. Os testes de unidade rodam com `npm run test:agent`; o smoke real opt-in (`npm run smoke:agent`) executa o Kimi de verdade com `KIMI_CODE_HOME` isolado, usando apenas `/status` e `/exit`.

Registro de processo (26/10/2026): o merge do PR #8 (adaptador Kimi) ocorreu com a CI do Ubuntu vermelha por erro de encadeamento de comandos do agente (`gh pr checks --watch | tail` mascarou o status de saída). O log da execução 40310345895 confirma dois testes vermelhos: o resolvedor de executáveis usava `path.join` do host mesmo quando recebia outra plataforma. A correção pendente usa `path.win32`/`path.posix` conforme a plataforma consultada e adiciona regressão POSIX de descoberta.

Plano da correção: preservar a busca pelo PATH e a preferência por executáveis nativos; validar os cenários Windows e POSIX; executar os gates locais e verificar os checks do PR em comando dedicado, sem pipe, antes do merge. A branch foi retomada com três arquivos já modificados pelo trabalho anterior, preservados nesta continuação.

Ambiente da retomada: Windows, Node.js 24.14.0 selecionado somente para os comandos da sessão (o PATH inicial selecionava Node.js 20.20.0, abaixo do requisito). O ai-memory local foi consultado via CLI: responde, mas não contém `default/ATLAS`; a busca global por ATLAS também não retornou páginas. Os documentos versionados fornecem a continuidade nesta máquina.

Evidências locais da correção: `npm test` (19/19), `npm run test:agent` (16/16), `npm run build`, `npm run check:public` e `npm run test:desktop` passaram em Windows. O smoke desktop executou Electron, dois PTYs reais e descoberta Git em fixture temporária, incluindo limpeza dos processos. A execução inicial no sandbox foi bloqueada ao criar a fixture Git; a execução autorizada fora do sandbox passou. A validação nativa em Ubuntu depende da CI do PR.

O PR #9 corrigiu a descoberta de adaptadores e foi integrado como `98c5728`, após `Verify (ubuntu-latest)` e `Verify (windows-latest)` verdes na execução 40314429850. `main` foi sincronizada e inspecionada antes de iniciar `codex/sqlite-operational-foundation`.

## Marco 2a — base SQLite

Integrado pelo PR #10 como `1fcaf2b`, após CI Ubuntu e Windows verde na execução 40316032122. `main` foi sincronizada antes da próxima branch. Conforme `docs/PLANO_SQLITE.md`, `electron/operational-store.cjs` registra projetos, sessões, runs e eventos atomicamente no SQLite embutido do Node/Electron. O banco fica no perfil do aplicativo. Migrations numeradas, foreign keys, WAL, controle de versão da run e backup consistente estão cobertos por testes. A autorização de diretórios continua no JSON existente; ler o banco não autoriza diretórios.

Uma única instância por perfil impede reconciliação concorrente de runs vivas. A saída natural confirmada vira `succeeded`/`failed`; fechamento ou crash não inventa sucesso: runs ainda ativas viram `lost`, com motivo explícito e sem exit code fictício. Nenhum transcript, prompt, entrada ou saída do PTY é gravado. A restauração dos cards, ausente no marco 2a, é tratada na subdivisão 2b abaixo.

Validação local no Windows: `npm test` (35/35), `npm run test:agent` (20/20), `npm run build` e `npm run test:desktop` passaram. Os testes de store e ciclo dos agentes também passaram usando o Electron 45 em modo Node (24/24). O smoke verifica o banco real criado pelo processo principal e sua integridade. Revisão de código independente não encontrou falhas críticas/importantes; a observação de tratamento de erro no shutdown foi corrigida com regressão SQLite. A API `node:sqlite` em Node.js 24.14.0 ainda emite aviso experimental; isso é um limite conhecido, sem suprimir o aviso.

Diagnóstico de ambiente resolvido: o Kimi Code 2.3.2 já estava instalado e incluído no PATH persistente do usuário. O processo Codex herdou um PATH anterior. A localização foi obtida lendo as entradas atuais de PATH do Windows; os comandos de teste acrescentaram a pasta do CLI apenas ao ambiente de processo, sem alterar a máquina nem versionar caminho pessoal. O smoke real passou usando `/status` e `/exit`, com `KIMI_CODE_HOME` isolado e sem prompt ao modelo. Uma corrida do smoke, exposta pela inicialização assíncrona do banco, foi reproduzida e corrigida: ele agora espera a existência da janela principal antes de invocar IPC.

## Marco 2b — restauração de histórico

Integrado pelo PR #11 como `36501ad`, após CI Ubuntu e Windows verde na execução 40317740822. `main` foi sincronizada antes de `codex/persistent-tasks`. Conforme `docs/PLANO_RESTAURACAO_SESSOES.md`, `agent:list` combina agentes vivos e histórico apenas de projetos e diretórios atualmente autorizados. Cards reais usam o UUID do processo principal; a hidratação mescla os resultados sem apagar terminais criados durante a carga nem duplicar sessões.

Histórico sem PTY tem indicação textual do resultado, diretório e datas, sem composer, TUI sintética ou tokens fictícios. Restaurar histórico não inicia processo. O smoke desktop usa banco de fixture simulando run interrompida e comprova restauração como `lost` na inicialização e após recarga da UI. O smoke real do Kimi também verifica fechamento e reabertura do Electron no mesmo perfil. As skills de UI foram invocadas, Python 3.14.3 confirmado e a consulta UX de contraste/estado textual validada contra o MASTER.

Evidências locais: `npm test` (39/39), `npm run test:agent` (21/21), build, `check:public`, smoke desktop e smoke real Kimi passaram. O desktop verifica contraste do histórico, ausência de composer/pop-up/métricas fictícias e nenhum spawn na restauração. O smoke real confirma identidade, diretório e saída 0 preservados após reinício físico do Electron. Captura local do histórico revisada, sem versionar imagens ou caminhos pessoais. Revisão independente sem bloqueios; observações sobre reautorizar projetos e saída com sinal foram corrigidas com regressões. O próximo incremento é criar e listar tarefas reais persistentes; isso não exige acessar o modelo.

## Marco 2c — tarefas reais

Em validação conforme `docs/PLANO_TAREFAS.md`: migration 2 adiciona tarefas e comandos de criação. Criar tarefa, registrar comando e emitir evento ocorre em transação; chave de idempotência por projeto e hash de payload impedem duplicação por reenvio. O núcleo fixa ator `user` e estado `backlog`. Não há IPC para concluir, atribuir ou executar tarefas.

O painel Tarefas do desktop usa dados reais do projeto selecionado. Formulário exige título e critérios de aceite, com descrição opcional, limites, foco modal e erros inline. A janela de acompanhamento recebe o mesmo snapshot para leitura. Trocar escopo limpa dados do projeto anterior e descarta respostas de carga atrasadas. Exemplos de mensagens/evidências e o wireframe do navegador continuam explícitos como ilustrativos.

Validação local: instalação limpa `npm ci` reaplicou o patch ConPTY com hashes verificados e terminou sem vulnerabilidades; `npm test` passou 52/52, `npm run test:agent` passou 21/21 e build passou com o aviso já existente de tamanho do bundle. O runtime Electron passou os 13 testes de tarefas/driver. O smoke desktop passou criação pelo formulário, foco em textarea, validação, contraste, isolamento entre projetos, sincronização com pop-up e tarefa/critério preservados após reload e reabertura do banco. A migration 1→2 preserva projetos, sessões, runs e eventos anteriores. O rollback de tarefa/comando/evento tem regressão.

Desvios corrigidos: revisão visual detectou regra CSS antiga ocultando o botão Nova tarefa; a regra foi delimitada e o smoke agora exige controle visível. Revisão de código encontrou conflito entre Ctrl+, e o modal de tarefa; o atalho é bloqueado dentro desse modal, com regressão de foco. O smoke Kimi expôs corrida ConPTY de pipe fechado antes do exit code nativo. A falha foi reproduzida no driver com dois testes vermelhos e corrigida por patch de instalação versionado/checksumado, sem inferir código 0 nem ocultar resultado com retry. Ambas as ordens de eventos e WinPTY têm cobertura. Após a instalação limpa, duas primeiras inicializações simultâneas disputaram a extração sob demanda do Electron (EBUSY); a instalação do binário foi verificada antes da nova validação, sem alterar testes.

O smoke real final do Kimi 2.3.2 passou após essa correção: `/status`, `/exit`, código nativo 0 e reinício do Electron preservando identidade e resultado. Nenhum prompt foi enviado ao modelo. `check:public` passou incluindo os 55 arquivos rastreados. A revisão independente confirmou a correção do driver e do foco, sem bloqueios remanescentes. A integração deste marco depende da CI Ubuntu/Windows do PR.

## Marco 3 — sessão principal real

Integrado pelo PR #13 como `2f4c8cc`, após CI Ubuntu e Windows verde na execução 40330142460. Conforme `docs/PLANO_ORQUESTRADOR.md`: ao abrir projeto autorizado sem principal, o desktop inicia o Kimi interativo com perfil ATLAS somente de leitura (`electron/orchestrator-profile.cjs`, via `--agent-file` oficial), sem flags de autonomia nem prompt inicial. Uma identidade de orquestrador por projeto (índice único na migration 3); cada tentativa é uma run com tentativa monotônica e snapshot de versão/cwd. Saída/interrupção preserva a identidade e exige **Nova execução** explícita; em pop-up, a janela é reintegrada antes do novo PTY. O desktop não mostra mais cards, métricas e menus ilustrativos — eles permanecem apenas no wireframe do navegador.

Validação local: `npm test` 61/61, build, `check:public`, smoke desktop completo e `npm run smoke:orchestrator` passaram. O smoke real confirmou principal com perfil de leitura, conversa real com um único prompt curto no provedor já configurado, `/status` e `/exit` com código 0, nova run após saída em pop-up e reinício do Electron com identidade preservada.

## Marco 4a — mensagens estruturadas

Conforme `docs/PLANO_MENSAGENS.md`: migration 4 cria `messages` e `message_deliveries`; o comando `message.send` usa chave de idempotência por projeto com hash de payload e emite `message.sent`; a leitura é idempotente e emite `message.read` uma única vez. Remetente e destinatário devem ser sessões persistidas do mesmo projeto. IPC `message:send/list/mark-read` restrito à janela principal e a pastas autorizadas, espelhando `task-host.cjs`.

No desktop, a sessão manual real ganha a ação **Descoberta** (modal com foco, validação inline, limites e preservação dos campos em erro) dirigida à principal do projeto. O painel Mensagens passa a listar dados reais do projeto selecionado, com rota, datas, contagem textual de não lidas anunciada com `role=status` e marcar como lida ao clicar; a aba mostra o total real de não lidas. Nada é digitado no terminal do destinatário: a mensagem é registro visível, não entrada para o modelo. O navegador mantém os cards ilustrativos. Skills ui-ux-pro-max e apple-design invocadas antes do trabalho de UI.

Validação local no Windows: `npm test` 71/71 (10 testes novos de mensagens cobrem idempotência, isolamento entre projetos, destinatário inválido, limites, rollback e migration 3→4), build, `check:public` (58 arquivos), `npm run test:desktop` e `npm run smoke:agent` passaram. O smoke desktop lista mensagem semeada na fixture, valida badge, leitura e isolamento de escopo, e confere a persistência no banco após reload e reabertura. O smoke real do Kimi envia a descoberta pelo modal a partir de sessão manual real, confirma entrega à principal, leitura e preservação após reinício físico do Electron — sem prompts ao modelo.

Retomada após a quota do Kimi esgotar antes do commit: a revisão do diff não encontrou bloqueios, e os gates foram repetidos (`npm test` 71/71, `npm run test:agent` 27/27, build, `check:public`, `npm run test:desktop`). A primeira repetição do `npm run smoke:agent` falhou no passo "nova run principal": `kimi --version` excedeu o timeout de 5 s da descoberta. A causa foi ambiental: o CLI se autoatualizou de 2.3.2 para 2.3.3 durante o smoke, e o `kimi.exe` foi substituído no meio da execução, com a versão anterior preservada em `.bak`. A primeira execução do binário novo passou do limite. Com o binário estável, `--version` responde em 1,1–1,7 s, e o smoke completo passou 10/10 com o Kimi 2.3.3. O timeout e os testes não foram alterados. Limite conhecido: a autoatualização do CLI não é controlada pelo smoke.

Servidor MCP, criação de agente pelo orquestrador, handoffs, delegação de tarefas e worktrees sob política continuam pendentes nas subdivisões seguintes do marco 4.

O Kimi foi interrompido durante os testes de dois terminais e descoberta Git. Essa etapa foi concluída: os testes agora são reproduzíveis em `scripts/`, e os marcos confirmados foram atualizados no planejamento. O relatório técnico/visual está em `docs/VALIDACAO_DESKTOP.md`.

## Preparar a máquina 24h

Instale Git e Node.js 24 LTS. O desktop completo deste incremento exige Windows e Windows PowerShell. Em uma pasta de sua escolha:

```powershell
git clone https://github.com/armandocarlini/atlas.git
cd atlas
npm ci
npm test
npm run build
npm run check:public
npm start
```

Para desenvolvimento: `npm run dev:desktop`. Para mudanças de PTY, janelas ou aparência, valide também `npm run test:desktop`. A CI executa testes de contraste, build, fixture Git e verificação dos arquivos públicos em Windows e Linux. O smoke completo de janelas/PTY deve ser executado localmente no Windows.

O agente autônomo deve começar por `AGENTS.md` e `docs/AUTONOMIA_V0_1.md`. Esse contrato autoriza branches, PRs e merges por marco até a v0.1, desde que todos os gates e a CI estejam verdes. O primeiro marco é o adaptador Kimi real, sem alterar os limites do shell Electron já validado.

Prompt pronto para o modo goal na outra máquina:

```text
Conclua a v0.1 do ATLAS seguindo estritamente AGENTS.md e docs/AUTONOMIA_V0_1.md. Comece pelo adaptador Kimi real, encadeie planos e PRs por marco, faça merge somente com testes e CI verdes, e pare somente quando os 12 passos da seção 16 da arquitetura estiverem demonstrados com estado preservado após reinício. Registre evidências, limites e bloqueios em docs/CONTINUIDADE.md. Não avance para v0.2 e não publique release/tag.
```

## Interface

Antes de qualquer alteração de UI, verifique e invoque **ui-ux-pro-max** e **apple-design**, instalando e confirmando skills ausentes conforme `AGENTS.md`. Siga `design-system/atlas/MASTER.md` e preserve a UI discreta, as convenções do Windows, o espaço dos terminais e o contraste. Não reintroduza os três círculos decorativos de janela macOS.

## Cuidados técnicos estabelecidos

- Consultas Git usam `--no-optional-locks`; mesmo a leitura de status não deve atualizar o índice do usuário.
- A carga inicial não pode desfazer o projeto ou a worktree que o usuário acabou de escolher.
- Reproduzir scrollback não pode enviar respostas de consultas antigas do terminal como entrada nova ao PowerShell.
- Encerrar um PTY é idempotente; ao sair, o aplicativo encerra seus PowerShells filhos.
- O diretório de teste é temporário, com perfil Electron isolado. Não troque a fixture por um projeto real.
- Os testes públicos usam dados fictícios e mantêm resultados locais fora do Git.

## ai-memory e credenciais

O marcador `.ai-memory.toml` fixa a identidade `default/ATLAS`. Se a outra máquina usa o mesmo servidor ai-memory, poderá consultar o contexto ali. Se usa um servidor local diferente, esse histórico não viaja automaticamente com o clone; use este documento para retomar. Endereços privados de servidor, tokens e bancos devem ser configurados somente na máquina local.

Autentique Git/GitHub normalmente na outra máquina se precisar enviar mudanças. Não copie tokens, gerenciadores de credenciais, `.env` ou perfis de agentes para o repositório. Consulte `SECURITY.md` antes de anexar logs ou capturas.
