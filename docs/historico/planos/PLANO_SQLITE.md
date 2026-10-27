# Marco 2 — persistência operacional

## Subdivisão 2a: projetos, sessões, runs e eventos

Base: `main` sincronizada após o PR #9, com os dois jobs Verify verdes. O shell usa Electron 45, cujo runtime instalado expõe `node:sqlite` (Node.js 24.22.0). O Node.js 24.14.0 instalado também o suporta. Usar o módulo embutido evita outro addon nativo e uma segunda cadeia de rebuild. A API ainda está em evolução no Node; a validação deve executar no runtime Electron, além dos testes Node.

Fluxo vertical deste PR:

1. Abrir `atlas.sqlite` apenas no processo principal, dentro de `app.getPath('userData')`.
2. Aplicar migrations numeradas em transação, com foreign keys, busy timeout, WAL e versão de esquema. Recusar bancos de versão futura e falhas de migration sem apagar dados.
3. Registrar projetos descobertos sem alterar a autoridade das pastas autorizadas: o JSON atual continua controlando permissões. Não importar cards ou tarefas ilustrativas.
4. Persistir identidade de sessão separada da tentativa de execução. Registrar sessão, run e eventos atomicamente após criar o PTY. Se a gravação falhar, encerrar o PTY e propagar o erro.
5. Persistir saída real como `succeeded`/`failed`, sem concluir tarefas. Ao abrir o banco em nova execução do aplicativo, reconciliar runs que ficaram ativas como `lost`, sem ressuscitar processos ou atribuir exit code fictício.
6. Solicitar encerramento dos PTYs, marcar runs ainda ativas como `lost` com motivo `application_closed` e fechar o banco. Não aguardar saída física nem inventar exit code quando o aplicativo interrompe o processo. Saída natural recebida antes disso é persistida normalmente. Não persistir entrada, saída do terminal, prompts ou credenciais.

Verificações: migrations repetidas, versão futura, rollback, reinício, isolamento entre projetos, evento/estado atômicos, conflitos de versão, encerramento idempotente, backup consistente e reabertura de uma cópia restaurada. Testar falha de persistência durante criação do agente e ciclo real em Electron com perfil temporário. Executar os gates do repositório e a CI Ubuntu/Windows antes do merge.

Backup é uma operação interna de manutenção testada, sem IPC que aceite caminhos arbitrários do renderer. Restore neste incremento é reabrir uma cópia de backup em fixture, sem sobrescrever banco em uso.

Limites: tarefas, mensagens e evidências da UI continuam ilustrativas. Restaurar cards/sessões na UI e criar tarefas reais pertencem à subdivisão seguinte. Orquestrador, claims/leases, mensagens, aprovações, worktrees e instalador continuam nos marcos posteriores. Nenhuma mudança visual neste PR.

## Referências

- [Node.js 24: SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
- [Electron 45: versões do runtime](https://releases.electronjs.org/release/v45.0.0)
