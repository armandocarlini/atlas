# Roadmap do ATLAS

Última revisão: 27/10/2026.

Este arquivo diz **o que vem depois e em que ordem**. O estado atual está em `docs/CONTEXTO.md`. A visão completa e os requisitos de longo prazo estão em `ATLAS_PLANEJAMENTO_ARQUITETURA.md`. Quando os dois divergirem sobre ordem ou escopo, vale este arquivo.

Itens marcados **[decidir]** dependem de uma decisão do mantenedor antes de virar plano técnico. Nenhum agente deve implementá-los por conta própria.

## Agora — fechar a v0.1

O contrato autônomo (`docs/AUTONOMIA_V0_1.md`) vale até aqui.

1. **Demonstração do aceite (marco 6c-2).** Seguir `docs/ROTEIRO_ACEITE_V0_1.md` e registrar evidências e limites no PR de fechamento. A v0.1 termina quando os 12 passos estiverem demonstrados com estado preservado após reinício.
2. **Revisar os PRs do Dependabot** (#22, #23, #25). Revisar cada um separadamente, com `npm run dist:win` e o job Package verdes, porque mexem no empacotamento validado.
3. **Acompanhar as intermitências** do instalador silencioso e do `test:desktop` (veja `docs/CONTEXTO.md`). Investigar na próxima ocorrência; não reexecutar às cegas.

Sem release ou tag automática. Publicar a v0.1 é decisão do mantenedor.

## Próximo — v0.2 (não autorizado para execução autônoma)

A ordem abaixo é uma proposta. Cada item precisa de plano aprovado antes de começar.

### 1. LLM por função [decidir]

O objetivo é escolher CLI e modelo uma vez por *função*, em vez de a cada sessão. A ideia: modelos mais econômicos onde bastam e mais capazes onde o retrabalho custa caro.

- O usuário define funções (por exemplo *planejar*, *explorar*, *implementar*, *revisar*, *testes*), cada uma com CLI e modelo.
- A principal informa a função em `agents_request`. O cartão de aprovação vem preenchido com a escolha da função, e o usuário aprova ou troca.
- A escolha continua do usuário. Isso substitui a regra atual "não existe CLI nem modelo padrão" por "não existe padrão do ATLAS; existem padrões definidos pelo usuário". A mudança precisa ser registrada no `AGENTS.md` quando for aprovada.
- Decidir: escopo das configurações (global, por projeto ou os dois) e se a principal também usa uma função.

### 2. Trocar o LLM de um agente sem perder a tela [decidir]

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

## Decisões em aberto

| Tema | Situação |
|---|---|
| LLM por função | Ideia aprovada em conversa; falta definir escopo e mudar a regra do `AGENTS.md` |
| Troca de modelo sem perder a tela | Investigar a capacidade dos CLIs |
| Suíte de regressão liga/desliga | Definir o significado exato |
| Publicação da v0.1 | Depois do aceite, por decisão do mantenedor |
| Núcleo Node vs. Rust, retenção de scrollback | Ver a seção 19 da arquitetura |
