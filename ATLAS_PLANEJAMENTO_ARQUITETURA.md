# ATLAS — Planejamento de Produto e Arquitetura

> **Documento de handoff para o responsável pelo desenvolvimento**
> **Versão:** 0.2 — recorte local-first, desktop e open source
> **Data:** 25/10/2026
> **Origem:** revisão do `ARGOS_PLANEJAMENTO_ARQUITETURA.md` e das decisões posteriores do usuário
> **Nome:** ATLAS, escolhido para o planejamento; disponibilidade pública de marca, domínio e repositório ainda deve ser verificada
> **Idioma de produto:** português brasileiro (PT-BR), com internacionalização futura
> **Estado:** visão de produto consolidada; tecnologias e integrações marcadas como propostas ainda exigem validação técnica
>
> **Para o estado atual e a ordem de trabalho**, leia `docs/CONTEXTO.md` e `docs/ROADMAP.md`. Este documento é a visão de longo prazo; quando divergir deles sobre o que existe ou sobre a ordem, valem eles.

---

## 0. Instruções ao agente desenvolvedor

Este documento especifica o **ATLAS**, um aplicativo desktop open source, local-first, para orquestração e participação direta do usuário em trabalhos de desenvolvimento realizados por agentes de IA.

O ATLAS deve combinar quatro elementos que não podem ser separados na experiência principal:

1. **Uma sessão principal de orquestrador, visível e interativa.**
2. **Terminais reais, visíveis e interativos para agentes e shells.**
3. **Sessões criadas pelo orquestrador ou pelo usuário colaborando na mesma rede de trabalho.**
4. **Tarefas, mensagens, execuções e evidências persistentes, independentes dos transcripts dos CLIs.**

Não reduzir o produto a:

- um Kanban com agentes executando invisivelmente em segundo plano;
- um chatbot que esconde os CLIs e seus terminais;
- um launcher ou multiplexador de terminais sem coordenação e persistência;
- uma plataforma cloud que exija conta, servidor ou infraestrutura remota para o uso básico;
- uma coleção de integrações incompletas sem um fluxo central confiável.

### 0.1 Convenções

- **[REQ]:** requisito explícito do usuário.
- **[PROP]:** proposta arquitetural para atender aos requisitos.
- **[OPEN]:** decisão que depende de protótipo, auditoria ou escolha futura.

### 0.2 Regras de implementação

- Entregar incrementos verticalmente demonstráveis, não módulos extensos sem integração.
- Não presumir capacidades de modelos, CLIs, hooks, MCP, autenticação ou planos de assinatura sem teste.
- Não apresentar saída de terminal ou declaração de um agente como prova suficiente de conclusão.
- Não modificar código produtivo, inicializar Git, fazer merge, acessar segredos ou executar comandos destrutivos sem política e autorização adequadas.
- Não confundir funcionalidade planejada com funcionalidade implementada no README, releases ou demonstrações.
- Preservar o caráter local e instalável do produto; recursos remotos devem ser opcionais.

---

## 1. Visão do produto [REQ]

> **O ATLAS é um cockpit desktop local para conversar com um orquestrador, acompanhar e interagir com terminais de agentes, criar sessões manualmente e coordenar tarefas persistentes de desenvolvimento.**

O usuário deve poder deixar o ATLAS na barra de tarefas, ao lado do VS Code, usando os dois aplicativos em conjunto:

- no VS Code, inspeciona e edita código;
- no ATLAS, conversa com o orquestrador, cria sessões, delega, acompanha terminais, intervém e revisa entregas.

O ATLAS não pretende substituir o IDE. Seu foco é o trabalho agêntico: planejar, delegar, executar, comunicar, acompanhar, revisar e retomar.

### 1.1 Definição curta para o repositório

> **ATLAS — um cockpit local e open source para orquestrar agentes de desenvolvimento em terminais interativos, com tarefas persistentes, colaboração entre sessões e entregas baseadas em evidências.**

### 1.2 Problema

O usuário trabalha em diversos projetos e mantém vários agentes e sessões em paralelo. Com isso, torna-se difícil saber:

- o que está sendo feito agora;
- o que falta fazer;
- o que já foi efetivamente entregue e validado;
- qual agente ou sessão possui determinado contexto;
- onde uma tarefa parou e como retomá-la;
- quais sessões precisam de resposta ou intervenção;
- como fazer sessões manuais e automáticas colaborarem sem copiar contexto repetidamente.

### 1.3 Princípio central

> **A tarefa é a unidade estável do trabalho; a sessão é o espaço interativo de colaboração; a run é uma tentativa de execução; o terminal é uma interface viva; o agente desempenha uma função; o modelo é uma capacidade substituível; o usuário conserva governança.**

---

## 2. Decisões de produto já tomadas [REQ]

| Tema | Decisão |
|---|---|
| Nome de planejamento | ATLAS |
| Distribuição | Projeto público e open source no GitHub |
| Uso básico | Local, sem cloud ou conta obrigatória |
| Forma de entrega inicial | Aplicativo desktop Windows, não uma página web |
| Experiência principal | Sessão visível e interativa do orquestrador |
| Agentes | Terminais visíveis e interativos para cada sessão |
| Sessões manuais | O usuário pode abrir terminais e sessões por conta própria |
| Colaboração | Sessões manuais e automáticas podem conversar e cooperar |
| Estado operacional | Tarefas e evidências persistem fora dos CLIs |
| Integração Windows | Opção `Abrir no ATLAS` no menu de contexto de pastas |
| Uso com IDE | Aplicativo próprio para trabalhar lado a lado com o VS Code |
| Visão futura | Múltiplos provedores, AI Memory, iPhone e Voice-to-Prompt |

---

## 3. Escopo e não objetivos

### 3.1 O primeiro release público deve provar [REQ/PROP]

