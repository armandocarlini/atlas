# Claude Code e Codex: investigação da fase 1 (equipe com várias IAs)

Investigação de 08/11/2026 para `docs/planos/PLANO_V0_2_EQUIPE_MULTI_IA.md`. Versões testadas: **Claude Code 2.1.318** e **Codex CLI 0.164.0**, no Windows 11.

**Gemini:** não foi investigado. O Gemini CLI não está instalado nesta máquina, e o ATLAS não instala CLIs.

## Como foi verificado, sem API nem configuração real

- **Homes isolados em pasta temporária:** `CLAUDE_CONFIG_DIR` e `CODEX_HOME`. Nenhum arquivo em `~/.claude` ou `~/.codex` foi lido ou gravado.
- **Codex:** `codex mcp list/get`, `codex debug models` e `codex debug prompt-input`. Este último mostra a lista de entrada que o modelo receberia (instruções e ferramentas) sem enviar nada.
- **Claude Code:**
  - roda com `ANTHROPIC_BASE_URL` apontando para um **servidor falso local**, que segue o formato da Messages API, com chave fictícia;
  - o servidor grava cada requisição, que traz as ferramentas e o system prompt efetivos;
  - o servidor responde um roteiro de chamadas de ferramenta, e o CLI executa cada chamada de verdade e devolve o resultado na requisição seguinte;
  - nada sai da máquina.
- **Servidor MCP fictício stdio** no lugar da ponte do ATLAS: ele grava o token recebido por ambiente e expõe a ferramenta `ping`.
- **O projeto de teste é hostil:**
  - `.env` com segredo;
  - `CLAUDE.md`;
  - `.claude/settings.json` que libera `Bash(*)` e `Edit(*)`.

Os testes usaram `claude -p`, o modo não interativo. O conjunto de ferramentas e as regras de permissão vêm das mesmas flags da sessão interativa. A fase 2 confirma isso na TUI, pelo PTY do ATLAS.

## Claude Code

| Pergunta do plano | Resultado |
|---|---|
| Modelo por run | `--model` aparece no campo `model` da requisição |
| Instruções da principal só pela run | `--append-system-prompt` aparece no system prompt |
| Ponte só pela run | `--mcp-config <arquivo> --strict-mcp-config`. A ferramenta aparece como `mcp__atlas__ping` |
| Token fora da linha de comando | `"env": {"ATLAS_RUN_TOKEN": "${ATLAS_RUN_TOKEN}"}` no JSON. O servidor MCP recebeu o valor do ambiente do processo |
| Principal somente leitura | `--restricted --tools "Read,Grep,Glob"`. As ferramentas oferecidas são só `Glob, Grep, Read` mais as do ATLAS. Uma chamada a `Bash` volta `No such tool available: Bash. Bash is disabled for this session, in subagents as well as here.` |
| `.env` bloqueado | `--settings '{"permissions":{"deny":["Read(**/.env)","Read(**/.env.*)"]}}'`. `Read` do `.env` volta `File is in a directory that is denied by your permission settings.`, e `Grep` pelo segredo volta `No matches found` |
| Configuração do repositório ignorada | `--restricted` ignora os arquivos de configuração do usuário, do projeto e locais. O `.claude/settings.json` hostil não devolveu o Bash |
| Ferramentas do ATLAS sem pedido de permissão | Sem regra, a chamada a `mcp__atlas__ping` pede permissão. A fase 2 inclui `mcp__atlas__*` em `permissions.allow` no mesmo `--settings` da run |
| Modo auto da principal | `--restricted --tools "Read,Grep,Glob,Edit,Write,Bash,PowerShell"` oferece as ferramentas de escrita e mantém a configuração do repositório ignorada |
| Lista de modelos | Não há comando que liste. O cartão aceita modelo digitado |

O `--restricted` também limita as ferramentas de arquivo às pastas de trabalho, recusa `bypassPermissions` e só deixa uma pessoa aprovar escritas em arquivos de configuração e Git, segundo a ajuda do CLI.

**Conclusão:** o Claude Code atende a todos os pontos para ser agente e principal, nos dois modos da chave.

## Codex

| Pergunta do plano | Resultado |
|---|---|
| Modelo por run | `-m` |
| Lista de modelos | `codex debug models` devolve o catálogo em JSON, sem rede |
| Ponte só pela run | `-c mcp_servers.atlas.command=...`, `-c mcp_servers.atlas.args=[...]`. `codex mcp list` mostra o servidor só naquela invocação |
| Token fora da linha de comando | `-c mcp_servers.atlas.env_vars=["ATLAS_RUN_TOKEN"]` repassa a variável do ambiente do processo |
| Instruções da principal só pela run | `-c developer_instructions="..."` aparece na entrada do modelo |
| Shell negado | `--disable shell_tool --disable unified_exec` tira `exec_command` e `write_stdin` das ferramentas declaradas |
| Subagentes negados | `--disable multi_agent` tira a declaração de `spawn_agent`, mas o nome ainda aparece em `collaboration` |
| Edição negada | **Não confirmado.** `apply_patch` continua declarado com `include_apply_patch_tool=false`, `tools.apply_patch=false` e `features.apply_patch=false` |
| Leitura de arquivos sem shell | **Não existe.** Sem o shell, o Codex não tem ferramenta de leitura. A principal só leria pelas ferramentas do ATLAS |
| Imagem | A funcionalidade `image_generation` aparece como `stable true` |

O sandbox `read-only` com `-a never` deveria recusar a escrita do `apply_patch` na execução. Isso ainda não foi comprovado: exige um servidor falso no formato da API do Codex, como foi feito com o Claude Code.

**Conclusão:**
- o Codex atende como **agente**;
- **como principal, fica bloqueado** até haver prova de que a escrita é recusada, nos dois modos;
- no modo auto, o shell também leria o `.env`, e não há regra de negação equivalente.

O cartão explica o bloqueio, no padrão de `assertOrchestratorSupport`. Uma investigação posterior com servidor falso pode liberar a principal Codex no modo "só coordena".

## Ajustes no plano decorrentes

- **No modo auto, o bloqueio de `.env` vale para as ferramentas de arquivo, não para o shell.** Em qualquer CLI, quem tem shell consegue ler o `.env`, como os agentes já conseguem hoje. O plano dizia que o modo auto mantinha o bloqueio sem essa ressalva. O aviso da chave passa a dizer isso.
- **Principal Codex:** bloqueada nesta entrega, conforme a regra de queda do próprio plano.
- **Smokes:** a técnica do servidor falso local entra no `smoke:claude` (fase 2) e permite comprovar as permissões sem quota.
