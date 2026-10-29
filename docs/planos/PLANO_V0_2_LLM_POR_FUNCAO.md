# Plano v0.2 — LLM por função

Situação: **proposta, aguardando aprovação do mantenedor.** Nada deste plano foi implementado.

Cobre o item 1 do `docs/ROADMAP.md` (LLM por função) e registra a investigação do item 2 (trocar o LLM de um agente sem perder a tela). O item 3 (suíte de regressão liga/desliga) e o redesign visual ficam fora.

## Objetivo

Hoje o usuário escolhe CLI e modelo do zero em toda sessão: manual, principal e cada agente pedido. O objetivo é ele definir isso uma vez por **função** (por exemplo *implementar* ou *revisar*), e o ATLAS trazer a escolha preenchida. O usuário continua decidindo: nada inicia sem o clique dele, e ele pode trocar a sugestão em qualquer cartão.

## Como funciona hoje (base do plano)

- `agents_request` (`electron/mcp-host.cjs`) recebe `name`, `purpose`, `taskId`, `worktree` e `idempotencyKey`. O hash do pedido (`payload_hash`) cobre só o que a principal escreveu.
- O cartão (`src/AgentRequests.jsx`) começa com `AgentChoice` vazio (`adapterId: ''`, `model: ''`). O botão "Aprovar e iniciar" só habilita com a escolha completa.
- Na aprovação, `agentHost.resolveLaunch(adapterId, model)` confere CLI e modelo antes de consumir o pedido ou criar a worktree (`electron/agent-request-host.cjs`).
- A migration 9 grava `adapter_id` e `model` por run em `agent_runs`.

## Decisões

### 1. Quais funções existem e se o usuário pode criar as dele

**Decidido pelo mantenedor (29/10/2026):** o MVP tem cinco funções **padrão**, além do Orquestrador da principal (veja o ponto 3). O usuário troca o CLI e o modelo delas quando quiser e também pode criar funções novas.

**As cinco padrão:**

| Slug | Nome | Descrição inicial (lida pela principal) |
|---|---|---|
| `planejar` | Planejar | Quebra um objetivo em passos, avalia riscos e propõe a abordagem antes do código |
| `explorar` | Explorar | Lê o código e a documentação para responder perguntas e localizar onde mexer, sem alterar arquivos |
| `implementar` | Implementar | Escreve e altera código numa worktree da tarefa |
| `revisar` | Revisar | Revisa um diff ou uma branch em busca de bugs, riscos e desvios do plano |
| `testes` | Testes | Escreve testes, roda as suítes e relata falhas com evidência |

- **Sempre existem e não podem ser apagadas.** Slug e nome são fixos, para a principal e o histórico sempre as reconhecerem. O usuário edita a descrição e, principalmente, o CLI e o modelo.
- Elas nascem **sem CLI nem modelo**. Na primeira vez, o ATLAS pede para o usuário configurá-las, e cada uma fica "não configurada" até lá. Assim, o código continua sem escolher modelo por conta própria (ponto 5).
- **Funções do usuário:** ele cria as dele, com:
  - identificador estável (slug, `^[a-z0-9-]{2,32}$`, sem colidir com as padrão);
  - nome;
  - descrição (até 300 caracteres);
  - CLI e modelo.
  - Elas podem ser editadas e apagadas.
- Limite de 12 funções no total, contando as padrão, para a lista da principal e o seletor caberem.
- Apagar uma função do usuário não altera runs passadas: o histórico guarda o slug e o nome da época.

### 2. Escopo da configuração (global, por projeto ou os dois)

**Recomendação:** **global** na v0.2, com o banco preparado para sobrescrita por projeto depois.

- CLIs, contas e modelos são da máquina, não do projeto. Na prática, o mesmo usuário quer o mesmo modelo para *revisar* em todos os projetos.
- Uma tela só é mais simples de entender e de testar. Com sobrescrita por projeto, cada cartão precisaria explicar de onde veio a sugestão.
- A tabela já nasce com `project_id` anulável (`NULL` = global). Ligar a sobrescrita por projeto depois é só interface e regra de precedência, sem migration nova.

**Armazenamento:** migration 10 no SQLite (`electron/operational-store.cjs`):
- tabela `agent_functions` com `id`, `project_id NULL`, `slug`, `name`, `description`, `kind` (`orchestrator`, `builtin` ou `custom`), `adapter_id NULL`, `model NULL`, `position`, `created_at` e `updated_at`, mais `UNIQUE(project_id, slug)`. A migration semeia `orquestrador` e as cinco padrão, sem CLI nem modelo;
- `agent_runs.function_slug` e `agent_runs.function_overridden` (0/1), para auditoria.

