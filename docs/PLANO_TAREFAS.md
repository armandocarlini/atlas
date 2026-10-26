# Marco 2c — tarefas reais persistentes

Base: `main` sincronizada após o PR #11, CI Ubuntu/Windows verde. Projetos, sessões, runs, eventos e restauração honesta de histórico já funcionam. Este fluxo cria e lista tarefas do projeto autorizado, sem usar o modelo.

## Plano e aceite

1. Migration 2 adiciona tarefas e comandos de criação, com UUID, projeto, título, descrição, critérios, estado `backlog`, versão e timestamps UTC. Não importar exemplos do cockpit.
2. Criar tarefa, comando concluído e evento em uma transação. Chave de idempotência por projeto e hash do payload impedem duplicação por envio repetido e rejeitam reutilização com conteúdo diferente.
3. IPC estreito `task:list`/`task:create`, exclusivo da janela principal, valida pasta pelo project host. Ator `user` e estado inicial são definidos no núcleo; nenhum parâmetro permite SQL, outro ator ou conclusão de tarefa.
4. Painel Tarefas do desktop lista apenas dados reais do projeto selecionado. Modal com título e critérios obrigatórios, descrição opcional, limites, erros inline, foco e estado de envio. A janela de acompanhamento recebe o mesmo snapshot e oferece leitura; criação ocorre na principal.
5. Trocar projeto limpa dados do escopo anterior e descarta respostas atrasadas. Fechar e reabrir preserva tarefa e critérios. Mensagens/evidências continuam explicitamente ilustrativas; navegador mantém seu wireframe.

Skills de UI `ui-ux-pro-max` e `apple-design` já invocadas; Python 3.14.3 confirmado. Consulta de UX para formulário validada; seguir MASTER, foco modal e tokens de contraste. Incluir textarea na navegação modal.

Verificar migration 1→2 preservando histórico, rollback, duplicação/alteração de chave, isolamento, tipos/limites negativos, dados de texto sem execução, reinício, controle de IPC e smoke desktop (formulário, teclado, pop-up, troca de escopo e persistência). Executar todos os gates e CI Ubuntu/Windows antes do merge.

Limites: criação/listagem em backlog. Alterar estado exige claims, política, evidências e revisão dos marcos seguintes. Este PR não declara delegação, mensagens, execução de tarefas ou conclusão automática.

## Desvio necessário: ordem de saída ConPTY

O smoke real do Kimi revelou uma corrida no `node-pty` 1.1.0: o pipe de saída pode fechar antes do callback nativo preencher o exit code. O resultado era uma saída `undefined`, impedindo a confirmação de saída 0 e a persistência do resultado. Dois testes determinísticos reproduziram a falha no código instalado antes da correção.

O driver agora espera a confirmação nativa se o pipe ConPTY fechar primeiro; se o callback chegar antes, mantém a drenagem até o fechamento do pipe. Não consulta campos privados do driver no código do ATLAS, não inventa código 0, não faz retry e não altera WinPTY. Sem callback, o resultado continua incerto e será reconciliado como `lost` ao encerrar/reabrir o aplicativo.

Como a versão estável usada ainda tem esse comportamento, `scripts/patch-node-pty.cjs` aplica o ajuste em `postinstall` com a dependência fixada em 1.1.0 e SHA-256 dos dois arquivos antes/depois. Valida ambos antes de escrever, é idempotente e recusa versão ou conteúdo desconhecidos. Os testes exercitam as duas ordens de eventos, saída final, código de erro, notificação duplicada, WinPTY e reaplicação. Uma atualização do driver exige revisar/remover esse patch.

Fontes primárias inspecionadas: [windowsTerminal](https://github.com/microsoft/node-pty/blob/main/src/windowsTerminal.ts) e [windowsPtyAgent](https://github.com/microsoft/node-pty/blob/main/src/windowsPtyAgent.ts), além do pacote instalado 1.1.0.
