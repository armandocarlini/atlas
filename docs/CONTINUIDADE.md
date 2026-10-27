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

Integrado pelo PR #14 como `0f07e13`, após CI Ubuntu e Windows verde na execução 40424432705. Conforme `docs/PLANO_MENSAGENS.md`: migration 4 cria `messages` e `message_deliveries`; o comando `message.send` usa chave de idempotência por projeto com hash de payload e emite `message.sent`; a leitura é idempotente e emite `message.read` uma única vez. Remetente e destinatário devem ser sessões persistidas do mesmo projeto. IPC `message:send/list/mark-read` restrito à janela principal e a pastas autorizadas, espelhando `task-host.cjs`.

No desktop, a sessão manual real ganha a ação **Descoberta** (modal com foco, validação inline, limites e preservação dos campos em erro) dirigida à principal do projeto. O painel Mensagens passa a listar dados reais do projeto selecionado, com rota, datas, contagem textual de não lidas anunciada com `role=status` e marcar como lida ao clicar; a aba mostra o total real de não lidas. Nada é digitado no terminal do destinatário: a mensagem é registro visível, não entrada para o modelo. O navegador mantém os cards ilustrativos. Skills ui-ux-pro-max e apple-design invocadas antes do trabalho de UI.

Validação local no Windows: `npm test` 71/71 (10 testes novos de mensagens cobrem idempotência, isolamento entre projetos, destinatário inválido, limites, rollback e migration 3→4), build, `check:public` (58 arquivos), `npm run test:desktop` e `npm run smoke:agent` passaram. O smoke desktop lista mensagem semeada na fixture, valida badge, leitura e isolamento de escopo, e confere a persistência no banco após reload e reabertura. O smoke real do Kimi envia a descoberta pelo modal a partir de sessão manual real, confirma entrega à principal, leitura e preservação após reinício físico do Electron — sem prompts ao modelo.

Retomada após a quota do Kimi esgotar antes do commit: a revisão do diff não encontrou bloqueios, e os gates foram repetidos (`npm test` 71/71, `npm run test:agent` 27/27, build, `check:public`, `npm run test:desktop`). A primeira repetição do `npm run smoke:agent` falhou no passo "nova run principal": `kimi --version` excedeu o timeout de 5 s da descoberta. A causa foi ambiental: o CLI se autoatualizou de 2.3.2 para 2.3.3 durante o smoke, e o `kimi.exe` foi substituído no meio da execução, com a versão anterior preservada em `.bak`. A primeira execução do binário novo passou do limite. Com o binário estável, `--version` responde em 1,1–1,7 s, e o smoke completo passou 10/10 com o Kimi 2.3.3. O timeout e os testes não foram alterados. Limite conhecido: a autoatualização do CLI não é controlada pelo smoke.

## Marco 4b-1 — ponte MCP do ATLAS com consentimento

Integrado pelo PR #15 como `222ac75`, após CI Ubuntu e Windows verde na execução 40429020566. Conforme `docs/PLANO_MCP.md`. O Kimi Code 2.3.3 só lê servidores MCP do `mcp.json` global (ou de `$KIMI_CODE_HOME`) e do `.kimi-code/mcp.json` do projeto. Alterar o repositório do usuário foi descartado. Entre a configuração global e uma `KIMI_CODE_HOME` separada (com novo login), o usuário escolheu a **entrada global com consentimento explícito**.

Uma sonda em fixture temporária confirmou que o Kimi inicia o servidor stdio como filho direto do PTY, repassa o ambiente da sessão e fala JSON-RPC por linha (`2025-11-25`). Com isso, cada run de agente recebe `ATLAS_MCP_ENDPOINT` e um token aleatório no ambiente do PTY. A ponte (`electron/atlas-mcp-bridge.cjs`, executada pelo Electron em modo Node) repassa as chamadas ao processo principal por named pipe, sem porta de rede. O host (`electron/mcp-host.cjs`) deriva projeto e sessão somente do token, revogado na saída ou em falha de spawn ou persistência. As ferramentas são `sessions_list`, `tasks_list`, `messages_unread`, `messages_mark_read` e `messages_send`, todas limitadas ao projeto da sessão. O conteúdo das mensagens volta marcado como não confiável. O perfil da principal libera `mcp__atlas__*` e continua sem ferramentas de escrita.

