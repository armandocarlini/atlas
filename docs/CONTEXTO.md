# Contexto atual do ATLAS

Última revisão: 08/11/2026, com as fases 2 e 3 da identidade visual (barra única, paleta de comandos e Painel do Atlas).

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
| Terminais | PowerShell real por node-pty/ConPTY e xterm.js, com grid, foco, pop-up nativo e reintegração sem matar o PTY | `electron/terminal-host.cjs`, `electron/pty-transport.cjs`, `src/TerminalView.jsx` |
| Projetos e Git | Pastas autorizadas e descoberta Git **somente leitura** (repositórios, branches, worktrees) | `electron/project-host.cjs`, `electron/git-discovery.cjs` |
| Adaptadores | Kimi Code, OpenCode, Claude Code e Codex, detectados no `PATH`. O Claude Code não lista modelos: o cartão aceita o modelo digitado, ou vazio para o da configuração dele. O Codex lista os modelos por `codex debug models` e, nesta versão, é só agente. O Gemini lista por `gemini --list-models` e recebe a ponte pelo `settings.json`, com consentimento (como o Kimi). Não existe CLI nem modelo padrão do ATLAS: o usuário escolhe em **toda** sessão, partindo do que salvou na função quando há uma | `electron/agent-adapters.cjs`, `electron/agent-host.cjs`, `src/AgentChoice.jsx` |
| Principal | Uma identidade por projeto, perfil somente leitura (`--agent-file` no Kimi, `atlas-orchestrator` no OpenCode, `--restricted` com Read, Grep e Glob no Claude Code, `--policy` do ATLAS no Gemini) e nova run explícita após a saída | `electron/orchestrator-profile.cjs` |
| Ponte MCP | Named pipe e token por run. O projeto e a sessão vêm só do token. No Kimi, a entrada vai para o `mcp.json` com consentimento, e o aviso de integração só aparece em projeto com sessão Kimi; no OpenCode, só pela run (`OPENCODE_CONFIG_CONTENT`) | `electron/mcp-host.cjs`, `electron/atlas-mcp-bridge.cjs`, `electron/kimi-mcp-config.cjs`, `src/KimiIntegration.jsx` |
| Funções de agente (v0.2) | Orquestrador e cinco padrão (planejar, explorar, implementar, revisar, testes), que não se apagam nem se renomeiam, mais as do usuário até 12. Tela "Funções de agente" na barra lateral, com aviso das que faltam configurar. A principal consulta `agent_functions_list` (sem CLI nem modelo), vê a função de cada sessão em `sessions_list` e informa `function` em `agents_request`; o cartão vem preenchido, o usuário troca função, CLI ou modelo, e a run registra a função e se houve troca. A principal é sempre o Orquestrador, preenchida com o que está salvo nele; a sessão manual tem "Usar função"; o card de um agente em execução troca a função (só o rótulo). A auditoria de cada run é calculada no processo principal Recomendações curadas pelo mantenedor em `electron/model-recommendations.json` (vazio por enquanto), aplicadas só com "Usar recomendado" | `electron/agent-functions.cjs`, `electron/agent-function-host.cjs`, `electron/model-recommendations.cjs`, `src/AgentFunctions.jsx` |
| Troca de modelo (v0.2) | O usuário troca o modelo no terminal do CLI (`/model` + Alt+S no Kimi, `/models` no OpenCode; no Claude Code, que não lista modelos, a troca não é registrada) e informa ao ATLAS em "Trocar modelo" no card. A mesma run guarda o modelo de início e o informado; o card mostra "informado por você". O ATLAS não digita no terminal. Na principal, liberado só no OpenCode, verificado pelo `smoke:opencode` (mesma run, ponte conectada, somente leitura) | `src/ModelSwitch.jsx`, `src/model-switch.js`, `electron/agent-host.cjs` |
| Suíte de regressão (v0.2) | Configurada na subbarra do projeto ("Suíte de regressão: … Configurar"), num diálogo com liga/desliga, comando ("Usar sugestão" só quando o `package.json` tem `scripts.test`), prazo e o aviso de permissões. Na revisão, o bloco "verificada pelo ATLAS" mostra estado por texto e ícone, duração, avisos, o trecho final do log (carregado ao abrir) e os botões "Abrir log completo", "Mostrar na pasta" e "Parar suíte"; ao lado do aceite, o estado, sem bloquear. Disparada por `tasks_request_review` quando o usuário ligou a suíte do projeto; a resposta ao agente não espera. Tarefa sem worktree registra "não executada". A evidência avisa se a suíte alterou a worktree (o aceite explica a recusa) e lista os arquivos de teste tocados pelo diff. `tasks_list` mostra aos agentes só o estado, e o perfil da principal diz que a suíte só informa: verde não conclui e vermelha não impede o aceite. O usuário configura por projeto o comando e o prazo (1 min a 24 h, ou sem prazo; sem padrão). Uma execução por vez, no shell do sistema, na worktree, sem credenciais do ATLAS no ambiente. Log completo em arquivo, com teto de segurança de 1 GB marcado no próprio log. Prazo, parada pelo usuário, erro e fechamento do ATLAS nunca viram `passed`; o que estava rodando vira `interrupted` no início seguinte, sem repetir | `electron/regression-suite.cjs`, `electron/regression-runner.cjs`, `electron/regression-suite-host.cjs`, `src/RegressionSuite.jsx` |
| Pedidos de agente | A principal pede com `agents_request`, e o usuário aprova no cartão. Modo assistido: profundidade 1, até 3 pendentes, validade de 15 min, até 2 ativos | `electron/agent-request-host.cjs`, `src/AgentRequests.jsx` |
| Tarefas | Criadas pelo usuário em `backlog`. Delegação por handoff com claim e `claim_epoch` (fencing); o fim da run tira o claim | `electron/task-host.cjs`, `electron/task-delegation.cjs`, `src/PersistentTasks.jsx` |
| Mensagens | Descobertas estruturadas entre sessões, com entrega e leitura persistidas. **Nunca** digitadas no terminal do destinatário | `electron/message-host.cjs`, `src/SessionMessages.jsx` |
| Worktrees | Criadas só ao aprovar um pedido com `taskId` + `worktree: true`, em `<repo>.atlas-worktrees/task-…` / `atlas/task-…`. O ATLAS nunca remove worktrees nem branches | `electron/worktree-manager.cjs` |
| Revisão | O agente pede revisão com evidência declarada, e o ATLAS anexa um retrato Git somente leitura e endurecido. Só o usuário conclui (`done`) | `electron/task-review.cjs`, `electron/git-evidence.cjs` |
| Reinício | Runs ativas viram `lost`, claims caem e aprovações interrompidas viram `failed`. Nada é reaberto sozinho | `electron/operational-store.cjs` |
| Abrir no ATLAS | `--atlas-open=<pasta>` com instância única. A entrada do Explorador (HKCU) só é gravada com consentimento | `electron/open-path-host.cjs`, `electron/explorer-integration.cjs`, `src/OpenFolder.jsx` |
| Interface | Identidade mármore, marfim e ouro, com a estátua do logo na barra de título e no projeto sem sessões. Uma barra só em cima (marca, abas de projeto e ações) e paleta de comandos (Ctrl Shift P ou F1), que vale com o foco no terminal sem enviar nada ao PTY. Painel do Atlas no topo da navegação: estado da principal, "Espera você" (principal parada, pedidos e revisões) e equipe por tarefa. Marfim sobre Obsidiana é o padrão; o usuário troca destaque e fundo, e `--gold`, o texto e o preenchimento do destaque se ajustam para continuar legíveis. Jost empacotada, sem rede. A grade de terminais não se sobrepõe: a linha define a altura do cartão. Sem barra de status; rolagem visível só ao rolar. Regras em `design-system/atlas/MASTER.md`; próximas fases em `docs/planos/PLANO_IDENTIDADE_VISUAL.md` | `src/identity.css`, `src/appearance.js`, `src/scrollbars.js`, `src/CommandPalette.jsx`, `src/AtlasPanel.jsx`, `src/assets/atlas-statue.webp` |
| Instalador | NSIS por usuário (`npm run dist:win`), pergunta antes de gravar a entrada do Explorador | `electron-builder.yml`, `scripts/smoke-installer.mjs` |

