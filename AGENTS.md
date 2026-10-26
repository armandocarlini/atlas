# ATLAS — contexto para agentes

Este é um projeto público, open source, para o portfólio profissional do mantenedor. Preserve a qualidade e a clareza do histórico; mantenha segredos e dados locais fora do Git.

## Começo de sessão

Leia `docs/AUTONOMIA_V0_1.md`, `docs/CONTINUIDADE.md`, `README.md` e os trechos relevantes de `ATLAS_PLANEJAMENTO_ARQUITETURA.md` antes de trabalhar. O contrato autônomo autoriza encadear marcos até a v0.1, com branch e PR por marco e merge somente depois de testes e CI verdes. Se ai-memory estiver disponível, consulte o projeto `default/ATLAS`; o marcador `.ai-memory.toml` preserva essa identidade mesmo depois de clonar em outra pasta. A memória local de outra máquina não está incluída no repositório. Os documentos versionados são a base portátil para continuidade.

## Limites do incremento atual

- Electron, PowerShell via PTY, descoberta Git e janelas nativas funcionam.
- O adaptador Kimi Code é real: o CLI é detectado pelo `PATH` e inicia sessões interativas em pastas autorizadas, com estado `running`/`exited` e sem flags de autonomia.
- Tarefas, mensagens, evidências e os quatro cards iniciais do cockpit são ilustrativos. Não os apresente como integrações ativas.
- A base SQLite registra projetos, sessões, runs e eventos. Sessões anteriores de escopos ainda autorizados reaparecem como histórico sem PTY. Tarefas persistentes, orquestrador e coordenação são próximos incrementos.
- Descoberta Git deve permanecer somente leitura. Não inicialize nem altere repositórios do usuário como parte da descoberta.

## Autonomia delimitada até a v0.1

- Siga o loop, os marcos, os bloqueios e a condição final de `docs/AUTONOMIA_V0_1.md`.
- Trabalhe em branch própria para cada marco ou subdivisão; crie PR, aguarde CI verde em Ubuntu e Windows e faça merge normal/squash somente depois dos checks finais. Não faça force push nem altere branch protection.
- A autorização de merge cobre o fluxo de desenvolvimento do repositório. Ela não elimina aprovações que o produto ATLAS deve exigir em runtime para ações dos agentes.
- Após o merge, sincronize e inspecione `main`, atualize `docs/CONTINUIDADE.md` e inicie o próximo marco sem pedir confirmação, até concluir a v0.1. Não avance para v0.2 e não publique release/tag automaticamente.

## Testes e regressões

- Gates obrigatórios em cada PR: `npm test`, `npm run build` e `npm run check:public`.
- Execute também `npm run test:desktop` no Windows e sempre que houver mudanças desktop, e `npm run test:agent` para mudanças no subsistema de agentes. O smoke real opt-in (`npm run smoke:agent`) exige o Kimi Code instalado e roda com `KIMI_CODE_HOME` isolado.
- Acrescente testes unitários, de integração e E2E proporcionais a cada alteração. Todo bug corrigido deve ganhar regressão reproduzível. Inclua casos negativos e, conforme o subsistema, concorrência, reinício, migrations, backup/restore e segurança.
- Não apague ou enfraqueça testes para obter verde, não esconda falhas com retries, não reduza cobertura para contornar regressão e não declare sucesso com testes vermelhos, pulados, ausentes ou timeout.
- O smoke e testes com CLI usam apenas fixtures temporárias. Não rode testes destrutivos ou comandos de escrita contra projetos reais.
- Registre comandos, ambiente, evidências e limites no PR/documentação. Testes bloqueiam regressões conhecidas e reduzem risco; não garantem ausência total de bugs.

## Interface obrigatória

- Antes de projetar, alterar ou revisar qualquer UI, verifique e invoque **ui-ux-pro-max** e **apple-design**. Preserve as convenções do Windows e `design-system/atlas/MASTER.md`, incluindo acessibilidade, foco, formulários, erros, contraste e comportamento modal conforme a alteração.
- Se `ui-ux-pro-max` estiver ausente, instale da fonte oficial `nextlevelbuilder/ui-ux-pro-max-skill` com `npm install -g ui-ux-pro-max-cli` e `uipro init --ai kimi --global`; use `uipro init --ai universal --global` para `~/.agents/skills/`.
- Se `apple-design` estiver ausente, instale da fonte oficial `dickwu/apple-design-skill` com `npx skills add dickwu/apple-design-skill -g`.
- Após instalar, recarregue a listagem/ambiente quando necessário e confirme que ambas as skills estão disponíveis e foram invocadas. Não trate comandos de instalação executados cegamente como comprovação.
- Não instale Python automaticamente. O ui-ux-pro-max exige Python 3; se estiver ausente ou a verificação falhar, registre bloqueio de ambiente e informe o usuário.

## Segurança e dados locais

- Não altere proteções do GitHub, credenciais ou políticas de execução. Instalações globais autorizadas ficam limitadas às skills de interface acima.
- Não versione `.env`, tokens, bancos, perfis de agentes, configurações locais do ai-memory, outputs ou capturas sem revisão.
- Não use merge com CI vermelha/ausente, release, deploy ou ações destrutivas fora de fixtures.
- Bloqueios de credenciais, quota, skill/Python, segurança ou CI devem ser registrados e resolvidos sem contornar proteções.