A interface mostra o estado na subbarra, um aviso dispensável e um diálogo de consentimento com o arquivo e o conteúdo exatos, efeitos, cancelar, conectar e remover. O card ganha o texto "ATLAS conectado" somente após o handshake real da ponte. Instalar ou remover pela IPC exige `confirm: true`. Entradas `atlas` alheias e JSON inválido nunca são sobrescritos.

Validação local no Windows (Node.js 24.14.0, Kimi Code 2.3.3), com a execução das suítes delegada a um subagente conforme `AGENTS.md`: `npm test` 105/105, `npm run test:agent` 60/60, build, `check:public` (71 arquivos), `npm run test:desktop` 17/17 e `npm run smoke:agent` 15/15, repetidos depois das correções da revisão. O smoke desktop usa `KIMI_CODE_HOME` de fixture com outro servidor pré-existente e confere conteúdo exato, foco inicial na ação segura, foco preso, cancelar sem escrita, conectar, remover só a entrada do ATLAS e contraste. O smoke real instala pela IPC confirmada na home isolada e comprova o handshake da ponte iniciada pelo Kimi na sessão manual e na nova run da principal com perfil `mcp__atlas__*`, a revogação do token na saída e a integração preservada após reinício. Nenhum prompt foi enviado ao modelo. Uma validação manual em fixture repetiu o caminho Kimi → `mcp.json` → ponte → host antes da UI (handshake em cerca de 5,7 s).

Uma revisão independente confirmou o modelo de identidade (projeto, remetente e chamador vêm só do token) e apontou defeitos corrigidos antes do PR, cada um com regressão quando reproduzível:

- Uma linha `null` no pipe lançava exceção não tratada no processo principal. Agora pedidos que não são objeto recebem erro, e o teste comprova que nenhuma exceção escapa.
- Mensagens enviadas pela ponte eram auditadas como `user`. O comando e o evento agora registram `agent:<sessão>`, e o store recusa ator alheio.
- Chaves de idempotência de agentes ganham o prefixo da sessão e não colidem entre sessões nem com comandos do usuário.
- Instalação e remoção verificam e gravam a partir da mesma leitura do `mcp.json`. Um arquivo mantido como link é atualizado no destino.
- O socket POSIX fica em diretório privado, e conexões que não se identificam são encerradas por tempo limite.
- A ponte tolera mensagens nulas e repete o `hello` após reconexão.
- O PTY recebe endpoint e token explicitamente vazios quando não há concessão.
- A confirmação de instalar ou remover parte do próprio diálogo. Após uma falha, o estado é relido e a mensagem sai sem o prefixo do Electron. O foco permanece no diálogo durante a ação.

Limites: o token fica no ambiente do processo do Kimi, ao alcance de comandos do próprio agente (fronteira: o usuário local, a mesma do SQLite). A entrada aponta para o Electron e o script do clone atual, e muda para `outdated` se o ATLAS mudar de pasta. O instalador do marco 6 define o caminho estável. A chamada de ferramenta pelo modelo depende do smoke opt-in com provedor configurado.

## Marco 4b-2 — orquestrador pede agentes dentro da política

Integrado pelo PR #16 como `0706d31`, após CI Ubuntu e Windows verde na execução 40479737665. Conforme `docs/PLANO_SOLICITACAO_AGENTES.md`. A política da v0.1 é o modo assistido:

- só a principal pede agentes (profundidade 1);
- até 3 pedidos pendentes por projeto;
- validade de 15 minutos por pedido;
- até 2 agentes da principal em execução;
- o agente nasce com o Kimi interativo no diretório do projeto, sem flags de autonomia nem prompt inicial.

A migration 5 cria `agent_requests`. O pedido é um comando idempotente com ator `agent:<sessão>` e gera os eventos `approval.requested`, `approval.resolved`, `approval.fulfilled` e `approval.failed`.

A principal usa as ferramentas MCP `agents_request` e `agents_request_status`. A lista de ferramentas depende do papel, e sessões de agente não as recebem. O usuário decide no cartão do workspace, que mostra solicitante, nome, propósito (texto da principal), validade e política. Aprovar exige o hash do conteúdo exibido. O host revalida pendência, validade, hash e limite de ativos no ponto de execução, reservando a vaga durante o spawn. O agente nasce com origem `orchestrator`. Uma falha de spawn vira `failed` com o motivo, permanece visível até ser dispensada e não cria sessão fictícia.

