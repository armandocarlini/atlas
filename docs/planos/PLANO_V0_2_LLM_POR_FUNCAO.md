# Plano v0.2 — LLM por função

Situação: **aprovado pelo mantenedor em 29/10/2026**, com os ajustes registrados em cada decisão. A implementação segue as fases abaixo.

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
- **Recomendação de modelo:** o Orquestrador, como toda função, tem modelos recomendados pelo ATLAS, curados pelo mantenedor (veja "Recomendações curadas" abaixo). A recomendação aparece em destaque, mas **não é escolhida pelo usuário automaticamente**: ele aceita com um clique ou escolhe outro, e essa escolha passa a preencher a principal.
- A principal continua só iniciando com o clique do usuário. O preenchimento não inicia a run sozinho, nem depois de uma saída.
- O perfil somente leitura (`--agent-file` no Kimi, `atlas-orchestrator` no OpenCode) não depende da função. A função escolhe só CLI e modelo.
- Em **Nova sessão** manual aparece a lista "Usar função", com as cinco padrão e as do usuário, que só preenche. O componente é o mesmo (`AgentChoice`), e o custo é baixo.

### Recomendações curadas (decidido pelo mantenedor, 29/10/2026)

O ATLAS recomenda, para cada função, modelos que de fato são bons para ela. **Quem escolhe as recomendações é o mantenedor do ATLAS.** O ATLAS mostra a recomendação, e quem escolhe é o usuário.

- **Onde fica:** `electron/model-recommendations.json`, versionado. Por função (inclusive `orquestrador`), uma lista ordenada de `{ adapterId, model, motivo }`, mais `revisadoEm`.
- **Quem altera:** só o mantenedor, ou um agente por instrução explícita dele. Agentes não acrescentam, removem nem reordenam recomendações por conta própria. Essa regra vai para o `AGENTS.md`.
- **Como aparece:**
  - na tela de funções, no diálogo da principal e no cartão, o ATLAS mostra a primeira recomendação **disponível nos CLIs detectados** (comparada com a lista que o CLI devolve), por exemplo "Recomendado pelo ATLAS: X — motivo", com o botão "Usar recomendado";
  - recomendações cujo modelo o usuário não tem ficam de fora, e sem nenhuma disponível aparece "Nenhum modelo recomendado disponível nos seus CLIs";
  - quando o modelo escolhido é diferente do recomendado, o ATLAS só mostra a recomendação ao lado, sem avisos insistentes.
- **Não é pré-seleção:** a recomendação nunca preenche o seletor sozinha. Uma função nunca configurada continua vazia até o usuário escolher, mesmo com recomendação disponível.
- **Kimi:** a lista do Kimi vem dos apelidos do `config.toml` do usuário, então a comparação precisa usar o nome real do modelo por trás do apelido. Detalhe a resolver na fase 2.
- **Arquivo inicial:** o mantenedor fornece as recomendações. Até lá, o arquivo existe vazio, e a interface trata isso como "sem recomendação".

### Como a função é escolhida e como o pedido chega ao agente certo

**Decidido pelo mantenedor (29/10/2026):** o Orquestrador delega a tarefa ao agente especializado, escolhendo a função correta sozinho. O usuário pode mudar o LLM e/ou a função do agente escolhido.

O ATLAS não escolhe a função: ele valida, preenche, registra e só executa depois do clique do usuário. A aprovação humana de cada novo agente continua (invariante da v0.1).

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
- **Função não configurada, CLI ausente ou modelo fora da lista do CLI:** o cartão abre vazio, como hoje, com aviso do motivo, por exemplo "O modelo X da função *revisar* não está mais na lista do OpenCode", e com a recomendação curada e o botão "Usar recomendado". Não há troca silenciosa por outro modelo.
- **Agente já em execução, reaproveitado pelo Orquestrador:** o usuário pode trocar a função dele no card da sessão. Isso muda só o rótulo, que o Orquestrador usa nas próximas delegações. A troca do LLM de um agente em execução é a troca nativa do CLI (item 2).
- O usuário pode mudar CLI ou modelo. O cartão mostra "alterado em relação à função", e a run registra `function_overridden = 1`.
- **Pedido sem função:** o comportamento é o de hoje, com o cartão vazio.
- `resolveLaunch` continua sendo a conferência final no ponto de execução.

