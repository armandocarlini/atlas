# Autorização autônoma para concluir a v0.1

Este documento é o contrato operacional para o agente que continuará o ATLAS na máquina 24h. Ele delimita o que pode ser feito sem uma nova confirmação do usuário e quais evidências são necessárias antes de concluir cada marco.

## Escopo e limite

O escopo autônomo termina quando a **v0.1 completa** estiver integrada e demonstrada. Não avance para v0.2 ou itens posteriores e não publique release ou tag automaticamente.

A autorização abaixo vale para o **fluxo de desenvolvimento**: planejar, implementar, testar, criar branches e commits, abrir PRs e integrar marcos após checks verdes. Ela não remove aprovações que o próprio produto ATLAS deve exigir em runtime para ações executadas por agentes, especialmente operações externas, irreversíveis ou com efeitos colaterais.

## Loop obrigatório por marco

1. Leia `AGENTS.md`, `docs/CONTINUIDADE.md`, `README.md` e os trechos relevantes de `ATLAS_PLANEJAMENTO_ARQUITETURA.md`.
2. Verifique e sincronize `main` antes de criar uma branch nova.
3. Escreva um plano técnico específico, baseado no código atual, sem marcar trabalho como concluído por antecipação.
4. Implemente um fluxo vertical pequeno e testável.
5. Execute todos os gates aplicáveis e documente evidências e limites.
6. Atualize `docs/CONTINUIDADE.md` e a documentação afetada.
7. Crie commit, branch e PR com descrição clara dos testes executados.
8. Observe a CI em Ubuntu e Windows até um estado final verde explícito.
9. Faça merge normal/squash somente com checks verdes, sem force push e sem contornar branch protection. Se o merge automático do GitHub estiver disponível, habilite-o no PR.
10. Sincronize e inspecione `main` depois do merge e inicie o próximo plano sem pedir nova confirmação, desde que a v0.1 ainda não tenha terminado.

Cada marco pode ser subdividido para manter PRs pequenos. Nenhum item pode ser considerado concluído a partir de demonstração estática, cards ilustrativos, teste superficial ou estado não persistido.

## Marcos iniciais

A ordem pode ser ajustada somente por dependências técnicas documentadas:

1. Adaptador Kimi real.
2. SQLite, migrations e modelo operacional mínimo.
3. Orquestrador principal real e visível.
4. Delegação, mensagens, handoffs e worktrees sob política.
5. Evidências, revisão, comandos idempotentes e reconciliação após reinício.
6. Instalador Windows, integração `Abrir no ATLAS` e fechamento do aceite da v0.1.

## Plano técnico do primeiro incremento

Implemente primeiro o Kimi Code como adaptador real, preservando o shell Electron, os terminais PowerShell existentes e a interface atual.

- O primeiro CLI é Kimi Code 2.3.2. A instalação já observada na máquina de preparação é apenas evidência local, não uma regra de configuração: descubra o executável pelo `PATH`, execute `--version` com `execFile`, timeout e erro acionável. Não use shell, caminho pessoal fixo ou argumentos arbitrários vindos do renderer. Claude Code 2.1.119 também está instalado, mas não entra neste incremento.
- Crie `electron/agent-adapters.cjs` para metadados e descoberta e `electron/agent-host.cjs` para identidade, ciclo de vida e IPC.
- Exponha somente `agent:list-adapters`, `agent:create` e `agent:list`. Gere identidade no processo principal, valide cwd com `projectHost.isAllowedCwd` e mantenha neste marco apenas adaptador, versão, cwd, PTY e estado em memória.
- Reutilize o transporte PTY, xterm, resize, scrollback, pop-up e cleanup. Refatore `terminal-host.cjs` sem duplicar transporte.
- O estado operacional inicial é somente `running` ou `exited`; não infera estado por parsing de ANSI.
- A UI deve exibir nome, CLI detectado e worktree. Crie o card somente após o PTY existir, mostre a TUI nativa sem composer, preserve os campos ao exibir erro inline e distinga agente real dos cards ilustrativos.
- Não use `--auto`, `--yolo`, prompt inicial, SQLite, MCP/hooks, resume/checkpoint ou métricas fictícias neste marco. Permissões e modelo permanecem no harness.
- Acrescente testes unitários do adaptador/host e o comando `npm run test:agent`. Mantenha o smoke padrão determinístico e crie um smoke real opt-in com `KIMI_CODE_HOME` isolado, usando `/status` ou `/help` e depois `/exit`, sem enviar prompt ao modelo nem consumir tokens nesse teste inicial.

## Testes e regressões

Os gates mínimos por PR são:

- `npm test`;
- `npm run build`;
- `npm run check:public`;
- `npm run test:desktop` no Windows e sempre que houver mudanças desktop;
- `npm run test:agent` e futuros testes de adaptadores assim que esses subsistemas existirem.

