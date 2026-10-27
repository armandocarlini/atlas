# Plano — "Abrir no ATLAS" (marco 6a)

Objetivo: cumprir o passo 1 do aceite da v0.1 (botão direito em uma pasta → "Abrir no ATLAS") seguindo a seção 8 da arquitetura.

## Comportamento

- O Explorador chama `"<ATLAS.exe>" "--atlas-open=%V"`. O caminho é um único argumento de processo; nunca entra em linha de shell.
- Instância única: com o ATLAS aberto, a segunda instância só repassa os argumentos (`second-instance`) e encerra; a instância existente recebe foco.
- O caminho é validado (absoluto, sem NUL, existente, pasta) e canonicalizado com o realpath nativo. A raiz de unidade (`C:\`), que chega como `C:"` por causa do escape da aspa, é tratada.
- Pasta dentro de um projeto já autorizado abre esse projeto sem duplicar; se a pasta é a raiz ou uma worktree descoberta, ela vira o diretório ativo.
- Pasta nova abre um diálogo de confirmação com o caminho, o efeito no escopo autorizado e a situação do Git. Nada é cadastrado antes de "Cadastrar e abrir"; o pedido vale uma vez e só a janela principal o autoriza.
- O ATLAS não executa `git init`. A detecção de Git só verifica se a pasta é a raiz de um repositório, sem rodar Git.
- Caminho inválido vira aviso, sem cadastro.

## Entrada no Explorador

- Opcional e controlada em "Aparência e configurações": a seção mostra o estado, as chaves e o comando exatos antes de gravar. Adicionar e remover exigem confirmação.
- Grava em `HKCU\Software\Classes\Directory\shell\ATLAS.Open` e `...\Directory\Background\shell\ATLAS.Open` (usuário atual, sem administrador), por `reg.exe` via `execFile`. Remover é idempotente. Fora do Windows a seção não aparece.
- Em desenvolvimento, o comando inclui o caminho do app Electron; no aplicativo instalado, só o executável. Uma entrada que aponta para outro executável aparece como desatualizada.
- O instalador (6b) deve oferecer a mesma entrada e removê-la na desinstalação.

## Testes

- Unidade: argumento, canonicalização com espaços, Unicode e caracteres especiais, projeto conhecido, subpasta, pasta nova com confirmação, IPC, cadastro sem duplicação.
- Registro: emulação em memória e `reg.exe` real em chave de fixture isolada no Windows.
- Desktop: segunda instância real com subpasta, pasta nova com confirmação e contraste, caminho inválido, entrada do Explorador adicionada e removida por consentimento em chave de fixture.
