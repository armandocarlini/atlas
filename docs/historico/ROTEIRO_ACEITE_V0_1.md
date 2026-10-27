# Roteiro — demonstração do aceite da v0.1 (marco 6c-2)

Os 12 passos de `docs/AUTONOMIA_V0_1.md`, na ordem em que se encaixam no ATLAS atual. A demonstração usa o OpenCode com um modelo gratuito da NVIDIA, com credencial já configurada no OpenCode, para não consumir quota paga. Registre em cada passo o que aparece, para as evidências do PR de fechamento.

## Antes de começar

- Instale o ATLAS com `release/ATLAS-Setup-0.1.0.exe`, gerado por `npm run dist:win`, ou com o artefato `atlas-windows-installer` da CI. Na pergunta do instalador, responda **Sim** para adicionar "Abrir no ATLAS". Sem assinatura, o Windows pode mostrar o aviso de editor desconhecido.
- Escolha o modelo: precisa estar na lista do OpenCode e saber chamar ferramentas (tool calling), como os modelos de instrução maiores da NVIDIA. Teste antes com uma pergunta simples no OpenCode, fora do ATLAS.
- Projeto de teste: uma pasta com repositório Git e ao menos um commit, por exemplo uma cópia descartável de um projeto pequeno. Não use um projeto real importante: o agente vai escrever na worktree da tarefa.

## Passos

1. **Abrir no ATLAS.** No Explorador, clique com o botão direito na pasta. No Windows 11, a entrada fica em "Mostrar mais opções". Escolha **Abrir no ATLAS** e confirme o cadastro da pasta nova.
2. **Sessão principal.** No aviso "A sessão principal deste projeto ainda não foi iniciada", clique em **Escolher agente**. Escolha OpenCode e o modelo da NVIDIA e clique em **Iniciar principal**. O card ORQUESTRADOR aparece com o selo "ATLAS conectado".
3. **Conversar com a principal.** No terminal dela, descreva um objetivo pequeno e verificável. Exemplo: "Quero um arquivo NOTAS.md com um resumo do projeto. Planeje comigo." A principal só lê e planeja.
4. **Criar a tarefa e abrir a sessão manual.**
   - No painel **Tarefas**, crie uma tarefa ligada ao objetivo, com critério de aceite. Exemplo: "NOTAS.md existe e resume o projeto".
   - Depois, em **Sessão**, abra uma segunda sessão de agente no mesmo projeto, escolhendo o CLI e o modelo.
5. **Terceiro agente pela principal.** Peça à principal: "Peça um agente para essa tarefa, com worktree." Ela usa `atlas_agents_request` com `taskId` e `worktree: true`. No cartão do pedido, confira o propósito, a worktree e a branch planejadas. Escolha o CLI e o modelo e clique em **Aprovar e iniciar**. O agente nasce na worktree `…atlas-worktrees/task-…`.
6. **Descoberta da sessão manual.** No card da sessão manual, clique em **Descoberta** e envie assunto e conteúdo à principal. Peça à principal que leia as mensagens não lidas; ela usa `atlas_messages_unread`.
7. **Delegação.** Peça à principal que delegue a tarefa ao terceiro agente. Ela usa `atlas_tasks_delegate`. No terminal do terceiro agente, peça: "Veja as ofertas pendentes do ATLAS e aceite a tarefa." Ele usa `atlas_handoffs_pending` e `atlas_handoffs_accept`. O painel Tarefas mostra o responsável.
8. **Alternar e intervir.** Alterne entre os três terminais: cards, foco ou pop-up. Digite diretamente em um deles, por exemplo para corrigir uma instrução do terceiro agente.
9. **Trabalho na worktree.** O terceiro agente cria o arquivo na worktree e informa progresso com `atlas_tasks_update`. Os eventos ficam registrados; a branch principal do repositório não muda.
10. **Revisão e aceite.** Peça ao terceiro agente que faça commit e peça revisão com `atlas_tasks_request_review`, informando o resumo e os comandos executados. Na aba **Evidências**, confira a declaração do agente e o retrato Git coletado pelo ATLAS. No painel Tarefas, aceite. A tarefa vira `done`, e só você pode concluí-la.
11. **Fechar e reabrir.** Feche o ATLAS com os agentes ainda abertos e abra de novo.
12. **Estado preservado.** Confira:
    - projeto, tarefa concluída, mensagem, revisão e evidências continuam;
    - as runs que estavam ativas aparecem como interrompidas ("resultado incerto"), sem reabrir processos;
    - a principal só volta com **Nova execução**, que pede de novo o CLI e o modelo.

## Evidências a registrar

- Capturas: pergunta do instalador, menu do Explorador, cartão do pedido, painel Tarefas com responsável e revisão, aba Evidências e estado após reabrir.
- Do terminal: comandos e respostas relevantes das três sessões, sem dados sensíveis.
- Limites observados, como falhas do modelo ao chamar ferramentas, para o PR de fechamento e o `docs/CONTEXTO.md`.

## Desfazer depois

- "Abrir no ATLAS" sai em **Aparência e configurações** ou ao desinstalar o ATLAS.
- A worktree e a branch `atlas/task-…` ficam no repositório; o ATLAS não as remove. Use `git worktree remove` e `git branch -D` quando quiser.
