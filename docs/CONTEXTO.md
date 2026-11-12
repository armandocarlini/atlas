# Contexto atual do ATLAS

Última revisão em 12/11/2026, com a coordenação real pela principal (ela cria tarefas, e o agente aprovado começa sozinho) e o painel Mensagens redesenhado.

Este arquivo descreve **o que existe hoje**. Ele é reescrito a cada marco: não acrescente diário aqui. A história de como chegamos até este ponto fica em `docs/historico/`. O que vem depois fica em `docs/ROADMAP.md`.

## Em uma frase

O ATLAS é um cockpit desktop local para Windows (Electron + React) que coordena agentes de código em terminais reais. Ele tem uma sessão principal de planejamento por projeto, agentes pedidos por ela com aprovação do usuário, tarefas, mensagens, worktrees e revisão com evidências. Tudo fica persistido em SQLite.

## Onde estamos

- Versão `0.1.0`. **A v0.1 está completa:** os 12 passos do aceite foram demonstrados em 27/10/2026 com o ATLAS instalado, o OpenCode e um modelo gratuito da NVIDIA, com estado preservado após reabrir (`docs/historico/ACEITE_V0_1.md`).
- Sem release nem tag. Publicar a v0.1 é decisão do mantenedor. O instalador sai só como artefato da CI.
- Os próximos passos estão em `docs/ROADMAP.md`.

## O que funciona de verdade

