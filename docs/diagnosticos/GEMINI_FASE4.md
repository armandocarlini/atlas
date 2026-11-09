# Gemini CLI: investigação da fase 4 (equipe com várias IAs)

Investigação de 09/11/2026 para `docs/planos/PLANO_V0_2_EQUIPE_MULTI_IA.md`, com o **Gemini CLI 0.67.0** no Windows 11.

## Como foi verificado, sem API nem configuração real

- **Home isolada** em pasta temporária com `GEMINI_CLI_HOME`. O `~/.gemini` do usuário não foi gravado.
- **Servidor falso local** no formato da API do Gemini (`streamGenerateContent`), por `GOOGLE_GEMINI_BASE_URL`, com chave fictícia:
  - o servidor grava cada requisição, que traz as ferramentas e o `systemInstruction` efetivos;
  - o servidor responde um roteiro de `functionCall`, e o CLI executa cada chamada de verdade.
- **Servidor MCP fictício** no lugar da ponte do ATLAS.
- **Modo de teste:** os testes usaram `-p` e, para provar a política, `--approval-mode yolo`. É o pior caso, que o ATLAS nunca usa. Sem `yolo`, o modo não interativo já esconde as ferramentas que pedem aprovação.

## Resultados

| Pergunta do plano | Resultado |
|---|---|
| Modelo por run | `--model` vai na URL da requisição |
| Lista de modelos | `gemini --list-models`: um modelo por linha sem recuo, por exemplo `gemini-2.5-pro (gemini-2.5-pro)` |
| Ponte só pela run | **Não dá.** O Gemini não tem flag de MCP por run. `GEMINI_CLI_SYSTEM_SETTINGS_PATH` e `GEMINI_CLI_SYSTEM_DEFAULTS_PATH` são recusados quando a pasta não pertence a um administrador ou ao SYSTEM ("Security Warning: Skipping system settings file … is insecure"), e a pasta de dados do ATLAS pertence ao usuário |
| Ponte por consentimento | A entrada `atlas` no `settings.json` do usuário funciona. A ferramenta aparece como `mcp_atlas_<nome>` |
| Token fora da linha de comando | O Gemini **não repassa** o ambiente da sessão aos servidores MCP: o token chegou vazio. Com `"env": {"ATLAS_MCP_TOKEN": "$ATLAS_MCP_TOKEN"}` na entrada, o valor da run é expandido. Fora do ATLAS a variável chega vazia, e a ponte fica inerte |
| Principal somente leitura | `--policy <arquivo>` com uma regra que nega tudo (`toolName = "*"`) e libera `read_file`, `list_directory`, `glob` e `mcpName = "atlas"`. Mesmo em `yolo`, as ferramentas oferecidas são só `glob, list_directory, read_file, mcp_atlas_ping`. Shell e escrita voltam `Tool "…" not found` |
| `.env` | `grep_search` lê o conteúdo do `.env` numa busca pela pasta, então fica fora da principal, como no OpenCode. `read_file` do `.env` volta erro: o próprio Gemini o trata como fora do workspace, e a política tem uma regra de negação a mais |
| Modo `plan` do CLI | É somente leitura, mas **esconde as ferramentas MCP**. Não serve para a principal |
| Instruções da principal | `GEMINI_SYSTEM_MD=<arquivo>` **substitui** o prompt do CLI inteiro e preenche `${AvailableTools}`. O ATLAS usa um prompt próprio, curto, com as instruções da principal |
| Servidores MCP do repositório | `--allowed-mcp-server-names atlas` deixa só a ponte do ATLAS na principal |

**Política inválida.** Um arquivo de política com erro, de sintaxe ou de esquema, só gera um aviso ("Policy file error"), e o CLI segue **sem restrição nenhuma**. Por isso:
- o texto da política é fixo no código;
- `scripts/agent-profile.test.mjs` confere as regras;
- `npm run smoke:gemini` falha se o aviso aparecer.

**Confiança na pasta.** O Gemini pergunta se a pasta do projeto é confiável. A decisão é do usuário, e o ATLAS não passa `--skip-trust`.

## Decisão do mantenedor (09/11/2026)

A ponte do Gemini entra **com consentimento**, como a do Kimi:
- **Diálogo:** um diálogo no ATLAS mostra o arquivo (`~/.gemini/settings.json`, ou o de `GEMINI_CLI_HOME`) e a entrada exata. Só grava com o clique do usuário, e sai pelo mesmo diálogo.
- **O que é gravado:** outros servidores e campos são preservados. A entrada traz só as referências `$ATLAS_MCP_ENDPOINT` e `$ATLAS_MCP_TOKEN`, nunca o token.
- **O que entra por run:** a política e o prompt da principal continuam entrando só pela run, por arquivos do perfil do ATLAS.