Endurecimento após revisão independente: nome do agente sem controles nem formatação invisível (bidi, largura zero) e propósito só com quebra de linha e tab; o nome do solicitante vem do banco; status consultado pela principal também expira pedidos vencidos; no reinício, aprovação interrompida vira `failed` sem novo spawn; se o agente inicia mas o registro do resultado falha, ele continua visível com aviso, sem ser marcado como falho; o cartão sai da fila ao vencer a validade. O hash de aprovação apenas amarra a decisão ao pedido exibido (o conteúdo é imutável após a criação); não é um controle contra alteração de conteúdo.

Validação local (Windows, Node 24.14.0, gates executados por subagente Sonnet): `npm test` 125/125, `npm run test:agent` 80/80, build, `check:public` 75 arquivos, `npm run test:desktop` 18 PASS (pedidos com conteúdo, validade, política, contraste, recusa e falha honesta sem CLI) e `npm run smoke:agent` 17 PASS com Kimi Code 2.3.3 real (pedido semeado da principal aprovado pela interface, agente com origem `orchestrator` e ponte conectada, estado `fulfilled` e origem preservados após reinício). Os smokes padrão não enviam prompt ao modelo; o caminho MCP `agents_request` é coberto por testes com ponte e host reais.

## Marco 4c-1 — delegação de tarefas por handoff

Integrado pelo PR #17 como `eae7868`, após CI Ubuntu e Windows verde na execução 40483097377. Conforme `docs/PLANO_DELEGACAO_TAREFAS.md`. A migration 6 acrescenta responsável, run do claim, `claim_epoch` e bloqueio às tarefas e cria `handoffs` com uma oferta aberta por tarefa. A principal oferece com `tasks_delegate` (objetivo, contexto e próximos passos) e pode cancelar com `handoffs_cancel`. O agente de destino, com run ativa, vê a oferta em `handoffs_pending` como dado não confiável e responde com `handoffs_accept` ou `handoffs_reject`. Depois do aceite, usa `tasks_update` (progresso, bloqueio, retomada) e `tasks_release`, sempre com o claim atual: mesma sessão e mesma run. O token da run é vinculado à run persistida logo após o spawn. O fim ou a perda da run tira o claim (`task.claim_lost`) sem concluir nem devolver a tarefa. No painel Tarefas, o usuário vê estado, responsável, oferta e bloqueio, e pode cancelar a oferta ou devolver a tarefa, o que incrementa o epoch e cerca o dono anterior.

Ajustes da revisão independente: ofertas abertas para uma sessão cuja run terminou ou se perdeu são canceladas pelo sistema, porque sessões de agente não ganham nova run; a principal vê em `tasks_list` se o claim está ativo e a última oferta encerrada com o motivo; textos com CRLF são normalizados. Limites conhecidos: o agente não é avisado de ofertas fora das ferramentas (precisa consultar `handoffs_pending` ou ser orientado pelo usuário), e o modo Foco calcula a altura do terminal sem descontar os avisos do workspace.

## Marco 4c-2 — worktrees sob política

Integrado pelo PR #18 como `fba84d5`, após CI Ubuntu e Windows verde na execução 40484779583. Conforme `docs/PLANO_WORKTREES.md`. A descoberta Git continua somente leitura; criar worktree é uma ação separada e aprovada. A principal pede um agente com `taskId` e `worktree: true`; o cartão mostra tarefa, caminho (`<repositório>.atlas-worktrees/task-<id curto>`) e branch nova (`atlas/task-<id curto>`) antes da decisão. Na aprovação, o host confirma o CLI, cria a worktree a partir do HEAD com `git worktree add` por `execFile`, registra em `worktrees` (migration 7, evento `worktree.created`, commit-base), atualiza a descoberta e inicia o agente nela. Caminho ou branch existentes, projeto sem repositório, com vários repositórios ou sem commit recusam sem alterar nada. Falha de spawn depois da criação mantém a worktree e registra o caminho no motivo. O ATLAS nunca remove worktrees ou branches.

