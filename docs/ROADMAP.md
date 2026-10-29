# Roadmap do ATLAS

Última revisão: 27/10/2026.

Este arquivo diz **o que vem depois e em que ordem**. O estado atual está em `docs/CONTEXTO.md`. A visão completa e os requisitos de longo prazo estão em `ATLAS_PLANEJAMENTO_ARQUITETURA.md`. Quando os dois divergirem sobre ordem ou escopo, vale este arquivo.

Itens marcados **[decidir]** dependem de uma decisão do mantenedor antes de virar plano técnico. Nenhum agente deve implementá-los por conta própria.

## Concluído — v0.1

O aceite dos 12 passos foi demonstrado em 27/10/2026 (`docs/historico/ACEITE_V0_1.md`, PR #30). A publicação (release e tag) é decisão do mantenedor.

## Agora — ajustes observados no aceite

São correções da v0.1, sem mudar o escopo do produto.

1. **Kimi Code 2.4.0 sem a ponte MCP.** Investigar por que o Kimi 2.4.0 não registra o runtime local do workspace ao iniciar o servidor `atlas` por stdio (veja `docs/CONTEXTO.md`) e adaptar o ATLAS ou documentar o passo do usuário. Até lá, o OpenCode é o CLI com integração completa.
2. **Acompanhar as intermitências** do instalador silencioso e do `test:desktop` (veja `docs/CONTEXTO.md`). O `CDP timeout` do `test:desktop` ganhou uma correção por hipótese (oclusão de janela). Investigar na próxima ocorrência; não reexecutar às cegas.

## Próximo — v0.2 (cada item precisa de plano aprovado)

A ordem abaixo é uma proposta. Cada item precisa de plano aprovado antes de começar.

### 1. LLM por função — entregue

Plano: `docs/planos/PLANO_V0_2_LLM_POR_FUNCAO.md` (aprovado em 29/10/2026), entregue nas fases 1 a 4 (PRs #38 a #41). **Adiado pelo mantenedor:** a lista inicial de recomendações de modelo em `electron/model-recommendations.json`, que depende de pesquisa de benchmarks dele. Até lá, a interface mostra "sem recomendação".

O objetivo é escolher CLI e modelo uma vez por *função*, em vez de a cada sessão. A ideia: modelos mais econômicos onde bastam e mais capazes onde o retrabalho custa caro.

- Cinco funções padrão (*planejar*, *explorar*, *implementar*, *revisar*, *testes*) e o Orquestrador da principal; o usuário troca CLI e modelo delas e cria as dele.
- O Orquestrador escolhe a função ao pedir um agente. O cartão vem preenchido, e o usuário aprova ou troca a função ou o LLM.
- O ATLAS recomenda modelos por função, a partir de uma lista curada pelo mantenedor, sem nunca escolher pelo usuário.
- Escopo global na v0.2. O novo texto da regra "CLIs e modelos" entra no `AGENTS.md` junto com a fase 3.

### 2. Trocar o LLM de um agente sem perder a tela — plano aprovado, em execução

Plano: `docs/planos/PLANO_V0_2_TROCA_DE_MODELO.md`.

Requisito do mantenedor: trocar o modelo de um agente em execução **sem perder o que está na tela**.

- Hoje o modelo vai como `--model` no início da run, e a migration 9 registra CLI e modelo por run.
- Caminhos a investigar com os CLIs reais:
  - comando nativo de troca de modelo dentro da TUI, com o ATLAS registrando a troca;
  - nova run com a mesma identidade, mantendo o scrollback anterior visível no card e entregando um resumo (handoff) ao novo modelo.
- Decidir depois da investigação: o que conta como "não perder". Pode ser só a tela, ou também o contexto da conversa no modelo.

### 3. Suíte de regressão liga/desliga [decidir]

Ideia do mantenedor: uma opção no ATLAS para ligar e desligar a suíte de testes de regressão.

- Escopo ainda não definido. *Palpite a confirmar:* por projeto, rodar os testes do repositório na worktree da tarefa ao pedir revisão, com o resultado anexado como evidência verificada pelo sistema.
- Decidir: o que roda, quando, onde aparece e quem pode desligar.

### 4. Itens já previstos na arquitetura

- Playbooks.
- Paralelismo ampliado e mais políticas além do modo assistido.
- Anexar sessões externas.

## Depois — v0.3 em diante

A ordem vem da arquitetura, ajustada ao que já foi entregue: o segundo adaptador, previsto para a v0.3, já entrou na v0.1.

- **v0.3:** AI Memory opcional *no produto* (por interfaces oficiais, conteúdo não confiável, degradação explícita). Novos adaptadores (Claude Code, Codex, Gemini).
- **v0.4:** catálogo de modelos, quotas, custos, fallback entre provedores e relatórios.
- **v0.5:** runner independente da UI e recuperação ampliada.
- **Futuro:** acesso remoto, iPhone, notificações push, Voice-to-Prompt e runners na nuvem.

## Possíveis ideias (sem decisão)

Anotações para avaliar mais tarde. Não são plano nem compromisso, e nenhum agente começa estes itens sem pedido do mantenedor.

### Redesign visual do ATLAS

O mantenedor pretende refazer todo o design visual mais adiante, e a direção ainda não está definida. Pontos observados em 27/10/2026, para considerar nessa hora:

- **Terminal com a aparência do terminal do sistema.** O processo já é nativo (ConPTY), mas o desenho no xterm.js usa as cores do ATLAS: fundo do tema, cursor e seleção na cor de destaque, paleta ANSI padrão do xterm, fonte 13 com entrelinha 1,25, sem margem interna. Possível caminho: ler, só para leitura, o `settings.json` do Terminal do Windows (fonte, tamanho, esquema de cores, cursor) e cair no padrão do Windows (Cascadia Mono, Campbell) quando ele não existir; copiar e colar como no Windows; cor do ATLAS só na moldura do card.
- **Abertura sem "resultado incerto".** Hoje o processo morre com o app, e na abertura seguinte a reconciliação marca a run como `lost`. Todo projeto abre no card "Histórico de sessão" com borda de erro e datas em ISO. Possível caminho: registrar o fechamento normal do ATLAS como encerramento, guardar a última tela do terminal e mostrá-la só para leitura, com "Nova execução" no próprio card. Guardar a tela também ajuda o item 2 da v0.2.

## Decisões em aberto

| Tema | Situação |
|---|---|
| LLM por função | Entregue; recomendações iniciais adiadas (benchmarks do mantenedor) |
| Troca de modelo sem perder a tela | Plano aprovado (`docs/planos/PLANO_V0_2_TROCA_DE_MODELO.md`), em execução |
| Suíte de regressão liga/desliga | Definir o significado exato |
| Publicação da v0.1 | Aceite feito; release e tag aguardam o mantenedor |
| Núcleo Node vs. Rust, retenção de scrollback | Ver a seção 19 da arquitetura |
