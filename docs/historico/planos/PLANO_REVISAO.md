# Plano — evidências, revisão e conclusão (marco 5a)

Objetivo: cumprir os passos 9 e 10 do aceite da v0.1. O trabalho delegado gera eventos e evidências, entra em revisão e só é concluído depois do aceite do usuário.

## Regras

- Só o responsável pede revisão: claim atual (mesma sessão e mesma run), tarefa `in_progress` e sem bloqueio. Uma revisão pendente por tarefa.
- A evidência separa declaração e verificação:
  - `agent_report` (fonte `agent`): resumo e até 20 comandos com exit code, como declarados pelo agente. É dado não confiável.
  - `git_snapshot` (fonte `system`): coletado pelo ATLAS somente com leituras Git na worktree registrada da tarefa: branch atual e esperada, commit-base, HEAD, número de commits, diffstat desde a base e arquivos fora dos commits. Sem worktree ou com falha de leitura, a evidência registra o motivo da indisponibilidade.
- Só o usuário decide: aceitar conclui (`done`, sem claim, responsável preservado no histórico, evento `task.completed` com ator, critério de aceite e evidências); pedir ajustes exige nota e devolve a tarefa a `in_progress` com o mesmo responsável, que pode pedir nova revisão.
- `run.succeeded` não implica `done`. A perda da run durante a revisão não decide nada.
- Nada faz merge, remove worktrees ou executa comandos em nome do agente.
- O retrato Git não confia no `.git` da worktree (escrito pelo agente): usa o diretório administrativo resolvido pelo repositório principal e desliga fsmonitor, diff externo e textconv. No aceite, o retrato é coletado de novo e o aceite é recusado se a worktree mudou.

## Implementação

1. Migration 8: `reviews` e `evidence`.
2. `electron/task-review.cjs` (pedido e decisão) e `electron/git-evidence.cjs` (retrato Git somente leitura).
3. MCP: `tasks_request_review` para agentes, assíncrono porque coleta o retrato Git antes de gravar; `tasks_list` mostra a última revisão. O host MCP passa a aceitar respostas assíncronas.
4. IPC `task:review-decide` só da janela principal; `task:list` inclui revisões e evidências.
5. Interface: painel Tarefas com evidências separadas ("Declarado pelo agente" e "Verificado pelo ATLAS no Git"), "Aceitar e concluir" e "Pedir ajustes" com nota; aba Evidências com as revisões reais do projeto.

## Testes

- Store: pedido com e sem claim, bloqueio, comandos inválidos, aceite, ajustes e nova revisão, perda da run, migration 7→8.
- Retrato Git com repositório e worktree reais, sem alterar a worktree; commit-base hostil recusado.
- Ponte MCP real: pedido assíncrono, papel e indisponibilidade do Git.
- Desktop: evidências visíveis, contraste, ajustes, conclusão só pelo usuário e persistência.
