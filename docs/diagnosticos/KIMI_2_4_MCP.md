# Kimi 2.4: MCP antes da sessão e perfil da principal

Investigação iniciada em 31/10/2026, atualizada em 03/11/2026. **Este incremento entrega contenção e diagnóstico; a integração com o Kimi distribuído oficialmente ainda não está corrigida.** O ATLAS recusa novas runs da principal no Kimi 2.4.0 e 2.4.1. Não escolhe outro CLI pelo usuário, não reinicia sessões existentes e não altera o Kimi instalado.

## O que foi observado

1. O smoke começou com Kimi 2.4.0. O próprio CLI se atualizou para 2.4.1 durante a execução. A principal e a sessão manual, portanto, não usaram necessariamente o mesmo binário. Não houve atualização comandada pelo teste.
2. Antes de existir uma sessão interna do Kimi, houve conexões MCP breves, seguidas de desconexões. O log também registrou `runtime local does not exist in workspace …` e reconexões automáticas do CLI. Um `hello` isolado não prova que as ferramentas ficaram disponíveis para uma sessão.
3. O smoke passou pelo handshake manual e falhou ao exigir o badge depois de recarregar o renderer. Essa reprodução não demonstra um defeito de restauração do renderer: uma sondagem sem React também observou as desconexões.
4. Em uma home temporária com modelo fictício configurado, `/title atlas-profile-check` criou uma sessão local sem enviar mensagem ao modelo. Depois disso, a ponte permaneceu conectada.
5. **A sessão criada nesse caminho no Kimi 2.4.1 não preservou o perfil de leitura.** Mesmo com `--agent-file` apontando para o arquivo gerado pelo ATLAS, `agents/main/wire.jsonl` registrou `profile.bind` com `profileName: "agent"`, incluindo `Write`, `Edit`, `Bash`, subagentes e `mcp__*`. O esperado é `atlas-orchestrator`, somente `Read`, `Grep`, `Glob`, `mcp__atlas__*` e nenhum subagente. A observação vale para a criação local por `/title`; não houve teste com prompt de LLM.

Não foi executada nenhuma ferramenta de escrita pelo modelo. Os nomes acima são metadados do perfil efetivamente vinculado pelo CLI, não uma conclusão baseada em ANSI ou no texto do prompt.

A primeira versão do diagnóstico enviava texto e Enter no mesmo chunk do PTY: o Kimi tratou esse envio como colagem, e o teste terminou em timeout. O diagnóstico foi corrigido para enviar texto e Enter separadamente. Com o título exato persistido, a nova execução conectou a ponte e falhou na asserção do perfil. O timeout anterior não foi convertido em sucesso. Outra sondagem usou o `cwd` inteiro em minúsculas no Windows: a sessão continuou vinculada ao perfil `agent`, portanto essa mudança de caminho não resolveu a perda do perfil.

## Relação com o código oficial

