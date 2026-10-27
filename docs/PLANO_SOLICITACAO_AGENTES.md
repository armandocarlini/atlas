# Marco 4b-2 — orquestrador pede agentes dentro da política

Base: `main` sincronizada após PR #15 (ponte MCP com consentimento), CI Ubuntu/Windows verde na execução 40429020566. Este plano cobre o passo 5 do aceite da v0.1 ("o orquestrador cria um terceiro agente dentro da política aprovada"). Nada aqui está concluído por antecipação.

## Política da v0.1

O modo é **assistido** (seção 10.1 da arquitetura). A principal propõe e o usuário aprova cada agente. A política padrão do projeto, exibida no próprio pedido, é:

- só a sessão principal (papel `orchestrator`) pode pedir agentes; agentes criados não pedem outros (profundidade 1);
- no máximo 3 pedidos pendentes por projeto;
- cada pedido vale 15 minutos;
- no máximo 2 agentes criados pela principal em execução ao mesmo tempo no projeto;
- o agente nasce no diretório do projeto, com o Kimi interativo, sem flags de autonomia, sem prompt inicial e com permissões no harness.

## Fluxo vertical

1. **Persistência (migration 5):** tabela `agent_requests` com projeto, sessão solicitante, nome, propósito, hash do payload, estado (`pending`, `approved`, `rejected`, `expired`, `fulfilled`, `failed`), validade, resolução, sessão criada, erro e versão. O pedido é um comando idempotente (`agent.request`), com ator `agent:<sessão>` e chave prefixada pela sessão. Eventos: `approval.requested`, `approval.resolved`, `approval.fulfilled` e `approval.failed`; a criação da sessão continua registrada por `session.created`.
2. **Ferramentas MCP:** `agents_request` (nome e propósito) e `agents_request_status`. A lista de ferramentas passa a depender do papel: sessões de agente não veem `agents_request`, e o host recusa a chamada mesmo assim.
3. **Aprovação (`electron/agent-request-host.cjs`):** IPC `agent-request:list`, `agent-request:approve` e `agent-request:reject`, só da janela principal e em pasta autorizada. Aprovar exige o `payloadHash` exibido ao usuário. No ponto de execução, o host revalida pendência, validade, hash e limite de agentes ativos antes do spawn. O agente nasce com origem `orchestrator`. Falha de spawn vira `failed` com motivo, sem sessão fictícia.
4. **Interface:** cartão de pedido pendente no workspace com solicitante, nome, propósito (exibido como texto não confiável), validade e política, mais as ações Recusar e Aprovar e iniciar, com erro inline e estado de envio. O card do novo agente mostra a origem `orquestrador`.

## Fora de escopo

Delegar ou atribuir tarefas ao agente criado, handoffs e worktrees ficam para o 4c. Não há modo autônomo controlado nem aprovação automática.

## Verificação

- Store: migration 4→5 preservando dados, idempotência e ator, papel do solicitante, limite de pendentes, expiração, hash divergente, transições inválidas e eventos.
- MCP: lista de ferramentas por papel, recusa para sessões de agente, isolamento entre projetos no status.
- Host de aprovação: janela e pasta não autorizadas, hash divergente, expirado, limite de agentes ativos no ponto de execução, falha de spawn virando `failed`, origem `orchestrator`.
- Smoke desktop: pedido pendente na interface, recusa e aprovação com falha honesta sem CLI.
- Smoke real do Kimi: pedido aprovado pela interface inicia o Kimi real com origem `orchestrator` e ponte conectada, sem prompt ao modelo.
- Gates: `npm test`, `npm run build`, `npm run check:public`, `npm run test:desktop`, `npm run test:agent`.
