# Plano: gestão de atenção, a fila "Precisam de mim"

Situação: **protótipo pedido pelo mantenedor em 13/11/2026, merge aguardando decisão dele.** A etapa 1 (dados) está no PR desta branch; a etapa 2 (interface) só começa depois da decisão sobre a etapa 1. As escolhas marcadas **(decisão do agente)** ficam abertas à revisão.

## Por quê

Hoje a fila "Espera você" é calculada no renderer (`atlasDecisions`, `src/atlas-panel.js`), só para o projeto ativo e só com três casos: iniciar a principal, pedido de agente pendente e revisão pendente. Com vários projetos e agentes em paralelo, o usuário precisa de um lugar só que diga, entre **todos** os projetos, o que exige decisão dele, e de um resumo do que andou desde a última visita.

## Etapa 1. Dados no processo principal (esta etapa)

Sem interface: nada muda em `src/`, e `atlasDecisions` continua como está.

### Peças

- `electron/attention.cjs`: função pura (`buildAttention`) que recebe as linhas do banco e devolve os itens e o resumo por projeto. Sem I/O.
- `electron/attention-store.cjs`: lê as linhas de todos os projetos e as preferências em `app_state`, numa transação, e grava adiar e dispensar com evento de auditoria. Espalhado no `operational-store`, como a suíte de regressão.
- `electron/attention-host.cjs`: IPC `attention:list`, `attention:snooze` e `attention:dismiss`, só pela janela principal, só para projetos em pastas autorizadas. Expostos no preload (`listAttention`, `snoozeAttention`, `dismissAttention`, `onAttentionChanged`).
- Aviso `attention:changed` ao renderer: emitido junto com `task:changed` e `agent-request:changed`, depois de adiar ou dispensar, e quando um adiamento vence ou um pedido pendente expira.
- **Nada na ponte MCP:** agentes não leem nem alteram a fila.

### Item

`{ id, kind, projectId, projectName, taskId, sessionId, title, reason, urgency, evidence: { type, id }, createdAt }`, com `id = kind:idDaEntidade`.

| kind | Quando | Sai da fila |
|---|---|---|
| `request_pending` | pedido de agente pendente e não expirado; o motivo do modo autônomo vai em `reason` | aprovado, recusado ou expirado |
| `request_failed` | pedido em `failed` | dispensado pelo usuário |
| `review_pending` | revisão pendente com tarefa `in_review`; suíte da revisão em `failed`, `timeout` ou `error` vira `urgency: 'alta'` no **mesmo** item | revisão decidida |
| `task_blocked` | tarefa em `blocked` | a tarefa muda de estado |
| `run_failed` | a última run de uma sessão não excluída terminou em `failed` ou `lost`, sem run mais nova, e não foi encerrada pelo usuário nem pelo fechamento normal | dispensado, sessão excluída ou nova run |

- Encerramento que **não** é falha: "Encerrar processo" grava `reason = 'user_closed'` na run (inclusive se o app cair depois), desanexar sessão externa fecha a run com código 0 (`succeeded`) e o fechamento normal grava `lost` com `reason = 'application_closed'`. Queda do app (`application_restarted`) é falha e aparece.
- `urgency` é `'alta'` só na revisão com suíte vermelha; o resto é `'normal'` **(decisão do agente)**.
- Ordem: `alta` primeiro, depois do mais antigo para o mais novo.
- Texto vindo de agentes (nome, propósito, título, motivo do bloqueio, erro) é dado não confiável: caracteres de controle e formatação invisível viram espaço, e o texto é cortado (título até 120, motivo até 240 caracteres).

### Resumo por projeto

Para cada projeto autorizado: tarefas concluídas desde a última visita, em andamento (`in_progress`), bloqueadas e aguardando o usuário (tarefas dos itens visíveis, exceto `task_blocked`, que tem contagem própria). Cada contagem leva os ids das tarefas.

"Última visita" é o último fechamento normal do app. A migration 15 guarda as runs fechadas, mas não o horário de um fechamento sem runs ativas; por isso `markAppClosed` passa a gravar `last_normal_close_at` em `app_state`. Em bancos anteriores, vale o `ended_at` mais recente das runs `application_closed`; sem nenhum dos dois, `lastVisitAt` é `null` e nada conta como concluído desde a visita.

### Adiar e dispensar

- Em `app_state` (`attention.snoozed`, `attention.dismissed`), JSON validado na leitura: valor corrompido vale como vazio e não derruba a lista.
- **Adiar** (qualquer item): some até a data e volta sozinho. Prazo até 30 dias **(decisão do agente)**.
- **Dispensar**: só `request_failed` e `run_failed`. Os demais saem apenas quando a entidade muda de estado.
- Entradas de itens que não existem mais, adiamentos vencidos e entradas inválidas são limpos na leitura.
- Cada ação grava `attention.snoozed` ou `attention.dismissed` em `audit_events`. Repetir a mesma ação não grava de novo.
- Sem migration: os estados existentes não mudam.

## Etapa 2. Interface (depois da decisão sobre a etapa 1)

- Painel "Precisam de mim" com os itens de todos os projetos, agrupados por projeto, com a ação que resolve cada um (abrir o cartão do pedido, a revisão, a sessão) e os botões adiar e dispensar.
- Resumo por projeto na abertura ("desde a sua última visita").
- Substituir ou alimentar "Espera você" a partir de `attention:list`; o caso "iniciar a principal" continua no renderer.
- Passa por `ui-ux-pro-max`, `apple-design` e `design-system/atlas/MASTER.md`, com `test:desktop`.

## Etapa 3. Briefing

Em 13/11/2026 o mantenedor decidiu que o usuário pode enviar o texto que escreveu no Briefing ao terminal de uma sessão de agente do projeto escolhida por ele, incluindo a principal. O ATLAS cola o texto e envia Enter por ação explícita do usuário na janela principal. Mensagens de agentes continuam fora dos terminais e a ponte MCP não oferece envio. O banco registra projeto, sessão, run e tamanho, sem o texto.

O Briefing usa a fila de atenção e mostra até seis fatos por projeto desde o último fechamento normal, com a contagem dos restantes. Os fatos vêm de conclusão de tarefa, pedido de revisão, término de run e resultado da suíte de regressão. O estado atual combina a run registrada, o PTY vivo e o claim da tarefa. Sessões anexadas aparecem sem opção de envio. Sem colagem protegida, o envio aceita uma única linha.