1. Abrir um projeto local pelo aplicativo ou pelo menu `Abrir no ATLAS`.
2. Iniciar e usar uma sessão principal de orquestrador em terminal interativo.
3. Criar manualmente outra sessão de agente e interagir com ela.
4. Permitir que o orquestrador crie uma sessão subordinada dentro de uma política aprovada.
5. Exibir e alternar entre os terminais, incluindo visualização lado a lado.
6. Trocar mensagens estruturadas entre sessões manuais e automáticas.
7. Criar, vincular e acompanhar tarefas persistentes.
8. Executar trabalho em branch/worktree isolada quando houver escrita.
9. Registrar eventos, alterações e testes como evidências.
10. Revisar uma entrega antes de marcar a tarefa como concluída.
11. Reabrir o aplicativo sem perder projetos, tarefas, mensagens, eventos e histórico.
12. Reconciliar sessões e runs interrompidas, sem fingir continuidade quando ela não existir.

### 3.2 Não objetivos do primeiro release [PROP]

- Aplicativo iOS ou acesso remoto pela internet.
- Voice-to-Prompt, embora permaneça na visão de produto.
- Runner remoto ou execução após o computador desligar.
- Autenticação multiusuário e colaboração entre pessoas.
- PostgreSQL, Redis, broker distribuído ou fila remota.
- Integração com todos os CLIs e provedores.
- Fallback automático cross-provider completo.
- Roteamento econômico sofisticado ou hierarquia recursiva de orquestradores.
- Dependência obrigatória do AI Memory.
- Editor de código completo, IDE ou ambiente de deploy.
- Garantia de que processos continuam executando com o aplicativo fechado.

Esses itens não foram descartados; estão posicionados no roadmap para não impedir a entrega de um núcleo local útil e confiável.

---

## 4. Experiência desktop [REQ/PROP]