Ajustes da revisão independente: o refresh depois da criação espera uma varredura já em andamento e faz outra completa; uma tarefa com worktree registrada não recebe nova worktree (o ATLAS não recria nem remove); a aprovação revalida o estado da tarefa no mesmo ponto de execução; o cartão avisa quando o caminho fica fora da pasta autorizada; o caminho registrado usa o realpath nativo do Windows.

Revisão, conclusão e evidências ficam no marco 5.

## Marco 5a — evidências, revisão e conclusão

Integrado pelo PR #19 como `1e57189`, após CI Ubuntu e Windows verde na execução 40521656643. Conforme `docs/PLANO_REVISAO.md`. A migration 8 cria `reviews` (uma pendente por tarefa) e `evidence` (`agent_report` declarado pelo agente e `git_snapshot` verificado pelo sistema). O responsável, com o claim atual e a tarefa sem bloqueio, usa `tasks_request_review` com resumo e comandos com exit code; o host coleta, só com leituras Git, branch, commit-base, HEAD, commits, diffstat e arquivos fora dos commits da worktree registrada da tarefa (ou registra por que não conseguiu) e move a tarefa para `in_review`. O usuário decide no painel Tarefas: aceitar conclui (`done`, evento `task.completed` com ator, critério de aceite e evidências) e pedir ajustes devolve ao responsável com a nota. A aba Evidências do desktop mostra as revisões reais do projeto. Nada conclui tarefas automaticamente e não há merge automático.

Segurança (revisão independente): o agente escreve na worktree, inclusive no arquivo `.git`, e poderia forjar o retrato "verificado" e executar código no processo do ATLAS por `core.fsmonitor`, textconv ou diff externo. O retrato e a descoberta passaram a usar o diretório administrativo da worktree resolvido pelo repositório principal (`--git-dir`/`--work-tree`), com `core.fsmonitor=false`, `--no-ext-diff` e `--no-textconv`; pastas `*.atlas-worktrees` não são candidatas da descoberta. A regressão com hook forjado falha contra o código anterior (inclusive a descoberta que já estava na `main`) e passa agora, com controle positivo. Erros do Git ficam em campo técnico separado e saneado. No aceite, o ATLAS coleta o retrato de novo e recusa se a worktree mudou desde o pedido; o HEAD aceito vai para `task.completed`. Limite: um agente que consiga escrever no `.git/config` do repositório principal (fora da sua worktree) ainda controla a configuração comum; isso depende das permissões do harness.

Reconciliação após reinício (passos 11 e 12): runs ativas viram `lost`, claims dessas runs são perdidos sem concluir tarefas, ofertas abertas para sessões encerradas são canceladas e aprovações interrompidas viram `failed`; projetos, tarefas, mensagens, revisões e evidências permanecem (smokes desktop e real verificam no SQLite após fechar e reabrir).

## Marco 6a — "Abrir no ATLAS"

Integrado pelo PR #20 como `55072c3`, após CI Ubuntu e Windows verde na execução 40525473209. Conforme `docs/PLANO_ABRIR_NO_ATLAS.md`. O ATLAS aceita `--atlas-open=<pasta>` na primeira instância ou repassado pela segunda (instância única), valida e canonicaliza o caminho, abre o projeto que já contém a pasta sem duplicar e pede confirmação para cadastrar pasta nova, sem `git init`. A entrada do Explorador ("Abrir no ATLAS" no menu de pastas e do fundo da pasta) é opcional, gravada no HKCU só depois da confirmação em "Aparência e configurações" e removível pelo mesmo lugar. Ajustes da revisão independente: a leitura do registro passou para PowerShell em UTF-8 (a saída do `reg.exe` usa a página OEM e quebrava caminhos com acento); um segundo pedido substitui e descarta o primeiro sem fechar o modal errado; raiz de unidade ou compartilhamento é recusada e pasta que contém projetos cadastrados é avisada; subpasta com nome iniciado por `..` continua no projeto; raiz autorizada durante uma varredura não se perde; o override de registro dos smokes só vale fora do aplicativo empacotado; a raiz de compartilhamento chega corretamente; segunda instância sem caminho traz a janela para frente; o texto avisa que no Windows 11 a entrada fica em "Mostrar mais opções".

## Marco 6b — instalador Windows

