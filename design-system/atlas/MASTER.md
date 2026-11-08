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
- **Ouro (`--gold`):** marca, rótulos de seção, aba ativa, seleção e órbitas. Não é cor de estado nem de ação.
- Estilos da identidade ficam em `src/identity.css`, carregado depois de `src/styles.css`.

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

- Cartões de sessão: raio de 12px, borda discreta e uma sombra baixa e larga que os separa do fundo sem brilho.
- Seleção: borda e anel em ouro, além do estado textual.
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

- O terminal real ocupa quase todo o card; o ATLAS fornece apenas moldura, identidade e ações essenciais.
- A interface interna pertence ao harness/PTY: não adicionar composer paralelo, introdução sintética ou statusbar falsa.
- Cada card oferece Pop-up e Foco; o pop-up permite Reintegrar sem encerrar o processo.
- O cabeçalho usa uma linha para nome, origem, CLI e ações. Tokens fictícios e metadados redundantes não competem com o terminal.
- Seleção, foco e estado não dependem apenas de cor.
- A linha da grade define a altura do cartão: piso de 380px, crescendo para que duas linhas caibam na janela. Cartões não têm altura mínima própria, para nunca se sobreporem. No Foco, o cartão ocupa toda a área.
- A barra de status inferior foi retirada para dar altura aos terminais; projeto e diretório continuam nas abas e nos cartões.

### Navegação e painéis

- Uma barra só em cima: marca, abas de projeto e ações. Não há barra de status.
- O Painel do Atlas abre a navegação: estado da principal, "Espera você" e equipe por tarefa. Cada item leva ao lugar da decisão; o painel não duplica aprovações. Estado das sessões por ponto e texto (para leitores de tela, "ativa" fica oculto visualmente).
- A paleta de comandos (Ctrl Shift P ou F1) reúne as ações, os projetos e os terminais. O atalho vale com o foco no terminal, e o que se digita nela nunca chega ao PTY. Toda ação nova entra também na paleta.

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
