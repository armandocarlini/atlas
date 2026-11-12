// Markdown seguro para o corpo das mensagens entre sessões.
// Nunca produz HTML: devolve uma árvore de blocos que o React monta como elementos,
// e todo caractere que não é sintaxe reconhecida continua no texto.

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const LIST_ITEM = /^(\s*)(?:(\d{1,9})[.)]|([-*+•]))\s+(.*)$/;
const LABEL = /^\S.{0,70}:$/;

const indentOf = (line) => line.length - line.trimStart().length;
const isBlank = (line) => !line.trim();

export function normalizeLines(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
}

function readFence(lines, start) {
  const [, marker, lang] = FENCE.exec(lines[start]);
  const body = [];
  let index = start + 1;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim().startsWith(marker[0].repeat(marker.length)) && FENCE.test(line) && !FENCE.exec(line)[2]) {
      return { block: { type: 'code', lang, text: body.join('\n') }, next: index + 1 };
    }
    body.push(line);
    index += 1;
  }
  // Cerca sem fechamento: o resto inteiro vira código, nada se perde.
  return { block: { type: 'code', lang, text: body.join('\n') }, next: index };
}

function readList(lines, start) {
  const first = LIST_ITEM.exec(lines[start]);
  const baseIndent = first[1].length;
  const ordered = first[2] !== undefined;
  const items = [];
  let index = start;
  while (index < lines.length) {
    const match = LIST_ITEM.exec(lines[index]);
    if (!match) break;
    const indent = match[1].length;
    if (indent < baseIndent || indent > baseIndent + 1 || (match[2] !== undefined) !== ordered) break;
    const contentIndent = match[0].length - match[4].length;
    const nestIndent = Math.min(contentIndent, baseIndent + 2);
    const body = [match[4]];
    index += 1;
    while (index < lines.length) {
      const line = lines[index];
      if (isBlank(line)) {
        let ahead = index;
        while (ahead < lines.length && isBlank(lines[ahead])) ahead += 1;
        if (ahead < lines.length && indentOf(lines[ahead]) >= nestIndent) {
          body.push(...lines.slice(index, ahead).map(() => ''));
          index = ahead;
          continue;
        }
        break;
      }
      const indent = indentOf(line);
      if (indent >= nestIndent) {
        body.push(line.slice(Math.min(indent, contentIndent)));
        index += 1;
        continue;
      }
      if (LIST_ITEM.test(line) || FENCE.test(line) || HEADING.test(line)) break;
      // Continuação preguiçosa: linha logo abaixo do item, sem recuo.
      body.push(line.trim());
      index += 1;
    }
    items.push({ number: ordered ? Number(match[2]) : null, blocks: parseBlocks(body) });
    // Linhas em branco entre itens irmãos não encerram a lista.
    let ahead = index;
    while (ahead < lines.length && isBlank(lines[ahead])) ahead += 1;
    const sibling = ahead < lines.length && LIST_ITEM.exec(lines[ahead]);
    if (ahead > index && sibling && sibling[1].length >= baseIndent && sibling[1].length <= baseIndent + 1 && (sibling[2] !== undefined) === ordered) index = ahead;
  }
  return { block: { type: 'list', ordered, items }, next: index };
}

export function parseBlocks(input) {
  const lines = Array.isArray(input) ? input : normalizeLines(input);
  const blocks = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', lines: paragraph });
    paragraph = [];
  };
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (isBlank(line)) { flush(); index += 1; continue; }
    if (FENCE.test(line)) {
      flush();
      const { block, next } = readFence(lines, index);
      blocks.push(block);
      index = next;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }
    if (LIST_ITEM.test(line)) {
      flush();
      const { block, next } = readList(lines, index);
      blocks.push(block);
      index = next;
      continue;
    }
    const trimmed = line.trim();
    if (!paragraph.length && LABEL.test(trimmed) && (index + 1 >= lines.length || isBlank(lines[index + 1]) || LIST_ITEM.test(lines[index + 1]) || FENCE.test(lines[index + 1]))) {
      blocks.push({ type: 'label', text: trimmed });
      index += 1;
      continue;
    }
    paragraph.push(trimmed);
    index += 1;
  }
  flush();
  return blocks;
}

const INLINE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\*\*(?=\S)([\s\S]*?\S)\*\*/g;

export function parseInline(text) {
  const source = String(text ?? '');
  const tokens = [];
  let last = 0;
  for (const match of source.matchAll(INLINE)) {
    if (match.index > last) tokens.push({ type: 'text', text: source.slice(last, match.index) });
    if (match[1]) tokens.push({ type: 'code', text: match[2] });
    else tokens.push({ type: 'strong', children: parseInline(match[3]) });
    last = match.index + match[0].length;
  }
  if (last < source.length) tokens.push({ type: 'text', text: source.slice(last) });
  return tokens;
}

// ---- Tons: precisa de você (âmbar), falha (vermelho), sucesso (verde). ----

