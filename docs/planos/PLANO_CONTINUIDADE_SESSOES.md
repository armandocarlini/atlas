# Continuidade das sessões ao reabrir o ATLAS

Decisão do mantenedor em 10/11/2026: ao reabrir o ATLAS, as sessões que estavam abertas voltam sozinhas, sem pedir confirmação, retomando a conversa quando o CLI permite. É uma exceção explícita à invariante de confirmação; ela está registrada no `AGENTS.md`.

## O que existia

- O PTY é filho do ATLAS: fechar o app mata o CLI.
- O fechamento marcava as runs ativas como `lost` (`application_closed`), e a abertura seguinte mostrava "resultado incerto".
- Nenhum adaptador pedia retomada, e `startSession` recusava uma nova run numa sessão de agente.

## Retomada por CLI (versões conferidas pelo `--help` em 10/11/2026)

| CLI | Ao iniciar a conversa | Ao reabrir |
|---|---|---|
| Claude Code 2.1.322 | `--session-id <uuid>` | `--resume <uuid>` (sem ID salvo: `--continue`) |
| Gemini 0.67.0 | `--session-id <uuid>` | `--resume <uuid>` (sem ID salvo: `--resume latest`) |
| Codex 0.167.0 | — | `resume --last` (filtra pela pasta) |
| OpenCode 2.2.6 | — | `--continue` |
| Kimi Code 2.5.2 | — | `--continue` (pela pasta); a principal com `--agent-file` não combina com retomada e abre uma conversa nova |

Nos CLIs que retomam pela pasta, duas sessões do mesmo CLI na mesma pasta não têm como pegar cada uma a sua conversa: só a mais recente usa `--continue`, e as outras abrem uma conversa nova. O ATLAS avisa quais foram.

## Fase 1: agentes e principal

1. Banco (migration 15): `sessions.conversation_id`, `agent_runs.restored_at` e `app_state` com as runs do último fechamento.
2. Fechamento: antes de matar os PTYs, o agent host para de registrar saídas e o banco marca as runs ativas como `application_closed` e grava seus IDs. Assim a saída forçada do processo não vira "falhou".
3. Abertura: só as runs da lista do último fechamento são retomadas. Bancos anteriores usam a data de encerramento mais recente registrada. A tentativa fica gravada em `restored_at` antes de iniciar, para não repetir em loop.
4. Cada sessão volta com o mesmo CLI, modelo (o declarado por último), função, nome e pasta, numa nova run da mesma sessão. Tarefas não voltam a ser reivindicadas: o fim da run continua tirando o claim.
5. A principal volta pelo mesmo caminho da principal, com o modo salvo no projeto.
6. A interface recebe `agent:changed` e recarrega as sessões; falhas e conversas novas aparecem num aviso.

## Fase 2: terminais PowerShell

No fechamento normal, o processo principal grava em `app_state` os terminais PowerShell que ainda estão em execução, com a identidade da janela, o nome e a pasta escolhida ao abrir. Na próxima abertura, consome a lista antes de recriar os PTYs. Cada pasta passa pela mesma validação usada ao abrir um terminal manualmente. Uma falha aparece em um aviso e os demais terminais continuam a reabrir.

Recarregar a interface reapresenta os PTYs existentes. Fechar o aplicativo encerra os processos e o novo PowerShell inicia na pasta de abertura com um buffer novo.

## Testes

- Unitários: argumentos de retomada por CLI; migration; seleção das runs do último fechamento; tentativa única; nova run para sessão de agente só com o mesmo CLI e a mesma pasta; retomada no agent host (exata, pela pasta, colisão, falha que não interrompe as outras, saída ignorada no fechamento).
- Smoke desktop: run fechada pelo app semeada no perfil isolado é retomada na abertura com falha honesta (CLI ausente na fixture), sem repetir depois de recarregar.
