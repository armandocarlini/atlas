# Plano v0.2: equipe com várias IAs (Claude Code, Codex, Gemini e revisão cruzada)

Situação: **aprovado pelo mantenedor em 08/11/2026.** A fase 1 (investigação de Claude Code e Codex) está registrada em `docs/diagnosticos/CLAUDE_CODEX_FASE1.md`. A chave "Principal só coordena" (fase 5) está no diálogo de iniciar a principal; no Kimi, o modo auto é recusado até ser verificado. O Gemini foi investigado em 09/11/2026 (`docs/diagnosticos/GEMINI_FASE4.md`): a ponte não entra por run, e o mantenedor decidiu que ela entra com consentimento, como no Kimi.

Substitui o antigo item 4 da v0.2 no `docs/ROADMAP.md`. Os playbooks saem da v0.2 e vão para "Possíveis ideias". O mantenedor considerou que eles duplicam o que a principal já faz.

## Por que

O ATLAS existe para o dev conversar com **uma principal** que coordena uma **equipe de IAs diferentes**, cada uma no seu terminal visível. A principal encaminha cada trabalho para quem faz melhor:

- uma imagem para o site vai para o Codex, que gera imagens;
- o código escrito por uma IA é revisado por outra.

Hoje a equipe só tem Kimi Code e OpenCode. O mantenedor usa principalmente o **Claude Code com Opus 5.5 como principal**. Para ele, o ATLAS só cumpre a proposta quando Claude Code, Codex e Gemini entram na equipe.

## Decisões do mantenedor (conversa de 04 a 06/11/2026)

| Tema | Decisão |
|---|---|
| Playbooks | Saem da v0.2. Vão para "Possíveis ideias", sem plano |
| Novos CLIs | Claude Code, Codex e Gemini (Gemini CLI), **no mesmo item**, entregues em fases. O Gemini foi antecipado da v0.3 a pedido do mantenedor em 06/11/2026 |
| Papel dos novos CLIs | Membros da equipe **e** principal. Qualquer CLI com adaptador pode ser a principal, sem CLI padrão |
| Principal editar arquivos | Chave por projeto **"Principal só coordena"**, ligada por padrão. Ligada, a principal só lê e delega, como hoje. Desligada, entra no modo auto: faz sozinha o que é pequeno e claro e delega o resto. Sem modos "nunca delega" ou "sempre pergunta" |
| Revisão cruzada | Regra padrão: quem revisa é uma IA diferente da que escreveu. O usuário pode trocar no cartão, por exemplo quando só tem uma assinatura |
| O que a principal vê | A principal passa a ver **qual IA (CLI e modelo) trabalhou em cada tarefa** e **o CLI e o modelo de cada função** |

### Invariantes que mudam com este plano

Ao entregar cada fase, o `AGENTS.md` deve ser reescrito para refletir as mudanças:

- **"Sessão principal: perfil somente leitura"** passa a ser o padrão da chave "Principal só coordena". Com a chave desligada, o perfil da principal tem ferramentas de escrita. As permissões continuam sendo as do CLI, sem flags de autonomia.
- **"`agent_functions_list` não expõe CLI nem modelo à principal"** deixa de valer. A principal vê CLI e modelo, mas **continua sem escolher sozinha**. O cartão de aprovação segue preenchido pela função, e só o usuário aprova.

Todas as outras invariantes continuam:

- aprovação humana de cada agente;
- só o usuário conclui;
- sem merge automático;
- worktrees só pela aprovação;
- nenhum CLI ou modelo padrão do ATLAS;
- configuração dos CLIs nunca gravada sem consentimento.

## Decisões técnicas propostas

### 1. Adaptadores Claude Code, Codex e Gemini

Seguem o modelo do OpenCode: **a ponte MCP e o perfil entram só pela run**, sem gravar em `~/.claude`, `~/.codex`, `~/.gemini` ou no repositório. A detecção é pelo `PATH` (`claude`, `codex`, `gemini`), com `--version`. As sessões são interativas e não usam flags de autonomia: as aprovações de permissão continuam no terminal do CLI.

**Claude Code.** Flags confirmadas na ajuda da 2.1.318:

