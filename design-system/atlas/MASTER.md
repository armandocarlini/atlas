# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules override this Master file.

**Project:** ATLAS
**Category:** Developer Tool / Desktop Cockpit
**Design Dials:** Variance 4/10 | Motion 3/10 | Density 7/10

---

## Global Rules

### Identidade

O ATLAS tem o titã do logo como personagem: a estátua de mármore que sustenta o globo escuro com órbitas de ouro. A interface usa as mesmas matérias: fundo obsidiana, texto marfim, ouro nas marcas e órbitas.

- **Marca:** `src/assets/atlas-statue.webp`, recorte do logo com fundo transparente, local e sem rede. Aparece na barra de título (`AtlasMark`) e grande na tela do projeto sem sessões (`AtlasWelcome`).
- **Wordmark:** "ATLAS" em Jost 300, espaçamento de .5em a .6em, sempre em maiúsculas.
- **Ouro (`--gold`):** marca, rótulos de seção e órbitas. Seleção de terminais e abas usa superfície e tipografia; ouro não é cor de estado nem de ação.
- Estilos da identidade ficam em `src/identity.css`; a densidade e os layouts ficam em `src/workspace.css`, carregado por último.

### Color Palette

| Role | Default | CSS Variable |
|------|---------|--------------|
| Accent/CTA | `#E6DCC8` (Marfim) | `--accent` |
| Accent text/focus | Ajustado para leitura em cada fundo | `--accent-text` |
| On Accent/CTA | Calculado por contraste | `--accent-ink` |
| Brand gold | `#C8A76B`, ajustado para 4.5:1 em cada fundo | `--gold` |
| Background | `#09090A` (Obsidiana), personalizável | `--bg` |
| Terminal Background | Segue `--bg` | `--terminal-bg` |
| Foreground | Marfim `#ECE5D8` ou grafite `#14120F`, por contraste | `--text` |
| Surface | Derivada de fundo + foreground | `--surface` |
| Raised Surface | Derivada de fundo + foreground | `--surface-raised` |
| Hover Surface | Derivada de fundo + foreground | `--surface-hover` |
| Muted Foreground | Derivado com contraste | `--muted` |
| Border | Derivada de fundo + foreground | `--border` |
| Success | `#4ECB8D` | `--success` |
| Warning | `#F2B84B` | `--warning` |
| Destructive | `#EF6363` | `--danger` |

- Marfim sobre obsidiana é o padrão. Ouro e Laranja continuam entre os presets; fundo e destaque são independentes.
- Quem ainda estava no padrão anterior sem nunca ter mudado (Laranja sobre Grafite) passa ao novo padrão. Qualquer outra escolha salva é mantida.
- Temas claro, escuro e fundo personalizado usam os mesmos tokens em todas as janelas.
- Verde, âmbar e vermelho comunicam estados, não decoração.
- Não aplicar a cor de destaque ao conteúdo ANSI dos harnesses.
- `--accent` é a cor escolhida, exceto quando ela quase some no fundo (contraste abaixo de 1.8:1, como Marfim sobre Papel). Aí só o preenchimento caminha na direção do texto até aparecer (`visibleAccent`); a escolha salva não muda. Texto e foco usam `--accent-text`.
- As cores semânticas são calculadas em `src/appearance.js`.

### Typography

- **Marca e títulos:** Jost (variável), empacotada com o app por `@fontsource-variable/jost`. Nada vem da rede.
- **Interface:** Segoe UI Variable, Segoe UI ou system-ui.
- **Terminal e metadados técnicos:** Cascadia Code, Cascadia Mono ou Consolas.
- Rótulos de seção em maiúsculas, 10.5–11px, peso 600, espaçamento .16em, em `--gold`.
- **Mood:** preciso, sereno, monumental na marca e funcional no trabalho.

### Spacing

*Density: 7/10 — legível para uso prolongado ao lado do IDE*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `2px` | Ajustes finos |
| `--space-sm` | `4px` | Relações compactas |
| `--space-md` | `8px` | Padding padrão |
| `--space-lg` | `12px` | Seções e grids |
| `--space-xl` | `16px` | Respiro entre regiões |
| `--space-2xl` | `24px` | Conteúdo de modais |
| `--space-3xl` | `32px` | Separações excepcionais |

