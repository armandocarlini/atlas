# Plano v0.2: várias equipes no mesmo repositório

Situação: **proposto em 08/11/2026, aguardando aprovação do mantenedor.** Muda a invariante "identidade única da principal por projeto". Nada é implementado antes da aprovação.

É a fase 5 de `docs/planos/PLANO_IDENTIDADE_VISUAL.md`. Complementa `docs/planos/PLANO_V0_2_EQUIPE_MULTI_IA.md` sem substituí-lo:

- o plano multi-IA decide **quais IAs** compõem uma equipe;
- este decide **quantas equipes** trabalham num mesmo repositório, e como elas não se atrapalham.

## Por que

O exemplo é o próprio desenvolvimento do ATLAS em 08/11/2026. No mesmo repositório, ao mesmo tempo:

- um agente segue com os planos do projeto (adaptadores Claude Code e Codex);
- outro trabalha nas mensagens estruturadas;
- um terceiro trabalha na interface e neste plano.

Hoje quem cuida para que eles não se atrapalhem é o usuário. Ele avisa cada agente de que existe outro, isola um deles numa worktree à mão e torce para que ninguém faça commit por cima do outro ou edite o mesmo arquivo na mesma branch.

O objetivo é o ATLAS cuidar disso sozinho:

- o usuário cria uma equipe por frente de trabalho, por exemplo "Interface", "Adaptadores" e "Mensagens";
- cada equipe tem a sua principal e os seus agentes;
- o ATLAS garante que cada trabalho aconteça num lugar próprio, percebe cedo quando duas equipes vão mexer no mesmo arquivo e faz as principais combinarem a ordem;
- o usuário só decide quando há conflito real. Ele não precisa saber, nem avisar, que existe outra equipe.

## O que já protege hoje e o que falta

**Já protege, dentro de uma equipe:**

- cada tarefa delegada com `worktree: true` ganha uma worktree e uma branch próprias (`atlas/task-…`), criadas só na aprovação;
- o claim com `claim_epoch` impede que dois agentes peguem a mesma tarefa;
- a principal é somente leitura por padrão;
- não há merge automático.

**Falta:**

1. **Uma só principal por repositório.** A segunda frente de trabalho não tem quem a coordene.
2. **Tarefa sem worktree, sessão manual e principal no modo auto** (plano multi-IA) trabalham na pasta do projeto. Duas delas na mesma pasta editam a mesma árvore e a mesma branch: é o "commit um em cima do outro".
3. **Ninguém vê sobreposição de arquivos entre worktrees.** Duas tarefas podem mudar `src/App.jsx` em branches diferentes, e o conflito só aparece na hora de integrar, quando o usuário já está no meio do merge.
4. **As principais não conversam.** As mensagens existem, mas só entre sessões da mesma principal.

## Decisões propostas (a aprovar pelo mantenedor)

### 1. Equipe dentro do projeto

- **O que muda:**
  - um projeto (repositório) passa a ter **uma ou mais equipes**;
  - cada equipe tem nome, objetivo curto, principal própria, tarefas, pedidos, agentes e mensagens.
- **O que fica:**
  - o projeto continua sendo a pasta autorizada;
  - o Git continua sendo lido somente leitura.
- **Migração sem perda:** todo projeto existente ganha uma equipe com o nome do projeto, e tudo o que já existe passa a ser dela. Quem nunca criar outra equipe não vê diferença nenhuma, além do nome da equipe na interface.
- **Criar, renomear e arquivar equipes:**
  - só pela interface, nunca por ferramenta MCP;
  - arquivar não apaga nada e só é possível sem runs ativas.
- **Invariante nova:** "identidade única da principal **por equipe**". As regras da principal continuam iguais em cada equipe:
  - nova run explícita após a saída, com nova escolha de CLI e modelo;
  - delegação por `tasks_delegate`;
  - modo da chave "Principal só coordena".

### 2. Lugar próprio para cada trabalho (evitar a causa)

A regra é: **dois trabalhos de equipes diferentes nunca escrevem na mesma árvore de arquivos.**

- **Projeto com mais de uma equipe ativa:**
  - o pedido de agente com tarefa vem com `worktree: true` marcado;
  - o usuário ainda pode desmarcar no cartão, mas o cartão avisa que outra equipe trabalha no repositório.
