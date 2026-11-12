// Cartão de mensagem entre sessões. Escrito com createElement (sem JSX) para
// que os testes de node renderizem exatamente o que o app mostra.
import { createElement as h, Fragment, useId, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, CheckCircle2, ChevronDown, Lightbulb, StickyNote, XCircle } from 'lucide-react';
import { collapsePlan, itemOwnTexts, lineTone, messageTone, parseBlocks, parseInline, toneOfTexts } from './message-markdown.js';

export const TONES = {
  attention: { label: 'Precisa de você', short: 'Atenção', Icon: AlertTriangle },
  danger: { label: 'Falha relatada', short: 'Falha', Icon: XCircle },
  success: { label: 'Sucesso relatado', short: 'Sucesso', Icon: CheckCircle2 },
};

export function formatWhen(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? String(iso ?? '') : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function Inline({ text }) {
  const render = (tokens) => tokens.map((token, index) => {
    if (token.type === 'code') return h('code', { key: index, className: 'md-code' }, token.text);
    if (token.type === 'strong') return h('strong', { key: index }, render(token.children));
    return h(Fragment, { key: index }, token.text);
  });
  return render(parseInline(text));
}

function ToneMark({ tone }) {
  if (!tone) return null;
  const { Icon, short } = TONES[tone];
  return h(Fragment, null,
    h(Icon, { size: 13, className: 'md-tone-icon', 'aria-hidden': true }),
    h('span', { className: 'sr-only' }, `${short}: `));
}

function Line({ text, toned }) {
  const tone = toned ? lineTone(text) : null;
  return h('span', { className: `md-line${tone ? ` tone-${tone}` : ''}` }, h(ToneMark, { tone }), h(Inline, { text }));
}

function Blocks({ blocks, toned = true }) {
  return blocks.map((block, index) => {
    switch (block.type) {
      case 'heading':
        return h('p', { key: index, className: `md-heading md-h${Math.min(block.level, 3)}`, role: 'heading', 'aria-level': Math.min(block.level + 3, 6) }, h(Line, { text: block.text, toned }));
      case 'label':
        return h('p', { key: index, className: 'md-label' }, h(Line, { text: block.text, toned }));
      case 'code':
        return h('pre', { key: index, className: 'md-pre', tabIndex: 0, 'aria-label': block.lang ? `Código ${block.lang}` : 'Bloco de código' }, h('code', null, block.text));
      case 'list':
        return h(block.ordered ? 'ol' : 'ul', { key: index, className: 'md-list' }, block.items.map((item, itemIndex) => {
          const tone = toned ? toneOfTexts(itemOwnTexts(item)) : null;
          return h('li', { key: itemIndex, value: block.ordered ? item.number : undefined, className: tone ? `tone-${tone}` : undefined },
            h(ToneMark, { tone }),
            h(Blocks, { blocks: item.blocks, toned: false }));
        }));
      default:
        return h('p', { key: index, className: 'md-paragraph' }, block.lines.map((line, lineIndex) => h(Fragment, { key: lineIndex },
          lineIndex > 0 ? h('br') : null,
          h(Line, { text: line, toned }))));
    }
  });
}

export function MessageBody({ body, id, collapsed = false }) {
  return h('div', { id, className: `msg-body${collapsed ? ' collapsed' : ''}` }, h(Blocks, { blocks: parseBlocks(body) }));
}

export function MessageCard({ message, readOnly = false, onMarkRead }) {
  const unread = !message.readAt;
  // Quem chegou não lida fica aberta enquanto o painel existir, mesmo depois de lida.
  const [keptOpen] = useState(unread);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const cardRef = useRef(null);
  const baseId = useId();
  const tone = messageTone(message);
  const plan = collapsePlan(message.body, { unread, keptOpen });
  const collapsed = plan.collapsible && !expanded;
  const kind = message.kind === 'discovery' ? { label: 'descoberta', Icon: Lightbulb } : { label: 'nota', Icon: StickyNote };
  const canMark = !readOnly && unread && typeof onMarkRead === 'function';

  async function markRead() {
    if (busy) return;
    setBusy(true);
    try {
      await onMarkRead(message);
    } finally {
      setBusy(false);
      cardRef.current?.focus();
    }
  }

  return h('article', {
    ref: cardRef,
    tabIndex: -1,
    className: `msg-card${unread ? ' unread' : ''}${tone ? ` tone-${tone}` : ''}`,
    'aria-labelledby': `${baseId}-subject`,
    'aria-describedby': `${baseId}-meta`,
  },
  tone && h('p', { className: `msg-flag tone-${tone}` }, h(TONES[tone].Icon, { size: 14, 'aria-hidden': true }), h('span', null, TONES[tone].label)),
  h('header', { className: 'msg-head' },
    h('p', { className: 'msg-route' },
      h('span', { className: 'sr-only' }, 'De '),
      h('span', { className: 'msg-party msg-from' }, message.fromName),
      h(ArrowRight, { size: 12, 'aria-hidden': true }),
      h('span', { className: 'sr-only' }, ' para '),
      h('span', { className: 'msg-party' }, message.toName)),
    h('time', { className: 'msg-time', dateTime: message.createdAt }, formatWhen(message.createdAt))),
  h('h3', { className: 'msg-subject', id: `${baseId}-subject` }, message.subject),
  h('p', { className: 'msg-badges', id: `${baseId}-meta` },
    h('span', { className: `msg-badge kind-${message.kind === 'discovery' ? 'discovery' : 'note'}` }, h(kind.Icon, { size: 12, 'aria-hidden': true }), kind.label),
    h('span', { className: `msg-badge ${unread ? 'state-unread' : 'state-read'}` },
      unread ? h('span', { className: 'msg-dot', 'aria-hidden': true }) : h(Check, { size: 12, 'aria-hidden': true }),
      unread ? 'não lida' : `lida em ${formatWhen(message.readAt)}`)),
  h(MessageBody, { id: `${baseId}-body`, body: collapsed ? plan.preview : message.body, collapsed }),
  (plan.collapsible || canMark) && h('footer', { className: 'msg-actions' },
    plan.collapsible && h('button', {
      type: 'button', className: 'msg-action msg-more', 'aria-expanded': expanded, 'aria-controls': `${baseId}-body`, onClick: () => setExpanded((value) => !value),
    }, h(ChevronDown, { size: 14, 'aria-hidden': true }), expanded ? 'Recolher' : `Mostrar tudo (+${plan.hiddenLines} ${plan.hiddenLines === 1 ? 'linha' : 'linhas'})`),
    canMark && h('button', { type: 'button', className: 'msg-action msg-mark', disabled: busy, onClick: markRead },
      h(Check, { size: 14, 'aria-hidden': true }), busy ? 'Marcando…' : 'Marcar como lida')));
}
