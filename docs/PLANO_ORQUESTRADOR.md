# Marco 3 — sessão principal real

Base: `main` sincronizada após PR #12, CI Ubuntu/Windows verde. O marco 2 entrega SQLite, migrations, tarefas em backlog, comandos de criação, eventos e histórico de sessões.

## Fluxo vertical

1. Registrar papel de sessão (`agent`/`orchestrator`) separado de origem e run. Uma identidade de orquestrador por projeto; cada tentativa tem run própria e metadados do CLI/diretório.
2. Abrir a sessão principal no projeto autorizado usando Kimi interativo e um perfil Markdown estático do ATLAS, carregado pela opção oficial `--agent-file`. Sem `--auto`, `--yolo`, prompt inicial, flags vindas do renderer ou alteração dos arquivos do projeto.
3. Neste marco o perfil principal é de planejamento, com ferramentas de leitura e sem subagentes nativos. O terminal é real, com modelo e permissões no harness. Delegação e ferramentas estruturadas do ATLAS entram no marco 4; não declarar essas integrações ativas aqui.
4. Ao abrir projeto sem principal, criar uma; pedidos simultâneos devem compartilhar o mesmo resultado. Se a principal já terminou/interrompeu, mostrar histórico e exigir ação explícita para nova run, preservando identidade. Nunca interpretar texto ANSI como estado operacional nem prometer retomada nativa sem comprová-la.
5. Exibir principal e sessões manuais no escopo do projeto. Tirar cards ilustrativos do desktop; manter wireframe no navegador. Falha de descoberta/spawn/persistência aparece de forma acionável, sem perder formulário ou criar card ativo fictício.

## Verificação

Testar unicidade concorrente, reinício, nova run com identidade preservada, erro de persistência/spawn, diretórios não autorizados, imutabilidade das flags e separação entre tarefas e estado da run. Executar perfil real no Kimi em fixture isolada, apenas comandos locais sem prompt ao modelo, e manter todos os gates do repositório. Para a demonstração de conversa, usar apenas provedor já configurado e prompt pequeno em fixture; registrar bloqueio se faltarem credenciais/quota, sem instalar/cadastrar acesso.

Skills de UI já invocadas: ui-ux-pro-max e apple-design; Python 3.14.3 verificado. Seguir MASTER e convenções Windows. Incluir estados de carregamento, erro, encerramento e foco sem métricas fictícias.

## Fontes verificadas

O `kimi --help` instalado (2.3.2) confirma `--agent-file`. A opção escolhe perfil somente em sessão nova e não é combinada com `--session`/`--continue`. O perfil permite ferramentas de leitura e mantém os controles nativos do harness.

- [Comando kimi](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command)
- [Formato de agentes](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/agents.html)

## Limites

Este marco não conclui o fluxo da v0.1: criação de subordinados sob política, mensagens, handoffs, leases/fencing, worktrees, evidências/revisão e instalador continuam pendentes. Nenhum release/tag ou avanço para v0.2.

## Evidências de implementação

A principal mantém UUID, com tentativas monotônicas separadas do relógio e snapshots de versão CLI/cwd por run. Os testes cobrem consulta de histórico concorrente com nova run explícita, relógio voltando e snapshots/saídas atrasadas. Reinício não promete retomar conversa nativa.

Revisão encontrou a necessidade de reintegrar pop-up antes de substituir seu PTY e validar o identificador de PTY nos eventos de saída. As duas correções têm regressões; o smoke Kimi executa saída no pop-up e nova run na janela principal, confirmando identidade e conexão novas.

O smoke de conversa inicialmente falhou por erro do teste: enviar texto e CR diretamente ao PTY deixou o texto no input da TUI. A captura local mostrou input preenchido e nenhum turno iniciado; o rótulo estático de esforço do modelo não comprovava geração. O teste agora usa teclado real do xterm via CDP e verifica a resposta renderizada. Passou com um único prompt curto e o provedor já configurado, sem copiar credenciais, mudar modelo/permissões ou aumentar timeout.
