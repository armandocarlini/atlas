# Segurança

O ATLAS é um protótipo desktop local em desenvolvimento. O terminal executa comandos com as permissões do usuário do sistema; seu isolamento de renderer não é uma sandbox para os comandos executados no PowerShell. Execute apenas projetos, shells e agentes em que você confia.

## Relatar uma vulnerabilidade

Use **Security → Advisories → Report a vulnerability** no repositório GitHub para um relato privado. Não publique tokens, credenciais, transcripts, caminhos privados ou dados pessoais em issues, pull requests ou anexos. Se o canal privado estiver indisponível, abra uma issue pedindo um canal seguro, sem descrever a exploração nem anexar dados sensíveis.

Não há prazo de resposta garantido nesta fase. O código atual em `main` é a versão mantida; ainda não existe um release estável para uso em produção.

## Cuidados ao contribuir

- Credenciais pertencem ao gerenciador de credenciais do sistema ou ao ambiente local. Nunca as inclua no código ou em parâmetros de URL.
- Arquivos `.env`, chaves, certificados, bancos locais, backups, preferências de agentes e resultados de smoke tests ficam fora do Git.
- Revise capturas de tela, logs, fixtures e mensagens de commit. O autor do commit também pode expor um email pessoal; configure um email `noreply` do GitHub quando desejar mantê-lo privado.
- Rode `npm run check:public` e `npm audit` antes de publicar. O primeiro faz verificações locais adicionais; nenhum scanner cobre todos os tipos de informação sensível.
- Testes de desktop abrem portas de depuração locais. Use apenas a máquina local e feche a instância de teste ao terminar. O ponto de entrada normal do aplicativo não inicia o servidor auxiliar dos testes.

## Modelo atual

O renderer usa `contextIsolation`, `sandbox` e uma API IPC limitada; o host controla pastas autorizadas, PTYs e janelas. A descoberta Git desativa locks opcionais para evitar atualizar o índice. Credenciais de provedores e autenticação dos agentes ainda não fazem parte da implementação.