const W = '(?<![\\p{L}\\p{N}_])';
const E = '(?![\\p{L}\\p{N}_])(?![-_./\\\\]\\p{L})';
const ATTENTION = [
  /para o usu[áa]rio\s*:/iu,
  /precis[ao]\s+(?:de\s+)?(?:sua\s+|você|voce|aprova|decis|confirma|autoriza)/iu,
  /aguard\w*\s+(?:a\s+)?(?:sua\s+)?(?:aprova|decis|confirma|autoriza|resposta)/iu,
  new RegExp(`${W}bloquead[oa]s?${E}|${W}bloqueio${E}`, 'iu'),
  /requer\s+(?:sua\s+)?(?:aprova|decis|autoriza|a[çc][ãa]o)/iu,
  /depende\s+de\s+voc[êe]/iu,
  /\[decidir\]/iu,
  /⚠/u,
];
const DANGER = new RegExp(`${W}(?:falh(?:a|as|ou|aram|ando|ar)|erros?|errors?|failed|failures?|failing|fails?|quebr(?:ou|ad[oa]s?)|crash(?:ed|ou)?|travou)${E}|❌|✗`, 'giu');
const SUCCESS = new RegExp(`${W}(?:pass(?:ou|aram|am|ando|ed|ing|es)|aprovad[oa]s?|sucesso|bem-sucedid[oa]s?|conclu[íi]d[oa]s?|resolvid[oa]s?|corrigid[oa]s?|verde|green|succeeded|ok)${E}|✅|✓|✔`, 'giu');
// Contagens e quantificadores negam a palavra seguinte ("0 falhas", "sem erros");
// "não" e "nunca" alcançam até quatro palavras ("não marque a tarefa como concluída").
const NEGATION_BEFORE = /(?:^|[\s(])(?:(?:sem|nenhum[a]?|zero|0|no|without)\s+(?:\S+\s+)?|(?:não|nao|nunca|not)\s+(?:\S+\s+){0,4})$/iu;
const ZERO_AFTER = /^\s*[:=]\s*0(?![\d.,])/u;
const CLAUSE_BREAK = /[.;!?\n]|,\s/gu;

function clauseBefore(text, index) {
  const before = text.slice(0, index);
  let start = 0;
  for (const match of before.matchAll(CLAUSE_BREAK)) start = match.index + match[0].length;
  return before.slice(start);
}

function plainOf(text) {
  // Trechos de código (`npm test`, nomes de classe) não definem o tom.
  return String(text ?? '').replace(/`[^`\n]*`/g, ' ');
}

function hasDanger(text) {
  for (const match of text.matchAll(DANGER)) {
    const negated = NEGATION_BEFORE.test(clauseBefore(text, match.index)) || ZERO_AFTER.test(text.slice(match.index + match[0].length));
    if (!negated) return true;
  }
  return false;
}

function successState(text) {
  let success = false;
  for (const match of text.matchAll(SUCCESS)) {
    if (NEGATION_BEFORE.test(clauseBefore(text, match.index))) {
      // "não passou" é falha; "não concluído" só não é sucesso.
      if (/^pass/i.test(match[0])) return 'danger';
      continue;
    }
    success = true;
  }
  return success ? 'success' : null;
}

export function lineTone(text) {
  const plain = plainOf(text);
  if (!plain.trim()) return null;
  if (ATTENTION.some((pattern) => pattern.test(plain))) return 'attention';
  const success = successState(plain);
  if (success === 'danger' || hasDanger(plain)) return 'danger';
  return success;
}

function blockTexts(blocks, out = []) {
  for (const block of blocks) {
    if (block.type === 'paragraph') out.push(...block.lines);
    else if (block.type === 'heading' || block.type === 'label') out.push(block.text);
    else if (block.type === 'list') for (const item of block.items) blockTexts(item.blocks, out);
  }
  return out;
}

const TONE_RANK = { attention: 3, danger: 2, success: 1 };

export function toneOfTexts(texts) {
  let best = null;
  for (const text of texts) {
    const tone = lineTone(text);
    if (tone && (!best || TONE_RANK[tone] > TONE_RANK[best])) best = tone;
    if (best === 'attention') break;
  }
  return best;
}

export function messageTone(message) {
  return toneOfTexts([message?.subject ?? '', ...blockTexts(parseBlocks(message?.body))]);
}

/** Texto do item sem as sublistas: é ele que define o tom do item. */
export function itemOwnTexts(item) {
  return blockTexts(item.blocks.filter((block) => block.type !== 'list'));
}

// ---- Recolhimento: só mensagens lidas e longas; a não lida abre inteira. ----

export const COLLAPSE_VISIBLE_LINES = 8;
export const COLLAPSE_MIN_HIDDEN = 5;

export function collapsePlan(body, { unread = false, keptOpen = false } = {}) {
  const lines = normalizeLines(body);
  const contentLines = lines.filter((line) => !isBlank(line)).length;
  const hiddenLines = contentLines - COLLAPSE_VISIBLE_LINES;
  const collapsible = !unread && !keptOpen && hiddenLines >= COLLAPSE_MIN_HIDDEN;
  if (!collapsible) return { collapsible: false, hiddenLines: 0, preview: null };
  let seen = 0;
  let cut = 0;
  let openFence = -1;
  while (cut < lines.length && seen < COLLAPSE_VISIBLE_LINES) {
    if (!isBlank(lines[cut])) seen += 1;
    if (FENCE.test(lines[cut])) openFence = openFence < 0 ? cut : -1;
    cut += 1;
  }
  // Não termina a prévia numa cerca que abre um bloco ainda vazio.
  if (openFence >= 0 && lines.slice(openFence + 1, cut).every(isBlank)) cut = openFence;
  const visible = lines.slice(0, cut).filter((line) => !isBlank(line)).length;
  return { collapsible: true, hiddenLines: contentLines - visible, preview: lines.slice(0, cut).join('\n').trimEnd() };
}
