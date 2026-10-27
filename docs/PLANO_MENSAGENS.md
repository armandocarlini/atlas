# Marco 4a — mensagens estruturadas entre sessões

Base: `main` sincronizada após PR #13 (orquestrador principal), CI Ubuntu/Windows verde. Este documento é o plano técnico da primeira subdivisão do marco 4 de `docs/AUTONOMIA_V0_1.md` (delegação, mensagens, handoffs e worktrees sob política). Nada aqui está concluído por antecipação.

## Fluxo vertical

1. **Persistência (migration 4):** tabela `messages` (id, project_id, from_session_id, to_session_id, kind, subject, body, created_at) e `message_deliveries` (message_id, session_id, read_at) com chaves estrangeiras e índices por projeto/destinatário. Remetente e destinatário são sessões persistidas do mesmo projeto; o usuário envia em nome de uma sessão manual neste incremento.
2. **Comando idempotente:** `message.send` registrado na tabela `commands` (marco 2c) com chave de idempotência por projeto e hash do payload; reenvio repetido retorna o mesmo resultado sem duplicar a mensagem. Eventos `message.sent` e `message.read` na trilha de auditoria, correlacionados ao comando.
3. **IPC:** `message:send`, `message:list`, `message:mark-read`, somente da janela principal, com cwd autorizado e projeto resolvido pelo `projectHost`, espelhando `task-host.cjs`. Validação: destinatário deve ser sessão do mesmo projeto; conteúdo com limites explícitos; nada de broadcast.
4. **UI real no desktop:** o painel Mensagens deixa de mostrar exemplos ilustrativos no desktop e passa a listar as mensagens do projeto selecionado (rota remetente → destinatário, estado lida/não lida, data). A sessão manual real ganha ação "Enviar descoberta" (modal com foco, validação inline, limites e estado de envio) dirigida à principal do projeto. A aba mostra o total real de não lidas com `role="status"` textual, não um número solto. Não há métricas fictícias; o navegador mantém o wireframe ilustrativo.

## Fora de escopo desta subdivisão

O modelo não recebe nem envia mensagens neste incremento: a entrega à principal é um registro visível para o usuário, não uma injeção no PTY. Servidor MCP, criação de agente pelo orquestrador, handoffs e worktrees entram nas subdivisões seguintes. Mensagens não concedem permissões nem executam ações.

## Verificação

- Store: envio com evento e entrega, idempotência por reenvio e por chave com payload divergente (erro), isolamento entre projetos, destinatário inexistente ou de outro projeto, limites de tamanho, migration 3→4 preservando dados anteriores, leitura idempotente (`mark-read` repetido).
- Host/IPC: janela não autorizada rejeitada, cwd não autorizado rejeitado, projeto inexistente.
- Smoke desktop: enviar descoberta pelo modal a partir de sessão real, badge e lista atualizados, marcar como lida ao abrir, persistência após reload da UI e reabertura do banco, contraste e foco do modal.
- Gates: `npm test`, `npm run build`, `npm run check:public`, `npm run test:desktop`, `npm run test:agent`.

## Interface

Skills ui-ux-pro-max e apple-design verificadas e invocadas nesta sessão; consultas UX cobriram foco/validação em modal, feedback de envio e badge com anúncio contextual para leitor de tela. Seguir `design-system/atlas/MASTER.md`, convenções Windows, contraste nos dois temas e `prefers-reduced-motion`.
