# Continuidade do desenvolvimento

Última atualização: 25/10/2026.

## Objetivo e critérios de qualidade

O ATLAS é um projeto público e open source de [Armando Ciciliano Carlini](https://github.com/armandocarlini), parte de seu portfólio profissional. O repositório é `armandocarlini/atlas`, a licença é MIT e o desenvolvimento deve manter uma apresentação profissional, decisões documentadas e validação reproduzível.

A visão completa está em `ATLAS_PLANEJAMENTO_ARQUITETURA.md`. O produto deve ser um cockpit desktop local, com orquestrador interativo, terminais de agentes visíveis, colaboração e estado persistente. Recursos ainda planejados não devem aparecer como entregues.

## Estado ao trocar de máquina

O shell Electron funciona com PowerShell real via node-pty/ConPTY e xterm.js. Há descoberta Git somente leitura em pastas autorizadas, branches/worktrees existentes, escolha de diretório para novos terminais, foco/grid, pop-up individual e reintegração preservando o PTY. As colunas laterais podem ser ocultadas; aparência e layout são salvos localmente. O acompanhamento usa uma janela nativa sempre no topo.

Os cards de Claude Code, Codex e Kimi, assim como tarefas, mensagens e evidências, continuam ilustrativos. Ainda não há adaptador real de agente, orquestrador conectado, SQLite ou persistência operacional. A próxima etapa é definir e implementar o primeiro adaptador real com um fluxo vertical verificável, respeitando os requisitos da arquitetura.

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
