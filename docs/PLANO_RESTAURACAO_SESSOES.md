# Marco 2b — histórico de sessões no cockpit

Base: `main` sincronizada após o PR #10, com CI Ubuntu e Windows verde. A base SQLite já preserva projetos, sessões, runs e eventos; a UI ainda só conhece cards criados nesta execução.

## Fluxo e aceite

1. Listar pelo IPC existente `agent:list` tanto agentes ativos quanto sessões históricas de projetos atualmente autorizados. Consultar apenas caminhos ainda autorizados; um registro no banco não concede permissão. Não expor SQL ou caminhos de banco ao renderer.
2. Usar o UUID canônico da sessão nos cards reais. Na carga inicial e recarga da UI, mesclar o estado retornado sem apagar terminais locais nem duplicar sessões recém-criadas.
3. Representar histórico encerrado sem PTY, sem composer, sem TUI sintética, sem métricas fictícias e com o resultado da última run. Não iniciar processo ao restaurar histórico. `lost` continua visível como interrupção incerta, sem exit code inventado.
4. Preservar pop-up, foco, grid, aparência, teclado e sincronização entre janelas. Não oferecer pop-up interativo para histórico sem PTY.
5. Testar a UI com perfil Electron temporário e banco de fixture simulando run interrompida: comprovar identidade, diretório e resultado, sem processo ressuscitado. Repetir a restauração após recarregar a UI. Complementar com o smoke real do Kimi: criar sessão, executar somente `/status` e `/exit`, fechar e reabrir o Electron no mesmo perfil e verificar identidade e saída persistidas. O CLI já instalado foi localizado consultando o PATH persistente do usuário; o PATH da sessão Codex estava desatualizado.

## Interface

Skills `ui-ux-pro-max` e `apple-design` carregadas; Python 3.14.3 confirmado. Consulta local de UX para formulários validada. Seguir `design-system/atlas/MASTER.md`: rótulos claros, tipografia do Windows, contraste por tokens e conteúdo sem animação decorativa. Histórico tem texto de estado explícito e não depende só de cor. Preservar a prioridade do terminal interativo.

## Limites e verificação

Este incremento restaura o histórico; não retoma sessões nativas do Kimi nem reconstrói scrollback. Tarefas reais ficam na subdivisão seguinte; mensagens, evidências e os quatro cards de demonstração continuam ilustrativos. Executar testes de unidade, integração com SQLite, todos os gates locais e CI Ubuntu/Windows antes do merge.