| Flag | Uso no ATLAS |
|---|---|
| `--model` | Modelo escolhido no cartão |
| `--mcp-config` + `--strict-mcp-config` | Só a ponte do ATLAS. A principal ignora outros servidores MCP |
| `--append-system-prompt` | Instruções da principal (`orchestratorInstructions('mcp__atlas__')`) |
| `--tools` / `--disallowedTools` | Perfil somente leitura da principal |
| `--setting-sources` | Ignorar configurações do projeto na principal, como o OpenCode faz com `OPENCODE_DISABLE_PROJECT_CONFIG` |

**Codex.** Flags confirmadas na ajuda da 0.164.0:

| Flag | Uso no ATLAS |
|---|---|
| `-m` | Modelo escolhido no cartão |
| `-c mcp_servers.atlas.*` | A ponte, só nesta run |
| `-s read-only` | Principal somente leitura |
| `-c` com instruções do desenvolvedor | Perfil da principal. A chave exata é verificada na fase 1 |

A funcionalidade `image_generation` aparece como estável e ligada na lista de funcionalidades do Codex.

**Gemini.** O Gemini CLI **não está instalado** nesta máquina, e o ATLAS não instala CLIs.

- A fase 1 depende de o mantenedor instalar o Gemini CLI. Antes disso, nada sobre ele é afirmado como verificado.
- O que a fase 1 precisa achar no Gemini CLI é o mesmo que nos outros dois:
  - modelo por run;
  - servidor MCP e instruções da principal passados só pela run, sem gravar em `~/.gemini/settings.json` nem em `.gemini/` do projeto;
  - perfil somente leitura com o shell negado;
  - leitura de `.env` bloqueada;
  - configuração do repositório ignorada na principal;
  - lista de modelos.
- **Se algum desses pontos não tiver forma confiável, valem as mesmas regras de queda dos outros CLIs.** Sem ponte segura, o Gemini entra só como sessão manual. Sem perfil somente leitura confiável, ele não vira principal no modo "só coordena".

**Regras de segurança dos adaptadores:**

- **Token fora da linha de comando.** O token da run nunca vai em argumento, porque argumentos são visíveis a outros processos do usuário. Ele passa por variável de ambiente que a configuração MCP referencia ou repassa:
  - Claude Code: expansão de `${VAR}` no JSON do MCP;
  - Codex: `env_vars` do servidor MCP.

  Se um CLI não permitir isso (inclusive o Gemini), o adaptador não oferece as ferramentas do ATLAS nesse CLI. O token nunca é exposto como alternativa.

  Sem a ponte, o CLI continua disponível só como sessão manual: terminal visível, sem tarefas, mensagens ou principal. É o que acontece hoje com o Kimi sem o consentimento do `mcp.json`. A fase do adaptador segue com esse escopo mínimo, e o cartão explica o limite.
- **Leitura de `.env` bloqueada na principal somente leitura.** A principal do OpenCode já nega a leitura de `.env`. No Claude Code isso é feito com regras de negação de `Read`. No Codex, o sandbox `read-only` ainda deixa o shell ler arquivos. A fase 1 verifica se dá para negar o shell à principal ou restringir a leitura. **Sem uma forma confiável, o Codex fica disponível como agente, mas não como principal somente leitura.** Nesse caso, o cartão explica o motivo, no mesmo padrão do bloqueio do Kimi 2.4.0/2.4.1 (`assertOrchestratorSupport`).
- **Configuração do repositório na principal.** `.claude/`, `CLAUDE.md`, `.codex/` e `AGENTS.md` do projeto podem trazer hooks ou servidores MCP. A principal ignora as fontes que reabririam permissões ou iniciariam processos. As instruções em texto, como o `CLAUDE.md`, podem continuar, porque já são tratadas como dado não confiável. O detalhe exato é verificado na fase 1.

**Modelos:**

- O Claude Code não tem comando que liste modelos. O Codex não tem um conhecido. Nos dois, o cartão aceita o modelo digitado pelo usuário, validado por `MODEL_PATTERN`, e mantém os modelos já usados naquela função.
- Se o CLI tiver lista, ela é usada. A fase 1 confirma.
- **O ATLAS não inventa lista de modelos.**

**Trocar o modelo sem perder a tela** (item 2 da v0.2): os dois CLIs têm `/model` na TUI. A fase 1 verifica se o ATLAS consegue registrar a troca como faz no OpenCode. Se não conseguir, o botão de troca fica indisponível nesses CLIs e mostra o motivo.

