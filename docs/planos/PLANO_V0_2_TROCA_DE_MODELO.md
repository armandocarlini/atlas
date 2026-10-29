# Plano v0.2 — trocar o LLM de um agente sem perder a tela

Situação: **aprovado em 29/10/2026 e implementado** (PRs #44 e o da interface). A fase 1 foi feita no OpenCode 1.19.5 pelo `smoke:opencode`; a principal no Kimi segue bloqueada até a ponte MCP voltar a funcionar no Kimi 2.4.0.

Cobre o item 2 do `docs/ROADMAP.md`. A investigação dos CLIs está na seção "Investigação do item 2" de `docs/planos/PLANO_V0_2_LLM_POR_FUNCAO.md`. A direção aprovada em 29/10/2026 é **começar pela troca nativa do CLI**, com rótulo honesto, e deixar a nova run com retomada como plano B.

## Objetivo

O usuário troca o modelo de um agente em execução (principal ou não) sem perder:

- **a tela:** o terminal, o scrollback e o card continuam os mesmos;
- **o contexto:** a conversa com o modelo continua na mesma sessão do CLI;
- **o vínculo com o ATLAS:** a mesma run, o token MCP, o claim da tarefa e a função.

O ATLAS mostra com honestidade qual modelo está em uso: o que ele iniciou e o que o usuário informou depois.

## O que os CLIs já fazem (reconferido em 29/10/2026)

| | Kimi Code 2.4.0 | OpenCode 1.18.21 |
|---|---|---|
| Comando | `/model` | `/models` (ou `/mo`), `<leader>m`; F2 alterna entre os recentes |
| Conversa | Continua na mesma sessão; em sessão com histórico, oferece "Compact and continue" | Continua; o modelo vale para as próximas mensagens |
| Grava padrão? | **Enter grava `default_model` no `config.toml` do usuário**; **Alt+S** troca só nesta sessão | Não grava configuração; guarda recentes em `~/.local/state/opencode/model.json` |
| Durante uma resposta | Recusa até a resposta parar (Esc ou Ctrl-C) | Não verificado |

O `/model` do Kimi 2.4.0 é igual ao da 2.3.3: o seletor, o Alt+S e a pergunta de compactação continuam lá.

## Decisões

### 1. Quem executa a troca

**Recomendação:** **o usuário, dentro do terminal do agente.** O ATLAS só orienta e registra.

- O card da sessão ganha o botão **"Trocar modelo"**, que abre um painel curto com o passo exato do CLI daquela sessão:
  - **Kimi:** digite `/model`, escolha e confirme com **Alt+S** para valer só nesta sessão. Enter grava o modelo como padrão no seu `config.toml`.
  - **OpenCode:** digite `/models` (ou F2 para alternar entre os recentes).
- O painel tem o botão "Ir para o terminal", que foca o terminal da sessão.
- **O ATLAS não digita `/model` no terminal do agente.** É a mesma regra das mensagens, que nunca são digitadas no terminal do destinatário. Além disso, escrever no PTY no meio de uma resposta ou de um texto que o usuário está digitando corromperia a entrada.

**Alternativa não recomendada:** o botão escreve `/model` no terminal. É mais rápido, mas quebra a regra acima e falha em silêncio quando o CLI está ocupado.

### 2. Como o ATLAS fica sabendo do modelo novo

O ATLAS não consegue ver a troca de forma confiável pela saída do terminal.

**Recomendação:** **o usuário informa, e o ATLAS marca como informado.**

- No mesmo painel, depois de trocar, o usuário escolhe "Informar o modelo atual" numa lista com os modelos do CLI da sessão (a mesma `listModels` de hoje).
- O ATLAS registra a troca na run, sem criar run nova:
  - um evento de auditoria `run.model_declared`, com o modelo anterior, o novo e a hora;
  - o campo novo `agent_runs.current_model` (migration 12). `model` continua sendo o modelo de início.
- **No card:**
  - `Kimi Code · modelo-x`, enquanto nada foi informado;
  - `Kimi Code · modelo-y (informado por você; iniciou com modelo-x)`, depois de informado.
  - Se o usuário trocar no CLI e não informar, o card continua mostrando o modelo de início com a dica "Trocou no terminal? Informe aqui".
- **`sessions_list`** passa a devolver `model` (o atual, se informado) e `modelSource` (`launch` ou `user`), para a principal saber qual modelo cada agente usa.
- **Função:** a troca marca `function_overridden = 1`, porque o modelo deixou de ser o salvo na função.

**Detecção automática** (só leitura) fica como investigação opcional, depois:
- **OpenCode:** o ATLAS iniciaria o CLI com `--port` e consultaria a sessão no servidor local da TUI;
- **Kimi:** leria os arquivos de sessão em `KIMI_CODE_HOME`. Hoje não há sessão gravada sem prompt, então ainda não foi verificado.

Detecção automática só entra com plano próprio. Ela dependeria de formatos internos dos CLIs, que mudam sem aviso, como a quebra do MCP no Kimi 2.4.0 mostrou.

### 3. O que conta como "não perder"

**Recomendação:** a tela **e** o contexto da conversa. A troca nativa entrega os dois, porque nada é reiniciado:
- o PTY, o scrollback e o card são os mesmos;
- a run, o token MCP, o claim e o `claim_epoch` não mudam;
- o CLI mantém a conversa. No Kimi, "Compact and continue" resume o histórico para o modelo novo.

### 4. Sessão principal

**Recomendação:** vale o mesmo fluxo, mas a fase 1 verifica antes que o perfil somente leitura sobrevive à troca:
- **Kimi:** depois de `/model`, a sessão continua sem ferramentas de escrita (o `--agent-file` é da sessão, não do modelo);
- **OpenCode:** as permissões estão no agente `atlas-orchestrator` e não dependem do modelo.

Se algum CLI perder o perfil na troca, o botão fica desabilitado na principal daquele CLI, com o motivo, até haver correção.

### 5. Plano B: nova run com retomada

**Recomendação:** não fazer agora. Ele só entra se a troca nativa falhar em algum CLI. Custos já levantados:
- o fim da run tira o claim (invariante), então a run sucessora teria de herdá-lo de forma atômica, com novo `claim_epoch`;
- no Kimi, a principal não pode ser retomada, porque `--agent-file` não combina com `--session`;
- o scrollback vive só na memória do PTY (512 KB) e teria de ser mantido acima da nova run.

## Fases (depois da aprovação)

Cada fase tem branch e PR próprios e CI verde em Ubuntu e Windows.

1. **Verificação com os CLIs reais.** Teste manual guiado, com fixture e sem tocar a configuração real:
   - `/model` com Alt+S no Kimi e `/models` no OpenCode mantêm a sessão, o perfil somente leitura da principal e a conexão MCP;
   - o resultado fica registrado no PR.
   - **Dependência:** com o Kimi 2.4.0 a ponte MCP não conecta (primeiro item de "Agora" no ROADMAP). A verificação do Kimi espera essa correção. O OpenCode segue antes.
2. **Banco e núcleo.**
   - Migration 12 com `agent_runs.current_model`.
   - IPC `agent:declare-model`: só a janela principal, só run em execução, modelo validado contra a lista do CLI da sessão.
   - Evento `run.model_declared`.
   - `sessions_list` com `model` e `modelSource`.
   - Testes:
     - concorrência com outra declaração;
     - run encerrada recusada;
     - modelo fora da lista;
     - janela secundária;
     - reabertura do banco.
3. **Interface.**
   - "Trocar modelo" no card, com o passo por CLI, "Ir para o terminal", "Informar o modelo atual" e o rótulo honesto.
   - Usa as skills ui-ux-pro-max e apple-design.
   - `test:desktop`: painel com o texto certo por CLI, nada escrito no terminal, rótulo antes e depois de informar e contraste.

Fora do escopo: o ATLAS digitar no terminal, detecção automática, nova run com retomada e troca de CLI (de Kimi para OpenCode) numa sessão em andamento.

## Decisões que dependem do mantenedor

1. O usuário troca no terminal e o ATLAS só orienta, sem digitar `/model`: **aprovar**.
2. O modelo novo é informado pelo usuário e aparece marcado como "informado por você"; a detecção automática fica para depois: **aprovar**.
3. "Não perder" = tela e contexto, entregues pela troca nativa: **aprovar**.
4. A principal entra no mesmo fluxo depois de verificado o perfil somente leitura: **aprovar**.
5. A verificação do Kimi espera a correção da ponte MCP no Kimi 2.4.0: **ciente**.
