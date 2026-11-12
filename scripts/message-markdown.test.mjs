import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { collapsePlan, lineTone, messageTone, parseBlocks, parseInline } from '../src/message-markdown.js';
import { MessageCard } from '../src/message-card.js';

// Mensagem real recebida pelo painel (briefing do orquestrador), reduzida só no tamanho.
const REAL_BODY = [
  'Objetivo: deixar o painel Mensagens legível, organizado e 100% responsivo.',
  '',
  'Diagnóstico atual:',
  '- src/SessionMessages.jsx:23 põe o corpo inteiro num único <p>, então as quebras somem.',
  '- styles.css:225-234 usa fontes de 7px; o corpo tem 10-12px.',
  '',
  'Requisitos:',
  '1. Renderizar o corpo como markdown seguro, sem HTML cru: `código`, **negrito** e listas.',
  '2. Nunca truncar nem resumir.',
  '   - Caminho longo: C:\\Users\\example\\Documents\\atlas\\src\\message-card.js',
  '10. Rodar `npm run build` e `npm test` com o Node em C:\\Program Files\\nodejs.',
  '',
  '```powershell',
  'npm run test:desktop -- --user-data-dir="C:\\Temp\\atlas <isolado>"',
  '```',
  '',
  'Observação: use nvm se o PATH tiver a v20 & mantenha <script>alert(1)</script> como texto.',
].join('\n');

