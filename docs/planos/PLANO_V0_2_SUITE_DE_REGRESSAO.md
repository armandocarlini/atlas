# Plano v0.2: suíte de regressão liga/desliga

Situação: **aprovado pelo mantenedor em 03/11/2026**, com o log completo em arquivo e o prazo escolhido pelo usuário. **Entregue** nas quatro fases abaixo (PRs #53 a #56).

Cobre o item 3 do `docs/ROADMAP.md`. As quatro escolhas de escopo foram feitas pelo mantenedor em 03/11/2026:

| Pergunta | Escolha |
|---|---|
| O que roda | Um comando por projeto, informado pelo usuário. O ATLAS pode sugerir, mas só grava com confirmação |
| Quando roda | Quando o agente pede revisão de uma tarefa, na worktree da tarefa |
| Se falhar | Só informa. O resultado aparece na revisão, e o usuário decide se conclui |
| Liga/desliga | Por projeto. Só o usuário liga, desliga ou altera; agentes e principal não alteram |

## Objetivo

Hoje a revisão de uma tarefa traz duas evidências:

- `agent_report`: o que o agente **declara**, ou seja, o resumo e os comandos com exit code, sem verificação;
- `git_snapshot`: o retrato Git que o ATLAS coleta.

O plano acrescenta uma terceira evidência, **verificada pelo sistema**: o ATLAS roda a suíte do projeto na worktree da tarefa e anexa à revisão o resultado, a duração e o log. Assim, o usuário não depende só do "rodei os testes e passou" do agente.

## Decisões técnicas propostas

### 1. Configuração por projeto

- Nova tabela `regression_suites`, na migration 13, com estes campos:
  - `project_id` como chave primária;
  - `enabled` (0 ou 1);
  - `command`, até 300 caracteres, sem caracteres de controle;
  - `timeout_seconds`, escolhido pelo usuário: de 1 minuto a 24 horas, ou `NULL` para "sem prazo". **Não há prazo padrão.** Para ligar a suíte, o usuário informa o comando e escolhe o prazo, inclusive "sem prazo". Pode alterar os dois quando quiser;
  - `updated_at` e `version`.
- Sem linha na tabela, a suíte fica desligada. **Configuração ausente nunca é preenchida em silêncio.**
- **Sugestão:** se a raiz do projeto tiver `package.json` com `scripts.test`, o diálogo mostra `npm test` como sugestão. O campo só é preenchido quando o usuário clica em "Usar sugestão", no mesmo padrão de "Usar recomendado" das funções. O ATLAS não sugere outros ecossistemas na v0.2.
- A configuração muda só por IPC do renderer (`regression-suite:get/set`). Não existe ferramenta MCP que a altere. A principal e os agentes não leem o comando.

### 2. Quando e onde roda

- `tasks_request_review` continua como hoje: grava a revisão, as duas evidências atuais e responde ao agente na hora. A suíte **não bloqueia** a chamada do agente.
- Se o projeto tiver a suíte ligada e a tarefa tiver worktree registrada pelo ATLAS, o host enfileira uma execução vinculada à revisão (`review_id`).
- **Tarefa sem worktree:** não roda na pasta principal do projeto. Grava uma evidência dizendo "suíte não executada: tarefa sem worktree", para o usuário não confundir ausência com sucesso.
- Uma execução por vez, numa fila global, para não disputar CPU com os agentes. A fila aparece na revisão como "na fila" ou "rodando".

### 3. Como roda

O comando é do usuário e é tratado como se ele o digitasse num terminal:

- Roda no shell do sistema (`cmd.exe /d /s /c` no Windows e `/bin/sh -c` nos demais), com `cwd` igual à worktree.
- **Ambiente limpo de credenciais do ATLAS:** sem o token da run, sem a variável da ponte MCP e sem `OPENCODE_CONFIG_CONTENT`. O restante do ambiente do usuário é herdado, como num terminal comum.
- Sem stdin.
- **Log completo em arquivo**, gravado em streaming em `<userData>/regression-logs/<projeto>/<execução>.log`, fora do banco e fora do Git. Projetos grandes geram logs grandes, e o ATLAS não corta a saída em situação normal.
- O banco guarda só o caminho, o total de bytes, o SHA-256 do arquivo e um trecho final de até 64 KB para a revisão abrir rápido. A evidência é carregada a cada atualização da lista de tarefas e enviada por IPC, então ela não carrega o log inteiro.
- **Teto de segurança** de 1 GB por execução, contra loop que imprime sem parar. Se ele for atingido, a gravação para, o log ganha a marca "log cortado em 1 GB" e o processo continua até terminar ou estourar o prazo. O resultado mostra o corte; não é silencioso.
- Se o arquivo não puder ser gravado (disco cheio, permissão), a execução termina como `error` com o motivo, nunca como `passed`.
- O ATLAS não apaga logs automaticamente.
- **Prazo:** o prazo é opcional, para um teste travado não segurar a fila para sempre. Ao fim dele, a árvore de processos é encerrada (`taskkill /T /F` no Windows, grupo de processos nos demais). O resultado fica `timeout`, nunca `passed`.
- **Parar a suíte:** na revisão, o botão "Parar suíte" encerra a execução em andamento ou tira da fila uma execução que ainda não começou. Ele é necessário principalmente com "sem prazo". O resultado fica `cancelled`, nunca `passed`. Só o usuário para a suíte; agentes não têm essa ação.
- Não há nova tentativa automática.

### 4. Evidência e honestidade do resultado

- A evidência nova tem `kind = 'regression_run'` e `source = 'system'`. A migration 13 reconstrói a tabela `evidence` para ampliar o `CHECK` e preserva os dados, com teste de migração.
- Estados possíveis: `queued`, `running`, `passed` (exit 0), `failed` (exit diferente de 0), `timeout`, `cancelled` (parada pelo usuário), `error` (o shell não iniciou), `interrupted` (o ATLAS fechou durante a execução, marcado pela reconciliação no início seguinte) e `skipped` (sem worktree).
- O trecho final do log fica só em `regression_runs` e é lido sob demanda (`regression-run:get`). A evidência é carregada a cada atualização da lista de tarefas, por isso não leva o trecho (ajuste da fase 1). O payload traz o comando efetivo, o exit code, a duração, o caminho e o SHA-256 do log completo, o total de bytes, se houve corte e o `HEAD` em que rodou.
- **A suíte alterou a worktree?** O ATLAS coleta o retrato Git de novo depois da execução. Se ele diferir do retrato da revisão, a evidência mostra "a suíte alterou a worktree". Nesse caso, o aceite já recusa por causa da regra atual, e a mensagem passa a explicar o motivo.
- **Arquivos de teste alterados pelo agente:** o agente pode, por exemplo, mudar o script `test` do `package.json`, configs de Vitest, Jest ou Playwright, ou arquivos `*.test.*`. Quando o diff da revisão toca arquivos assim, a evidência mostra um aviso com a lista. Um verde nessas condições não deve ser lido como garantia.

### 5. Falha só informa

- A conclusão continua sendo decisão exclusiva do usuário, inclusive com suíte vermelha, em timeout ou ainda rodando.
- Com a suíte vermelha, o botão "Aceitar e concluir" mostra o estado ao lado, por exemplo "Suíte: falhou (exit 1)". Não bloqueia nem pede confirmação extra.
- Nada volta automaticamente ao agente. O usuário pode pedir ajustes, como hoje.
- `tasks_list` passa a informar aos agentes só o estado da suíte da revisão pendente (`passed`, `failed` etc.), sem o log nem o comando. Assim, o agente responsável fica sabendo de uma falha quando o usuário pedir ajustes. O log continua só na interface.

### 6. Interface

As skills ui-ux-pro-max e apple-design e o `MASTER.md` serão aplicados na fase 3.

- Na barra do projeto, uma entrada **"Suíte de regressão"** abre um diálogo modal com:
  - a chave liga/desliga;
  - o campo do comando, com "Usar sugestão" quando houver;
  - o prazo, com valor livre (minutos ou horas) ou a opção "sem prazo";
  - o aviso de que o comando roda com as permissões do usuário, na worktree da tarefa, com código escrito pelo agente.
- Na revisão (`ReviewEvidence`), um bloco "Suíte de regressão (verificada pelo ATLAS)" com:
  - o estado, por texto e ícone, não só por cor;
  - a duração;
  - o trecho final do log, recolhido por padrão;
  - "Abrir log completo", que abre o arquivo no editor padrão do sistema, e "Mostrar na pasta". Antes de abrir, o ATLAS confere que o caminho está na pasta de logs;
  - os avisos de worktree alterada e de arquivos de teste alterados.

### 7. Segurança

- **Não amplia permissões.** Os agentes já executam qualquer comando no próprio terminal com as permissões do usuário. A suíte roda código que o agente escreveu, mas só o comando que o usuário configurou, e só na worktree.
- O pedido de revisão é a única coisa que o agente controla. Ele não escolhe o comando, o prazo nem a pasta. A fila global e o limite de uma execução por revisão evitam que uma sequência de pedidos sobrecarregue a máquina.
- Não há suíte para projetos que o ATLAS não registrou nem para pastas fora da worktree registrada.

## Fases (depois da aprovação)

1. **Banco e host:**
   - migration 13 (`regression_suites` e `evidence` ampliada);
   - `electron/regression-suite.cjs` (configuração, fila, execução, limite de saída, timeout e reconciliação);
   - IPC e preload.
   - Testes: unitários e de integração com fixtures temporárias (comando que passa, que falha, que estoura o prazo, que cria arquivo na worktree, que imprime mais de 64 KB e que atinge o teto reduzido de teste, falha de gravação do log), migração com dados existentes e reinício durante a execução.
2. **Ponte:** disparo a partir de `tasks_request_review`, evidência `skipped` sem worktree e estado da suíte em `tasks_list`. Inclui `test:agent` cobrindo o fluxo completo com worktree de fixture.
3. **Interface:**
   - diálogo de configuração;
   - bloco na revisão;
   - estado ao lado do aceite;
   - `test:desktop` abrindo o diálogo e mostrando uma evidência semeada na fixture.
4. **Docs:** `CONTEXTO.md`, `ROADMAP.md` e o texto do aceite no `orchestrator-profile.cjs`, que passa a citar a suíte verificada.

Cada fase é um PR com CI verde em Ubuntu, Windows e Package.

## Fora deste plano

- Botão "Rodar de novo" e execução manual. O mantenedor escolheu só ao pedir revisão; dá para acrescentar depois.
- Vários comandos por projeto, detecção de outros ecossistemas e suíte por tarefa.
- Bloquear a conclusão ou devolver a tarefa ao agente automaticamente.
- Sandbox ou isolamento de rede para a suíte.

## Decisões do mantenedor

1. ~~Aprovar o plano~~: aprovado em 03/11/2026.
2. Aprovado: `tasks_list` informa aos agentes só o **estado** da suíte, sem log (seção 5).
3. ~~Prazo padrão de 10 minutos~~: substituído pelo prazo escolhido pelo usuário, sem padrão e com a opção "sem prazo". O teto de segurança de 1 GB por log foi aprovado.