### 4.1 Estrutura visual conceitual

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Projeto / Missão / Modo de autonomia / Controles                    │
├───────────────┬───────────────────────────────────────┬──────────────┤
│ ORQUESTRADOR  │ Terminal da sessão ativa              │ Tarefas      │
│ Sessão manual │                                       │ Pendências   │
│ Agente 1      │ Entrada e saída interativas           │ Mensagens    │
│ Agente 2      │ ANSI, teclado, resize e scrollback    │ Evidências   │
│ + Terminal    │                                       │              │
│ + Sessão      │                                       │              │
├───────────────┴───────────────────────────────────────┴──────────────┤
│ Status / CLI / modelo / worktree / eventos / custo quando disponível │
└──────────────────────────────────────────────────────────────────────┘
```

A disposição final deve ser validada em uso, mas os seguintes comportamentos são requisitos:

- o orquestrador é visualmente destacado e sempre fácil de acessar;
- sessões podem ser abertas em abas ou panes lado a lado;
- o usuário consegue digitar diretamente em cada terminal;
- cada sessão informa origem, CLI, estado, diretório/worktree e tarefa vinculada;
- mensagens e pedidos de atenção são visíveis sem exigir inspeção de todos os terminais;
- tarefas e evidências complementam os terminais, sem escondê-los;
- a interface prioriza densidade, legibilidade, atalhos e uso prolongado ao lado do IDE.

#### Direção visual de referência [REQ/PROP]

O usuário aprovou como referência visual a estética do Overclock apresentada no arquivo de trabalho `overclock-referencia-visual.png`. Os elementos desejados são:

- aparência escura de central de comando, sem estética de dashboard genérico;
- projetos organizados em abas superiores;
- missões/projetos e indicadores em navegação lateral compacta;
- sessão principal do orquestrador com hierarquia visual maior;
- demais sessões em cards ou panes densos, visíveis simultaneamente quando houver espaço;
- identidade cromática por sessão/agente, sem depender apenas de cor para comunicar estado;
- tipografia monoespaçada nos terminais e sans-serif legível na navegação;
- CLI, modelo, esforço, estado e consumo no cabeçalho da sessão quando os dados forem confiáveis;
- microinterações discretas e sensação de atividade viva, sem animações que prejudiquem leitura ou desempenho.

Adaptação para o ATLAS:

- panes redimensionáveis, abas e modo de foco para trabalhar ao lado do VS Code;
- as três colunas do workspace — navegação, terminais e painéis — podem ser reordenadas em qualquer sequência por uma faixa “Arrastar coluna” sempre visível no cabeçalho, inclusive posicionando a navegação entre os terminais e os painéis;
- Tarefas, Mensagens e Evidências permanecem na coluna de painéis: suas abas apenas mudam de ordem dentro dessa coluna e não podem ser arrastadas para fora dela; o arraste nunca começa no conteúdo dos terminais;
- durante o arraste de uma coluna, a própria coluna acompanha o cursor com todo o seu conteúdo real, sem criar uma cópia visual; um placeholder marca o espaço de destino e as demais colunas se reorganizam ao vivo para pré-visualizar o resultado antes de soltar; Escape cancela o movimento e restaura a ordem anterior;
- durante o arraste da aba de uma seção, uma prévia visual compacta acompanha o cursor, sem instruções textuais ou mensagens decorativas ocupando áreas vazias;
- ordem das colunas e ordem das seções dentro da coluna de painéis são persistidas localmente, com comando “Restaurar layout” para voltar ao padrão;
- indicação explícita de sessão `manual` ou `orquestrador` e sinal de mensagem não lida;
- painel contextual para tarefa, mensagens, diff, testes e evidências;
- densidade configurável, tipografia legível e contraste acessível, inclusive com foco visível e suporte a movimento reduzido;
- base visual neutra em preto profundo/grafite, sem gradientes decorativos, brilho genérico, emojis ou iconografia SVG decorativa; controles priorizam rótulos tipográficos discretos;
- cabeçalho compacto de sessão em uma única linha, com nome, origem, CLI, tokens e ações essenciais, sem copiar o design do Overclock;
- área de leitura do terminal tem prioridade sobre a quantidade de sessões visíveis: panes possuem altura útil mínima e o grid rola como um todo, evitando miniaturas de terminal que exigem scroll após poucas linhas;
- cor de destaque personalizável pelo usuário, com presets vivos e seletor de cor livre; preferência persistida localmente;
- padrão inicial laranja sobre base escura neutra, usado como destaque principal sem colorir decorativamente projetos, missões ou sessões comuns; verde, âmbar e vermelho ficam reservados a estados significativos, e as cores próprias dos harnesses permanecem contidas no conteúdo dos terminais; vermelho não é a identidade principal;
- identidade visual própria, sem copiar marca, mascote, ícones ou assets do Overclock;
- preview web/mobile apenas como painel opcional futuro, não requisito inferido do print.

A imagem é uma referência de trabalho fornecida pelo usuário. Verificar direitos de uso antes de incluí-la em repositório público ou material de divulgação.

### 4.2 Sessão principal do orquestrador [REQ]

O orquestrador não é apenas uma chamada de LLM executada secretamente pelo backend. Ele possui uma **sessão agêntica principal visível**, com a qual o usuário conversa diretamente.

Exemplo de fluxo:

1. O usuário descreve um objetivo no terminal do orquestrador.
2. O orquestrador examina o contexto autorizado e propõe um plano.
3. Conforme o modo de autonomia, solicita aprovação ou inicia a delegação permitida.
4. Cria sessões de agentes e acompanha eventos, handoffs e bloqueios.
5. O usuário abre qualquer sessão, intervém e retorna ao orquestrador.
6. O orquestrador replaneja com base em fatos, mensagens e evidências.

O orquestrador não deve consumir tokens em polling contínuo. Eventos técnicos devem ser tratados pelo núcleo; a LLM é acionada quando há decisão relevante.

### 4.3 Novo terminal, nova sessão e sessão externa [REQ/PROP]

Essas ações são distintas:

#### Novo terminal

- Abre PowerShell, WSL ou outro shell configurado.
- Possui PTY e diretório de trabalho.
- Não recebe automaticamente identidade de agente, papel ou modelo.
- Pode ser vinculado a um projeto para fins de organização.

#### Nova sessão de agente

- O usuário escolhe CLI/harness, modelo quando aplicável, diretório, worktree e escopo.
- O ATLAS inicia a sessão com identidade e integrações registradas.
- Pode ser independente ou vinculada a uma missão/tarefa.
- Participa da colaboração estruturada com outras sessões autorizadas.

#### Anexar sessão externa

- Permite descobrir ou registrar uma sessão iniciada fora do ATLAS.
- Depende de hooks/adaptadores e das capacidades do CLI.
- É uma evolução, não uma promessa do primeiro release.

Um processo arbitrário iniciado dentro de um terminal comum não deve ser tratado como sessão integrada sem registro e adaptador.

### 4.4 Sessões manuais e automáticas [REQ]

A origem da sessão não pode isolá-la da colaboração.

Toda sessão de agente, seja criada pelo usuário ou pelo orquestrador, deve possuir:

- identidade estável;
- escopo de projeto e, opcionalmente, missão/tarefa;
- origem `user` ou `orchestrator`;
- papel e capacidades;
- CLI/modelo quando disponíveis;
- terminal interativo;
- caixa de mensagens;
- política de permissões;
- histórico de runs e eventos;
- referências de contexto, handoffs e evidências.

Uma sessão manual não se torna automaticamente subordinada ao orquestrador. Ela pode colaborar diretamente com outras sessões, respeitando escopo e permissões.

### 4.5 Aprendizados das referências oficiais do Overclock [PROP]

O site do Overclock foi revisado como referência de produto. Os seguintes padrões são aderentes à visão do ATLAS:

- modo de uso direto no qual o usuário abre seus próprios panes e conversa com cada CLI;
- grid dinâmico com sessões lado a lado e maestro em destaque;
- missões como escopos de panes, status e worktrees;
- configuração MCP preparada no spawn para o agente nascer conectado às ferramentas;
- handoffs estruturados e duráveis, acordando o orquestrador por eventos;
- projetos em abas e retomada de sessões anteriores;
- busca no buffer do terminal e links de arquivos como melhorias posteriores de usabilidade;
- reordenação de panes e drag-out para outra janela/monitor como evolução, não requisito da `v0.1`.

Diferenciais que o ATLAS deve preservar:

- tarefas centrais, editáveis e persistentes, em vez de apenas um placar de marcos controlado pelos agentes;
- sessões manuais e automáticas com comunicação estruturada entre si, e não apenas execuções subordinadas a uma missão;
- evidências e revisão necessárias para conclusão, sem inferir `done` de atividade de terminal;
- uso local e open source, sem assinatura ou serviço central do ATLAS;
- integração opcional com AI Memory, sem criar outro sistema de memória por padrão.

As páginas públicas descrevem capacidades do produto de referência; sua presença aqui não representa auditoria independente nem promessa de comportamento idêntico no ATLAS.

### 4.6 Painéis destacados e acompanhamento sempre visível [REQ/PROP]

A coluna Painéis pode ser destacada do workspace e transformada em uma janela independente de acompanhamento. O objetivo é permitir que o usuário pesquise, use o IDE ou trabalhe em outro projeto enquanto continua vendo o andamento dos agentes sem manter a janela principal do ATLAS em foco.

- no aplicativo desktop, a janela destacada deve usar uma janela nativa com `always-on-top`, podendo sobrepor outros aplicativos do PC;
- a janela apresenta etapa atual, tarefas, progresso, mensagens, eventos e aprovações pendentes, com uma composição compacta adequada ao acompanhamento contínuo;
- destacar não cria uma segunda fonte de verdade: a janela consome o mesmo estado, eventos e permissões da coluna Painéis;
- o usuário pode mover a janela, reintegrá-la ao workspace e restaurar sua posição e dimensões anteriores;
- posição, dimensões, preferência de destaque e estado `always-on-top` devem ser persistidos localmente;
- uma aprovação crítica continua exigindo interação explícita e nunca é confirmada apenas porque a janela está acima de outros aplicativos;
- o wireframe web representa o destaque e a reintegração apenas dentro da página. Sobrepor qualquer aplicativo do sistema operacional é uma capacidade do shell desktop, não algo que uma página web comum possa garantir.

**Estado validado em 25/10/2026:** o shell Electron abre os Painéis em uma `BrowserWindow` nativa `always-on-top`, reintegra a coluna e sincroniza estado e aparência via `BroadcastChannel`. O smoke automatizado confirmou aba, tema e restauração das dimensões. Terminais PowerShell reais também podem ser destacados individualmente e reintegrados com o mesmo processo e histórico. As colunas laterais podem ser ocultadas e restauradas; layout, fundo e projetos autorizados sobrevivem à recarga. Dados de agentes, tarefas, mensagens e evidências continuam ilustrativos. Evidências e limites: `docs/historico/VALIDACAO_DESKTOP.md`.

---

## 5. Comunicação e colaboração entre sessões [REQ/PROP]

### 5.1 Modelo de comunicação

O ATLAS deve fornecer comunicação estruturada, e não exigir que agentes leiam ou copiem transcripts inteiros uns dos outros.

Canais previstos:

- **mensagem direta:** uma sessão envia uma pergunta ou informação a outra;
- **contexto de missão:** eventos e decisões relevantes compartilhados com participantes autorizados;
- **handoff:** transferência explícita de trabalho e contexto;
- **tarefa:** progresso, bloqueios, evidências e revisão associados ao trabalho;
- **intervenção humana:** o usuário fala diretamente em qualquer terminal.

Não transmitir todo output de terminal para todos os agentes. Isso aumentaria custo, ruído, exposição de dados e risco de prompt injection.

### 5.2 Ferramentas conceituais

```text
sessions.list
sessions.get
sessions.get_context
messages.send
messages.reply
messages.list_unread
handoff.offer
handoff.accept
handoff.reject
tasks.get
tasks.propose
tasks.claim
tasks.update_progress
tasks.report_blocker
tasks.submit_evidence
tasks.request_review
orchestration.request_agent
orchestration.request_user_approval
memory.search_relevant       # futuro e opcional
```

As ferramentas devem validar identidade, escopo, permissões e idempotency key. Nenhuma ferramenta de agente pode contornar os gates de revisão ou aprovação.

### 5.3 Regras de colaboração

- Mensagens são persistidas e correlacionadas a projeto, missão, tarefa e sessões.
- O destinatário recebe sinal de mensagem não lida sem depender de output acidental no terminal.
- O usuário pode inspecionar mensagens interagentes relevantes.
- Handoff contém objetivo, estado atual, decisões, próximos passos, referências Git e evidências.
- Memória, logs e mensagens recebidas são dados não confiáveis, não instruções que ampliam permissões.
- Comunicação entre projetos exige autorização explícita.
- O usuário pode silenciar notificações sem apagar o histórico.

---

## 6. Modelo conceitual [REQ/PROP]

### 6.1 Hierarquia de trabalho

```text
Workspace
└── Projeto
    ├── Repositórios/diretórios
    ├── Missões
    │   └── Tarefas/subtarefas
    ├── Sessões
    │   └── Runs
    ├── Mensagens e handoffs
    └── Evidências e aprovações
