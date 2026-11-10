# Workspace terminal-first — fases 1 e 2

Escopo aprovado pelo mantenedor em 09/11/2026, após a comparação com o Alethe Agents. Continuação da identidade visual do ATLAS, sem mudanças no núcleo de agentes.

## Fase 1 — espaço de trabalho compacto

- Barra superior de 42px; toolbar de 42px na área dos terminais.
- Retirar subbarra permanente, rodapé repetido e cabeçalho separado da coluna central.
- Panes com intervalo e raio de 3px, sem sombras decorativas; reduzir padding dos terminais.
- Painéis recolhidos por padrão em instalações novas; estado e integrações sob demanda.
- Preservar marca, temas, contraste, foco, avisos relevantes, paleta e diálogos de aprovação.

## Fase 2 — árvore e layouts

- Árvore de projetos, repositórios, worktrees e sessões, incluindo histórico e sessões ocultas.
- "Espera você" leva aos pedidos e revisões; não os aprova.
- Grade, Destaque, Principal + agentes e Abas; setas, Home e End nas abas.
- Ocultar desmonta apenas a view. Restaurar preserva PTY, PID e scrollback em memória.
- Persistir preferências locais, preservar pop-ups e permitir restaurar todo o layout.

## Validação

Gates: `npm test`, `npm run build`, `npm run check:public` e `npm run test:desktop` no Windows. As regressões cobrem agrupamento por projeto/worktree, visibilidade, seleção de layouts, navegação entre projetos, área útil sem abas, continuidade de PTY, teclado e restauração. O smoke mantém os cenários anteriores de tarefas, mensagens, consentimento e evidências.

## Fora do escopo

Scrollback em disco, retomada nativa de conversas, processos sobrevivendo ao app, custos/quotas, modo Conversa, equipes múltiplas e mudanças nas permissões. Não copiar código, assets ou marca do Alethe.

Referência: [Alethe Agents](https://github.com/Kc1t/alethe-agents). O artifact anterior do mantenedor é contexto histórico; mármore, marfim e ouro continuam na identidade.