- **Sessão na pasta do projeto:**
  - uma sessão manual, ou uma tarefa sem worktree, que vai rodar na pasta do projeto (a árvore principal) enquanto outra sessão de **outra equipe** já roda nela pede confirmação;
  - o cartão mostra quem já está lá e oferece abrir a sessão numa worktree.
  - O ATLAS **não bloqueia**: o usuário decide.
- **Principal no modo auto** (plano multi-IA): com mais de uma equipe ativa, as edições da principal vão para uma worktree da equipe, criada com a confirmação do usuário na primeira vez. A principal no modo "só coordena" não escreve, então não precisa disso.
- **Fora do alcance:** o ATLAS só vê o que roda dentro dele. Um agente aberto num terminal externo continua invisível. Anexar sessões externas é outro item do `ROADMAP`.

### 3. Mapa de arquivos e colisões (perceber cedo)

- **Mapa:** o ATLAS mantém, por worktree ativa e pela árvore principal, a lista de arquivos alterados.
  - Os arquivos são os commits desde a base, mais o que está modificado e ainda não foi commitado.
  - A leitura é **somente leitura**, reaproveitando o leitor Git endurecido de `electron/git-evidence.cjs`.
  - Ela acontece em intervalos, com limite de tempo, e quando a run informa progresso ou pede revisão.
- **Colisão:** é o mesmo caminho alterado em dois lugares de **equipes diferentes**.
  - Colisões dentro da mesma equipe aparecem só para a principal dela, que já coordena as próprias tarefas.
  - Colisão é um fato observado no Git, nunca uma afirmação de agente.
- **Reservas de área**, opcionais e consultivas:
  - a principal pode reservar caminhos ou padrões (por exemplo, `src/styles.css` ou `electron/adapters/**`) antes de delegar;
  - uma reserva que cruza a de outra equipe vira colisão "prevista", antes de alguém editar;
  - o ATLAS não impede a escrita em disco, nem pode. A reserva serve para as principais combinarem antes.
- **Arquivos comuns:** uma lista por projeto de arquivos que quase sempre colidem, por exemplo `package-lock.json`, `docs/ROADMAP.md` e `docs/CONTEXTO.md`. O usuário edita a lista. Para esses arquivos, a colisão vira aviso de integração ("integre um depois do outro"), não pedido de decisão.

### 4. Coordenação entre principais (combinar a ordem)

- **Conversa entre principais:** mensagens entre as principais de equipes diferentes.
  - São mensagens persistidas com entrega e leitura, como as de hoje, e **nunca digitadas no terminal**.
  - A principal recebe pelas ferramentas de sempre (`messages_unread`).
- **Colisão:** as duas principais recebem a colisão e propõem uma **ordem de integração**. A ordem diz qual equipe integra primeiro, e a outra atualiza a branch dela depois.
  - Se as duas propõem a mesma ordem, o cartão mostra a proposta já combinada.
  - O **usuário aprova, inverte ou adia** num cartão "Coordenação", no mesmo padrão dos pedidos de agente.
- **O ATLAS nunca faz merge, rebase nem commit.** A ordem aprovada:
  - aparece para as duas equipes;
  - aparece na revisão da tarefa ("integrar depois da equipe Interface");
  - entra na checklist de integração do usuário.
- **Sem resposta:** se as principais não respondem (CLI fechado, por exemplo), a colisão continua visível para o usuário, sem prazo que decida sozinho.

### 5. O que cada principal vê pela ponte MCP

A ponte continua presa ao token da run. Hoje ela oferece dados do projeto; passa a oferecer:

- tudo da **própria equipe**: tarefas, sessões e mensagens, como hoje;
- das **outras equipes**, só o necessário para coordenar:
  - nome e objetivo;
  - principal (nome, sem token);
  - reservas;
  - arquivos alterados que colidem com a equipe;
  - ordens de integração.
- **Não vê:** tarefas, mensagens ou descrições internas das outras equipes.
- **Ferramentas novas da principal:**

  | Ferramenta | Para quê |
  |---|---|
  | `coordination_status` | Equipes, reservas, colisões e ordens |
  | `areas_reserve` / `areas_release` | Reservar e liberar áreas |
  | `coordination_propose_order` | Propor a ordem de integração |
  | Destino "principal da equipe X" | Mandar mensagem a outra equipe com `messages_send` |

  Nenhuma delas aprova, mescla ou altera Git.
- **Agentes** de uma equipe não veem as outras. Quem coordena é a principal.

### 6. Interface (segue a identidade visual)

- **Abas de equipe** na barra do projeto, como no protótipo. Cada aba mostra:
  - a principal;
  - um ponto de estado;
  - uma marca quando há colisão esperando o usuário.
