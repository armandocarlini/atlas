# Aceite da v0.1 — demonstração dos 12 passos (marco 6c-2)

Demonstração feita em 27/10/2026 no Windows 11, com o ATLAS **instalado** pelo instalador do marco 6b, gerado da `main` em `2b91c80`. O projeto era descartável, `atlas-demo-aceite`: um repositório Git com `calc.mjs`. As três sessões usaram o OpenCode 1.18.21 com `nvidia/minimaxai/minimax-m3.1-flash`, um modelo gratuito da NVIDIA que o usuário já tinha configurado no OpenCode, escolhido por responder rápido e chamar ferramentas corretamente. Nenhum CLI nem modelo veio pré-selecionado; a escolha foi feita em cada sessão.

O agente operou a interface pela porta de depuração do Chromium (CDP) e escreveu nos terminais pelo mesmo IPC que o xterm usa quando o usuário digita. O que difere do uso manual está nas observações de cada passo.

## Passos

| # | Passo | Resultado |
|---|---|---|
| 1 | Botão direito → "Abrir no ATLAS" | A entrada foi adicionada em "Aparência e configurações", com confirmação. A instalação silenciosa responde "não" à pergunta do instalador. O menu de contexto real da pasta passou a listar **"Abrir no ATLAS"**. O verbo foi disparado pelo shell do Windows (`Shell.Application` → `InvokeVerb('ATLAS.Open')`), o mesmo caminho do clique. A instância aberta recebeu a pasta e pediu confirmação antes de cadastrá-la. |
| 2 | ATLAS abre o projeto e apresenta a principal | Aparece "A sessão principal deste projeto ainda não foi iniciada". O usuário escolheu OpenCode e o modelo, e a principal subiu com o perfil `atlas-orchestrator` e o selo "ATLAS conectado". |
| 3 | Conversa direta com a principal | Objetivo descrito: `multiplica(a, b)` com teste. A principal leu o projeto e propôs um plano em passos, com critério de aceite, sem pedir agentes. |
| 4 | Segunda sessão manual | A tarefa foi criada no painel Tarefas. A sessão `revisor-manual` foi aberta pelo botão Sessão, com escolha explícita de CLI e modelo. |
| 5 | A principal cria um terceiro agente dentro da política | A principal usou `atlas_tasks_list` e `atlas_agents_request` com `taskId` e `worktree: true`, e informou que o pedido estava `pending`. No cartão, o usuário escolheu o CLI e o modelo e aprovou. `executor-multiplica` nasceu na worktree `…atlas-worktrees/task-70c7f602` (branch `atlas/task-70c7f602`), com origem `orchestrator`. |
| 6 | A sessão manual envia uma descoberta | O botão **Descoberta** registrou a mensagem. A principal a leu com `atlas_messages_unread` e a tratou como dado não confiável. |
| 7 | A principal delega a tarefa ao terceiro agente | `atlas_tasks_delegate` levou a tarefa de backlog para ready, com a oferta aberta. O executor usou `atlas_handoffs_pending` e `atlas_handoffs_accept`, e o painel passou a mostrar "Em andamento · executor-multiplica". |
| 8 | Alternar entre os três terminais e intervir | Os três terminais foram focados em sequência. A intervenção direta foi uma instrução escrita no terminal do executor. Observação: com a janela coberta por outras, o Chromium descarta o teclado. Por isso o texto foi pelo `terminal:write`, o mesmo canal do `onData` do xterm. |
| 9 | Trabalho em worktree com eventos e evidências | O executor implementou o código, rodou `node --test calc.test.mjs` (3/3), informou progresso e fez o commit `64027a5` na branch da tarefa. Conferido à parte: 3/3 na worktree, e a `main` do repositório intocada em `1211d11`. |
| 10 | Revisão; conclusão só pelo aceite | O executor pediu revisão. A aba Evidências mostrou o declarado (resumo e comandos com exit code) e o retrato Git verificado pelo ATLAS: 1 commit de `1211d110` a `64027a5b`, 2 arquivos, +20 −0. "Aceitar e concluir" deixou a tarefa em "Concluída por você". |
| 11 | Fechar e reabrir | Janela fechada por `WM_CLOSE` com os três agentes em execução. Nenhum processo do ATLAS ou do OpenCode restou. Em seguida o app foi aberto de novo. |
| 12 | Estado preservado e runs reconciliadas | Continuam: o projeto, a tarefa concluída, a descoberta lida, a revisão aceita e as evidências. As três sessões aparecem como "interrompida · resultado incerto", com CLI e modelo, sem processo, e a principal oferece "Nova execução". |

Trilha de auditoria do projeto no SQLite, consultada só para leitura depois de reabrir:
`project.registered`, `session.created`×3, `run.started`×3, `task.created`, `approval.requested`, `approval.resolved`, `worktree.created`, `approval.fulfilled`, `message.sent`, `message.read`, `task.ready`, `handoff.offered`, `handoff.accepted`, `task.assigned`, `task.progress`, `evidence.recorded`×2, `task.review_requested`, `task.completed`, `run.lost`×3 (motivo `application_closed`). Cada run registra `opencode` e o modelo escolhido.

As capturas de cada passo ficaram fora do repositório: mostram outros projetos locais do usuário e precisam de revisão antes de qualquer publicação.

## Limites observados

- **Abertura lenta com projetos grandes.** A janela principal só aparece depois da varredura Git de todos os projetos cadastrados: 148 s e 172 s nesta máquina, que tem um projeto com 50 worktrees. Pelo mesmo motivo, depois de criar a worktree de uma tarefa, a atualização revarre todos os projetos e o agente demora cerca de 2 minutos para iniciar. Não impede o aceite, mas é o próximo ajuste.
- **Aviso do Kimi fora de contexto.** O aviso "Ferramentas ATLAS no Kimi: não conectadas" aparece mesmo quando as sessões usam o OpenCode, que recebe as ferramentas por run.
- **Estado do pedido desatualizado na fala da principal.** Depois da aprovação, a principal disse que o pedido seguia pendente porque não consultou `atlas_agents_request_status`; na pergunta seguinte, consultou e acertou. O ATLAS não afirma nada em nome dela.
- **Aviso de atualização do OpenCode.** O OpenCode mostrou na TUI um aviso da própria atualização, dispensado com Esc. O ATLAS não atualiza nem altera o CLI.
- **Restos da demonstração.** A worktree e a branch `atlas/task-70c7f602` permanecem no projeto, porque o ATLAS não remove nada.
