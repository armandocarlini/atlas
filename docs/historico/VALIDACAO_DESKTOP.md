# Validação do cockpit desktop ATLAS

Data: 25/10/2026. Continuação da sessão interrompida do Kimi, a partir do smoke de dois terminais e da fixture Git.

## Resultado

O incremento de shell desktop, terminais PowerShell, descoberta Git, janelas destacadas e personalização passou no build, nos três testes de contraste e no smoke automatizado com Electron e PTYs reais no Windows. Adaptadores de agentes, orquestração, SQLite, tarefas e evidências persistentes ainda não foram implementados.

## Como reproduzir

```powershell
npm test
npm run build
npm run test:desktop
```

O smoke usa uma pasta temporária, preferências isoladas, um repositório bare local, um clone e uma worktree com espaços e acentos no caminho. A autorização de pasta é simulada exclusivamente no ponto de entrada de teste; a UI e os handlers de produção continuam sendo exercitados. Os comandos Git da fixture podem escrever nela; a descoberta do produto é validada como somente leitura, comparando o índice byte a byte, inclusive depois de alterar apenas o timestamp de um arquivo sem mudar o conteúdo.

O controle de janelas e a depuração são exclusivos de `scripts/smoke-app.cjs`. O aplicativo normal inicia por `electron/main.cjs` e não carrega esse servidor de teste. O runner retira o `PSModulePath` injetado pelo runtime do Codex para usar os módulos nativos do Windows, sem alterar preferências ou política de execução da máquina.

## Evidências verificadas

| Fluxo | Verificação |
| --- | --- |
| Git | Branches e duas worktrees agrupadas; upstream/ahead; arquivos staged, modificados e não rastreados; índice inalterado |
| Diretório | PowerShell inicia na worktree selecionada, incluindo acentos no caminho |
| Teclado e saída | Entrada e saída Unicode; os marcadores esperados são compostos no PowerShell, evitando confundir eco do comando com execução |
| Resize e Ctrl+C | Dimensões reais do console mudam; um `Start-Sleep` é interrompido e o shell aceita outro comando |
| Dois terminais | PIDs diferentes; saída de um terminal não aparece no outro |
| Pop-up individual | Mesmo PID; comando executado na janela; histórico preservado ao reintegrar |
| Acompanhamento | Janela nativa sempre no topo; tema e aba sincronizados; largura restaurada ao reabrir |
| Layout | Ocultar/restaurar ambas as colunas; visibilidade preservada após recarga; controles disponíveis em 940px |
| Aparência | Presets claro/escuro; fundo personalizado propagado ao pop-up e salvo após recarga |
| Acessibilidade | Modal recebe foco e mantém Tab; medições do texto visível do cockpit/modal sem contraste inferior a 4,5:1 nos estados medidos |
| Encerramento | Estado de saída publicado; fechar novamente é seguro; os PIDs de PowerShell deixam de existir; Electron sai antes da remoção da fixture |

Os arquivos da última execução ficam em `.atlas-smoke-results/`: `result.json`, auditorias de contraste e capturas de tela. Essa pasta é ignorada no controle de versão. A fixture de uma execução bem-sucedida é removida depois que os processos saem; em caso de falha, seu caminho é registrado para diagnóstico.

## Revisão visual: ui-ux-pro-max e apple-design

**Avaliação: boa, dentro do escopo medido.** A função principal é dar espaço a terminais de desenvolvimento com controles discretos e recuperáveis. Foram mantidos os controles nativos do Windows, a tipografia local e a identidade laranja do ATLAS. As recomendações Apple foram aplicadas como princípios de legibilidade, hierarquia e interação no Electron; não foram reproduzidas convenções específicas do macOS.

### Problemas corrigidos

- **Contraste alto impacto:** o laranja original sobre a superfície clara tinha aproximadamente 1,81:1. Texto e foco agora usam um token ajustado; no tema Névoa, `#69472A` sobre a superfície derivada mede aproximadamente 6,73:1. Cores de tarefas, metadados e estados também usam tokens semânticos. Referência: `apple-design/references/hig/accessibility.md › Vision`, “Strive to meet color contrast minimum standards.”
- **Teclado:** modais agora recebem foco, impedem Tab para o conteúdo ao fundo e devolvem o foco ao fechar. O ui-ux-pro-max retornou as diretrizes de foco visível e foco não oculto para a busca `keyboard focus modal`. Referência: `apple-design/references/hig/keyboards.md › Best practices`, “Support Full Keyboard Access when possible.”
- **Navegação compacta:** a largura mínima mantém texto e controles para abrir terminais e ocultar/restaurar colunas. Foi removida a redução dos rótulos a letras isoladas. Referência: `apple-design/references/hig/sidebars.md › Best practices`, “Consider letting people hide the sidebar.”
- **Hierarquia e espaço:** lista Git e rodapé da navegação não se sobrepõem quando há mais repositórios; instruções permanentes de arraste e recipientes de ícones vazios foram retirados. Referência: `apple-design/references/hig/layout.md › Visual hierarchy`, “Use progressive disclosure to make layouts cleaner and easier to interact with.”

### Correções funcionais encontradas na validação

- A descoberta usa `git --no-optional-locks`, evitando atualizar o índice durante consultas.
- A conclusão tardia da inicialização preserva a pasta/worktree já escolhida e os projetos já carregados.
- O host usa o ConPTY fornecido pelo node-pty e evita encerrar novamente um processo em encerramento ou já encerrado.
- A reprodução do scrollback não envia respostas automáticas de consultas antigas de volta ao shell. Esse caso foi reproduzido no pop-up com consultas de atributos do terminal.

## Limites e próximos marcos

- A validação usa Windows PowerShell; os cards Claude Code, Codex e Kimi continuam ilustrativos.
- Estado de sessões e scrollback não é persistido após recarga/reinício. A persistência validada é de aparência, layout, pastas autorizadas e dimensões dos Painéis.
- A auditoria automatizada mede os textos do cockpit e dos modais nos estados exercitados. Não certifica leitores de tela, todos os estados de interação ou cores ANSI escolhidas pelo shell/harness.
- O produto descobre worktrees existentes. Criar e limpar a fixture não prova gerenciamento de worktrees do usuário pelo ATLAS.
- O build emite aviso de bundle maior que 500 kB; empacotamento/instalador, assinatura, integração Explorer e validação em outras máquinas permanecem pendentes.
- O diretório ATLAS foi recebido sem `.git`. Após a validação do cockpit, o mantenedor autorizou sua preparação e publicação como projeto open source; a continuidade está documentada em `docs/CONTINUIDADE.md`.