Integrado pelo PR #21 como `e9ec2fb`, após CI Ubuntu, Windows e Package verde na execução 40553177785, que publicou o instalador como artefato do workflow. Na CI, o smoke precisou canonicalizar caminhos com o realpath nativo: o runner usa nomes 8.3 (`RUNNER~1`) na pasta temporária. Conforme `docs/PLANO_INSTALADOR.md`. `npm run dist:win` gera `release/ATLAS-Setup-<versão>.exe` (NSIS por usuário, sem administrador). O instalador pergunta se adiciona "Abrir no ATLAS" ao Explorador, com "não" como padrão e na instalação silenciosa. Usa as mesmas chaves e o mesmo comando do app; a desinstalação remove só a entrada desta instalação. `node-pty` e a ponte MCP ficam fora do asar, e o app empacotado aponta o `mcp.json` para a ponte desempacotada. O job `Package` da CI gera o instalador e roda `scripts/smoke-installer.mjs` duas vezes: sobre o app desempacotado e com instalação e desinstalação silenciosas numa pasta temporária. O instalador sai como artefato do workflow, sem release nem tag.

Ambiente local: a extração do `winCodeSign` pelo electron-builder falha sem privilégio de criar links simbólicos (arquivos de macOS). Nesta máquina, o pacote foi extraído no cache do electron-builder sem a pasta `darwin`; a CI não precisa disso. Limites: sem assinatura de código e sem ícone próprio.

## Marco 6c-1 — escolha de CLI e modelo por agente

Integrado pelo PR #24 como `22989f9`, após CI Ubuntu, Windows e Package verde na execução 40553885143. Conforme `docs/PLANO_ESCOLHA_DE_AGENTE.md`, por decisão do usuário: nenhum CLI é fixo, nem na principal. O OpenCode entrou como segundo adaptador, e o usuário escolhe o CLI e o modelo de cada sessão manual, da principal (também em cada nova execução) e de cada agente pedido. A escolha usa só CLIs detectados e modelos que eles informam, sem padrão. O OpenCode recebe a ponte e o perfil somente leitura da principal por `OPENCODE_CONFIG_CONTENT`, sem gravar configuração. A migration 9 registra o CLI e o modelo de cada run. `npm run smoke:opencode` valida o OpenCode real com `XDG_*` isolados e sem prompt; a configuração e as credenciais reais do usuário foram conferidas por hash antes e depois. Na revisão independente, a principal no OpenCode deixava de ser somente leitura por Tab para o agente `build` e por um `opencode.json` hostil no repositório. A correção usa permissão global da run, desabilita `build` e `plan` e liga `OPENCODE_DISABLE_PROJECT_CONFIG`, verificados no próprio OpenCode pelo smoke. Também foram corrigidas a corrida da lista de modelos na interface, a revalidação entre a aprovação e o início e a recarga da lista de CLIs. Observação de validação: uma execução do `test:desktop` falhou por `CDP timeout: Page.captureScreenshot`, logo depois do passo de pop-up "sempre no topo", que este marco não alterou. As duas execuções seguintes, sem mudança de código, passaram 24/24. Fica registrado como intermitência a acompanhar.

A demonstração final do aceite (6c-2) continua pendente; o roteiro está em `docs/ROTEIRO_ACEITE_V0_1.md`. A descrição de `agents_request` deixou de dizer "agente Kimi", porque o usuário escolhe o CLI na aprovação. Incidente: o PR #26 (roteiro e descrição de `agents_request`) foi integrado como `c34ef90` com o job Verify (windows-latest) vermelho, por erro do agente: o merge foi encadeado depois do acompanhamento da CI sem depender do resultado. A falha era o teste real de registro do "Abrir no ATLAS": quatro PowerShells em paralelo (um por chave) estouraram o tempo limite de 15 s no runner. O PR seguinte lê as quatro chaves num único PowerShell, com regressão que falha contra o código anterior. Daqui em diante, o merge só roda condicionado ao sucesso de `gh pr checks --watch`. Os PRs #22, #23 e #25 do Dependabot (electron-builder e dependências) ficam para revisão própria, porque mexem no empacotamento validado. Vai usar o OpenCode com um modelo gratuito da NVIDIA, com credencial já configurada pelo usuário, para não consumir quota.

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