Ferramentas MCP da ponte: `sessions_list`, `tasks_list`, `messages_unread`, `messages_mark_read`, `messages_send`, `agents_request`, `agents_request_status`, `agent_functions_list`, `tasks_delegate`, `handoffs_cancel`, `handoffs_pending`, `handoffs_accept`, `handoffs_reject`, `tasks_update`, `tasks_release` e `tasks_request_review`. A lista exposta depende do papel da sessão.

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
| `npm run smoke:agent` / `smoke:opencode` | CLIs reais, opt-in, sem prompt ao modelo |
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
  - Se repetirem, investigue em vez de reexecutar.
- **Kimi Code 2.4.0/2.4.1: integração oficial pendente, contenção implementada.** O SDK perde o perfil explícito e vincula o padrão com ferramentas de escrita; conexões MCP anteriores à criação da sessão também são transitórias. O candidato temporário `2.4.1+atlas-profile-fix.1`, com patch do SDK, passou no diagnóstico nativo e no smoke completo: perfil de leitura e ferramentas ATLAS, troca de modelo na mesma sessão/run/PTY, pedidos, worktree, revogação e reinício, sem API. O painel de informar modelo também foi exercitado numa sessão manual em execução. O patch e sua regressão estão em `docs/diagnosticos/patches/`; o candidato não foi instalado no CLI do usuário. As versões oficiais afetadas continuam recusadas para novas runs da principal antes de token/PTY/persistência; histórico e agentes manuais permanecem disponíveis. Uma distribuição oficial corrigida ainda precisa ser validada antes de liberar a principal Kimi e seu botão de troca. Reprodução e limites: `docs/diagnosticos/KIMI_2_4_MCP.md`. O OpenCode não é afetado.
- O token MCP fica no ambiente do processo do agente: a fronteira de confiança é o usuário local.
- O agente não é avisado de ofertas fora das ferramentas e precisa consultar `handoffs_pending`.
- O modo Foco não desconta a altura dos avisos do workspace.
- `node:sqlite` emite aviso experimental no Node 24.
- O patch local do `node-pty` 1.1.0 (`scripts/patch-node-pty.cjs`) precisa ser revisto a cada atualização dessa dependência.
- Sem assinatura de código e sem ícone próprio no instalador.

## Ambiente

- Node.js 24 LTS. Git no `PATH`. Windows e Windows PowerShell para o desktop completo.
  - Confira com `node --version` antes dos testes.
  - Nesta máquina, o PATH de alguns shells seleciona o Node 20. Nele, `npm test` falha com `Could not find '...\scripts\*.test.mjs'`, porque o Node 20 não expande o glob.
  - Coloque `C:\Program Files\nodejs` (Node 24) primeiro no PATH da sessão.
- CLIs usados no desenvolvimento: Kimi Code, OpenCode, Codex e Claude Code. Os smokes do produto cobrem Kimi, OpenCode, Claude Code (`smoke:claude`, com servidor falso local) Codex (`smoke:codex`) e Gemini (`smoke:gemini`, com servidor falso local).
- ai-memory: projeto `default/ATLAS` (veja a seção em `AGENTS.md`).

## Como atualizar este arquivo

Ao fechar um marco:

1. Reescreva as seções afetadas para refletir o novo estado.
2. Atualize a data e o commit no topo.
3. Mova o que virou história (incidentes, números de CI, evidências do PR) para `docs/historico/` ou para a descrição do PR.

Este arquivo deve continuar cabendo em poucos minutos de leitura.