function textOf(html) {
  return html
    .replace(/<br\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
}

function render(message, props = {}) {
  return renderToStaticMarkup(createElement(MessageCard, { message, ...props }));
}

const base = { id: 'm1', kind: 'note', fromName: 'ORQUESTRADOR', toName: 'claude-ui', subject: 'Briefing', createdAt: '2026-11-12T13:35:40.204Z', readAt: null };

test('mensagem real: todo o texto original aparece, sem marcadores de sintaxe', () => {
  const html = render({ ...base, body: REAL_BODY });
  const text = textOf(html);
  for (const raw of REAL_BODY.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('```')) continue;
    const expected = raw.replace(/^\s*(?:\d+[.)]|[-*+])\s+/, '').replace(/\*\*|`/g, '').trim();
    assert.ok(text.includes(expected), `texto ausente: ${expected}`);
  }
  assert.ok(html.includes('<ol'), 'lista numerada vira <ol>');
  assert.match(html, /<li value="1"/);
  assert.match(html, /<li value="10"/, 'numeração original preservada');
  assert.ok(html.includes('<ul'), 'lista com tópicos vira <ul>');
  assert.ok(html.includes('<pre class="md-pre"'), 'bloco de código preservado');
  assert.ok(html.includes('<code class="md-code">npm run build</code>'), 'código inline');
  assert.ok(html.includes('<strong>negrito</strong>'), 'negrito');
  assert.ok(!/Mostrar tudo/.test(html), 'não lida nunca recolhe');
});

test('HTML no corpo nunca vira elemento', () => {
  const html = render({ ...base, body: '<img src=x onerror=alert(1)> e <script>alert(1)</script>\n- <b>item</b>' });
  assert.ok(!html.includes('<script'), 'script escapado');
  assert.ok(!html.includes('<img'), 'img escapada');
  assert.ok(!html.includes('<b>'), 'b escapado');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('parser: cercas, títulos, rótulos e marcadores sem par ficam como texto', () => {
  const blocks = parseBlocks('## Título\nRequisitos:\n- a\n- b\n\n```\nsem fechamento\n**x');
  assert.deepEqual(blocks.map((block) => block.type), ['heading', 'label', 'list', 'code']);
  assert.equal(blocks[3].text, 'sem fechamento\n**x', 'cerca sem fechamento vira código até o fim');
  assert.deepEqual(parseInline('a ** b ` c'), [{ type: 'text', text: 'a ** b ` c' }]);
  assert.deepEqual(parseInline('*.test.mjs e C:\\a\\*b'), [{ type: 'text', text: '*.test.mjs e C:\\a\\*b' }]);
  const paragraph = parseBlocks('linha 1\nlinha 2');
  assert.deepEqual(paragraph, [{ type: 'paragraph', lines: ['linha 1', 'linha 2'] }], 'quebras de linha preservadas');
});

test('tom das linhas: sucesso, falha e atenção', () => {
  assert.equal(lineTone('npm test passou: 214 testes'), 'success');
  assert.equal(lineTone('CI verde em Ubuntu e Windows'), 'success');
  assert.equal(lineTone('npm run test:desktop falhou no redimensionamento'), 'danger');
  assert.equal(lineTone('Erro ao abrir o PTY'), 'danger');
  assert.equal(lineTone('3 passed, 2 failed'), 'danger');
  assert.equal(lineTone('Os testes não passaram'), 'danger');
  assert.equal(lineTone('Para o usuário: aprove o merge'), 'attention');
  assert.equal(lineTone('O merge precisa de aprovação'), 'attention');
  assert.equal(lineTone('Tarefa bloqueada pela CI'), 'attention');
});

test('tom das linhas: casos negativos não ficam vermelhos', () => {
  for (const text of ['sem erros', 'Sem erros no build', '0 falhas', '214 testes, 0 falhas', 'nenhum erro', 'Nenhum erro encontrado', 'falhas: 0', 'tests 42 passed, 0 failed', 'não houve erros', 'o teste não falhou']) {
    assert.notEqual(lineTone(text), 'danger', text);
  }
  assert.equal(lineTone('Ajustei `.error-note` e `errors.js`'), null, 'código inline não define tom');
  assert.equal(lineTone('styles.error-note ficou igual'), null, 'identificador com error- não é falha');
  assert.equal(lineTone('desbloqueado'), null);
  assert.equal(lineTone('Nada a relatar'), null);
  assert.equal(lineTone('Não marque a tarefa como concluída: só o usuário conclui.'), null, 'instrução negativa não é sucesso');
  assert.equal(lineTone('Não consegui rodar porque o build falhou'), 'danger', 'negação distante não apaga a falha');
});

test('tom da mensagem: atenção vence falha, que vence sucesso', () => {
  assert.equal(messageTone({ subject: 'x', body: '1. passou\n2. falhou\n\nPara o usuário: decida' }), 'attention');
  assert.equal(messageTone({ subject: 'x', body: '- passou\n- falhou' }), 'danger');
  assert.equal(messageTone({ subject: 'x', body: '- passou\n- 0 falhas' }), 'success');
  assert.equal(messageTone({ subject: 'x', body: '```\nError: só no log\n```' }), null, 'conteúdo de código não define o tom');
});

test('itens e linhas coloridos levam ícone e texto, não só cor', () => {
  const html = render({ ...base, body: '- testes passaram\n- build falhou\n- sem erros\n\nlinha com erro\nlinha neutra' });
  assert.match(html, /<li class="tone-success"><svg[^>]*md-tone-icon[\s\S]*?<span class="sr-only">Sucesso: <\/span>/);
  assert.match(html, /<li class="tone-danger"><svg[^>]*md-tone-icon[\s\S]*?<span class="sr-only">Falha: <\/span>/);
  assert.ok(!/<li class="tone-danger"><svg[^>]*>[\s\S]*?sem erros/.test(html.split('build falhou')[1] ?? ''), 'sem erros não fica vermelho');
  assert.match(html, /<span class="md-line tone-danger">.*?linha com erro/);
  assert.match(html, /<span class="md-line">linha neutra/);
  assert.match(html, /class="msg-flag tone-danger"[\s\S]*Falha relatada/, 'selo no topo do cartão');
});

test('recolhimento: só lida e longa, com quantas linhas faltam', () => {
  const long = Array.from({ length: 20 }, (_, index) => `linha ${index + 1}`).join('\n');
  assert.equal(collapsePlan(long, { unread: true }).collapsible, false, 'não lida abre inteira');
  assert.equal(collapsePlan(long, { keptOpen: true }).collapsible, false, 'chegou não lida: continua aberta');
  assert.equal(collapsePlan('a\nb\nc').collapsible, false, 'curta não recolhe');
  const plan = collapsePlan(long);
  assert.equal(plan.collapsible, true);
  assert.equal(plan.hiddenLines, 12);
  assert.equal(plan.preview.split('\n').length, 8);

  const readHtml = render({ ...base, readAt: '2026-11-12T14:00:00.000Z', body: long });
  assert.ok(readHtml.includes('Mostrar tudo (+12 linhas)'));
  assert.match(readHtml, /aria-expanded="false"/);
  assert.ok(readHtml.includes('linha 8') && !readHtml.includes('linha 9<'), 'mostra 8 linhas e o botão expande o resto');

  const fenced = ['a', 'b', 'c', 'd', 'e', 'f', 'g', '```', 'npm test', '```', 'h', 'i', 'j', 'k', 'l'].join('\n');
  const fencedPlan = collapsePlan(fenced);
  assert.equal(fencedPlan.preview, 'a\nb\nc\nd\ne\nf\ng', 'prévia não termina em cerca vazia');
  assert.equal(fencedPlan.hiddenLines, 8, 'linhas ocultas contam a cerca deixada de fora');

  const unreadHtml = render({ ...base, body: long });
  assert.ok(!unreadHtml.includes('Mostrar tudo'));
  assert.ok(unreadHtml.includes('linha 20'), 'não lida mostra tudo');
});

test('cabeçalho, selos e marcar como lida; somente leitura sem o botão', () => {
  const html = render({ ...base, kind: 'discovery', body: 'oi' }, { onMarkRead: () => {} });
  assert.match(html, /<article[^>]*class="msg-card unread"/, 'cartão é article, não botão: texto selecionável');
  assert.ok(!/<button[^>]*class="msg-card/.test(html));
  assert.ok(textOf(html).includes('De ORQUESTRADOR para claude-ui'), 'rota de→para legível');
  assert.match(html, /<time class="msg-time" dateTime="2026-11-12T13:35:40.204Z">/);
  assert.ok(html.includes('descoberta') && html.includes('não lida'));
  assert.ok(html.includes('Marcar como lida'));

  const readOnly = render({ ...base, body: 'oi' }, { readOnly: true, onMarkRead: () => {} });
  assert.ok(!readOnly.includes('Marcar como lida'), 'janela de acompanhamento não marca');
  assert.ok(!readOnly.includes('<button'), 'nenhum botão para mensagem curta em somente leitura');

  const read = render({ ...base, readAt: '2026-11-12T14:00:00.000Z', body: 'oi' }, { onMarkRead: () => {} });
  assert.ok(!read.includes('Marcar como lida'), 'lida não oferece marcar de novo');
  assert.ok(read.includes('lida em'));
  assert.ok(read.includes('nota'));
});