Fica no banco, e não em arquivo de configuração, para entrar no backup e restore que já existem.

### 3. A principal também usa uma função?

**Decidido pelo mantenedor (29/10/2026):** a principal é **sempre** o Orquestrador. A recomendação é o modelo mais capaz, mas o usuário escolhe e pode trocar.

- Uma função reservada, `orquestrador`, pertence só à principal:
  - não aparece para os pedidos de agente;
  - não pode ser apagada;
  - o diálogo da principal vem preenchido com ela.
- **"LLM mais potente como recomendada":** os CLIs devolvem só nomes de modelos (`listModels`), sem nenhuma medida de capacidade. Por isso, no MVP, a recomendação é **orientação na tela, não pré-seleção automática**.
  - Ao configurar o Orquestrador, o ATLAS diz: "Recomendado: o modelo mais capaz que você tiver. O Orquestrador planeja e delega, e um erro dele se espalha pelos agentes."
  - O usuário escolhe, e essa escolha passa a preencher a principal.
  - Ordenar os modelos por capacidade de verdade depende do catálogo de modelos da v0.4. Uma lista de nomes "fortes" mantida à mão no código envelheceria rápido e viraria, na prática, um modelo padrão do ATLAS.
- A principal continua só iniciando com o clique do usuário. O preenchimento não inicia a run sozinho, nem depois de uma saída.
- O perfil somente leitura (`--agent-file` no Kimi, `atlas-orchestrator` no OpenCode) não depende da função. A função escolhe só CLI e modelo.
- Em **Nova sessão** manual aparece a lista "Usar função", com as cinco padrão e as do usuário, que só preenche. O componente é o mesmo (`AgentChoice`), e o custo é baixo.

### Como a função é escolhida e como o pedido chega ao agente certo

Quem escolhe a função é a **principal (Orquestrador)**. O **usuário confirma ou troca** no cartão. O ATLAS não roteia nada sozinho: ele valida, preenche, registra e só executa depois do clique do usuário.

1. **O usuário pede ao Orquestrador**, no terminal da principal, por exemplo: "implemente o filtro da tarefa 12 e depois revise".
   - Se quiser, ele mesmo nomeia a função: "use a função revisar".
   - Tarefas continuam criadas pelo usuário (invariante da v0.1).
2. **O Orquestrador consulta as funções** com `agent_functions_list`: slug, nome, descrição e se está configurada.
   - Ele escolhe pela descrição, não pelo custo.
   - Se o usuário nomeou uma função, ele usa essa.
3. **O Orquestrador vê se já há um agente adequado** com `sessions_list`, que passa a informar a função de cada sessão.
   - **Se houver** um agente da função livre, ele oferece a tarefa com `tasks_delegate`. O agente aceita ou recusa, como hoje. Nenhum agente novo é criado.
   - **Se não houver**, ele pede um com `agents_request { name, purpose, function, taskId, worktree }`.
4. **O ATLAS mostra o cartão**:
   - "Função: *implementar* (escolhida pelo Orquestrador)";
   - CLI e modelo já preenchidos pela função;
   - uma lista para o usuário **trocar a função**, que preenche de novo CLI e modelo, ou trocar só o CLI e o modelo.
5. **Na aprovação**, o ATLAS:
   - confere CLI e modelo (`resolveLaunch`);
   - cria a worktree, se pedida;
   - inicia o agente com o CLI e o modelo confirmados;
   - grava na run a função e se o usuário a alterou.
6. **O Orquestrador delega a tarefa** ao novo agente com `tasks_delegate` (o fluxo de handoff, claim e `claim_epoch` da v0.1, sem mudança).
   - Na etapa seguinte, por exemplo revisar, ele repete os passos 2 a 6 com outra função.
7. **Sessão manual:** o usuário escolhe a função direto em "Nova sessão", sem passar pelo Orquestrador.

O que o ATLAS **não** faz: escolher a função pelo Orquestrador, digitar no terminal de um agente, aprovar sozinho ou trocar o modelo de um agente já em execução (isso é o item 2).

### 4. Como fica o cartão de aprovação

**Recomendação:** a principal informa a função, e o cartão vem preenchido e marcado como sugestão.

**Na ponte MCP:**
- `agents_request` ganha o campo opcional `function` (slug).
- A ponte valida o slug contra as funções existentes. Um slug desconhecido devolve erro com a lista válida, em vez de virar pedido sem função.
- `function` entra no `payload_hash`, porque é a principal que escreve. CLI e modelo continuam fora do hash, porque quem decide é o usuário, como hoje.
- `sessions_list` passa a informar a função de cada sessão, para o Orquestrador reaproveitar um agente em vez de pedir outro.
- Nova ferramenta `agent_functions_list`, só para o papel `orchestrator`, sem a função reservada `orquestrador`. Devolve slug, nome, descrição e se está configurada.
- **Não** devolve CLI nem modelo: a principal escolhe pelo trabalho, não pelo custo. Isso também evita vazar a configuração local para o modelo.

