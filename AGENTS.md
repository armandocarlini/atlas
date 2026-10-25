# ATLAS — contexto para agentes

Este é um projeto público, open source, para o portfólio profissional do mantenedor. Preserve a qualidade e a clareza do histórico; mantenha segredos e dados locais fora do Git.

## Começo de sessão

Leia `docs/CONTINUIDADE.md`, `README.md` e os trechos relevantes de `ATLAS_PLANEJAMENTO_ARQUITETURA.md` antes de trabalhar. Se ai-memory estiver disponível, consulte o projeto `default/ATLAS`; o marcador `.ai-memory.toml` preserva essa identidade mesmo depois de clonar em outra pasta. A memória local de outra máquina não está incluída no repositório. Os documentos versionados são a base portátil para continuidade.

## Limites do incremento atual

- Electron, PowerShell via PTY, descoberta Git e janelas nativas funcionam.
- Os cards e dados de agentes, tarefas, mensagens e evidências são ilustrativos. Não os apresente como integrações ativas.
- SQLite, adaptadores reais, orquestrador e coordenação persistente são próximos marcos.
- Descoberta Git deve permanecer somente leitura. Não inicialize nem altere repositórios do usuário como parte da descoberta.

## Trabalho e validação

- Use branches para mudanças após a publicação inicial; não faça force push nem merge sem autorização.
- Interface: aplique ui-ux-pro-max e apple-design quando disponíveis, preservando as convenções do Windows e o design system em `design-system/atlas/MASTER.md`.
- Antes de concluir: `npm test`, `npm run build` e `npm run check:public`. Mudanças de desktop exigem também `npm run test:desktop` no Windows.
- O smoke cria apenas fixtures temporárias; não rode comandos de teste destrutivos contra projetos reais.
- Não versione `.env`, tokens, bancos, perfis de agentes, configurações locais do ai-memory, outputs ou capturas sem revisão.