| Área | Comportamento | Onde |
|---|---|---|
| Terminais | PowerShell real por node-pty/ConPTY e xterm.js. Grade, Destaque, Principal + agentes e Abas. Ocultar, restaurar ou destacar em pop-up mantém o PTY em execução. No fechamento normal, os terminais ativos ficam registrados para reabrir com o mesmo nome e a pasta de abertura. Cada PowerShell recriado começa com um buffer novo | `electron/terminal-host.cjs`, `electron/pty-transport.cjs`, `src/TerminalView.jsx` |
| Projetos e Git | Pastas autorizadas e descoberta Git **somente leitura** (repositórios, branches, worktrees) | `electron/project-host.cjs`, `electron/git-discovery.cjs` |
| Adaptadores | Kimi Code, OpenCode, Claude Code, Codex e Gemini, detectados no `PATH`. O Claude Code não lista modelos: o cartão aceita o modelo digitado, ou vazio para o da configuração dele. O Codex lista os modelos por `codex debug models` e, nesta versão, é só agente. O Gemini lista por `gemini --list-models` e recebe a ponte pelo `settings.json`, com consentimento (como o Kimi). Não existe CLI nem modelo padrão do ATLAS: o usuário escolhe em **toda** sessão, partindo do que salvou na função quando há uma | `electron/agent-adapters.cjs`, `electron/agent-host.cjs`, `src/AgentChoice.jsx` |
| Principal | Uma identidade por projeto, perfil somente leitura por padrão (chave "Principal só coordena", por projeto; desligada, a principal edita o que é pequeno, com as aprovações do CLI e o `.env` negado nas ferramentas de arquivo; o Kimi recusa esse modo) (`--agent-file` no Kimi, `atlas-orchestrator` no OpenCode, `--restricted` com Read, Grep e Glob no Claude Code, `--policy` do ATLAS no Gemini) e nova run explícita após a saída | `electron/orchestrator-profile.cjs` |
| Ponte MCP | Named pipe e token por run. O projeto e a sessão vêm só do token. Kimi e Gemini recebem a entrada `atlas` no arquivo do CLI (`mcp.json`, `settings.json`) só com consentimento, e o aviso de integração só aparece em projeto que usa o CLI. O OpenCode recebe a ponte pela run (`OPENCODE_CONFIG_CONTENT`), o Claude Code por arquivos do perfil do ATLAS (`--mcp-config`) e o Codex por `-c mcp_servers.atlas.*`, sem gravar configuração. Ferramentas: `sessions_list`, `tasks_list`, `messages_unread`, `messages_mark_read`, `messages_send`, `agents_request`, `agents_request_status`, `agent_functions_list`, `tasks_create`, `tasks_delegate`, `handoffs_cancel`, `handoffs_pending`, `handoffs_accept`, `handoffs_reject`, `tasks_update`, `tasks_release` e `tasks_request_review`. A lista exposta depende do papel da sessão | `electron/mcp-host.cjs`, `electron/atlas-mcp-bridge.cjs`, `electron/kimi-mcp-config.cjs`, `src/KimiIntegration.jsx` |
| Funções de agente (v0.2) | Orquestrador e cinco padrão (planejar, explorar, implementar, revisar, testes), que não se apagam nem se renomeiam, mais as do usuário até 12. Tela "Funções de agente" na barra lateral, com aviso das que faltam configurar. A principal consulta `agent_functions_list` (com o CLI e o modelo de cada função, para a revisão cruzada), vê em `workedBy` de `tasks_list` quem já trabalhou em cada tarefa, vê a função de cada sessão em `sessions_list` e informa `function` em `agents_request`; o cartão vem preenchido e avisa, sem bloquear, quando a IA escolhida já trabalhou na tarefa com outra função; o usuário troca função, CLI ou modelo, e a run registra a função e se houve troca. A principal é sempre o Orquestrador, preenchida com o que está salvo nele; a sessão manual tem "Usar função"; o card de um agente em execução troca a função (só o rótulo). A auditoria de cada run é calculada no processo principal. Recomendações curadas pelo mantenedor em `electron/model-recommendations.json` (vazio por enquanto), aplicadas só com "Usar recomendado" | `electron/agent-functions.cjs`, `electron/agent-function-host.cjs`, `electron/model-recommendations.cjs`, `src/AgentFunctions.jsx` |
| Troca de modelo (v0.2) | O usuário troca o modelo no terminal do CLI (`/model` + Alt+S no Kimi, `/models` no OpenCode; no Claude Code, que não lista modelos, a troca não é registrada) e informa ao ATLAS em "Trocar modelo" no menu da sessão. A mesma run guarda o modelo de início e o informado; a descrição do cabeçalho informa "informado por você". O ATLAS não digita no terminal. Na principal, liberado só no OpenCode, verificado pelo `smoke:opencode` (mesma run, ponte conectada, somente leitura) | `src/ModelSwitch.jsx`, `src/model-switch.js`, `electron/agent-host.cjs` |
| Suíte de regressão (v0.2) | Configurada na área "Estado" do projeto ("Suíte de regressão: … Configurar"), num diálogo com liga/desliga, comando ("Usar sugestão" só quando o `package.json` tem `scripts.test`), prazo e o aviso de permissões. Na revisão, o bloco "verificada pelo ATLAS" mostra estado por texto e ícone, duração, avisos, o trecho final do log (carregado ao abrir) e os botões "Abrir log completo", "Mostrar na pasta" e "Parar suíte"; ao lado do aceite, o estado, sem bloquear. Disparada por `tasks_request_review` quando o usuário ligou a suíte do projeto; a resposta ao agente não espera. Tarefa sem worktree registra "não executada". A evidência avisa se a suíte alterou a worktree (o aceite explica a recusa) e lista os arquivos de teste tocados pelo diff. `tasks_list` mostra aos agentes só o estado, e o perfil da principal diz que a suíte só informa: verde não conclui e vermelha não impede o aceite. O usuário configura por projeto o comando e o prazo (1 min a 24 h, ou sem prazo; sem padrão). Uma execução por vez, no shell do sistema, na worktree, sem credenciais do ATLAS no ambiente. Log completo em arquivo, com teto de segurança de 1 GB marcado no próprio log. Prazo, parada pelo usuário, erro e fechamento do ATLAS nunca viram `passed`; o que estava rodando vira `interrupted` no início seguinte, sem repetir | `electron/regression-suite.cjs`, `electron/regression-runner.cjs`, `electron/regression-suite-host.cjs`, `src/RegressionSuite.jsx` |
| Pedidos de agente | A principal pede com `agents_request`, e o usuário aprova no cartão. Modo assistido: profundidade 1, até 3 pendentes, validade de 15 min, até 2 ativos. Na aprovação, o agente abre com um prompt inicial fixo do ATLAS (Claude Code e Codex pelo argumento do prompt, Gemini por `-i`, OpenCode por `--prompt`; o Kimi não recebe) e o propósito do cartão chega pelo ATLAS: como oferta da tarefa do pedido ou, sem tarefa, como mensagem da principal. Falha na entrega não derruba o agente e aparece no aviso | `electron/agent-request-host.cjs`, `src/AgentRequests.jsx` |
| Tarefas | Criadas em `backlog` pelo usuário ou pela principal (`tasks_create`, com `created_by` = `agent:<sessão>`). Delegação por handoff com claim e `claim_epoch` (fencing); o fim da run tira o claim | `electron/task-host.cjs`, `electron/task-delegation.cjs`, `src/PersistentTasks.jsx` |
| Mensagens | Descobertas estruturadas entre sessões, com entrega e leitura persistidas. **Nunca** digitadas no terminal do destinatário. No painel, cada mensagem é um cartão com remetente → destinatário, data, selos de tipo e de estado e "Marcar como lida" (ausente no Acompanhamento). O texto passa por um markdown seguro que não gera HTML (parágrafos, títulos, listas, `código`, negrito); tons âmbar ("precisa de você"), vermelho (falha) e verde (sucesso) sempre com ícone e texto, sem colorir negações como "0 falhas". A não lida abre inteira; a lida e longa abre recolhida com "Mostrar tudo (+N linhas)". Container queries em três faixas de largura | `electron/message-host.cjs`, `src/SessionMessages.jsx`, `src/message-card.js`, `src/message-markdown.js` |
| Worktrees | Criadas só ao aprovar um pedido com `taskId` + `worktree: true`, em `<repo>.atlas-worktrees/task-…` / `atlas/task-…`. O ATLAS nunca remove worktrees nem branches | `electron/worktree-manager.cjs` |
| Revisão | O agente pede revisão com evidência declarada, e o ATLAS anexa um retrato Git somente leitura e endurecido. Só o usuário conclui (`done`) | `electron/task-review.cjs`, `electron/git-evidence.cjs` |
| Reinício | Após fechamento normal, os agentes e a principal que estavam ativos reabrem com o CLI, o modelo, a função e a pasta anteriores. O ATLAS tenta retomar a conversa e informa falhas ou a abertura de conversa nova. Após queda, as runs interrompidas ficam no histórico. Claims são liberados no fim da run e aprovações interrompidas viram `failed` | `electron/operational-store.cjs`, `electron/agent-host.cjs` |
| Ações de sessão | **Ocultar** tira o card da área de trabalho e mantém o processo. **Encerrar processo** para o PTY após confirmação e mantém o histórico acessível. **Excluir do ATLAS** remove uma sessão encerrada ou um histórico da árvore e da área de trabalho. Tarefas, mensagens e evidências conservam seus vínculos no SQLite. Uma nova execução explícita da principal reutiliza a identidade única do projeto | `src/App.jsx`, `electron/pty-transport.cjs`, `electron/operational-store.cjs` |
| Abrir no ATLAS | `--atlas-open=<pasta>` com instância única. A entrada do Explorador (HKCU) só é gravada com consentimento | `electron/open-path-host.cjs`, `electron/explorer-integration.cjs`, `src/OpenFolder.jsx` |
| Interface | Identidade mármore, marfim e ouro, com estátua na marca e no projeto vazio. Uma barra superior só, de 36px: no Windows e no Linux a janela principal não tem barra nativa, e minimizar, maximizar e fechar ficam sobre a barra do ATLAS, na cor do tema; pop-ups de terminal e Acompanhamento também têm uma barra só, no cabeçalho da sessão e na faixa do painel (no macOS a barra nativa continua). Terminais contíguos, sem gaps, bordas ou raios. Na abertura, só sessões vivas ocupam a área de trabalho: uma run sem processo ("resultado incerto") fica na árvore e abre somente leitura quando escolhida; projeto sem sessões vivas mostra "Como começar?", com a sessão principal e as funções de agente, e cada escolha abre o diálogo preenchido pela função, sem iniciar nada sem confirmação. Todo select abre uma lista no material do ATLAS (`base-select`), sem perder teclado nem leitor de tela. A árvore lateral usa chevrons, ícones e indentação entre projetos, repositórios, worktrees e sessões; clicar no projeto o expande, e trocar de projeto preserva a expansão anterior. "Espera você" aparece só com decisões e leva à principal parada, aos pedidos e às revisões. O cabeçalho de cada sessão tem o ícone oficial do CLI (Simple Icons, CC0; Codex neutro; terminal com ícone de terminal) com selo de estado (verde ativa, âmbar oculta), a função e um menu de ações; a árvore usa o mesmo ícone; metadados ficam na descrição. A paleta fica numa cápsula com lupa e atalho no topo e reúne Restaurar layout, Funções de agente (com quantas faltam configurar) e Aparência; o rodapé da navegação fica livre, e o lettering ATLAS da barra é vetorial. Seleção usa superfície e tipografia, sem filetes; Navegação e Painéis mantêm posição fixa. Painéis começam recolhidos em instalações novas; estado e integrações ficam sob demanda. Sessões ocultas continuam na árvore e podem ser restauradas sem novo processo; preferências de layout persistem localmente. Paleta (Ctrl Shift P ou F1) funciona com foco no terminal sem enviar texto ao PTY. Temas preservam contraste e Jost é local. Plano em `docs/planos/PLANO_WORKSPACE_TERMINAL_FIRST.md` | `src/WorkspaceTree.jsx`, `src/workspace-layout.js`, `src/workspace.css`, `src/identity.css`, `src/controls.css`, `src/window-overlay.js`, `src/SessionGlyph.jsx`, `src/cli-marks.js`, `electron/window-chrome.cjs`, `src/CommandPalette.jsx` |
| Instalador | NSIS por usuário (`npm run dist:win`), pergunta antes de gravar a entrada do Explorador | `electron-builder.yml`, `scripts/smoke-installer.mjs` |