Acrescente testes unitários, de integração e E2E proporcionais ao subsistema alterado. Todo bug corrigido deve ganhar uma regressão reproduzível. Inclua casos negativos e, quando pertinentes, concorrência, reinício, migrations, backup/restore e segurança, cobrindo progressivamente os cenários da seção 17 da arquitetura.

É proibido apagar ou enfraquecer testes para obter verde, esconder falhas com retries, reduzir cobertura para contornar regressão ou declarar sucesso com testes vermelhos, pulados, ausentes ou timeout. Não rode fixtures contra projetos reais. Testes de CLIs que enviem prompts devem ser pequenos, limitados e executados somente em fixtures, com provedores/credenciais já configurados e sem cadastrar cobrança ou novos segredos.

A CI deve terminar verde em Ubuntu e Windows. Em cada PR, registre comandos, ambiente, evidências e limites. Testes bloqueiam regressões conhecidas e reduzem risco; não garantem ausência total de bugs.

## Interface obrigatória

Antes de projetar, alterar ou revisar qualquer interface, verifique e invoque as skills **ui-ux-pro-max** e **apple-design**. Preserve as convenções do Windows e `design-system/atlas/MASTER.md`. A revisão deve considerar acessibilidade, foco, formulários, erros, contraste e comportamento modal conforme a alteração.

Se `ui-ux-pro-max` estiver ausente, instale pela fonte oficial `nextlevelbuilder/ui-ux-pro-max-skill`:

```powershell
npm install -g ui-ux-pro-max-cli
uipro init --ai kimi --global
```

Use `uipro init --ai universal --global` quando o destino for `~/.agents/skills/`.

Se `apple-design` estiver ausente, instale pela fonte oficial `dickwu/apple-design-skill`:

```powershell
npx skills add dickwu/apple-design-skill -g
```

Depois da instalação, recarregue a listagem/ambiente quando necessário e confirme que ambas as skills estão disponíveis e foram invocadas antes do trabalho de UI. Executar comandos de instalação sem verificação não comprova disponibilidade.

Não instale Python automaticamente. O ui-ux-pro-max exige Python 3; se ele estiver ausente ou a instalação/verificação falhar, registre bloqueio de ambiente e informe o usuário. Não contorne a exigência da skill nem altere o sistema operacional por conta própria.

## Segurança e bloqueios

- Não altere proteções do GitHub, credenciais ou políticas de execução.
- Não exponha segredos, perfis, tokens, bancos ou configurações locais.
- Não use force push, merge com CI vermelha/ausente, release, deploy ou ações destrutivas fora de fixtures.
- Instalações globais autorizadas ficam limitadas às duas skills de interface acima.
- Conflitos simples podem ser resolvidos preservando trabalho alheio e repetindo todos os gates.
- Bloqueio de credenciais, quota, skill/Python, decisão insegura, falha repetida após três ciclos de investigação ou CI sem solução deve interromper apenas o trabalho afetado e ser registrado. Não declare conclusão parcial como sucesso final.
- Atualize `docs/CONTINUIDADE.md` em cada marco com concluído, evidências, PR/commit, próximo marco e bloqueios.
- O repositório é a fonte portátil. ai-memory pode complementar a continuidade quando estiver configurado, mas não é pré-requisito.

## Condição final da v0.1

Conclua somente depois de demonstrar estes 12 passos da seção 16 da arquitetura:

1. O usuário clica com o botão direito em uma pasta e escolhe `Abrir no ATLAS`.
2. O ATLAS abre o projeto e apresenta a sessão principal do orquestrador.
3. O usuário descreve um objetivo e conversa diretamente com ele.
4. O usuário abre manualmente uma segunda sessão de agente no mesmo projeto.
5. O orquestrador cria um terceiro agente dentro da política aprovada.
6. A sessão manual envia uma descoberta estruturada ao orquestrador.
7. O orquestrador delega uma tarefa relacionada ao terceiro agente.
8. O usuário alterna entre os três terminais e intervém diretamente em um deles.
9. O trabalho ocorre em worktree autorizada e gera eventos e evidências.
10. A entrega entra em revisão e só é concluída após o aceite definido.
11. O ATLAS é fechado e reaberto.
12. Projeto, tarefas, mensagens e evidências permanecem; runs interrompidas são reconciliadas honestamente.

A demonstração deve preservar estado após reinício, documentar evidências e limites, integrar todos os PRs de trabalho e atualizar a continuidade. Não inicie v0.2 e não crie release/tag automaticamente.

## Prompt para iniciar a máquina 24h

Cole este objetivo no modo goal do agente, no diretório do clone:

```text
Conclua a v0.1 do ATLAS seguindo estritamente AGENTS.md e docs/AUTONOMIA_V0_1.md. Comece pelo adaptador Kimi real, encadeie planos e PRs por marco, faça merge somente com testes e CI verdes, e pare somente quando os 12 passos da seção 16 da arquitetura estiverem demonstrados com estado preservado após reinício. Registre evidências, limites e bloqueios em docs/CONTINUIDADE.md. Não avance para v0.2 e não publique release/tag.
```
