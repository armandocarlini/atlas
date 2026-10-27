# Plano — worktrees sob política (marco 4c-2)

Objetivo: cumprir a parte do passo 9 do aceite da v0.1 em que o trabalho delegado ocorre em uma worktree autorizada. Evidências e revisão ficam no marco 5.

## Política da v0.1

- A descoberta Git continua somente leitura. Criar worktree é uma ação separada, explícita e aprovada pelo usuário.
- A worktree nasce de um pedido de agente da principal ligado a uma tarefa (`agents_request` com `taskId` e `worktree: true`). O cartão de aprovação mostra a tarefa, o caminho e a branch que serão criados; nada é criado antes da aprovação.
- Caminho: `<repositório>.atlas-worktrees/task-<id curto>`, ao lado do repositório e fora dele. Branch: `atlas/task-<id curto>`, criada a partir do HEAD atual do repositório principal do projeto. Caminho ou branch já existentes recusam a criação, sem sobrescrever nada.
- O projeto precisa ter exatamente um repositório Git com commit. Projetos sem repositório, com vários repositórios ou com HEAD sem commit recusam pedidos com worktree.
- Antes de criar a worktree, o host confirma que o CLI está disponível, para não deixar worktree órfã por falta de CLI. Se o spawn falhar depois da criação, a worktree permanece e o pedido vira `failed` com o caminho no motivo.
- Uma tarefa com worktree registrada não recebe outra; a aprovação revalida se a tarefa ainda está `backlog` ou `ready`. O cartão avisa quando o caminho fica fora da pasta autorizada.
- O ATLAS nunca remove worktrees ou branches automaticamente. A worktree criada entra no escopo autorizado pela descoberta normal (`git worktree list`) e fica registrada em `worktrees` com tarefa, pedido, branch e commit-base.
- Git roda por `execFile`, sem shell, com timeout e argumentos validados (branch conferida por expressão regular e `--` antes do caminho). A descoberta continua usando `--no-optional-locks`.

## Implementação

1. Migration 7: `worktrees` (projeto, tarefa, pedido, repositório, caminho único, branch, commit-base, criação) e colunas `task_id` e `use_worktree` em `agent_requests`.
2. `electron/worktree-manager.cjs`: planejar (caminho e branch determinísticos pela tarefa) e criar com verificações.
3. Pedido e aprovação: `agents_request` aceita `taskId` e `worktree`; o hash do pedido inclui ambos. A aprovação planeja, verifica o CLI, cria, registra (`worktree.created`), atualiza a descoberta e inicia o agente com cwd na worktree.
4. Interface: o cartão mostra tarefa, caminho e branch e informa que o ATLAS não remove worktrees.

## Testes

- Gerenciador com repositórios Git temporários reais: plano, criação, branch e caminho existentes, repositório sem commit, argumentos hostis.
- Store: migration 6→7, pedido com tarefa de outro projeto ou inexistente, registro e evento.
- Host de aprovação: CLI ausente não cria worktree; falha de spawn mantém worktree e registra motivo; agente nasce com cwd na worktree.
- Smoke real opt-in: fixture Git, pedido com worktree aprovado pela interface, Kimi iniciado na worktree.