## Workspace terminal-first

Navegação, área de terminais e Painéis têm divisórias próprias, redimensionáveis por mouse e teclado, com tamanhos persistidos. Navegação vira modo compacto e depois trilho de ícones com árvore completa em flyout; Painéis viram abas compactas e depois trilho com painel sobreposto. Barras e ações de terminais se adaptam à largura sem perder rótulos no nome acessível. Na Grade e em Principal + agentes, divisórias redimensionam as trilhas com mínimos de terminal.

Selecionar texto no terminal copia automaticamente e informa a contagem de caracteres. Ctrl+C copia quando há seleção e continua interrompendo sem ela; Ctrl+V cola sem Enter. A barra de seleção oferece Responder, Reescrever e Colar em outra sessão. Caminhos do Explorer e arquivos arrastados entram como literais seguros do PowerShell; imagem respeita o atalho do CLI. Implementação: `src/TerminalView.jsx`, `src/TrackResizers.jsx`, `src/terminal-clipboard.js`, `src/workspace.css` e `src/resizable.css`.

Só no navegador (`npm run dev`) aparecem os quatro cards de demonstração. Eles não são integrações e não devem ser apresentados como tal.

## Banco (SQLite, `electron/operational-store.cjs`)

As migrations são numeradas e nunca editadas depois de integradas:

