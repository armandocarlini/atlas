# Workspace terminal-first — fases 1 e 2

Escopo aprovado pelo mantenedor em 09/11/2026, após a comparação com o Alethe Agents. Continuação da identidade visual do ATLAS, sem mudanças no núcleo de agentes.

## Fase 1 — espaço de trabalho compacto

- Barra superior de 36px; toolbar de 38px e cabeçalhos de sessão de 32px.
- Retirar subbarra permanente, rodapé repetido e cabeçalho separado da coluna central.
- Panes contíguos, sem intervalo, raio, borda ou sombra; reduzir padding dos terminais.
- Cabeçalho limitado a estado, função e menu de ações; selecionar muda a superfície e a tipografia, sem filetes dourados.
- Navegação e Painéis mantêm posição fixa na toolbar ao mostrar ou ocultar colunas.
- Painéis recolhidos por padrão em instalações novas; estado e integrações sob demanda.
- Preservar marca, temas, contraste, foco, avisos relevantes, paleta e diálogos de aprovação.

## Fase 2 — árvore e layouts

- Árvore visualmente hierárquica de projetos, repositórios, worktrees e sessões, incluindo histórico e sessões ocultas, com chevrons, ícones e indentação.
- Clicar no nome do projeto também o expande; trocar de projeto preserva a expansão escolhida anteriormente.
- "Espera você" aparece somente com decisões e leva aos pedidos e revisões; não os aprova.
- Grade, Destaque, Principal + agentes e Abas; setas, Home e End nas abas.
- Ocultar desmonta apenas a view. Restaurar preserva PTY, PID e scrollback em memória.
- Persistir preferências locais, preservar pop-ups e permitir restaurar todo o layout.

## Refinamento de 10/11/2026

As capturas do mantenedor rejeitaram os filetes de seleção, os pequenos intervalos entre terminais e a multiplicidade de botões. A implementação remove esses ornamentos e agrupa as ações contextuais sem alterar o comportamento dos processos. A revisão inclui regressões de adjacência dos terminais, estabilidade da toolbar, abertura da árvore, teclado e menus de sessão.

## Validação

Gates: `npm test`, `npm run build`, `npm run check:public` e `npm run test:desktop` no Windows. As regressões cobrem agrupamento por projeto/worktree, visibilidade, seleção de layouts, navegação entre projetos, área útil sem abas, continuidade de PTY, teclado e restauração. O smoke mantém os cenários anteriores de tarefas, mensagens, consentimento e evidências.

## Fora do escopo

Scrollback em disco, retomada nativa de conversas, processos sobrevivendo ao app, custos/quotas, modo Conversa, equipes múltiplas e mudanças nas permissões. Não copiar código, assets ou marca do Alethe.

Referência: [Alethe Agents](https://github.com/Kc1t/alethe-agents). O artifact anterior do mantenedor é contexto histórico; mármore, marfim e ouro continuam na identidade.