- **Cartão "Coordenação"** junto dos pedidos de agente. Mostra:
  - o arquivo;
  - as duas equipes;
  - a proposta das principais;
  - os botões Aprovar ordem, Inverter e Ver.
- **Painel de coordenação** com:
  - o mapa de quem mexe em quê;
  - as reservas;
  - a fila de integração;
  - a lista de arquivos comuns.
- **Cabeçalho do terminal:** o terminal de cada sessão mostra a equipe e o lugar onde trabalha (worktree ou pasta do projeto).
- **Telas:** seguem `design-system/atlas/MASTER.md` e invocam ui-ux-pro-max e apple-design.

## Invariantes

**Muda:**

- **Antes:** "identidade única da principal por projeto".
- **Depois:** "identidade única da principal por equipe; um projeto tem uma ou mais equipes".

**Continua:**

- aprovação humana de cada agente;
- só o usuário conclui;
- sem merge, rebase ou commit automáticos;
- worktrees só pela aprovação do usuário;
- o ATLAS nunca remove worktrees nem branches;
- mensagens nunca digitadas no terminal;
- descoberta Git somente leitura;
- ponte inerte fora do ATLAS e identidade vinda só do token;
- nenhum CLI ou modelo padrão.

O `AGENTS.md` é reescrito na fase que mudar a invariante.

## Encaixe com o plano multi-IA

- **Ordem:**
  - os dois planos mexem no banco, no `mcp-host` e no perfil da principal;
  - para não colidirem (o problema que este plano resolve), as fases daqui começam **depois** da fase 5 do plano multi-IA (chave "Principal só coordena");
  - a numeração das migrations é decidida na hora, sobre a `main` atualizada.
- **Modo auto com várias equipes:** a decisão 2 vale para o modo auto daquele plano. Com mais de uma equipe, a principal edita numa worktree da equipe.
- **Revisão cruzada:** `workedBy` continua por tarefa. Tarefas são sempre de uma equipe.

## Fases (depois da aprovação)

Cada fase tem branch, PR e CI verde em Ubuntu e Windows.

1. **Equipes no banco:**
   - migration (equipes, `team_id` em sessões, runs, tarefas, pedidos e mensagens, e a principal única por equipe);
   - migração de cada projeto para uma equipe;
   - IPC e a ponte filtrada pela equipe do token;
   - `test:agent` com casos de isolamento: uma equipe não lê tarefas nem mensagens da outra, e o token de uma não age na outra.
2. **Interface das equipes:**
   - abas, criar, renomear e arquivar;
   - principal por equipe;
   - `test:desktop`.
3. **Lugar próprio:**
   - worktree marcada por padrão com várias equipes;
   - confirmação de sessão na mesma árvore de outra equipe;
   - worktree da principal no modo auto, se aquele plano já tiver entregado o modo;
   - testes e regressões.
4. **Mapa e colisões:**
   - leitura periódica somente leitura, com limites e fixture com duas worktrees que alteram o mesmo arquivo;
   - reservas e arquivos comuns;
   - `coordination_status`.
5. **Coordenação:**
   - mensagens entre principais;
   - propostas de ordem e cartão "Coordenação";
   - ordem na revisão;
   - perfil da principal e `AGENTS.md`.
6. **Documentação:** `CONTEXTO.md`, `ROADMAP.md` e este plano como entregue.

## Escolhas a conferir pelo mantenedor

1. Equipe dentro do projeto, sem projeto duplicado para a mesma pasta.
2. Com várias equipes, a worktree vem marcada no pedido, mas o usuário pode desmarcar. Sessão na mesma árvore de outra equipe pede confirmação e não é bloqueada.
3. Reservas consultivas, sem bloqueio de escrita.
4. Colisão é só entre equipes diferentes. Dentro da equipe, fica com a principal.
5. A principal vê das outras equipes só o necessário para coordenar.
6. Arquivos comuns editáveis, com `package-lock.json`, `docs/ROADMAP.md` e `docs/CONTEXTO.md` sugeridos.
7. Este plano começa depois da fase 5 do plano multi-IA.

## Fora deste plano

- Sessões abertas fora do ATLAS (item "Anexar sessões externas").
- Merge, rebase ou resolução automática de conflito.
- Equipes entre repositórios diferentes.
- Limites de quantas equipes um projeto pode ter, além do bom senso da interface. Se for preciso, entra na fase 2.