1. projetos, sessões, runs e eventos
2. tarefas e comandos idempotentes
3. identidade única da principal
4. mensagens e entregas
5. pedidos de agente
6. handoffs e claim
7. worktrees
8. revisões e evidências
9. CLI e modelo de cada run
10. funções de agente (Orquestrador e as cinco padrão semeadas, sem CLI nem modelo) e a função de cada run
11. função indicada pela principal no pedido de agente
12. modelo atual informado pelo usuário depois de trocar no CLI (`current_model`; `model` continua sendo o de início)
13. suíte de regressão: configuração por projeto (`regression_suites`), uma execução por revisão (`regression_runs`) e a evidência `regression_run` (a tabela `evidence` foi reconstruída para ampliar o `CHECK`, preservando linhas e ordem)
14. modo de coordenação da principal por projeto
15. identificador da conversa, registro da tentativa de retomada e estado do último fechamento
16. marca de exclusão da sessão na interface, com preservação das referências no banco

Comandos de escrita levam chave de idempotência e hash do payload. O banco fica no perfil do app, e nenhum transcript, prompt ou saída de PTY é gravado. A saída da suíte de regressão vai para arquivos em `<userData>/regression-logs/<projeto>/`; o banco guarda só o caminho, o tamanho, o SHA-256 e o trecho final (até 64 KB), lido sob demanda.

