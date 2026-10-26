# Continuidade do desenvolvimento

Última atualização: 26/10/2026.

## Objetivo e critérios de qualidade

O ATLAS é um projeto público e open source de [Armando Ciciliano Carlini](https://github.com/armandocarlini), parte de seu portfólio profissional. O repositório é `armandocarlini/atlas`, a licença é MIT e o desenvolvimento deve manter uma apresentação profissional, decisões documentadas e validação reproduzível.

A visão completa está em `ATLAS_PLANEJAMENTO_ARQUITETURA.md`. O produto deve ser um cockpit desktop local, com orquestrador interativo, terminais de agentes visíveis, colaboração e estado persistente. Recursos ainda planejados não devem aparecer como entregues.

## Estado ao trocar de máquina

O shell Electron funciona com PowerShell real via node-pty/ConPTY e xterm.js. Há descoberta Git somente leitura em pastas autorizadas, branches/worktrees existentes, escolha de diretório para novos terminais, foco/grid, pop-up individual e reintegração preservando o PTY. As colunas laterais podem ser ocultadas; aparência e layout são salvos localmente. O acompanhamento usa uma janela nativa sempre no topo.

O primeiro adaptador de agente real está integrado: o ATLAS descobre o Kimi Code pelo `PATH` (`electron/agent-adapters.cjs`), inicia o CLI interativo em PTY compartilhado (`electron/pty-transport.cjs`) e registra identidade, versão, diretório e estado `running`/`exited` em memória (`electron/agent-host.cjs`). O modal de nova sessão lista somente CLIs detectados e mostra erros inline sem perder os campos. Os testes de unidade rodam com `npm run test:agent`; o smoke real opt-in (`npm run smoke:agent`) executa o Kimi de verdade com `KIMI_CODE_HOME` isolado, usando apenas `/status` e `/exit`.

Registro de processo (26/10/2026): o merge do PR #8 (adaptador Kimi) ocorreu com a CI do Ubuntu vermelha por erro de encadeamento de comandos do agente (`gh pr checks --watch | tail` mascarou o status de saída). O log da execução 40310345895 confirma dois testes vermelhos: o resolvedor de executáveis usava `path.join` do host mesmo quando recebia outra plataforma. A correção pendente usa `path.win32`/`path.posix` conforme a plataforma consultada e adiciona regressão POSIX de descoberta.

Plano da correção: preservar a busca pelo PATH e a preferência por executáveis nativos; validar os cenários Windows e POSIX; executar os gates locais e verificar os checks do PR em comando dedicado, sem pipe, antes do merge. A branch foi retomada com três arquivos já modificados pelo trabalho anterior, preservados nesta continuação.

Ambiente da retomada: Windows, Node.js 24.14.0 selecionado somente para os comandos da sessão (o PATH inicial selecionava Node.js 20.20.0, abaixo do requisito). O ai-memory local foi consultado via CLI: responde, mas não contém `default/ATLAS`; a busca global por ATLAS também não retornou páginas. Os documentos versionados fornecem a continuidade nesta máquina.

Evidências locais da correção: `npm test` (19/19), `npm run test:agent` (16/16), `npm run build`, `npm run check:public` e `npm run test:desktop` passaram em Windows. O smoke desktop executou Electron, dois PTYs reais e descoberta Git em fixture temporária, incluindo limpeza dos processos. A execução inicial no sandbox foi bloqueada ao criar a fixture Git; a execução autorizada fora do sandbox passou. A validação nativa em Ubuntu depende da CI do PR.

O PR #9 corrigiu a descoberta de adaptadores e foi integrado como `98c5728`, após `Verify (ubuntu-latest)` e `Verify (windows-latest)` verdes na execução 40314429850. `main` foi sincronizada e inspecionada antes de iniciar `codex/sqlite-operational-foundation`.

## Marco 2a — base SQLite

Implementação em validação conforme `docs/PLANO_SQLITE.md`: `electron/operational-store.cjs` registra projetos, sessões, runs e eventos atomicamente no SQLite embutido do Node/Electron. O banco fica no perfil do aplicativo. Migrations numeradas, foreign keys, WAL, controle de versão da run e backup consistente estão cobertos por testes. A autorização de diretórios continua no JSON existente; ler o banco não autoriza diretórios.

Uma única instância por perfil impede reconciliação concorrente de runs vivas. A saída natural confirmada vira `succeeded`/`failed`; fechamento ou crash não inventa sucesso: runs ainda ativas viram `lost`, com motivo explícito e sem exit code fictício. Nenhum transcript, prompt, entrada ou saída do PTY é gravado. Os cards ainda não são restaurados a partir desse histórico; essa é a próxima subdivisão do marco 2, junto de tarefas reais persistentes.

Validação local no Windows: `npm test` (35/35), `npm run test:agent` (20/20), `npm run build` e `npm run test:desktop` passaram. Os testes de store e ciclo dos agentes também passaram usando o Electron 45 em modo Node (24/24). O smoke verifica o banco real criado pelo processo principal e sua integridade. Revisão de código independente não encontrou falhas críticas/importantes; a observação de tratamento de erro no shutdown foi corrigida com regressão SQLite. A API `node:sqlite` em Node.js 24.14.0 ainda emite aviso experimental; isso é um limite conhecido, sem suprimir o aviso.

Bloqueio de ambiente: `npm run smoke:agent` foi tentado e falhou porque o Kimi Code não está no PATH nesta máquina. Não houve instalação global do CLI. O smoke desktop e os testes de ciclo de vida com SQLite podem ser validados independentemente; a demonstração real do Kimi e o aceite do orquestrador dependem de disponibilizar o CLI.

Tarefas, mensagens, evidências e os quatro cards iniciais continuam ilustrativos. Não há orquestrador conectado. O marco 2 completo, os demais marcos e os 12 passos de aceite da v0.1 permanecem pendentes.

O Kimi foi interrompido durante os testes de dois terminais e descoberta Git. Essa etapa foi concluída: os testes agora são reproduzíveis em `scripts/`, e os marcos confirmados foram atualizados no planejamento. O relatório técnico/visual está em `docs/VALIDACAO_DESKTOP.md`.

## Preparar a máquina 24h

Instale Git e Node.js 24 LTS. O desktop completo deste incremento exige Windows e Windows PowerShell. Em uma pasta de sua escolha:

```powershell
git clone https://github.com/armandocarlini/atlas.git
cd atlas
npm ci
npm test
npm run build
npm run check:public
npm start
```

Para desenvolvimento: `npm run dev:desktop`. Para mudanças de PTY, janelas ou aparência, valide também `npm run test:desktop`. A CI executa testes de contraste, build, fixture Git e verificação dos arquivos públicos em Windows e Linux. O smoke completo de janelas/PTY deve ser executado localmente no Windows.

O agente autônomo deve começar por `AGENTS.md` e `docs/AUTONOMIA_V0_1.md`. Esse contrato autoriza branches, PRs e merges por marco até a v0.1, desde que todos os gates e a CI estejam verdes. O primeiro marco é o adaptador Kimi real, sem alterar os limites do shell Electron já validado.

Prompt pronto para o modo goal na outra máquina:

```text
Conclua a v0.1 do ATLAS seguindo estritamente AGENTS.md e docs/AUTONOMIA_V0_1.md. Comece pelo adaptador Kimi real, encadeie planos e PRs por marco, faça merge somente com testes e CI verdes, e pare somente quando os 12 passos da seção 16 da arquitetura estiverem demonstrados com estado preservado após reinício. Registre evidências, limites e bloqueios em docs/CONTINUIDADE.md. Não avance para v0.2 e não publique release/tag.
```

## Interface

Antes de qualquer alteração de UI, verifique e invoque **ui-ux-pro-max** e **apple-design**, instalando e confirmando skills ausentes conforme `AGENTS.md`. Siga `design-system/atlas/MASTER.md` e preserve a UI discreta, as convenções do Windows, o espaço dos terminais e o contraste. Não reintroduza os três círculos decorativos de janela macOS.

## Cuidados técnicos estabelecidos

- Consultas Git usam `--no-optional-locks`; mesmo a leitura de status não deve atualizar o índice do usuário.
- A carga inicial não pode desfazer o projeto ou a worktree que o usuário acabou de escolher.
- Reproduzir scrollback não pode enviar respostas de consultas antigas do terminal como entrada nova ao PowerShell.
- Encerrar um PTY é idempotente; ao sair, o aplicativo encerra seus PowerShells filhos.
- O diretório de teste é temporário, com perfil Electron isolado. Não troque a fixture por um projeto real.
- Os testes públicos usam dados fictícios e mantêm resultados locais fora do Git.

## ai-memory e credenciais

O marcador `.ai-memory.toml` fixa a identidade `default/ATLAS`. Se a outra máquina usa o mesmo servidor ai-memory, poderá consultar o contexto ali. Se usa um servidor local diferente, esse histórico não viaja automaticamente com o clone; use este documento para retomar. Endereços privados de servidor, tokens e bancos devem ser configurados somente na máquina local.

Autentique Git/GitHub normalmente na outra máquina se precisar enviar mudanças. Não copie tokens, gerenciadores de credenciais, `.env` ou perfis de agentes para o repositório. Consulte `SECURITY.md` antes de anexar logs ou capturas.
