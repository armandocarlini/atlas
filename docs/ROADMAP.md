# Roadmap do ATLAS

Última revisão em 12/11/2026.

Este arquivo diz **o que vem depois e em que ordem**. O estado atual está em `docs/CONTEXTO.md`. A visão completa e os requisitos de longo prazo estão em `ATLAS_PLANEJAMENTO_ARQUITETURA.md`. Quando os dois divergirem sobre ordem ou escopo, vale este arquivo.

Itens marcados **[decidir]** dependem de uma decisão do mantenedor antes de virar plano técnico. Nenhum agente deve implementá-los por conta própria.

## Concluído — v0.1

O aceite dos 12 passos foi demonstrado em 27/10/2026 (`docs/historico/ACEITE_V0_1.md`, PR #30). A publicação (release e tag) é decisão do mantenedor.

## Agora — ajustes observados no aceite

São correções da v0.1, sem mudar o escopo do produto.

1. **Perfil e troca de modelo do Kimi.** O Kimi 2.5.2 voltou a reproduzir a perda do perfil de leitura, documentada para 2.4.0/2.4.1 em `docs/diagnosticos/KIMI_2_4_MCP.md`. Validar a correção do fornecedor e o smoke da troca de modelo em uma versão oficial recente.
2. **Acompanhar as intermitências** do instalador silencioso e do `test:desktop` (veja `docs/CONTEXTO.md`). O timeout de captura voltou com renderer oculto, mesmo após a hipótese de oclusão; o smoke agora exige janela visível e um frame antes de capturar. A digitação do comando de dimensões também aguarda o prompt do PowerShell. Investigar novas ocorrências; não reexecutar às cegas.
3. **Coordenação real pela principal — entregue.** Plano: `docs/planos/PLANO_COORDENACAO_PRINCIPAL.md` (aprovado pelo mantenedor em 12/11/2026). Falta o primeiro uso real com modelo. No primeiro uso real, a principal pediu o agente certo, mas ele abriu parado, e ela não conseguiu criar tarefas. A correção tem duas partes:
   - **`tasks_create` para a principal:** ela cria a tarefa e pede o agente com `taskId` e `worktree: true`, então a worktree nasce pelo ATLAS. Só o usuário conclui.
   - **Prompt inicial na aprovação:** o agente aprovado abre com um texto fixo do ATLAS e o propósito que o usuário leu no cartão, e consulta handoffs e mensagens. Sem flags de autonomia, com as aprovações do próprio CLI. As mensagens seguintes continuam fora do terminal.
4. **Permissões da principal para trabalho direto.** Todos os CLIs integrados podem ser principal com "Principal só coordena" desligada. O perfil de leitura do Codex fica pendente de verificação. O diálogo indica o modo que o CLI suporta.

## Próximo — v0.2 (cada item precisa de plano aprovado)

A ordem abaixo é uma proposta. Cada item precisa de plano aprovado antes de começar.

### 1. LLM por função — entregue

Plano: `docs/planos/PLANO_V0_2_LLM_POR_FUNCAO.md` (aprovado em 29/10/2026), entregue nas fases 1 a 4 (PRs #38 a #41). **Adiado pelo mantenedor:** a lista inicial de recomendações de modelo em `electron/model-recommendations.json`, que depende de pesquisa de benchmarks dele. Até lá, a interface mostra "sem recomendação".

O objetivo é escolher CLI e modelo uma vez por *função*, em vez de a cada sessão. A ideia: modelos mais econômicos onde bastam e mais capazes onde o retrabalho custa caro.

- Cinco funções padrão (*planejar*, *explorar*, *implementar*, *revisar*, *testes*) e o Orquestrador da principal; o usuário troca CLI e modelo delas e cria as dele.
- O Orquestrador escolhe a função ao pedir um agente. O cartão vem preenchido, e o usuário aprova ou troca a função ou o LLM.
- O ATLAS recomenda modelos por função, a partir de uma lista curada pelo mantenedor, sem nunca escolher pelo usuário.
- Escopo global na v0.2. O texto da regra "CLIs e modelos" está no `AGENTS.md`.

### 2. Trocar o LLM de um agente sem perder a tela — entregue (falta verificar a principal no Kimi)

Plano: `docs/planos/PLANO_V0_2_TROCA_DE_MODELO.md`.

Requisito do mantenedor: trocar o modelo de um agente em execução **sem perder o que está na tela**.

- Entregue pelo comando nativo de cada CLI: o usuário troca no terminal (`/model` no Kimi, `/models` no OpenCode) e informa ao ATLAS em "Trocar modelo". A mesma run guarda o modelo de início e o informado (migration 12), e o ATLAS não digita no terminal.
- Na principal, a troca está liberada só no OpenCode, o único CLI em que o perfil somente leitura foi verificado depois da troca.
- No Claude Code, que não lista modelos ao ATLAS, a troca pelo `/model` funciona no terminal, mas não fica registrada no card.

### 3. Suíte de regressão liga/desliga — entregue

Plano: `docs/planos/PLANO_V0_2_SUITE_DE_REGRESSAO.md`, entregue nas fases 1 a 4 (PRs #53 a #56). Escopo escolhido pelo mantenedor em 03/11/2026:

- um comando por projeto, informado pelo usuário;
- roda na worktree da tarefa quando o agente pede revisão, e o resultado vira evidência verificada pelo sistema;
- falha só informa, e o usuário continua decidindo se conclui;
- liga/desliga por projeto, só pelo usuário;
- o prazo é escolhido pelo usuário, inclusive "sem prazo", e há o botão "Parar suíte";
- o log completo fica em arquivo.

### 4. Equipe com várias IAs: Claude Code, Codex, Gemini e revisão cruzada — entregue

Plano: `docs/planos/PLANO_V0_2_EQUIPE_MULTI_IA.md`. A investigação da fase 1 (`docs/diagnosticos/CLAUDE_CODEX_FASE1.md`) confirmou o Claude Code como agente e principal e o Codex só como agente; o Gemini foi investigado depois da instalação (`docs/diagnosticos/GEMINI_FASE4.md`). Os adaptadores do Claude Code (PR #63), do Codex (PR #65) e do Gemini (fase 4, com a ponte por consentimento, decisão do mantenedor em 09/11/2026) já estão no produto. Escopo escolhido pelo mantenedor entre 04 e 06/11/2026:

- adaptadores Claude Code, Codex e Gemini, como agentes e como principal, com ponte e perfil passados só pela run;
- chave por projeto "Principal só coordena", ligada por padrão; desligada, a principal faz sozinha o que é pequeno e delega o resto;
- revisão cruzada: a principal vê qual IA trabalhou em cada tarefa e prefere outra para revisar, e o cartão avisa quando é a mesma.

### 5. Paralelismo, políticas e sessões externas — entregue

Plano: `docs/planos/PLANO_V0_2_PARALELISMO_POLITICAS.md`, pedido pelo mantenedor em 12/11/2026 e executado na ausência dele; as escolhas marcadas como decisão do agente aguardam revisão.

- **Fase 1, política de agentes por projeto — entregue:** limites de 1 a 6 e modo autônomo controlado, desligado por padrão.
- **Fase 2, anexar sessão externa — entregue:** um CLI aberto fora do ATLAS entra na equipe pela ponte, com um card sem terminal e o comando para colar num PowerShell.

## Depois — v0.3 em diante

A ordem vem da arquitetura, ajustada ao que já foi entregue: o segundo adaptador, previsto para a v0.3, já entrou na v0.1.

- **v0.3:** AI Memory opcional *no produto* (por interfaces oficiais, conteúdo não confiável, degradação explícita). Outros adaptadores (Claude Code, Codex e Gemini foram antecipados para o item 4 da v0.2).
- **v0.4:** catálogo de modelos, quotas, custos, fallback entre provedores e relatórios.
- **v0.5:** runner independente da UI e recuperação ampliada.
- **Futuro:** acesso remoto, iPhone, notificações push, Voice-to-Prompt e runners na nuvem.

## Possíveis ideias (sem decisão)

Anotações para avaliar mais tarde. Não são plano nem compromisso, e nenhum agente começa estes itens sem pedido do mantenedor.

### Playbooks

Previstos na arquitetura e retirados da v0.2 em 04/11/2026. O mantenedor considerou que um roteiro fixo duplicaria o que a principal já decide ao conversar com o usuário e escolher as funções. Voltam só se surgir uma necessidade concreta no uso.

### Redesign visual do ATLAS

Em andamento, a pedido do mantenedor (06/11/2026). A direção está definida: mármore, marfim e ouro, com a estátua do logo como personagem. Plano em `docs/planos/PLANO_IDENTIDADE_VISUAL.md`. As fases 1 a 3 da identidade foram entregues. Em 09/11/2026 foi aprovada a evolução terminal-first, com o Alethe como referência: densidade, árvore lateral, quatro layouts e ocultação sem encerrar processos. O refinamento de 10/11/2026 elimina gaps, bordas e filetes, agrupa as ações das sessões e estabiliza os controles. O PR #84 levou Restaurar layout, Funções de agente e Aparência para a paleta, liberou o rodapé da navegação, suavizou as junções entre as colunas e desenhou em vetor o lettering ATLAS da barra de título. No mesmo dia, a janela principal passou a ter uma barra superior só, com os controles do sistema sobre ela, e os selects ganharam lista no material do ATLAS. Plano em `docs/planos/PLANO_WORKSPACE_TERMINAL_FIRST.md`. Continuidade e persistência ficam fora desse marco. As fases 4 (modo Conversa) e 5 (várias equipes por repositório) estão marcadas **[decidir]**.

Em 12/11/2026, o painel Mensagens foi redesenhado (PR #89): cartões legíveis com markdown seguro, tons com ícone e texto e nenhuma mensagem não lida recolhida.

Em 11/11/2026, o workspace passou a ter divisórias persistidas para Navegação, Terminais e Painéis; os extremos compactos preservam acesso por ícones, flyouts e nomes acessíveis. Terminais também ganharam cópia automática da seleção, ações de Responder/Reescrever/Colar em outra sessão, colagem segura de caminhos e entrada por arrastar arquivos.

Pontos observados em 27/10/2026 que continuam valendo:

- **Terminal com a aparência do terminal do sistema.** O processo já é nativo (ConPTY), mas o desenho no xterm.js usa as cores do ATLAS: fundo do tema, cursor e seleção na cor de destaque, paleta ANSI padrão do xterm, fonte 13 com entrelinha 1,25, sem margem interna. Possível caminho: ler, só para leitura, o `settings.json` do Terminal do Windows (fonte, tamanho, esquema de cores, cursor) e cair no padrão do Windows (Cascadia Mono, Campbell) quando ele não existir; copiar e colar como no Windows; cor do ATLAS só na moldura do card.
- **Continuidade ao reabrir.** Entregue nos PRs #80 e #81. Agentes e principal ativos no último fechamento normal reabrem com tentativa de retomar a conversa. Terminais PowerShell ativos reabrem na pasta escolhida ao iniciar, com um processo novo. O histórico abre pela árvore, sob demanda. A retenção da última tela continua em avaliação. Plano em `docs/planos/PLANO_CONTINUIDADE_SESSOES.md`.
- **Encerrar e excluir sessões.** Entregue no PR #82. O menu de sessão e a paleta oferecem encerramento para processos ativos e exclusão para terminais, agentes e históricos encerrados. A exclusão retira a sessão da interface e preserva os vínculos com tarefas e mensagens.

## Decisões em aberto

| Tema | Situação |
|---|---|
| LLM por função | Entregue; recomendações iniciais adiadas (benchmarks do mantenedor) |
| Troca de modelo sem perder a tela | Entregue; a principal no Kimi espera a correção da ponte e a preservação efetiva do perfil de leitura nas versões 2.4 |
| Suíte de regressão liga/desliga | Entregue (PRs #53 a #56) |
| Equipe com várias IAs | Entregue (PRs #59 a #69); mudou duas invariantes da principal (somente leitura por padrão e visão de CLI e modelo) |
| Continuidade ao reabrir | Entregue (PRs #80 e #81); relançar sem confirmação é exceção decidida pelo mantenedor em 10/11/2026 |
| Coordenação real pela principal | Entregue: `tasks_create` e prompt inicial na aprovação (aprovada em 12/11/2026) |
| Política de agentes e sessão externa | Item 5 entregue; o teto de 6 e a exigência de tarefa com worktree no modo autônomo são decisões do agente, a revisar |
| Publicação da v0.1 | Aceite feito; release e tag aguardam o mantenedor |
| Núcleo Node vs. Rust, retenção de scrollback | Ver a seção 19 da arquitetura |