Na tag oficial 2.4.0, [`listWorkspaceMcpServers`](https://github.com/MoonshotAI/kimi-code/blob/%40moonshot-ai/kimi-code%402.4.0/packages/node-sdk/src/sdk-rpc-client-v2.ts) adquire um workspace, aguarda a descoberta e libera a referência em `finally`. O [`WorkspaceInstanceManager`](https://github.com/MoonshotAI/kimi-code/blob/%40moonshot-ai/kimi-code%402.4.0/packages/agent-core-v2/src/workspace/workspaceInstance/workspaceInstanceManagerService.ts) fecha a instância quando a última referência é liberada. Isso explica as conexões transitórias observadas nas consultas anteriores à criação da sessão; não prova sozinho a causa de toda ocorrência de `runtime.not_found`.

O comando [`/title`](https://github.com/MoonshotAI/kimi-code/blob/%40moonshot-ai/kimi-code%402.4.0/apps/kimi-code/src/tui/commands/session.ts) usa `ensureSession` quando recebe um título e ainda não existe sessão. A [`TUI`](https://github.com/MoonshotAI/kimi-code/blob/%40moonshot-ai/kimi-code%402.4.0/apps/kimi-code/src/tui/kimi-tui.ts) pretende preservar o perfil de início na primeira criação tardia. A divergência entre essa intenção e o `profile.bind` observado ainda precisa ser resolvida no CLI ou por uma interface oficialmente suportada. A documentação de [`--agent-file`](https://moonshotai.github.io/kimi-code/en/reference/kimi-command.html) não autoriza presumir que o perfil foi aplicado só porque o arquivo foi aceito.

A revisão localizou a perda entre essas camadas: `doCreateSession` no SDK não encaminha `agentProfile`/`agentFiles`, e `materializeMainAgent` vincula `DEFAULT_AGENT_PROFILE_NAME`. O caminho aparece no [SDK 2.4.1](https://github.com/MoonshotAI/kimi-code/blob/2c73f3f/packages/node-sdk/src/sdk-rpc-client-v2.ts#L1400) e no [SDK 2.4.0](https://github.com/MoonshotAI/kimi-code/blob/%40moonshot-ai/kimi-code%402.4.0/packages/node-sdk/src/sdk-rpc-client-v2.ts#L1861). A 2.4.1 tem reprodução dinâmica limpa; na 2.4.0 há confirmação estática desse caminho, além da falha MCP já registrada.

Os IDs diferentes do trust e do workspace não provam defeito de casing: são derivados de normalizações distintas no Kimi. A sondagem com `cwd` em minúsculas não corrigiu o perfil; o produto não passou a alterar caminhos para tentar contornar isso.

## Reprodução sem quota nem configuração real

```powershell
npm run smoke:kimi-profile
```

Exige Windows, Node 24, dependências instaladas e Kimi no `PATH`. O diagnóstico:

- inicia o CLI diretamente em ConPTY, fora do bloqueio de compatibilidade do produto;
- usa `KIMI_CODE_HOME` e perfil em uma fixture temporária;
- desliga autoatualização com `KIMI_CODE_NO_AUTO_UPDATE=1` tanto na consulta de versão quanto no PTY; o smoke completo também desliga essa atualização;
- configura um modelo fictício contra um servidor HTTP da própria fixture em loopback e exige **zero requisições** a ele;
- instala a entrada MCP apenas nessa home temporária, usando a ponte e o host reais do ATLAS;
- confirma a confiança somente da fixture, executa `/title` com Enter separado, confere o título persistido exato, exige conexão persistente e verifica o perfil em `wire.jsonl`;
- encerra apenas o processo criado pelo diagnóstico e preserva a fixture quando falha.

Esse teste deve **falhar** enquanto o perfil efetivo divergir. Ele não transforma a incompatibilidade em `PASS`, não substitui o `smoke:agent` e não libera a troca de modelo na principal. Saídas e fixtures ficam fora do Git.

Há também uma etapa opcional para verificar a troca pelo seletor nativo:

```powershell
npm run smoke:kimi-profile -- --switch-model
```

Ela só começa se o perfil inicial estiver correto. Seleciona um segundo modelo fictício com `/model` e Alt+S, confere a identidade da sessão e do PTY, a manutenção do perfil e da ponte, a configuração intacta e zero chamadas ao provedor. A leitura do journal incorpora `config.update` e mudanças na lista de ferramentas, em vez de considerar apenas o último `profile.bind`. Isso é automação de teste numa fixture; o produto continua sem digitar no terminal.

Para uma sessão **manual** já configurada no Kimi, dar um título com `/title <nome>` pode materializar a sessão antes da primeira mensagem e estabelecer a ponte sem consumir quota. É uma ação do usuário no terminal. **Não usar esse caminho como solução da principal**, por causa da perda de perfil observada.

## Contenção no ATLAS

`agent-host.cjs` rejeita a criação da principal nas versões conhecidas afetadas **antes** de emitir token, criar PTY ou gravar sessão/run. A versão 2.4.0 já estava sem verificação completa do MCP; a perda do perfil foi confirmada diretamente na 2.4.1. `launchFor` também recusa gerar o lançamento incompatível. Sessões manuais continuam disponíveis, assim como o histórico. Versões futuras não são declaradas afetadas por extrapolação; também não são declaradas verificadas por esse diagnóstico.

O botão de troca de modelo da principal Kimi continua desabilitado. Não há fallback de CLI/modelo, flags de autonomia, escrita no terminal pelo produto, downgrade ou alteração de configuração real.

As runs Kimi iniciadas pelo ATLAS recebem `KIMI_CODE_NO_AUTO_UPDATE=1` somente no ambiente do processo. Isso impede que a própria inicialização troque o binário depois da verificação de compatibilidade; não grava a preferência de atualização do usuário nem afeta seus lançamentos fora do ATLAS. Uma atualização externa concorrente continua fora dessa garantia.

## Critério para resolver

1. Reproduzir com versão fixa do Kimi e identificar por que o perfil explícito não chegou ao `profile.bind` nesse caminho — identificado no SDK; patch experimental abaixo.
2. Fazer o diagnóstico nativo passar com o perfil de leitura correto, conexão persistente e zero chamadas ao provedor fictício — demonstrado no candidato local, ainda não numa distribuição oficial corrigida.
3. Fazer o `smoke:agent` completo passar, incluindo reinício e revogação de token, sem retirar as verificações existentes — demonstrado no candidato experimental, não na distribuição oficial.
4. Verificar a troca de modelo na principal: mesma run, PTY e sessão interna, ferramentas de leitura e ATLAS preservadas e MCP ativo — demonstrado no candidato experimental. A liberação do botão para uma distribuição oficial ainda depende de validá-la.

Não publicar release, atualizar o CLI do usuário ou abrir issue externa automaticamente como parte desta investigação.

## Patch experimental no código oficial

O [patch reproduzível](patches/kimi-code-2.4.1-profile.patch) foi preparado numa cópia temporária da tag `@moonshot-ai/kimi-code@2.4.1`, commit completo `2c73f3f50af4fa7f2540ca0d2e33b07a1408e3a7`. O arquivo de origem obtido do codeload oficial tem SHA-256 `040c503ca03f4852f827cb8d0ea50c49a535a6bda0177d47e56d34ea37d16c92`. Não há binário ou dependência vendorizados no ATLAS.

A correção altera três arquivos de produção do Kimi:

1. `KimiHarnessOptions` e `SDKRpcClientV2Options` recebem arquivos explícitos de perfil no escopo do processo; o cliente encaminha a lista ao bootstrap que já tem o loader correspondente.
2. O lançamento interativo encaminha `opts.agentFiles` para esse harness.
3. A criação de sessão encaminha `agentProfile` ao bind, inclusive sem override de modelo. Um novo bind usa o perfil solicitado ou o já vinculado, antes de considerar o perfil padrão. Um perfil inexistente deixa de ser substituído silenciosamente.

O patch inclui regressão sem prompt: perfil escolhido, arquivo fora da descoberta, independência entre sessões, troca de modelo e reabertura, nome inexistente, modelo vindo só da configuração e arquivo explícito ausente. O provedor é um servidor HTTP local que conta tentativas de chamada; o catálogo remoto é substituído por uma fixture pelo seam de teste do SDK. O teste não precisa de credenciais.

**Limite de escopo:** os arquivos explícitos são entradas do harness/processo, como os flags do lançamento interativo. O patch não implementa a semântica geral de arquivos diferentes por chamada de `CreateSessionOptions.agentFiles` em clientes SDK arbitrários. Também não tenta alterar a política de confiança, antecipar a criação da sessão pela interface ou manter vivo um workspace sem sessão.

Para reproduzir, aplique o patch em um checkout descartável desse commit, com Node 24.15 ou superior e pnpm 10.33.0. Depois de instalar as dependências fixadas pelo lockfile, execute a partir de `packages/node-sdk`:

```text
pnpm exec vitest run --config vitest.config.ts test/atlas-profile-regression.test.ts --reporter verbose
```

Não execute essa suíte pelo projeto Vitest da raiz: ele carrega também configurações de outros aplicativos do monorepo. A execução original confirmou a perda dos dois perfis e a aceitação indevida do nome inexistente; a primeira execução corrigida passou nesses três casos. Resultados ampliados e limitações de plataforma ficam no PR, sem converter timeout ou testes vermelhos em sucesso.

O candidato local usa as fontes corrigidas e um bundle gerado pelos scripts oficiais, executado com Node em TEMP. Ele não é uma distribuição oficial do Kimi e não foi instalado nem colocado no PATH permanente. A versão instalada, sua autenticação e sua configuração permanecem fora dessa experiência. Um resultado positivo desse candidato não libera a versão oficial 2.4.1 nem o botão da principal no ATLAS.

Nesse candidato, o diagnóstico nativo com `--switch-model` passou: `profileName: atlas-orchestrator`, ferramentas `Read`, `Grep`, `Glob`, `mcp__atlas__*`, nenhum subagente, ponte persistente e troca de `fixture-a` para `fixture-b` na mesma sessão/PTY com Alt+S. A configuração ficou idêntica e o servidor do provedor recebeu zero chamadas. Não foi enviado prompt ao modelo.

O lançamento direto das fontes via TSX excedeu o limite de versão do diagnóstico; foi substituído por um bundle compilado, sem aumentar o timeout. Uma execução ampliada do teste de regressão também excedeu 15 segundos num caso; a fixture foi isolada do catálogo externo e ganhou trace opcional de fases. A execução instrumentada passou nos cinco casos, mas isso não estabelece sozinho a causa exata daquele timeout. Esses resultados anteriores continuam registrados no PR.

A ampliação para o arquivo existente `sdk-rpc-client-v2.test.ts` encontrou cinco falhas no Windows: duas expectativas de formato de caminho e três criações de symlink recusadas com `EPERM`. A execução desse mesmo arquivo nas fontes originais reproduziu as cinco falhas com os mesmos nomes. Elas não foram corrigidas, suprimidas ou contadas como testes aprovados; a suíte ampliada do fornecedor continua vermelha neste ambiente.

## Validação integrada do candidato

O bundle corrigido foi identificado como `2.4.1+atlas-profile-fix.1`, apenas em TEMP e no PATH dos subprocessos de teste. O identificador descreve uma compilação modificada, não uma versão publicada. O bloqueio de 2.4.0/2.4.1 no produto não recebeu exceções.

O smoke completo semeia dois modelos fictícios e um provedor HTTP em uma home isolada antes de consultar o CLI. Cada sessão é materializada por `/title`, como uma ação local do usuário de teste. O journal precisa mostrar o perfil esperado; na principal, exige também `mcp__atlas__*`, não apenas ausência de escrita. A mesma execução confere troca nativa e declaração de modelo, o painel da sessão manual, pedidos aprovados, worktree, saída, revogação, persistência e reabertura sem PTY. O contador do provedor precisa continuar zerado e a configuração permanece idêntica.

O diagnóstico isolado também exige saída espontânea com código zero; encerramento forçado apenas limpa uma falha e nunca a transforma em aprovação. O resultado JSON do smoke completo só é publicado depois das verificações e do encerramento do provedor. Uma chamada tardia ao provedor grava falha, preservando eventual erro anterior.

As primeiras execuções integradas encontraram truncamento de apresentação: o diretório não cabia em `/status`, e o rodapé de atalhos não cabia no card. O teste amplia o PTY para conferir o caminho completo e identifica o seletor por seu título e opções; a troca continua comprovada no journal. O diagnóstico isolado também passou a aguardar o eco do comando antes do Enter, evitando que a inicialização agrupe as entradas como uma colagem. Os timeouts anteriores permanecem registrados no PR; não houve aumento dos limites nem retirada de asserções de perfil, modelo ou conexão.

## Estado no fornecedor (verificado em 03/11/2026)

- A última versão estável continua sendo a **2.4.1** (30/10/2026). Há apenas canários da 2.5.0, que não são distribuição oficial para o ATLAS.
- No `main` do repositório oficial, `doCreateSession` em `packages/node-sdk/src/sdk-rpc-client-v2.ts` ainda não encaminha `agentProfile`/`agentFiles` para sessões locais. A correção ainda não chegou ao código-fonte.
- O defeito já é conhecido upstream: issues [#2767](https://github.com/MoonshotAI/kimi-code/issues/2767) (TUI ignora `--agent-file` no início) e [#3857](https://github.com/MoonshotAI/kimi-code/issues/3857), e os PRs [#3855](https://github.com/MoonshotAI/kimi-code/pull/3855) e [#2832](https://github.com/MoonshotAI/kimi-code/pull/2832), abertos e aguardando revisão.
- Próxima verificação: quando sair uma versão estável acima de 2.4.1, rodar `npm run smoke:kimi-profile -- --switch-model` e `npm run smoke:agent` com ela, sem tocar na instalação real. Só depois disso liberar a principal e o botão de troca. Contribuir upstream é decisão do mantenedor.