```

### 6.2 Distinções obrigatórias

- **Terminal:** componente de UI e transporte interativo ligado a um PTY; não representa conclusão ou estado canônico.
- **Sessão:** identidade interativa de shell ou agente, com escopo e participantes; pode atravessar mais de uma run quando houver retomada.
- **Run:** tentativa concreta de execução de um processo/CLI, com início, fim, falha ou perda.
- **Agente:** função desempenhada por uma sessão de agente; não é sinônimo de modelo.
- **Tarefa:** unidade durável do trabalho, independente da sessão que a executa.
- **Missão:** objetivo coordenado que agrupa tarefas e participantes.
- **Evidência:** artefato verificável associado a um critério ou revisão.

### 6.3 Estado da tarefa

```text
backlog → ready → in_progress → in_review → done
                  ↕                  ↕
               blocked            blocked
                  ↓                  ↓
               canceled           canceled
```

A máquina de estados final deve listar transições válidas; o diagrama não autoriza todas as transições implícitas.

Ao marcar `done`, registrar ator, horário, critérios atendidos, evidências e revisão exigida. `run.succeeded` não implica `task.done`.

### 6.4 Estado da run

`queued`, `starting`, `running`, `waiting_for_user`, `paused`, `recovering`, `succeeded`, `failed`, `canceled`, `lost`.

Se uma run perder comunicação, não marcar automaticamente a tarefa como pronta ou concluída. Persistir incerteza e reconciliar processo, arquivos, Git e efeitos externos.

### 6.5 Invariantes iniciais

- Uma tarefa só fica `ready` quando suas dependências obrigatórias estiverem satisfeitas.
- Uma run antiga não pode escrever eventos ou comandos como dona atual depois de perder seu lease.
- Uma sessão não assume uma tarefa sem claim válido.
- Duas runs não escrevem no mesmo alvo sem política explícita.
- Uma aprovação vale apenas para o payload, escopo e validade aprovados.
- Toda conclusão exige os critérios e evidências definidos pela política da tarefa.
- Uma sessão encerrada não apaga tarefa, mensagens ou histórico.
- Um handoff não transfere automaticamente permissões maiores que as do destinatário.
- Todo consumidor de comando ou evento deve tolerar duplicação.

---

## 7. Arquitetura local [PROP]

```text
┌──────────────────────── ATLAS Desktop ────────────────────────┐
│ Tauri + React/TypeScript                                      │
│ - Orquestrador e panes de terminal                            │
│ - Projetos, tarefas, mensagens e evidências                   │
└──────────────────────────┬────────────────────────────────────┘
                           │ IPC local / eventos