**Fixtures.** Os smokes reais usam homes isolados (`CLAUDE_CONFIG_DIR`, `CODEX_HOME` e o equivalente do Gemini, confirmado na fase 1) em pasta temporária e não enviam prompt ao modelo. Cobrem:

- detecção;
- argumentos;
- perfil;
- ponte conectada;
- ferramentas negadas na principal;
- nenhuma escrita na configuração real.

### 2. Chave "Principal só coordena"

- **Banco:** nova coluna ou tabela por projeto (`orchestrator_mode`: `coordinate` ou `auto`), com `version` para escrita otimista, no mesmo padrão da suíte de regressão.
  - **Sem registro, vale `coordinate`.** Esse é o comportamento atual, e o mantenedor o escolheu como padrão.
  - A alteração vem só do renderer, por IPC. Não existe ferramenta MCP que mude a chave.
- **Efeito:** só na **próxima** run da principal. A run em andamento não muda de permissão, porque trocar permissões de um CLI no meio da sessão não é confiável. O cartão de iniciar a principal mostra o modo em que ela vai rodar.
- **Modo `auto`, por CLI:**
  - **OpenCode:** a principal usa as permissões normais do CLI, sem `orchestratorPermission()`. As instruções e a ponte continuam.
  - **Claude Code:** sem a restrição de `--tools`. As permissões ficam nos modos do próprio Claude Code, que o usuário controla no terminal.
  - **Codex:** sandbox `workspace-write`, com a aprovação padrão do CLI.
  - **Gemini:** permissões normais do CLI, sem o perfil somente leitura, com a aprovação padrão dele.
  - **Kimi:** como a principal Kimi está bloqueada nas versões 2.4.0/2.4.1, o modo `auto` vale quando ela voltar.
- **O que continua protegido no modo auto:** o modo libera edição e comandos, nas permissões normais do CLI. As outras proteções da principal continuam:
  - a leitura de `.env` continua negada **nas ferramentas de arquivo**. Com shell, qualquer CLI consegue ler o `.env`, como os agentes já conseguem hoje, e o aviso da chave diz isso (ajuste da fase 1);
  - a configuração do repositório que inicia processos continua ignorada, ou seja, hooks, plugins e servidores MCP do projeto;
  - a única ponte MCP é a do ATLAS.

  Os smokes cobrem esses casos negativos nos dois modos.
- **O cartão só mostra o modo.** Não há troca por run: o cartão traz um link para a configuração do projeto, e a mudança vale para a próxima execução.
- **Perfil no modo auto:** um parágrafo a mais diz que ela pode fazer sozinha alterações pequenas e claras na pasta do projeto, e delega o resto. Trabalho que pode conflitar com agentes vai para uma worktree. Ela avisa ao usuário que essas edições não passam pela revisão de tarefa nem pela suíte. O usuário pode pedir "faça você" ou "delegue" a qualquer momento.
- **Interface:** a chave fica junto da configuração da principal do projeto. A tela segue `design-system/atlas/MASTER.md` e invoca ui-ux-pro-max e apple-design. Ela traz um texto curto que explica o que muda, e avisa que as edições da principal não passam por revisão.

### 3. Revisão cruzada

- **Autoria registrada pelo sistema:** `tasks_list` ganha, por tarefa, `workedBy`, a lista distinta de `{ adapter, model, function }` das runs que já tiveram o claim da tarefa.
  - Os dados vêm das runs, que já guardam CLI e modelo (migration 9), e da função do pedido de agente que criou a sessão. Nunca vêm do que o agente diz de si.
  - A função entra para separar quem escreveu de quem revisou. Sem ela, um revisor que pegou o claim apareceria como autor.
- **O que conta como "mesma IA":** o mesmo adaptador e o mesmo modelo, comparados sem diferença de maiúsculas e espaços.
  - Quando o modelo não foi registrado (padrão do CLI ou troca pela TUI que o ATLAS não captou), basta o mesmo adaptador. O aviso então diz que o modelo é desconhecido.
  - O ATLAS não tenta reconhecer apelidos como `opus` e `claude-opus-5-5` como o mesmo modelo.
- **Funções com CLI e modelo:** `agent_functions_list` passa a incluir `adapter` e `model` de cada função, ou `null` quando a função não está configurada.
- **Perfil da principal:**
  - para revisar uma tarefa, prefira uma função cuja IA seja diferente das que aparecem em `workedBy`;
  - se nenhuma for diferente, peça mesmo assim e diga isso no propósito;
  - o usuário decide no cartão.
