# Plano — delegação de tarefas por handoff (marco 4c-1)

Objetivo: cumprir o passo 7 do aceite da v0.1 ("o orquestrador delega uma tarefa relacionada ao terceiro agente") com handoff estruturado, claim com fencing e progresso visível, sem ampliar permissões. Worktrees sob política ficam no 4c-2. Revisão e conclusão (`in_review`, `done`) ficam no marco 5.

## Regras

- Só a sessão principal oferece handoffs (profundidade 1). O destino é uma sessão de agente do mesmo projeto, com run ativa, nunca a própria principal.
- Uma tarefa tem no máximo uma oferta aberta. Só tarefas `backlog` ou `ready` sem responsável podem ser oferecidas; a oferta move `backlog` para `ready`.
- O handoff contém objetivo, contexto e próximos passos escritos pela principal. É dado não confiável para o destinatário e não transfere permissões: o agente continua sob o harness do Kimi.
- Aceitar é um ato do agente de destino, identificado pelo token da run. O aceite grava responsável, run do claim e um `claim_epoch` crescente, e move a tarefa para `in_progress`.
- Progresso, bloqueio, retomada e devolução exigem o claim atual: mesma sessão e mesma run. Uma run encerrada ou perdida perde o claim (`task.claim_lost`); a tarefa não volta sozinha para `ready` nem avança, porque o estado real do trabalho é incerto.
- O usuário pode cancelar uma oferta aberta e devolver uma tarefa em andamento para `ready` pela interface. Devolver incrementa o epoch, o que invalida o claim anterior.
- Nada aqui conclui tarefas: `run.succeeded` não implica `done`.

## Máquina de estados coberta

```text
backlog --oferta--> ready --aceite--> in_progress <--> blocked
                      ^                    |              |
                      +---- devolução -----+--------------+
```

## Implementação

1. **Migration 6:** `tasks` ganha `assigned_session_id`, `claim_run_id`, `claim_epoch` e `blocked_reason`; nova tabela `handoffs` (`offered`, `accepted`, `rejected`, `canceled`) com índice único de oferta aberta por tarefa.
2. **Store (`electron/task-delegation.cjs`):** `offerHandoff`, `acceptHandoff`, `rejectHandoff`, `cancelHandoff`, `updateTask`, `releaseTask`, `listHandoffs` e perda de claim no fim da run e na reconciliação. Oferta é comando idempotente com ator `agent:<sessão>`; eventos `handoff.offered/accepted/rejected/canceled`, `task.ready`, `task.assigned`, `task.progress`, `task.blocked`, `task.unblocked`, `task.released` e `task.claim_lost`.
3. **MCP:** principal recebe `tasks_delegate` e `handoffs_cancel`; agentes recebem `handoffs_pending`, `handoffs_accept`, `handoffs_reject`, `tasks_update` e `tasks_release`. `tasks_list` passa a mostrar responsável e bloqueio.
4. **Interface:** o painel de tarefas mostra estado, responsável, oferta aberta com objetivo e bloqueio, com as ações "Cancelar oferta" e "Devolver tarefa". Atualiza por evento `task:changed`.
5. **Perfil da principal:** instruções para delegar com `tasks_delegate` e acompanhar por `tasks_list`, sem afirmar aceite antes de ele ocorrer.

## Testes

- Store: migration 5→6 preservando dados; papéis e projeto; oferta duplicada e idempotência; aceite só pelo destino com run ativa; fencing após devolução e após fim da run; transições inválidas; textos não confiáveis com controles invisíveis.
- MCP com ponte real: lista de ferramentas por papel; fluxo delegar → pendente → aceitar → progresso → bloqueio → retomada → devolução.
- Desktop: painel com oferta e tarefa em andamento semeadas, contraste, cancelar e devolver.