┌──────────────────────────▼────────────────────────────────────┐
│ Núcleo local                                                  │
│ - Comandos e políticas                                        │
│ - Scheduler e leases                                          │
│ - Sessões, runs e mensagens                                   │
│ - Tarefas, handoffs e evidências                              │
│ - Event log + outbox transacional                             │
│ - SQLite e migrações                                          │
└───────────────┬───────────────────────┬───────────────────────┘
                │                       │
       ┌────────▼────────┐     ┌────────▼────────┐
       │ PTY/session host│     │ Servidor MCP    │
       │ e adaptadores   │     │ local do ATLAS  │
       └────────┬────────┘     └────────┬────────┘
                │                       │
       ┌────────▼───────────────────────▼────────┐
       │ CLIs de agentes, shells e integrações   │
       └────────────────────┬────────────────────┘
                            │
                 ┌──────────▼──────────┐
                 │ Git/worktrees/testes│
                 └─────────────────────┘
```

### 7.1 Tecnologias candidatas

| Camada | Proposta inicial | Observação |
|---|---|---|
| Desktop | Tauri | Aplicativo Windows com janela e identidade próprias |
| Interface | React + TypeScript | Tecnologia de UI, não entrega como site |
| Terminal visual | xterm.js ou equivalente | Validar ANSI, teclado, resize e scrollback |
| Núcleo local | Node.js + TypeScript como sidecar | Validar empacotamento e atualização no Windows |
| Persistência | SQLite | Fonte canônica local, migrações versionadas |
| Comunicação UI/núcleo | IPC local e stream de eventos | Não abrir porta de rede desnecessária |
| Execução | PTY + adaptadores de CLI | Capacidades reais descobertas por adaptador |
| Integração agêntica | MCP local + hooks quando disponíveis | Não depender de parsing de ANSI para estado |
| Código | Git, branches e worktrees | Sem merge automático cego |

**OPEN:** comparar o sidecar Node com um núcleo Rust integrado ao Tauri após uma POC de PTY, SQLite e packaging. A decisão deve considerar confiabilidade de distribuição e manutenção, não apenas preferência de linguagem.

### 7.2 Instalação e dados

- O usuário comum baixa um instalador pela página de Releases.
- O colaborador clona o repositório e executa em modo de desenvolvimento.
- O uso básico não exige Docker, PostgreSQL ou conta externa do ATLAS.
- CLIs e provedores de IA são pré-requisitos apenas das integrações escolhidas.
- Configurações e banco ficam no diretório de dados do usuário, fora dos repositórios monitorados.
- Projetos são autorizados por caminho; não varrer o disco automaticamente.
- Segredos não são gravados em prompts, eventos ou transcripts persistidos pelo ATLAS.
- Não há telemetria por padrão.

---

## 8. Integração com o Windows Explorer [REQ/PROP]

O instalador pode oferecer a opção **“Abrir no ATLAS”**:

- no menu de contexto de uma pasta;
- no menu de contexto do espaço vazio dentro de uma pasta.

Comportamento:

1. Se o ATLAS estiver fechado, iniciar o aplicativo com o caminho recebido.
2. Se estiver aberto, focar a instância existente.
3. Validar e canonicalizar o caminho antes de qualquer ação.
4. Se o projeto já existir, abri-lo sem duplicação.
5. Se for novo, apresentar confirmação de cadastro.
6. Se não houver Git, informar a situação e não executar `git init` automaticamente.
7. Nunca interpolar o caminho recebido diretamente em uma linha de shell.

A integração deve ser opcional, removida corretamente na desinstalação e também controlável nas configurações. O suporte às variações de menu do Windows 10/11 deve ser validado em protótipo.

---

## 9. Adaptadores de CLI e terminais [REQ/PROP]

### 9.1 Requisitos do terminal

- PTY bidimensional e bidirecional.
- Entrada de teclado e atalhos direcionada ao processo real, sem substituir a interação própria do harness por um chat paralelo.
- A interface interativa exibida é a do harness real em execução: Claude Code, Kimi Code, Codex ou outro CLI conserva sua apresentação e seus controles dentro do terminal.
- O ATLAS não recria skins de CLIs nem aplica sua cor de destaque ao conteúdo ANSI; temas personalizam a moldura do app, enquanto a aparência interna segue o harness e as configurações do terminal do usuário.
- ANSI, cores e sequências de controle usadas pelos CLIs suportados.
- Resize coordenado entre UI e processo.
- Scrollback e seleção de texto.
- Panes e abas.
- Detecção de encerramento e desconexão.
- Reabertura do histórico estruturado sem presumir que o buffer visual completo sobreviveu.

### 9.2 Contrato conceitual

```typescript
interface AgentHarness {
  capabilities(): Promise<HarnessCapabilities>;
  start(spec: SessionSpec): Promise<SessionHandle>;
  observe(sessionId: string, cursor?: string): AsyncIterable<AtlasEvent>;
  sendInput(sessionId: string, input: string): Promise<void>;
  requestStop(sessionId: string): Promise<void>;
  checkpoint(sessionId: string): Promise<CheckpointResult>;
  resume?(spec: ResumeSpec): Promise<RunHandle>;
}
```

O contrato final deve nascer de um adaptador real e ser revisto ao integrar o segundo. Não fingir suporte uniforme a resume, checkpoint, modelos, esforço ou custo.

### 9.3 Separação entre transporte e verdade operacional

- O terminal transmite interação e output do processo.
- MCP, hooks e adaptadores transmitem fatos estruturados quando disponíveis.
- Git e testes fornecem evidências independentes.
- O estado da tarefa não é inferido apenas de texto ou ANSI.
- Logs brutos podem ser efêmeros ou ter retenção limitada; eventos essenciais são persistidos separadamente.
- Entrada de terminal não é registrada indiscriminadamente, pois pode conter segredos.

---

## 10. Orquestração e autonomia [REQ/PROP]

### 10.1 Modos

- **Manual:** o usuário cria sessões, escolhe modelos e atribui tarefas.
- **Assistido:** o orquestrador propõe plano e equipe e aguarda aceite.
- **Autônomo controlado:** o orquestrador delega dentro de limites previamente aprovados.

### 10.2 Limites

- Número máximo de sessões e runs simultâneas.
- Profundidade de delegação limitada.
- Orçamento e tentativas quando houver métricas confiáveis.
- Escopo de diretórios, ferramentas e provedores.
- Pausa imediata de missão com explicação do que foi interrompido.
- Ações irreversíveis sempre sujeitas a política específica.

### 10.3 Delegação proporcional

Nem toda tarefa precisa de equipe. Para uma alteração pequena e clara, o orquestrador pode trabalhar diretamente ou usar uma única sessão. Playbooks e estratégias reutilizáveis podem evoluir dessa regra, mas não devem criar overhead obrigatório.

---

## 11. Persistência e contratos [PROP]

### 11.1 Entidades iniciais

| Entidade | Responsabilidade |
|---|---|
| `workspaces`, `projects`, `repositories` | Escopo local e caminhos autorizados |
| `missions`, `tasks`, `task_dependencies` | Objetivos, trabalho e dependências |
| `agent_profiles` | Papéis e políticas reutilizáveis |
| `sessions`, `session_participants` | Identidade, origem e participação |
| `agent_runs`, `run_leases` | Tentativas de execução e propriedade atual |
| `messages`, `message_deliveries` | Comunicação estruturada e leitura |
| `handoffs` | Transferência semântica de trabalho |
| `commands` | Intenções persistidas e idempotentes |
| `run_events`, `audit_events`, `outbox_events` | Eventos, auditoria e entrega confiável |
| `worktrees`, `checkpoints` | Isolamento e recuperação |
| `evidence`, `reviews`, `approvals` | Aceite e rastreabilidade |
| `providers`, `models`, `model_invocations` | Configuração e métricas, conforme adapters |
| `memory_links` | Integração futura e opcional com AI Memory |
| `user_settings`, `project_policies` | Preferências e limites |

IDs estáveis, timestamps UTC, `correlation_id`, versões de esquema, índices, migrations e controle otimista são obrigatórios onde aplicável.

### 11.2 Comandos como cidadãos de primeira classe

Ações como iniciar, pausar, responder, enviar mensagem, cancelar e aprovar devem ser persistidas como comandos:

```text
command_id
command_type
target_id
payload
payload_hash
idempotency_key
status
created_by
created_at
completed_at?
result?
correlation_id
```

O sistema deve assumir entrega pelo menos uma vez e processamento idempotente, não prometer `exactly once`.

### 11.3 Leases e fencing

Heartbeat sozinho não impede uma run antiga de continuar agindo após perder propriedade. Cada claim/lease deve carregar epoch ou fencing token crescente, validado nas operações protegidas.

### 11.4 Eventos representativos

```text
project.opened
session.created
session.attached
run.started
run.waiting_for_user
run.succeeded
run.failed
run.lost
message.sent
message.read
handoff.offered
handoff.accepted
task.created
task.ready
task.assigned
task.review_requested
task.completed
approval.requested
approval.resolved
evidence.recorded
```

---

## 12. Evidências, revisão e Git [REQ/PROP]

Uma evidência estruturada pode conter:

- projeto, repositório e worktree;
- commit-base, branch e commit final;
- diff ou referência imutável;
- comandos executados e exit codes;
- ambiente e versões relevantes;
- testes executados, resultados e artefatos;
- autor da evidência e mecanismo de coleta;
- distinção entre declaração do agente e verificação do sistema.

Um teste verde comprova apenas que determinado teste passou naquele ambiente. Não é prova universal de correção.

Regras:

- worktree isolada para trabalhos com escrita que possam conflitar;
- lease de escrita e política para recursos compartilhados;
- nenhum merge automático cego;
- `in_review` antes de `done` quando a política exigir;
- merge, deploy, migrations destrutivas e acesso a segredos exigem aprovação específica;
- fallback ou retry não pode repetir efeitos externos sem reconciliação.

---

## 13. Recuperação e comportamento ao fechar [REQ/PROP]

No primeiro release, o ATLAS pode interromper seus processos filhos ao fechar, desde que:

- o comportamento seja explícito para o usuário;
- tarefas, mensagens, comandos e eventos já persistidos não sejam perdidos;
- runs interrompidas sejam marcadas de forma honesta;
- a reabertura reconcilie processos e estado do repositório;
- a retomada nativa só seja oferecida quando o adapter a suportar;
- a alternativa seja nova run com handoff semântico e contexto reconstruído.

Não prometer que uma sessão continua viva ou idêntica após reinício. Um runner independente que sobreviva ao fechamento da UI pode ser introduzido posteriormente.

---

## 14. Segurança local [REQ/PROP]

Embora seja pessoal e local, o ATLAS executa processos com acesso potencial ao código e às credenciais do usuário.

Requisitos mínimos:

- autorização explícita de diretórios e projetos;
- menor privilégio possível por sessão e ferramenta;
- políticas distintas para leitura, escrita e ações externas;
- aprovação vinculada a `payload_hash`, escopo e expiração;
- verificação da aprovação também no ponto de execução;
- proteção contra prompt injection em arquivos, logs, memória, mensagens e web;
- nenhum segredo enviado desnecessariamente à UI ou a outro agente;
- retenção configurável e aviso sobre transcripts;
- backup/restore e migrações testadas;
- sem portas de rede expostas por padrão;
- sem telemetria por padrão;
- integração do Explorer sem execução de caminho como comando shell.

---

## 15. Roadmap incremental

### Requisitos preservados para releases posteriores [REQ]

O recorte do primeiro release não elimina os seguintes requisitos da visão do ATLAS:

#### Escolha de modelos e economia

- Orquestrador de alta capacidade para planejamento, supervisão e decisões complexas.
- Agentes mais econômicos quando forem suficientes para a tarefa.
- Escolha de provedor, CLI, modelo e esforço por função, projeto, tarefa ou execução, respeitando a configuração mais específica.
- Modos automático e manual, incluindo possibilidade de fixar ou proibir provedores.
- Avaliação do custo de retrabalho e tentativas, não apenas do preço nominal por token.

#### Fallback entre provedores

- Cadeias de fallback configuráveis por função e compatíveis com as capacidades exigidas.
- Classificação de timeout, rate limit, quota, autenticação, modelo removido, resposta inválida e falha de runner.
- Retry limitado, circuit breaker e reconciliação antes de repetir ações com efeitos colaterais.
- Nova run relacionada à mesma tarefa quando houver troca de modelo, com handoff semântico.
- Aviso ao usuário sobre modelo anterior, novo modelo, motivo e possível impacto financeiro.
- Pausa informada quando nenhuma alternativa autorizada e compatível estiver disponível.

#### AI Memory

- Integração opcional por MCP, hooks ou outras interfaces oficiais, sem acessar diretamente seu banco privado.
- AI Memory para conhecimento, decisões, contexto e continuidade; ATLAS para estado operacional, permissões e evidências.
- Seleção limitada de memórias relevantes, segregação por projeto e tratamento do conteúdo recuperado como não confiável.
- Degradação explícita sem interromper o núcleo quando o serviço de memória estiver indisponível.

#### iPhone e acesso remoto

- Cliente capaz de comandar, não apenas monitorar: criar missões, enviar instruções, responder agentes, aprovar ações e revisar entregas.
- Processamento em runners autorizados, nunca dependência de compilação ou execução contínua no iPhone.
- Notificações push e inbox persistente para perguntas, falhas, fallback e limites.
- Backend remoto, autenticação forte e runners conectados por conexão de saída autenticada quando esse modo for implementado.
- Nenhum desses componentes remotos é necessário para o funcionamento local do desktop.

#### Voice-to-Prompt

- Ditado em PT-BR com transcrição progressiva no desktop e no iPhone.
- Trechos parciais e finais sem duplicação, pausa, reconexão e edição antes do envio.
- Envio exclusivamente explícito; nunca enviar automaticamente ao detectar silêncio.
- Modos de transcrição fiel e organização opcional do prompt, com comparação antes do envio.
- Dicionário técnico, fallback de STT, privacidade de áudio e retenção desativada por padrão quando não necessária.
- Disponível para o orquestrador e para interações com sessões individuais.

### Fase 0 — Provas técnicas [PROP]

- [x] Escolher um CLI inicial e testar PTY interativo real no Windows (Kimi Code).
- [x] Validar ANSI, resize, teclado, stop e comportamento de saída no terminal PowerShell real do shell Electron.
- [x] Validar núcleo local + SQLite em build empacotado. Decisão: Electron em vez de Tauri.
- [x] Testar MCP/hooks do CLI sem presumir capacidades iguais em outros (Kimi e OpenCode, cada um com seu mecanismo).
- [x] Provar criação segura de worktree. Decisão: o ATLAS não remove worktrees nem branches.
- [x] Prototipar `Abrir no ATLAS` e remoção da integração.
- [ ] Definir ADRs para núcleo, PTY, IPC, SQLite, packaging e MCP.

**Entrega:** matriz de capacidades testada e decisões de implementação justificadas.

### Fase 1 — Cockpit local mínimo [REQ/PROP]

- [x] Aplicativo desktop e abertura de projeto por seletor nativo de pastas autorizadas.
- [x] SQLite, migrations, projetos, tarefas e eventos.
- [x] Terminal comum interativo PowerShell, com diretório/worktree selecionável.
- [x] Sessão de agente manual com um adaptador real.
- [x] Sessão principal do orquestrador visível.
- [x] Panes/abas, estados e persistência básica, incluindo sessões e estado operacional no SQLite.

**Aceite:** o usuário abre uma pasta, conversa com o orquestrador, cria manualmente uma sessão e interage com os dois terminais.

**Incremento do cockpit validado em 25/10/2026 (histórico; a Fase 1 foi concluída depois, nos marcos 1 a 3):** dois PTYs independentes, pop-up individual com reintegração, colunas recolhíveis, fundo personalizável, revisão de contraste/foco e descoberta Git somente leitura com branches/worktrees existentes. Isso não conclui a Fase 1: adaptadores reais de agentes, orquestrador e SQLite permanecem pendentes. A fixture de teste cria worktrees para validar a descoberta; o produto ainda não cria nem remove worktrees do usuário.

### Fase 2 — Delegação e colaboração [REQ/PROP]

- [x] Criação de agente pelo orquestrador dentro de política.
- [x] Identidade e inbox para toda sessão de agente.
- [x] Mensagens diretas entre sessões. Contexto de missão (agrupar tarefas sob um objetivo) ainda não existe.
- [x] Claims, leases, fencing e worktrees.
- [x] Handoff estruturado e pendências do usuário.
- [x] Plano assistido e modo manual.

**Aceite:** uma sessão manual envia uma descoberta ao orquestrador; ele delega trabalho relacionado a outro agente; o usuário acompanha e intervém nos três terminais.

### Fase 3 — Entrega confiável e release público [REQ/PROP]

- [x] Critérios de aceite, evidências e revisão.
- [x] Comandos idempotentes e reconciliação após reinício.
- [x] Aprovações e trilha de auditoria.
- [x] Instalador Windows e `Abrir no ATLAS`.
- [x] Testes automatizados e smoke tests com CLI real.
- [x] README, demonstração e documentação da `v0.1` (aceite em `docs/historico/ACEITE_V0_1.md`).
- [ ] Release `v0.1`, por decisão do mantenedor.

**Aceite da `v0.1`:** demonstrar o fluxo completo da seção 16 e preservar o estado após fechar e reabrir o aplicativo.

### Fases posteriores [PROP]

- **v0.2:** playbooks, paralelismo ampliado, mais políticas e anexar sessões externas.
- **v0.3:** AI Memory opcional e novos adaptadores (o segundo adaptador, OpenCode, já entrou na v0.1).
- **v0.4:** catálogo de modelos, quotas, custos, fallback e relatórios.
- **v0.5:** runner independente da UI e recuperação ampliada.
- **Futuro:** acesso remoto, iPhone, notificações push, Voice-to-Prompt e runners cloud.

---

## 16. Fluxo de aceite central da `v0.1` [REQ]

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

Esse fluxo é o principal diferencial do release e não deve ser substituído por uma demonstração apenas de Kanban, chat ou logs.

---

## 17. Qualidade e testes [PROP]

### Núcleo

- Transições e invariantes de tarefas e runs.
- Comandos repetidos e eventos duplicados.
- Duas sessões tentando reivindicar a mesma tarefa.
- Lease expirado e fencing de uma run antiga.
- Aprovação com payload alterado ou expirado.
- Backup, restore e migrations.

### Terminal e sessões

- Entrada/saída bidirecional e resize.
- ANSI e interfaces interativas do CLI suportado.
- Stop, crash, processo órfão e reabertura da UI.
- Alternância entre múltiplos panes sem mistura de streams.
- Sessão manual e automática no mesmo escopo.

### Colaboração

- Entrega de mensagem e leitura idempotente.
- Handoff aceito, rejeitado e duplicado.
- Isolamento entre projetos.
- Prompt injection em mensagem, memória ou arquivo.
- Ausência de broadcast indiscriminado de terminal.

### Git e evidências

- Conflito de worktree e de arquivos.
- Diff e commit associados à run correta.
- Teste executado com exit code registrado.
- `run.succeeded` sem transição automática indevida para `task.done`.

### Distribuição

- Instalação, atualização e desinstalação no Windows.
- Entrada `Abrir no ATLAS` adicionada e removida corretamente.
- Caminhos com espaços, Unicode e caracteres especiais.
- Aplicativo sem dependência de serviço cloud para o fluxo local.

---

## 18. Repositório público e portfólio [REQ/PROP]

O repositório deve demonstrar engenharia e honestidade de escopo:

- README com problema, proposta, screenshots e limitações;
- quickstart testado para usuário e para colaborador;
- GIF ou vídeo curto do fluxo principal;
- diagrama da arquitetura local;
- ADRs das decisões estruturais;
- licença definida antes do release;
- guia de contribuição e código de conduta quando apropriado;
- política de segurança;
- roadmap separado entre implementado e planejado;
- releases pequenas e rastreáveis;
- issues reproduzíveis e critérios de aceite;
- nenhum segredo, banco pessoal, caminho sensível ou configuração privada versionado;
- nenhuma alegação de compatibilidade não testada.

A força do projeto para portfólio deve estar no modelo de sessões, colaboração, recuperação, terminal interativo e evidências — não na quantidade de logos de provedores.

---

## 19. Decisões em aberto [OPEN]

| Tema | Como decidir |
|---|---|
| Nome público ATLAS | Verificar repositório, marca, domínio e identidade antes do lançamento |
| CLI inicial | POC de interação, MCP/hooks, stop e recuperação |
| Núcleo Node sidecar ou Rust | Comparar PTY, packaging, manutenção e desempenho |
| Biblioteca de terminal | POC com o CLI escolhido |
| Integração Explorer | Protótipo nos alvos Windows suportados |
| Política de retenção de scrollback | Avaliar utilidade, disco e risco de segredos |
| Runner independente da UI | Introduzir apenas quando sobrevivência da sessão for requisito implementado |
| AI Memory | Validar instalação e interfaces oficiais antes da integração |
| Modelos e esforço | Descobrir capacidades reais em runtime |
| Hosting/remoto/iOS | Decidir somente após o núcleo local estar validado |

---

## 20. Referências

- **Planejamento anterior:** `ARGOS_PLANEJAMENTO_ARQUITETURA.md`.
- **Overclock:** <https://overclock.sh/> — referência de produto informada pelo usuário para maestro, sessões e terminais; não presumir compatibilidade interna.
- **Alethe Orchestrate Skill:** <https://github.com/Kc1t/alethe-orchestrate-skill> — referência de playbooks, delegação, worktrees, limites e relatórios; não é modelo do cockpit de terminais do ATLAS.
- **Vídeo da Alethe:** <https://www.youtube.com/watch?v=ujW-e6w3NQA&t=1354s>.
- **AI Memory:** <https://github.com/akitaonrails/ai-memory> — integração futura e desacoplada, por interfaces oficiais.
- **AI Memory — Managed Workstreams:** <https://github.com/akitaonrails/ai-memory/blob/main/docs/managed-workstreams.md>.
- **AI Memory — Windows:** <https://github.com/akitaonrails/ai-memory/blob/main/docs/windows.md>.

Referências de produto servem para conceitos, não para copiar implementação proprietária nem presumir APIs estáveis.

---

## 21. Resumo executivo

Construir o **ATLAS** como um aplicativo desktop Windows, open source e local-first, centrado em uma **sessão principal de orquestrador visível e interativa**.

O usuário pode criar seus próprios terminais e sessões, enquanto o orquestrador pode criar agentes sob políticas controladas. Todas as sessões de agente registradas, independentemente da origem, participam da mesma rede de mensagens, handoffs, tarefas e evidências. Cada sessão possui terminal real; nenhuma fica reduzida a um log oculto.

A `v0.1` deve provar um único fluxo completo: abrir projeto, conversar com o orquestrador, criar sessão manual, delegar a outro agente, colaborar entre sessões, intervir nos terminais, revisar evidências e recuperar o estado após reabrir o aplicativo.

A visão posterior inclui múltiplos CLIs, AI Memory, playbooks, fallback, custos, iPhone e Voice-to-Prompt. Esses recursos devem ampliar o núcleo, não atrasar nem substituir a experiência central.

> **Critério norteador:** o usuário deve conseguir ver e tocar o trabalho de cada agente, conversar com o orquestrador e com qualquer sessão, e ainda assim confiar que tarefas, mensagens, permissões e evidências não dependem da sobrevivência de um terminal.