- **Cartão de aprovação (segunda proteção):**
  - quando o pedido tem `taskId` e o CLI e o modelo preenchidos coincidem com alguma entrada de `workedBy` de **outra função**, o cartão avisa "mesma IA que já trabalhou nesta tarefa como <função>". As entradas da mesma função do pedido não contam, para que uma segunda revisão não acuse o primeiro revisor;
  - o aviso não bloqueia: o usuário pode aprovar assim mesmo;
  - o ATLAS não troca a escolha sozinho.

### 4. Imagens

Não há ferramenta nova. O usuário cria uma função, por exemplo "Imagem", com descrição e ligada ao Codex. A principal escolhe pela descrição, como já faz. Os arquivos gerados ficam na pasta ou worktree do agente, e o resultado passa pela revisão de tarefa de sempre.

## Fases (depois da aprovação)

Cada fase tem branch, PR e CI verde em Ubuntu e Windows.

1. **Investigação sem API** (feita para Claude Code e Codex em 08/11/2026; resultado em `docs/diagnosticos/CLAUDE_CODEX_FASE1.md`), só fixtures e homes isolados:
   - confirmar as flags e as chaves de configuração acima nos três CLIs (o Gemini depois que o mantenedor instalar);
   - confirmar o token por ambiente, o bloqueio de `.env` e de shell na principal, a lista de modelos e o `/model`.
   - O resultado vai para `docs/diagnosticos/`, e este plano é ajustado se algo não se confirmar.
2. **Adaptador Claude Code:**
   - agente e principal somente leitura;
   - `smoke:claude`, opt-in;
   - testes de `launchFor`;
   - interface do cartão para modelo digitado.
3. **Adaptador Codex:**
   - agente e principal, se a fase 1 permitir;
   - `smoke:codex`, opt-in;
   - testes.
4. **Adaptador Gemini:**
   - agente e principal, conforme a fase 1;
   - `smoke:gemini`, opt-in;
   - testes.
5. **Chave "Principal só coordena":**
   - banco, IPC, modo `auto` por CLI e interface;
   - perfil e `AGENTS.md`;
   - `test:desktop`.
6. **Revisão cruzada:**
   - `workedBy` em `tasks_list`;
   - CLI e modelo em `agent_functions_list`;
   - aviso no cartão, perfil e `AGENTS.md`;
   - `test:agent` e `test:desktop`.
7. **Documentação:** `CONTEXTO.md`, `ROADMAP.md` e este plano como entregue.

## Fora deste plano

- Outros CLIs além de Claude Code, Codex e Gemini (v0.3).
- Modos "nunca delega" e "sempre pergunta".
- Aprovação em conjunto de vários agentes, ou qualquer política além do modo assistido.
- Escolha automática de CLI ou modelo pelo ATLAS.
- Lista curada de modelos para os novos CLIs: continua adiada, como a recomendação por função.
- Anexar sessões externas.

## Escolhas do plano, a conferir pelo mantenedor

Estas não vieram da conversa. Foram decididas ao escrever o plano:

- Sem ponte por token em ambiente, o CLI entra só como sessão manual. O token nunca vai na linha de comando.
- O Gemini só é verificado depois que o mantenedor instalar o CLI. O ATLAS não o instala.
- O Codex só vira principal se houver prova de que a escrita é recusada. A fase 1 não achou essa prova: `apply_patch` continua declarado, e sem shell o Codex não lê arquivos. **Nesta entrega, o Codex é só agente.**
- O modo auto mantém o bloqueio de `.env`, a configuração do repositório ignorada e a ponte MCP única.
- O cartão só mostra o modo da principal, sem troca por run.
- `workedBy` guarda a função, e o aviso ignora as entradas da mesma função do pedido.
- "Mesma IA" é o mesmo adaptador e o mesmo modelo, sem reconhecer apelidos.
- Os novos CLIs aceitam modelo digitado quando não têm lista.

## Deixado para quem implementar

- Os nomes de colunas, tabelas e migrations.
- O texto exato do perfil e dos avisos, desde que diga o que este plano pede.
- A organização dos smokes, desde que usem só fixtures e homes isolados.
