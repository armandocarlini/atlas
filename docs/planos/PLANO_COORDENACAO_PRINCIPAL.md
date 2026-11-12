# Plano: coordenação real pela principal

Situação: **aprovado pelo mantenedor em 12/11/2026** (partes A e B), item 3 de "Agora" no `docs/ROADMAP.md`.

## Por quê

No primeiro uso real, com o Claude Code como principal, ela pediu o agente certo, e o usuário aprovou, mas:

- o agente abriu parado: o ATLAS inicia o CLI sem prompt inicial e nunca digita mensagens no terminal, então o usuário teve de escrever "leia e faça";
- a principal não conseguiu criar tarefas: a ponte só tinha `tasks_delegate`, para tarefas já criadas pelo usuário. O pedido saiu sem `taskId`, e não houve worktree do ATLAS nem `workedBy`; o agente criou uma worktree por conta própria.

## A. A principal cria tarefas

- Nova ferramenta `tasks_create`, só para a principal, com título, descrição e critérios de aceite.
- A tarefa nasce em `backlog`, com `created_by` = `agent:<sessão da principal>` e o mesmo ator no comando e no evento. Sem migration: a coluna já é texto.
- O store só aceita esse ator quando a sessão é a principal do projeto. A interface continua criando como `user`.
- Nada muda no fim: só o usuário conclui (`done`).

## B. O agente aprovado começa sozinho

O propósito escrito pela principal **não** vai para a linha de comando: no Windows os CLIs instalados por npm são shims `.cmd`, e o texto passaria pelo `cmd.exe`. O caminho é:

1. **Entrega pelo ATLAS, na aprovação.** Depois que o agente inicia:
   - pedido com tarefa: o ATLAS oferece a tarefa ao novo agente, em nome da principal, com o propósito do cartão como objetivo. O ator do comando é `user`, porque foi a aprovação do usuário que o gerou. Se a oferta não puder ser criada (por exemplo, já existe outra aberta), o propósito vai por mensagem e o motivo fica registrado;
   - pedido sem tarefa: o propósito vai como mensagem da principal para o agente.
   Falha na entrega não derruba o agente já iniciado e aparece no resultado da aprovação.
2. **Prompt inicial fixo**, só na run criada pela aprovação (não em sessões manuais nem ao reabrir): um texto constante do ATLAS, seguro para o `cmd.exe`, que manda o agente consultar `handoffs_pending` e `messages_unread` e começar pelo que encontrar.
   - Claude Code e Codex: argumento posicional do prompt;
   - Gemini: `-i` (`--prompt-interactive`);
   - OpenCode: `--prompt`;
   - Kimi Code: sem prompt inicial, porque o `-p` dele não é interativo. O agente Kimi continua esperando o usuário.
3. Sem flags de autonomia: as aprovações do próprio CLI continuam valendo. As mensagens seguintes continuam fora do terminal.

## Perfil da principal

Para trabalho de escrita: criar a tarefa com `tasks_create`, pedir o agente com `taskId` e `worktree: true` e esperar. A aprovação já entrega a tarefa; não é preciso delegar de novo. `tasks_delegate` continua para oferecer uma tarefa a um agente que já está em execução.

## Invariantes alteradas (`AGENTS.md`)

- "CLIs e modelos": a run criada pela aprovação de um pedido recebe o prompt inicial fixo do ATLAS.
- "Tarefas": a principal também cria tarefas, em `backlog`; só o usuário conclui.

## Testes

- Store: criação pela principal, ator registrado, recusa de sessão que não é a principal e de ator inválido.
- Ponte: `tasks_create` só para a principal; o agente recebe recusa.
- Aprovação: com tarefa, a oferta nasce para o novo agente com o propósito; sem tarefa, a mensagem; falha na oferta cai para a mensagem; falha total não marca o pedido como falho.
- Adaptadores: argumentos de prompt por CLI, texto aprovado pelo padrão seguro do `cmd.exe`, nada no Kimi, nada sem a opção e nada ao retomar conversa.
- Perfil: a principal é orientada a criar a tarefa e não delegar de novo.
