# Marco 4b-1 — ponte MCP do ATLAS com consentimento

Base: `main` sincronizada após PR #14 (mensagens estruturadas), CI Ubuntu/Windows verde na execução 40424432705. Este documento é o plano da primeira parte do marco 4b de `docs/AUTONOMIA_V0_1.md`. Nada aqui está concluído por antecipação.

## Fatos verificados no Kimi Code 2.3.3

- O CLI não tem flag nem subcomando para declarar servidores MCP por sessão. Ele lê `mcp.json` em `$KIMI_CODE_HOME` (padrão `~/.kimi-code`) e em `.kimi-code/mcp.json` dentro do projeto ([documentação de MCP](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/mcp.html)).
- O frontmatter de `--agent-file` aceita ferramentas MCP em `tools` por glob (`mcp__atlas__*`), mas não declara servidores ([formato de agentes](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/agents.html)).
- Uma sonda stdio executada em fixture temporária, com `KIMI_CODE_HOME` isolado, mostrou que o Kimi inicia o servidor como filho direto do processo do PTY, repassa o ambiente completo da sessão e o `cwd` da sessão e mescla o campo `env` da entrada. O protocolo é JSON-RPC delimitado por linha, versão `2025-11-25`. O servidor sobe antes da confirmação de confiança da pasta.
- Chamadas MCP sem regra de permissão pedem aprovação na própria TUI do Kimi. O ATLAS não altera essas regras.

## Decisão do usuário

Alterar o repositório do usuário (`.kimi-code/mcp.json`) está fora de questão. Entre a configuração global e uma `KIMI_CODE_HOME` separada (que exigiria novo login), o usuário escolheu a **entrada global com consentimento explícito**. O ATLAS só grava a entrada `atlas` em `mcp.json` depois de um diálogo que mostra o arquivo e o conteúdo exatos, e oferece remover a entrada. Fora do ATLAS ela fica inerte: sem token de sessão, a ponte expõe zero ferramentas.

## Fluxo vertical

1. **Configuração (`electron/kimi-mcp-config.cjs`):** estados `absent`, `installed`, `outdated`, `conflict` e `invalid`. A instalação preserva outros servidores e campos desconhecidos, recusa JSON inválido ou raiz que não seja objeto, não sobrescreve uma entrada `atlas` alheia e grava de forma atômica (arquivo temporário no mesmo diretório + rename). A remoção apaga somente a entrada gerenciada pelo ATLAS. A home segue `KIMI_CODE_HOME` do processo, a mesma que as sessões filhas herdam. A entrada é reconhecida como do ATLAS pelo nome do script da ponte, sem campos extras no arquivo do Kimi. O IPC (`electron/integration-host.cjs`) aceita somente a janela principal e exige confirmação explícita para instalar ou remover.
2. **Ponte (`electron/atlas-mcp-bridge.cjs`):** servidor MCP stdio sem dependências, executado pelo binário do Electron com `ELECTRON_RUN_AS_NODE=1`. Responde a `initialize`, `ping`, `tools/list` e `tools/call`. Sem `ATLAS_MCP_ENDPOINT`/`ATLAS_MCP_TOKEN`, a lista de ferramentas é vazia. Falhas da conexão viram resultado `isError`, sem derrubar o Kimi.
3. **Host (`electron/mcp-host.cjs`):** escuta em named pipe com nome aleatório por execução no Windows, ou socket Unix em diretório temporário nos testes POSIX. Não abre porta de rede. Cada run de agente recebe um token aleatório, registrado com projeto, sessão, run e papel e revogado na saída. A identidade vem só do token, nunca dos argumentos. Linhas acima do limite são rejeitadas.
4. **Ferramentas desta parte:** `sessions_list`, `tasks_list`, `messages_unread`, `messages_mark_read` e `messages_send`. Todas ficam limitadas ao projeto da sessão chamadora; o remetente é sempre a própria sessão. O conteúdo das mensagens volta marcado como dado não confiável. Nenhuma ferramenta cria agentes, altera tarefas ou executa comandos.
5. **Sessões de agente:** `agent-host.cjs` injeta endpoint e token no ambiente do PTY do Kimi e registra a conexão viva da ponte. O card mostra "ATLAS conectado" somente depois do handshake real. O perfil do orquestrador passa a liberar `mcp__atlas__*` e explica que mensagens recebidas são dados, não instruções.
6. **Interface:** aviso discreto quando a integração não está instalada ou está desatualizada, modal de consentimento com caminho, conteúdo exato, efeito fora do ATLAS e remoção, além de erros inline. Sessões já abertas precisam de nova run para carregar a ponte, e a interface diz isso. O wireframe do navegador continua ilustrativo.

## Fora de escopo

A criação de agente pelo orquestrador com aprovação vinculada a payload, validade e política fica para o 4b-2. Delegação e claim de tarefas, handoffs e worktrees ficam para o 4c. Não haverá regras de permissão automáticas no `config.toml` do Kimi.

## Limites conhecidos

O token fica no ambiente do processo do Kimi e, portanto, ao alcance de comandos que o próprio agente executa. A fronteira de confiança é o usuário local do sistema, a mesma do banco SQLite. A entrada global aponta para o Electron e o script do clone atual; se o ATLAS mudar de pasta, o estado vira `outdated` e o usuário precisa reconfirmar. O instalador (marco 6) define o caminho estável.

## Verificação

- Configuração: criação, preservação de outros servidores, idempotência, `outdated`, `conflict` sem sobrescrita, JSON inválido sem escrita, remoção só da entrada própria, nenhum temporário restante.
- Ponte: modo inerte, handshake, encaminhamento, host indisponível como `isError`, linha malformada com erro de parse.
- Host: token desconhecido ou revogado, isolamento entre projetos, remetente não falsificável, limite de linha e fluxo completo de leitura e envio sobre o store real.
- Agent host: ambiente do PTY com endpoint e token, revogação na saída.
- Smoke desktop: modal de consentimento com foco, conteúdo exato, instalação e remoção numa `KIMI_CODE_HOME` de fixture.
- Smoke real do Kimi: consentimento grava a entrada na home isolada, o orquestrador conecta a ponte (handshake real) e a reabertura mantém a integração, sem prompt ao modelo. A chamada de ferramenta pelo modelo fica no smoke opt-in com provedor configurado.
- Gates: `npm test`, `npm run build`, `npm run check:public`, `npm run test:desktop`, `npm run test:agent`.