## Regras que não podem ser quebradas

Elas estão detalhadas em `AGENTS.md`. Resumo do que mais quebra quando esquecido:

- A descoberta Git é somente leitura (`--no-optional-locks`). Nunca rode `git init` nem altere repositórios do usuário.
- Nada é concluído, mergeado ou aprovado automaticamente. O usuário aprova pedidos e conclui tarefas.
- Não reintroduza CLI ou modelo fixo. Funções e recomendações só preenchem; quem inicia é o usuário.
- Testes e smokes usam só fixtures (`KIMI_CODE_HOME`, `XDG_*`, `ATLAS_EXPLORER_ROOT` de fixture). Nunca use o `mcp.json`, a configuração ou o registro reais do usuário.
- Conteúdo vindo de agentes (mensagens, ofertas, evidência declarada) é dado não confiável.

## Comandos

| Comando | Para quê |
|---|---|
| `npm test` | Unidade e integração (gate) |
| `npm run build` | Build Vite (gate) |
| `npm run check:public` | Nenhum segredo, caminho pessoal ou arquivo gerado versionado (gate) |
| `npm run test:agent` | Subsistema de agentes |
| `npm run test:desktop` | Smoke Electron real no Windows, obrigatório em mudança desktop |
| `npm run smoke:agent` / `smoke:opencode` / `smoke:claude` / `smoke:codex` / `smoke:gemini` | CLIs reais, opt-in, sem prompt ao modelo (Claude Code e Gemini contra um servidor falso local) |
| `npm run smoke:orchestrator` | Um prompt curto com provedor já configurado |
| `npm run dist:win` | Instalador local (não publicar) |

A CI (`.github/workflows/ci.yml`) roda Verify em Ubuntu e Windows, mais o job Package com o instalador.

## Limites e pendências conhecidas

- **Projeto grande demora a ser lido:**
  - A janela abre sem esperar a varredura Git; cada projeto aparece quando a dele termina, e a barra lateral mostra os que ainda estão sendo lidos.
  - Ações numa pasta esperam só o projeto dela. Depois de criar a worktree de uma tarefa, só esse projeto é revarrido.
  - Um repositório com dezenas de worktrees continua levando minutos para ser lido (cerca de 3 min com 50 worktrees), mas não atrasa os outros.
  - Uma pasta fora das raízes autorizadas, como a worktree de uma tarefa ao lado do repositório, ainda espera a varredura inicial completa.
