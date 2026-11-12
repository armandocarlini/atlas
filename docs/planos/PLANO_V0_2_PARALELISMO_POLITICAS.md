# Plano: item 5 da v0.2, paralelismo, políticas e sessões externas

Situação: pedido pelo mantenedor em 12/11/2026 ("faça o item 5"), executado na ausência dele. As escolhas marcadas **(decisão do agente)** foram tomadas sem consulta e ficam abertas à revisão; todas começam desligadas ou com os valores de hoje, de modo que nada muda para quem não abrir as configurações.

## Por quê

A v0.1 fixou o modo assistido com limites rígidos: até 2 agentes pedidos pela principal em execução, até 3 pedidos aguardando e aprovação humana de cada pedido. Com tarefas, worktrees e o início automático do agente aprovado (PR #90), a principal já coordena de verdade; o que falta é deixar a equipe crescer quando o usuário quiser e permitir que ele delegue as aprovações rotineiras dentro de limites que ele mesmo define. A arquitetura (seção 10) prevê três modos: manual, assistido e autônomo controlado.

## Fase 1. Política de agentes por projeto

Um diálogo "Política de agentes", na área Estado do projeto, ao lado da suíte de regressão. Só o usuário altera, pela janela principal; a ponte MCP só lê o que precisa.

### Paralelismo ampliado

- **Agentes ativos ao mesmo tempo** (pedidos pela principal): 1 a 6, padrão 2.
- **Pedidos aguardando:** 1 a 6, padrão 3.
- Sem configuração, valem os limites atuais. A validade de 15 min e a profundidade 1 não mudam.
- O teto de 6 é **(decisão do agente)**: cada agente é um CLI com modelo pago, e uma máquina comum fica lenta com muitos terminais.

### Modo autônomo controlado

- **Assistido** (padrão): o usuário aprova cada pedido, como hoje.
- **Autônomo controlado:** o ATLAS aprova sozinho o pedido que cumpre **todas** as regras abaixo. O que não cumpre continua esperando o usuário, com o motivo no cartão.
  - tem tarefa e `worktree: true`: a escrita fica isolada numa worktree nova;
  - indica uma função que já tem CLI salvo (e modelo, quando o CLI lista modelos): o ATLAS usa exatamente o que o usuário salvou, nunca uma escolha da principal;
  - cabe no limite de agentes ativos do projeto.
- Quando um agente pedido pela principal termina e libera vaga, o ATLAS reavalia os pedidos pendentes do projeto.
- Desligar o modo (voltar a Assistido) é a pausa: aprovações automáticas param na hora; agentes em execução seguem até o usuário encerrá-los.
- A aprovação automática fica registrada como `resolved_by = 'policy'` e com evento próprio, e a interface avisa cada agente iniciado assim.
- **Não muda:** só o usuário conclui tarefas, não há merge, push nem remoção de worktree automáticos, e as permissões de cada CLI continuam as dele, sem flags de autonomia. Exigir tarefa com worktree é **(decisão do agente)**: sem isolamento, dois agentes automáticos poderiam escrever na mesma pasta.

### Banco

Migration 17, `agent_policies` (projeto, modo `assisted` ou `autonomous`, limites, versão), e `resolved_by` aceita `policy`. Sem linha, a política é a de hoje.

## Fase 2. Anexar sessão externa

Um CLI aberto fora do ATLAS (por exemplo, no Terminal do Windows) entra na equipe do projeto: recebe mensagens, ofertas de tarefa e pode pedir revisão, como um agente criado pelo ATLAS.

- "Anexar sessão externa" (paleta e menu de nova sessão) pede nome, CLI e, opcionalmente, função. O ATLAS registra a sessão com origem `external`, abre uma run e gera o comando para conectar.
- O comando é um script PowerShell no perfil do ATLAS que define o endpoint e o token da run só naquele processo e inicia o CLI escolhido com a ponte do ATLAS, do mesmo jeito que a run interna (arquivo `--mcp-config` no Claude Code, `-c` no Codex, `OPENCODE_CONFIG_CONTENT` no OpenCode; Kimi e Gemini usam a entrada consentida, que já lê o endpoint e o token do ambiente).
- O card da sessão externa não tem terminal: mostra se a ponte está conectada, o comando para copiar e "Desanexar", que revoga o token, encerra a run e libera o claim, como o fim de qualquer run.
- Ao fechar o ATLAS a run termina; a sessão externa não é reaberta sozinha, porque o processo não é do ATLAS.
- O script fica no perfil do app, nunca no repositório, e é apagado ao desanexar. Ele contém o token da run; a fronteira de confiança continua sendo o usuário local, como no ambiente do PTY.

## Invariantes alteradas (`AGENTS.md`)

- "Aprovação humana": existe um modo autônomo controlado, desligado por padrão, ligado só pelo usuário por projeto e restrito às regras acima.
- "Sessões": uma sessão externa anexada participa da colaboração sem PTY do ATLAS.

## Testes

- Store: política padrão, limites válidos, recusa de valores fora da faixa, modo inválido e projeto alheio; `requestAgent` usa os limites do projeto; aprovação pela política registrada como `policy`.
- Aprovação automática: aprova só o pedido elegível, com o CLI e o modelo da função; deixa pendente com motivo o que não tem tarefa, worktree, função configurada ou vaga; reavalia quando uma vaga abre; desligar o modo para tudo.
- Sessão externa: registro, token, script sem segredo fora do perfil, desanexar revoga e libera claim, reinício não reabre.
- `test:desktop`: diálogo da política (teclado, foco, contraste), cartão com o motivo e card da sessão externa.
