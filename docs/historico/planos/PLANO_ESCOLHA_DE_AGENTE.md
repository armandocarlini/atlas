# Plano — escolha de CLI e modelo por agente (marco 6c-1)

Objetivo: decisão do usuário antes da demonstração do aceite. Nenhum CLI é o padrão do ATLAS, nem para a principal. Em toda sessão de agente, o usuário escolhe o CLI e o modelo entre os identificados na máquina. Isso vale para a sessão manual, para a principal e para o agente pedido pela principal.

## Comportamento

- Adaptadores detectados no `PATH`: Kimi Code e OpenCode. Nenhum vem pré-selecionado e não existe CLI padrão no núcleo.
- Modelos identificados:
  - Kimi Code: os aliases do `config.toml` da home do Kimi, lidos sem executar o CLI.
  - OpenCode: a saída de `opencode models`, ou seja, os provedores com credencial e os gratuitos.
  - A lista fica em cache por um minuto e é atualizada quando o usuário pede.
- Se o CLI lista modelos, a escolha de um deles é obrigatória e o núcleo recusa modelo fora da lista. Se o CLI não lista nenhum, ele usa a própria configuração e a interface diz isso.
- O modelo vai como `--model` e precisa casar com `^[A-Za-z0-9][A-Za-z0-9._:/-]*$`. No Windows o OpenCode é um shim `.cmd` interpretado pelo `cmd.exe`, então metacaracteres de shell são recusados. A versão e a lista de modelos do shim rodam pelo `cmd.exe` só com argumentos constantes do ATLAS.
- Principal:
  - Ao abrir um projeto sem principal, o ATLAS não inicia nada: mostra "Escolher agente".
  - "Nova execução" pede a escolha de novo e permite trocar o CLI e o modelo.
  - A identidade da principal, as tarefas e as mensagens continuam entre runs.
  - A migration 9 grava `adapter_id` e `model` em cada run, e o evento `run.started` leva os dois.
- Pedido de agente da principal: a principal pede; o usuário escolhe o CLI e o modelo no cartão antes de "Aprovar e iniciar". A escolha é conferida antes de aprovar. Assim, um CLI indisponível não consome o pedido nem cria a worktree.

## Ferramentas do ATLAS por CLI

- Kimi Code: como antes. A entrada `atlas` vai para o `mcp.json` com consentimento, e a principal usa o perfil `--agent-file`.
- OpenCode: nada é gravado na configuração do usuário. A run recebe `OPENCODE_CONFIG_CONTENT` com:
  - o servidor MCP `atlas`: a mesma ponte, com endpoint e token desta run;
  - na principal, o agente `atlas-orchestrator`: as mesmas instruções com o prefixo `atlas_` e permissão só para `read` (sem `.env`), `glob`, `list` e `atlas_*`. Há negações explícitas para shell, escrita, `grep`, `task`, rede e pastas externas. A mesma permissão vale para a run inteira, e os agentes padrão `build` e `plan` ficam desabilitados, então trocar de agente na TUI não reabre nada. `OPENCODE_DISABLE_PROJECT_CONFIG=1` faz a principal ignorar o `opencode.json` e a pasta `.opencode/` do repositório.
- As ferramentas vivem só nas runs iniciadas pelo ATLAS e morrem com o token, como no Kimi.

## Testes

- Unidade: shim `.cmd` pelo `cmd.exe` com argumentos constantes e recusa de metacaracteres, listagem de modelos dos dois CLIs, montagem do lançamento por CLI e papel.
- Host:
  - sem CLI padrão;
  - modelo obrigatório e identificado, com recusa de injeção;
  - CLI sem modelos usa a própria configuração;
  - cache e atualização da lista, com falha que não fica em cache;
  - principal que pede a escolha e troca de CLI entre runs mantendo a identidade;
  - ponte e perfil injetados no OpenCode;
  - aprovação de pedido com escolha conferida antes da worktree.
- Desktop (fixture determinística, OpenCode "detectado" com executável inexistente):
  - modal de sessão sem CLI nem modelo pré-selecionados, com botão bloqueado até a escolha;
  - escolha da principal;
  - pedido com escolha;
  - falha honesta ao iniciar, sem sessão fictícia;
  - contraste.
- `npm run smoke:opencode`: OpenCode real com `XDG_*` de fixture e nenhum prompt. Cobre:
  - modelos listados;
  - principal com o perfil `atlas-orchestrator` e a ponte conectada;
  - agente com o modelo escolhido;
  - runs registradas;
  - configuração e credenciais reais conferidas por hash antes e depois.
- `npm run smoke:agent` (Kimi real) passa a escolher o CLI pela interface na nova execução e nos pedidos.

## Ajustes da revisão independente

- A principal no OpenCode deixava de ser somente leitura em dois casos:
  - a tecla Tab trocava para o agente `build`;
  - um `opencode.json` no repositório reabria o `bash`, confirmado no OpenCode real.
  - Correção: permissão global da run, `build` e `plan` desabilitados e configuração do projeto ignorada.
  - A regressão unitária confere a configuração; o `smoke:opencode` cria um `opencode.json` hostil e pergunta ao próprio OpenCode (`debug agent`, `debug config`) quais ferramentas a principal tem.
- O `grep` saiu da principal no OpenCode porque leria `.env` por fora da regra de `read`.
- Uma lista de modelos que chegava atrasada podia desfazer a troca de CLI. Agora as respostas antigas são descartadas, e a escolha não vale enquanto a lista carrega. O smoke desktop reproduz a corrida com uma lista lenta.
- A escolha conferida na aprovação é a mesma usada no início, sem nova consulta de modelos entre a worktree e o spawn.
- A principal inicia no projeto em que a escolha foi aberta, e o aviso diz se a run é nova.
- A lista de CLIs não some durante uma recarga; antes, as opções sumiam por um instante enquanto o usuário escolhia.

## Limites

- A configuração global do OpenCode do próprio usuário continua sendo mesclada. As negações explícitas da principal sobrescrevem as mesmas chaves, mas a configuração global é tratada como confiável.
- `MODEL_PATTERN` descarta modelos com `@`, `+` ou espaço por segurança no `cmd.exe`; eles não aparecem na lista.
- Outros CLIs (Claude Code, Codex, Gemini) ainda não têm adaptador; o modelo de adaptador está pronto para recebê-los.
- O ATLAS não conhece custo nem quota dos modelos; o modelo escolhido é o que o CLI executa.