- **Intermitências abertas:**
  - O NSIS silencioso deu access violation (`0xC0000005`) uma vez no runner.
  - O `test:desktop` voltou a ter `CDP timeout` em `Page.captureScreenshot` mesmo com `CalculateNativeWinOcclusion` desligado no smoke. O diagnóstico mostrou o renderer oculto; a hipótese de oclusão sozinha era insuficiente. Cada captura agora restaura/foca a janela correta e exige visibilidade e um frame antes de capturar, sem retry ou timeout maior. Também houve digitação corrompida no PowerShell entre comandos; o smoke aguarda o próximo prompt antes de consultar dimensões. Acompanhar novas ocorrências sem declarar ausência de intermitência.
  - Em 12/11/2026, o `test:desktop` deu `Timeout: left no trilho` uma vez, no arraste da Navegação até o trilho (eventos sintéticos do DevTools), com o usuário usando a máquina. As duas execuções seguintes, no `main` e no branch, passaram. Causa não confirmada.
  - Se repetirem, investigue em vez de reexecutar.
- **Kimi Code 2.4.0/2.4.1: integração oficial pendente, contenção implementada.** O SDK perde o perfil explícito e vincula o padrão com ferramentas de escrita; conexões MCP anteriores à criação da sessão também são transitórias. O candidato temporário `2.4.1+atlas-profile-fix.1`, com patch do SDK, passou no diagnóstico nativo e no smoke completo: perfil de leitura e ferramentas ATLAS, troca de modelo na mesma sessão/run/PTY, pedidos, worktree, revogação e reinício, sem API. O painel de informar modelo também foi exercitado numa sessão manual em execução. O patch e sua regressão estão em `docs/diagnosticos/patches/`; o candidato não foi instalado no CLI do usuário. As versões oficiais afetadas continuam recusadas para novas runs da principal antes de token/PTY/persistência; histórico e agentes manuais permanecem disponíveis. Uma distribuição oficial corrigida ainda precisa ser validada antes de liberar a principal Kimi e seu botão de troca. Reprodução e limites: `docs/diagnosticos/KIMI_2_4_MCP.md`. O OpenCode não é afetado.
- O token MCP fica no ambiente do processo do agente: a fronteira de confiança é o usuário local.
- O agente não é avisado de ofertas fora das ferramentas e precisa consultar `handoffs_pending`.
- O agente Kimi aprovado não recebe prompt inicial e espera o usuário. O prompt inicial dos demais CLIs foi verificado por testes de argumentos, não por uma sessão real com modelo.
- `node:sqlite` emite aviso experimental no Node 24.
- O patch local do `node-pty` 1.1.0 (`scripts/patch-node-pty.cjs`) precisa ser revisto a cada atualização dessa dependência.
- Sem assinatura de código e sem ícone próprio no instalador.

## Ambiente

- Node.js 24 LTS ou posterior. Git no `PATH`. Windows e Windows PowerShell para o desktop completo.
  - Confira com `node --version` antes dos testes.
  - `npm test` enumera os arquivos `.test.mjs` em `scripts/` por `scripts/run-tests.mjs`, portanto funciona em PowerShell, `cmd.exe` e shells POSIX.
- CLIs usados no desenvolvimento: Kimi Code, OpenCode, Codex e Claude Code. Os smokes do produto cobrem Kimi, OpenCode, Claude Code (`smoke:claude`, com servidor falso local), Codex (`smoke:codex`) e Gemini (`smoke:gemini`, com servidor falso local).
- ai-memory: projeto `default/ATLAS` (veja a seção em `AGENTS.md`).

## Como atualizar este arquivo

Ao fechar um marco:

1. Reescreva as seções afetadas para refletir o novo estado.
2. Atualize a data e o commit no topo.
3. Mova o que virou história (incidentes, números de CI, evidências do PR) para `docs/historico/` ou para a descrição do PR.

Este arquivo deve continuar cabendo em poucos minutos de leitura.