**No cartão:**
- Uma linha nova, "Função: *implementar* (escolhida pelo Orquestrador)", com uma lista para o usuário trocar a função.
- `AgentChoice` vem preenchido com o CLI e o modelo da função. O botão "Aprovar e iniciar" continua exigindo clique explícito.
- **Função não configurada, CLI ausente ou modelo fora da lista do CLI:** o cartão abre vazio, como hoje, com aviso do motivo, por exemplo "O modelo X da função *revisar* não está mais na lista do OpenCode". Não há troca silenciosa por outro modelo.
- O usuário pode mudar CLI ou modelo. O cartão mostra "alterado em relação à função", e a run registra `function_overridden = 1`.
- **Pedido sem função:** o comportamento é o de hoje, com o cartão vazio.
- `resolveLaunch` continua sendo a conferência final no ponto de execução.

**O que não muda:** o modo assistido, os limites da política (até 3 pendentes, 15 min, até 2 ativos), a criação de worktree só na aprovação e o fato de só o usuário concluir tarefas.

### 5. O que muda no AGENTS.md

**Recomendação:** trocar a frase do invariante "CLIs e modelos" pelo texto abaixo, no mesmo PR que implementar a fase 3 (antes disso, a regra atual continua valendo):

> **CLIs e modelos:** os adaptadores (Kimi Code, OpenCode) detectam o CLI pelo `PATH` e iniciam sessões interativas em pastas autorizadas, sem flags de autonomia. Não existe CLI nem modelo padrão **do ATLAS**: o código não escolhe CLI ou modelo por conta própria. O usuário pode definir **funções** com CLI e modelo, que só **preenchem** a escolha. Cada sessão (manual, principal ou pedida) continua iniciando apenas com a confirmação explícita do usuário, que pode trocar a sugestão. Configuração ausente ou inválida nunca é substituída em silêncio.

Também entram:
- em "Integração MCP": `agent_functions_list` não expõe CLI nem modelo à principal;
- no `docs/CONTEXTO.md`: a linha "Adaptadores" deixa de dizer "Não existe CLI nem modelo padrão" e passa a citar as funções.

## Fases de implementação (depois da aprovação)

Cada fase tem branch e PR próprios e CI verde em Ubuntu e Windows.

1. **Banco e host.** Migration 10, CRUD de funções no main process com validação de slug, limite e ordem, e IPC só para a janela principal.
   - Testes: migration a partir do banco v9, backup/restore, slug duplicado, limite, função apagada com runs antigas.
2. **Tela de funções.** Configurações → Funções: lista, criar, editar, apagar e as sugestões iniciais, reaproveitando `AgentChoice`. Usa as skills ui-ux-pro-max e apple-design e segue `design-system/atlas/MASTER.md`.
   - Testes: `test:desktop` cobrindo foco, teclado e erro de CLI ausente.
3. **Ponte e cartão.**
   - `function` em `agents_request`, `agent_functions_list`, cartão preenchido e auditoria em `agent_runs`.
   - Mudança no `AGENTS.md` e nas instruções da principal (`electron/orchestrator-profile.cjs`), que passam a citar `agent_functions_list` e o campo `function`.
   - Testes:
     - slug desconhecido;
     - hash com e sem função;
     - modelo sumido;
     - CLI indisponível;
     - usuário troca a sugestão;
     - aprovação simultânea;
     - regressão de pedido sem função;
     - smoke do OpenCode e do Kimi com fixtures.
4. **Principal e sessão manual.** "Usar função" nos dois diálogos.
   - Testes: preencher não inicia a run, e uma nova run depois da saída continua pedindo confirmação.

Fora do escopo: sobrescrita por projeto, custo e quota por função (v0.4) e escolha automática de função pelo ATLAS.

## Investigação do item 2 — trocar o LLM sem perder a tela

Feita em 27/10/2026 com o **Kimi Code 2.3.3** e o **OpenCode 1.18.21** instalados nesta máquina. Foi só leitura: ajuda dos CLIs e texto dos executáveis. Nenhum prompt foi enviado e nenhuma configuração foi alterada.

### O que os CLIs fazem

