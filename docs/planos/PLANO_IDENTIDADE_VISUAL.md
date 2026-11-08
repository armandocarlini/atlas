# Plano — identidade visual do ATLAS

Situação: **fase 1 pedida pelo mantenedor em 06/11/2026 e implementada.** As fases 2 e 3 só mudam a interface e seguem quando o mantenedor pedir. As fases 4 e 5 mudam invariantes do produto e estão marcadas **[decidir]**.

## Referência

O protótipo navegável aprovado pelo mantenedor em 06/11/2026 é a referência visual. É uma página única em HTML, fora do repositório, com dados ilustrativos. Do protótipo, **o que está fixo são as cores e o logo**: a estátua de mármore que sustenta o globo escuro com órbitas de ouro, o texto marfim sobre obsidiana e o ouro nas marcas. O resto pode mudar se houver forma melhor.

O que o mantenedor pediu ao longo da revisão do protótipo:

- uma tela só, voltada a quem programa, sem navegar entre telas;
- terminais grandes, que nunca se sobrepõem, para competir com o terminal nativo;
- menos botões ocupando espaço;
- sem barra de status;
- rolagem fina, reta e visível só ao rolar;
- temas personalizáveis;
- um modo **Conversa** para quem não programa, com chat e uma visão ilustrada do orquestrador e dos agentes;
- várias equipes num mesmo repositório, que se coordenam para não editar os mesmos arquivos nem fazer commit uma sobre a outra.

## Fase 1 — identidade (este PR)

Só interface, sem mudar dados nem IPC. Para conviver com o trabalho de outros agentes em `App.jsx`, a identidade fica numa folha própria (`src/identity.css`, carregada depois de `src/styles.css`) e mexe pouco no JSX.

- **Tokens** (`src/appearance.js`):
  - tinta quente (marfim e grafite);
  - `--gold` ajustado para 4.5:1 em cada fundo;
  - `visibleAccent`: um destaque que some no fundo (marfim sobre Papel, por exemplo) só tem o preenchimento ajustado.
- **Presets:**
  - Marfim sobre Obsidiana passa a ser o padrão, com Ouro e Obsidiana novos;
  - quem estava exatamente no padrão antigo, sem nunca ter mudado, passa ao novo.
- **Marca:**
  - a estátua do logo (`src/assets/atlas-statue.webp`, recorte com fundo transparente) na barra de título;
  - o wordmark em Jost 300, empacotada com o app.
- **Projeto sem sessões:** o Atlas recebe o usuário com a estátua, as órbitas que se desenham e uma explicação curta, numa entrada única, sem loop.
- **Terminais:**
  - a linha da grade define a altura de cada cartão, com piso de 380px e duas linhas por janela, então nada se sobrepõe;
  - no Foco, o cartão ocupa toda a área;
  - cartões com raio de 12px e borda de estado à esquerda;
  - seleção em ouro.
- **Sem barra de status inferior:** a altura vai para os terminais.
- **Rolagem** fina, reta e visível só enquanto rola (`src/scrollbars.js`).
- **Diálogos e toasts** chegam como material.
- **Acessibilidade:**
  - `prefers-reduced-motion` mostra o estado final;
  - `prefers-reduced-transparency` tira o desfoque.
- **Design system:** `design-system/atlas/MASTER.md` foi reescrito com a identidade.

## Fase 2 — barra única e paleta de comandos (entregue)

Só interface.

- **Uma barra só em cima**, com marca, abas de projeto e ações:
  - a barra de título e a linha de abas viraram uma, e os terminais ganharam mais 40px de altura;
  - saíram "Início", o avatar e o rótulo "Sessões locais", que não faziam nada;
  - o caminho da pasta ficou curto, com o caminho completo na dica.
- **Abas em vez de seletor.** Os projetos continuam em abas, a um clique, porque são poucos. Seletor e abas de equipe ficam para a fase 5, quando houver equipes.
- **Paleta de comandos** com Ctrl Shift P ou F1. Funciona também com o foco dentro do terminal: o atalho é lido antes do xterm, e nada do que se digita nela chega ao PTY.
  - A paleta reúne as ações dos botões, os projetos e os terminais do projeto.
  - A busca ignora acentos e maiúsculas.
- **Barras das colunas:** "Navegação", "Terminais" e "Painéis" continuam como rótulos de seção, porque guardam Ocultar e Pop-up. Também dá para ocultar e mostrar as colunas pela paleta.

## Fase 3 — Painel do Atlas

Só interface, com os dados que já existem: pedidos, tarefas, sessões e revisão.

- **No topo:** quem coordena (a principal, com o modelo dela) e, logo abaixo, **"Espera você"**:
  - pedidos de agente;
  - revisões prontas para o usuário concluir.

  Cada um com a ação dele.
- **A equipe agrupada por tarefa:** cada agente com função, modelo e estado. A linha leva ao terminal certo.
- **Rostos dos modelos:** logos dos fornecedores, só como identificação, com a licença de cada ícone conferida antes.

## Fase 4 — modo Conversa [decidir]

Uma tela alternativa para quem não programa: um chat comum e, ao lado, a equipe ilustrada, com o que cada um faz em linguagem simples. Antes de implementar, o mantenedor decide:

1. **Como a mensagem do chat chega à principal.** Mensagens nunca são digitadas no terminal. O caminho natural é um canal novo da ponte MCP que a principal lê, o que muda o perfil dela e precisa de plano.
2. **De onde vem o "o que está fazendo agora".** Os agentes informariam progresso em linguagem simples pela ponte, ou o ATLAS deriva de tarefas e estados.
3. **Qual modo abre primeiro**, e se a escolha fica por usuário ou por projeto.

## Fase 5 — várias equipes no mesmo repositório [decidir]

Várias equipes no mesmo repositório (por exemplo, Interface e Instalador), cada uma com a sua principal, coordenando-se para não editar os mesmos arquivos nem fazer commit uma sobre a outra.

- **Muda uma invariante:** "identidade única da principal por projeto" passaria a ser "por equipe". Precisa de plano aprovado.
- **O protótipo mostra o fluxo proposto:**
  1. o ATLAS detecta arquivos em comum entre as worktrees;
  2. as principais propõem uma ordem de integração;
  3. o usuário aprova ou inverte.

  Nada é mesclado sozinho, e o Git do usuário continua somente leitura.

## Fora deste plano

O terminal com a aparência do terminal do sistema e a abertura sem "resultado incerto" continuam como ideias em `docs/ROADMAP.md`.