### Elevation

- Panes de sessão são contíguos: zero intervalo, raio, borda ou sombra. O terminal começa logo abaixo do cabeçalho de 32px.
- Seleção usa superfície e peso tipográfico, sem filetes, sublinhados ou anéis decorativos; o foco de teclado continua visível.
- Modais: material elevado (raio de 16px), scrim com desfoque, que vira fundo sólido com `prefers-reduced-transparency`.
- Gradientes só como luz quente sutil no topo da barra de título e da navegação. Sem glow em controles.

---

## Component Specs

### Buttons

```css
.button-primary {
  background: var(--accent);
  color: var(--accent-ink);
  border: 1px solid var(--accent);
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 180ms ease;
}

.button-secondary {
  background: var(--surface-raised);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
}
```

Controles possuem rótulos tipográficos discretos, foco visível e estado disabled explícito.

### Terminal e session cards

- O terminal real ocupa quase todo o card; o ATLAS fornece apenas identidade e ações essenciais.
- A interface interna pertence ao harness/PTY: não adicionar composer paralelo, introdução sintética ou statusbar falsa.
- O cabeçalho de 32px mostra estado, função (ou nome, quando não houver função) e um menu discreto. CLI, modelo e conexão ficam na descrição do cabeçalho; Pop-up, Foco, modelo, descoberta, ocultação e nova execução ficam no menu conforme o estado da sessão.
- O menu mantém o gatilho no mesmo lugar, devolve o foco ao fechar e não deixa Escape atravessar para os painéis ao fundo.
- Seleção, foco e estado não dependem apenas de cor.
- A linha da grade define a altura do cartão: piso de 300px, crescendo com a área disponível. Cartões não têm altura mínima própria, para nunca se sobreporem. No Foco, o cartão ocupa toda a área.
- A barra de status inferior foi retirada para dar altura aos terminais; projeto e diretório continuam na árvore e no contexto da área de trabalho.

### Navegação e painéis

- Uma barra superior só, de 36px: marca, contexto e ações. Projetos ficam na árvore lateral; não há barra de status permanente.
- No Windows e no Linux a janela principal não tem barra nativa: minimizar, maximizar e fechar são os controles do sistema desenhados sobre a barra do ATLAS (`titleBarOverlay`, `electron/window-chrome.cjs`), na cor de `--surface` com símbolos em `--text`, e acompanham o tema. Os controles têm 35px para o filete inferior da barra continuar visível.
- A barra arrasta a janela e maximiza com duplo clique; botões e campos dela são `no-drag`, assim como diálogos, paleta, toasts e o atalho de teclado que a cobrem. A área dos controles é reservada com `env(titlebar-area-*)`; nenhuma ação fica sob eles.
- No macOS a barra nativa continua. Pop-ups e Acompanhamento mantêm a barra nativa.
- A árvore organiza visualmente projetos, repositórios, worktrees e sessões com chevrons, ícones e indentação. Clicar no nome do projeto também o expande; trocar de projeto não recolhe a árvore anterior. "Espera você" aparece somente quando há decisões e leva à principal parada, aos pedidos e às revisões do projeto ativo. Cada item leva ao lugar da decisão; o painel não duplica aprovações. Estado das sessões por ponto e texto (para leitores de tela, "ativa" fica oculto visualmente).
- A paleta de comandos (Ctrl Shift P ou F1) reúne as ações, os projetos e os terminais. O atalho vale com o foco no terminal, e o que se digita nela nunca chega ao PTY. Toda ação nova entra também na paleta.

- Navegação e Painéis podem ser ocultados independentemente e recuperados pela toolbar. Painéis começam recolhidos numa instalação nova. Estado do projeto e integrações abre sob demanda.
- Os mesmos controles permanecem disponíveis na largura desktop mínima de 940px. A navegação mantém rótulos textuais e seu conteúdo rola sem sobreposição.
- A ordem das colunas e sua visibilidade persistem localmente.
- Repositórios e worktrees usam uma árvore compacta somente leitura, com branch e alterações locais. Cada sessão pode ser ocultada e restaurada sem encerrar o PTY; o estado oculto aparece em texto.
- Pop-ups de terminal são janelas normais; a janela de Acompanhamento permanece `always-on-top`.

### Layouts dos terminais