| | Kimi Code 2.3.3 | OpenCode 1.18.21 |
|---|---|---|
| Troca dentro da TUI | `/model` abre o seletor ("Switch LLM model") | `/models` (atalho `/mo`), `<leader>m`; F2 / Shift+F2 alternam entre os recentes |
| Conversa preservada | Sim: `session.setModel(alias)` na mesma sessão. Em sessão com histórico, pergunta "Compact and continue", "Continue as-is" ou "Cancel" | Sim: o modelo vale para as próximas mensagens da mesma sessão |
| Durante uma resposta | Recusa: "Cannot switch models while streaming — press Esc or Ctrl-C first." | Não verificado |
| Grava como padrão? | **Sim, por padrão.** Enter grava `default_model` no `config.toml` do usuário; **Alt+S** troca só nesta sessão ("for this session only") | Não grava configuração. Guarda os recentes e favoritos em `~/.local/state/opencode/model.json`, que o CLI usa como padrão quando não recebe `--model` |
| Retomar com outro modelo | `kimi -S <id>` ou `-c`, com `-m`. **`--agent-file` não combina com `--session`/`--continue`** | `opencode -s <id>` ou `-c`, com `-m` (e `--fork` opcional) |
| ATLAS consegue ver a troca? | Não pela saída do terminal de forma confiável | Não pela saída do terminal; a TUI tem servidor HTTP local (`--port`) com a sessão, ainda não testado como fonte |

### Consequências para o ATLAS

- **A troca nativa já cumpre "não perder a tela" e o contexto.** O PTY, o scrollback, a run, o token MCP e o claim da tarefa continuam os mesmos, porque nada é reiniciado.
- **Hoje o ATLAS não fica sabendo da troca.** O registro da run (migration 9) continua mostrando o modelo de início. O cartão precisa dizer isso com honestidade, por exemplo "iniciado com X".
- **O perfil da principal não depende do modelo.** No OpenCode, as permissões estão no agente `atlas-orchestrator`, não no modelo. No Kimi, o perfil é da sessão. Ainda falta confirmar com teste que `/model` mantém o `--agent-file`.
- **Armadilha do Kimi:** o Enter no `/model` grava o padrão no `config.toml` real do usuário. É ação do usuário dentro do CLI, não do ATLAS, mas a ajuda do ATLAS deve apontar o Alt+S.
- **Nova run com retomada** (o caminho alternativo do roadmap) tem dois custos:
  - o fim da run tira o claim (invariante), então a run sucessora precisaria herdar o claim de forma atômica com novo `claim_epoch`;
  - no Kimi, a principal não pode ser retomada, porque `--agent-file` não combina com `--session`.
  - Além disso, o scrollback hoje vive só na memória do PTY (`electron/pty-transport.cjs`, 512 KB) e precisaria ser mantido acima da nova run.

### Recomendação para o item 2 (a decidir no plano dele)

1. **Primeira entrega:** apoiar a troca nativa sem mexer no PTY.
   - O cartão da sessão mostra "modelo de início" e uma ajuda curta: `/model` com Alt+S no Kimi, `/models` no OpenCode.
   - O ATLAS **não** digita comandos no terminal do agente, pela mesma lógica das mensagens.
2. **Depois, se o registro fizer falta:** detectar a troca por fonte somente leitura, como o servidor local do OpenCode ou os arquivos de sessão do Kimi, a investigar.
3. **Nova run com retomada:** só se a troca nativa falhar em algum CLI, e com o desenho da herança do claim aprovado antes.

"Não perder" passa a valer para a tela **e** para o contexto da conversa: a troca nativa cumpre os dois.

## Decisões que dependem do mantenedor

1. ~~Quais funções~~ **Decidido:** cinco padrão (sem apagar, nome fixo, CLI e modelo trocáveis), mais funções do usuário, com limite de 12. Confirmar só que as padrão nascem sem modelo e o ATLAS pede para configurar na primeira vez.
2. Escopo global na v0.2, com o banco já pronto para sobrescrita por projeto: **aprovar ou pedir por projeto já**.
3. ~~Principal~~ **Decidido:** sempre o Orquestrador. Confirmar que, no MVP, "mais potente recomendada" é orientação na tela, sem ranking automático até o catálogo da v0.4.
3b. O fluxo de escolha (o Orquestrador escolhe pela descrição, reaproveita um agente da função se houver, e o usuário pode trocar a função no cartão): **aprovar**.
4. `agent_functions_list` sem CLI nem modelo, e `function` dentro do hash: **aprovar**.
5. Novo texto do invariante "CLIs e modelos" no `AGENTS.md`: **aprovar o texto**.
6. Item 2: começar pela troca nativa com rótulo honesto e deixar a nova run com retomada como plano B: **aprovar a direção**.