**O que não muda:** o modo assistido, os limites da política (até 3 pendentes, 15 min, até 2 ativos), a criação de worktree só na aprovação e o fato de só o usuário concluir tarefas.

### 5. O que muda no AGENTS.md

**Aprovado pelo mantenedor (29/10/2026).** O texto abaixo substitui a frase do invariante "CLIs e modelos" no mesmo PR que implementar a fase 3. Antes disso, a regra atual continua valendo.

> **CLIs e modelos:** os adaptadores (Kimi Code, OpenCode) detectam o CLI pelo `PATH` e iniciam sessões interativas em pastas autorizadas, sem flags de autonomia. Não existe CLI nem modelo padrão **do ATLAS**: o código não escolhe CLI ou modelo por conta própria. O usuário pode definir **funções** com CLI e modelo, que só **preenchem** a escolha. O ATLAS pode **recomendar** modelos por função, a partir da lista curada pelo mantenedor (`electron/model-recommendations.json`), mas a recomendação nunca é selecionada sem o usuário. Agentes não alteram essa lista sem instrução explícita do mantenedor. Cada sessão (manual, principal ou pedida) continua iniciando apenas com a confirmação explícita do usuário, que pode trocar a sugestão. Configuração ausente ou inválida nunca é substituída em silêncio.

Também entram:
- em "Integração MCP": `agent_functions_list` não expõe CLI nem modelo à principal;
- no `docs/CONTEXTO.md`: a linha "Adaptadores" deixa de dizer "Não existe CLI nem modelo padrão" e passa a citar as funções.

## Fases de implementação (depois da aprovação)

Cada fase tem branch e PR próprios e CI verde em Ubuntu e Windows.

1. **Banco e host.**
   - Migration 10, que semeia `orquestrador` e as cinco padrão.
   - CRUD de funções no processo principal, com validação de slug, limite e ordem, e proteção das padrão e do Orquestrador (não se apagam e não se renomeiam).
   - IPC só para a janela principal.
   - Leitor validado de `electron/model-recommendations.json`, que começa vazio.
   - Testes: migration a partir do banco v9, backup/restore, slug duplicado ou reservado, limite, apagar ou renomear uma padrão (recusado), função apagada com runs antigas e arquivo de recomendações inválido (recusado com erro claro).
2. **Tela de funções.**
   - Configurações → Funções: lista com as padrão e as do usuário, criar, editar e apagar as do usuário, e trocar CLI e modelo de todas.
   - A recomendação curada aparece com "Usar recomendado", reaproveitando `AgentChoice`.
   - Usa as skills ui-ux-pro-max e apple-design e segue `design-system/atlas/MASTER.md`.
   - Testes: `test:desktop` cobrindo foco, teclado, erro de CLI ausente e recomendação que nunca preenche sozinha.
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
4. **Principal e sessão manual.** "Usar função" nos dois diálogos (o da principal vem com o Orquestrador), e a troca da função de um agente já em execução no card da sessão (só o rótulo usado nas próximas delegações).
   - Testes: preencher não inicia a run, e uma nova run depois da saída continua pedindo confirmação.

Fora do escopo: sobrescrita por projeto, custo e quota por função (v0.4), escolha da função pelo próprio ATLAS (ela é do Orquestrador) e aprovação automática de agentes.

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

## Decisões do mantenedor (29/10/2026)

1. **Funções:** cinco funções padrão, que não podem ser apagadas, têm nome fixo e CLI e modelo trocáveis, mais as funções do usuário, até 12 no total. As padrão nascem sem modelo, e o ATLAS pede para configurá-las na primeira vez.
2. **Recomendações:** o ATLAS recomenda, por função, modelos realmente bons, curados pelo mantenedor. A recomendação nunca é escolhida pelo usuário automaticamente.
3. **Principal:** é sempre o Orquestrador, com recomendação de modelo e escolha do usuário.
4. **Escolha da função:** o Orquestrador escolhe sozinho a função do agente e delega a ele. O usuário pode mudar o LLM e/ou a função no cartão. A aprovação de cada novo agente continua.
5. **Escopo:** global na v0.2.
6. **AGENTS.md:** texto aprovado, já com a regra das recomendações.
7. **Item 2:** começar pela troca nativa do CLI com rótulo honesto. A nova run com retomada fica como plano B.

**Pendente com o mantenedor:** a lista inicial de recomendações (função → CLI e modelo, com motivo). Até ela chegar, o arquivo fica vazio, e a interface mostra "sem recomendação".
