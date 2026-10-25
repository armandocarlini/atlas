# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules override this Master file.

**Project:** ATLAS
**Category:** Developer Tool / Desktop Cockpit
**Design Dials:** Variance 3/10 | Motion 1/10 | Density 7/10

---

## Global Rules

### Color Palette

| Role | Default | CSS Variable |
|------|---------|--------------|
| Accent/CTA | `#F2994A` | `--accent` |
| Accent text/focus | Ajustado para leitura em cada fundo | `--accent-text` |
| On Accent/CTA | Calculado por contraste | `--accent-ink` |
| Background | `#080A0B`, personalizável | `--bg` |
| Terminal Background | Segue `--bg` | `--terminal-bg` |
| Foreground | Calculado por contraste | `--text` |
| Surface | Derivada de fundo + foreground | `--surface` |
| Raised Surface | Derivada de fundo + foreground | `--surface-raised` |
| Hover Surface | Derivada de fundo + foreground | `--surface-hover` |
| Muted Foreground | Derivado com contraste | `--muted` |
| Border | Derivada de fundo + foreground | `--border` |
| Success | `#4ECB8D` | `--success` |
| Warning | `#F2B84B` | `--warning` |
| Destructive | `#EF6363` | `--danger` |

- Laranja é o destaque padrão; fundo e destaque são independentes.
- Temas claro, escuro e fundo personalizado usam os mesmos tokens em todas as janelas.
- Verde, âmbar e vermelho comunicam estados, não decoração.
- Não aplicar a cor de destaque ao conteúdo ANSI dos harnesses.
- `--accent` permanece a cor escolhida para preenchimentos e marcas. Texto e foco usam `--accent-text` para preservar contraste, inclusive com destaque preto sobre fundo escuro.
- As cores semânticas são calculadas em `src/appearance.js`. No tema Névoa, o texto de destaque usa `#69472A` sobre a superfície, com contraste de aproximadamente 6,73:1; o preenchimento laranja permanece `#F2994A`.

### Typography

- **Interface:** Segoe UI Variable, Segoe UI ou system-ui.
- **Terminal e metadados técnicos:** Cascadia Code, Cascadia Mono ou Consolas.
- **Mood:** preciso, funcional, legível e content-first.
- Usar fontes locais nesta fase, sem depender de Google Fonts ou rede.

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

- Cards do workspace não dependem de sombra para hierarquia.
- Usar bordas discretas e diferenças de superfície.
- Sombras ficam reservadas a modais, janelas internas e estados de arraste.
- Não usar glow, gradientes decorativos ou movimento de hover que desloque o layout.

---

## Component Specs

### Buttons

```css
.button-primary {
  background: var(--accent);
  color: var(--accent-ink);
  border: 1px solid var(--accent);
  border-radius: 5px;
  cursor: pointer;
  transition: background-color 180ms ease;
}

.button-secondary {
  background: var(--surface-raised);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 5px;
  cursor: pointer;
}
```

Controles possuem rótulos tipográficos discretos, foco visível e estado disabled explícito.

### Terminal e session cards

- O terminal real ocupa quase todo o card; o ATLAS fornece apenas moldura, identidade e ações essenciais.
- A interface interna pertence ao harness/PTY: não adicionar composer paralelo, introdução sintética ou statusbar falsa.
- Cada card oferece Pop-up e Foco; o pop-up permite Reintegrar sem encerrar o processo.
- O cabeçalho usa uma linha para nome, origem, CLI e ações. Tokens fictícios e metadados redundantes não competem com o terminal.
- Seleção, foco e estado não dependem apenas de cor.

### Navegação e painéis

- Navegação e Painéis podem ser ocultadas independentemente e recuperadas pela toolbar.
- Os mesmos controles permanecem disponíveis na largura desktop mínima de 940px. A navegação mantém rótulos textuais e seu conteúdo rola sem sobreposição.
- A ordem das colunas e sua visibilidade persistem localmente.
- Repositórios e worktrees usam uma árvore compacta somente leitura, com branch e alterações locais.
- Pop-ups de terminal são janelas normais; a janela de Acompanhamento permanece `always-on-top`.

### Inputs e modais

```css
.input {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 5px;
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

---

## Style Guidelines

**Style:** Minimalism / content-first desktop cockpit

- Reduzir cromo, badges, indicadores repetidos e textos decorativos.
- Priorizar o conteúdo dos terminais sobre a quantidade de panes.
- Usar tipografia, espaçamento e superfícies para hierarquia antes de adicionar bordas.
- Não reproduzir controles de janela do macOS no Windows.
- Manter a identidade ATLAS sem copiar marca, assets ou composição proprietária de referências.

## Motion

- Microinterações discretas entre 150–200ms, sem animação contínua decorativa.
- Não deslocar componentes em hover.
- Respeitar `prefers-reduced-motion` e apresentar o estado final imediatamente.
- Terminal e streams não aguardam transições visuais.

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