- **Grade:** panes simultâneos, com rolagem da grade.
- **Destaque:** uma sessão ocupa o espaço disponível; faixa superior permite mudar a sessão.
- **Principal + agentes:** principal visível maior; sem principal, a sessão selecionada, demais ao lado; em área estreita, empilha para preservar leitura.
- **Abas:** uma sessão por vez, com setas, Home e End na faixa de abas.
- O layout e a lista de sessões ocultas persistem só como preferências locais. Restaurar layout revela todas as sessões.
- Abas, avisos e terminais têm linhas explícitas para que a ausência de uma faixa não deixe espaço vazio.

### Inputs e modais

```css
.input {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.input:focus-visible {
  border-color: var(--accent);
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

- Modais usam `var(--surface-raised)`, scrim discreto e conteúdo rolável quando necessário.
- Erros são textuais e não dependem apenas de cor.
- Abrir um modal move o foco para ele, torna o conteúdo ao fundo inerte e mantém Tab/Shift+Tab dentro do diálogo. Fechar restaura o foco ao controle de origem.
- Aparência oferece presets e cores livres para destaque e fundo, salvos localmente.

### Seleções

- Todo `<select>` usa `appearance: base-select` (`src/controls.css`): continua nativo para teclado, leitor de tela e formulário, mas a lista abre no material do ATLAS, não no popup padrão do sistema. Onde não houver suporte, o select nativo continua.
- Gatilho: chevron próprio que gira 180° ao abrir; aberto, ganha a superfície de hover.
- Lista: `--surface-raised`, borda `--border`, raio de 8px, 4px de respiro, sombra curta, ancorada no controle e no mínimo da largura dele.
- Opções de 30px, raio de 5px. Hover usa `--surface-hover`; a escolhida usa peso 600 e marca de confirmação em `--accent-text` à direita (forma, não só cor); foco de teclado tem anel de 2px interno; desabilitada fica esmaecida.
- Movimento: entra em 180ms (opacidade e 4px de deslocamento a partir do controle) e sai em 90ms; com movimento reduzido, só opacidade. Com contraste alto, borda em `--text` e sem sombra.

---

## Style Guidelines

**Style:** Minimalism / content-first desktop cockpit

- Reduzir cromo, badges, indicadores repetidos e textos decorativos.
- Priorizar o conteúdo dos terminais sobre a quantidade de panes.
- Usar tipografia, espaçamento e superfícies para hierarquia antes de adicionar bordas.
- Não reproduzir controles de janela do macOS no Windows.
- Manter a identidade ATLAS sem copiar marca, assets ou composição proprietária de referências.

## Motion

- Microinterações entre 150–240ms; pressionar um botão reduz a escala para .97.
- Modais e toasts chegam como material (opacidade, deslocamento curto e desfoque), sem piscar.
- A tela do projeto sem sessões tem uma entrada única de cerca de 2s: estátua, órbitas que se desenham, wordmark e texto. Não há animação em loop.
- Não deslocar componentes em hover.
- Respeitar `prefers-reduced-motion` e apresentar o estado final imediatamente.
- Terminal e streams não aguardam transições visuais.
- Barras de rolagem finas e retas, visíveis só enquanto a área rola (`src/scrollbars.js`).

---

## Anti-Patterns (Do NOT Use)

- **Emojis como ícones estruturais.**
- **Controles sem cursor pointer ou sem nome acessível.**
- **Layout-shifting hovers.**
- **Contraste abaixo de 4.5:1 para texto normal.**
- **Foco invisível ou ações disponíveis apenas por gesto.**
- **Cores fixas que impeçam temas claros ou personalizados.**
- **Skins sintéticas apresentadas como a interface real de um harness.**

---

## Pre-Delivery Checklist

- Terminal real permanece legível em grid, foco e pop-up.
- Temas claro/escuro e fundo personalizado funcionam em todas as janelas.
- Texto e controles essenciais mantêm contraste suficiente.
- Navegação por teclado, nomes acessíveis e foco visível verificados.
- `prefers-reduced-motion` respeitado.
- Colunas podem ser ocultadas e restauradas sem perder o trabalho.
- Nenhum conteúdo fica escondido sob barras fixas.
- Não apresentar dados ilustrativos como integrações ativas.
