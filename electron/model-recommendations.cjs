const fs = require('node:fs');
const path = require('node:path');
const { MODEL_PATTERN } = require('./agent-adapters.cjs');
const { SLUG_PATTERN } = require('./agent-functions.cjs');

// Recomendações de modelo por função, curadas pelo mantenedor do ATLAS
// (`model-recommendations.json`). Agentes não alteram a lista sem instrução
// explícita dele. A recomendação só é exibida ao usuário: nunca preenche a
// escolha sozinha.

const DEFAULT_FILE = path.join(__dirname, 'model-recommendations.json');
const MAX_PER_FUNCTION = 5;

function text(label, value, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\p{Cc}\p{Cf}]/u.test(value)) throw new Error(`${label}: texto visível com até ${max} caracteres.`);
  return value.trim();
}

// Valida tudo antes de usar: um arquivo errado falha com mensagem clara em vez de
// recomendar algo pela metade.
function parseRecommendations(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Recomendações de modelo ilegíveis: ${error.message}`);
  }
  const fail = (detail) => { throw new Error(`Recomendações de modelo inválidas: ${detail}.`); };
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('o arquivo deve ser um objeto');
  const extra = Object.keys(data).filter((key) => !['revisadoEm', 'funcoes'].includes(key));
  if (extra.length) fail(`campo desconhecido ${extra[0]}`);
  if (data.revisadoEm !== null && (typeof data.revisadoEm !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.revisadoEm))) fail('revisadoEm deve ser null ou AAAA-MM-DD');
  if (!data.funcoes || typeof data.funcoes !== 'object' || Array.isArray(data.funcoes)) fail('funcoes deve ser um objeto');
  const funcoes = {};
  for (const [slug, list] of Object.entries(data.funcoes)) {
    if (!SLUG_PATTERN.test(slug)) fail(`função ${slug}`);
    if (!Array.isArray(list) || list.length > MAX_PER_FUNCTION) fail(`${slug} deve ser uma lista com até ${MAX_PER_FUNCTION} itens`);
    funcoes[slug] = list.map((item, index) => {
      const where = `${slug}[${index}]`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) fail(`${where} deve ser um objeto`);
      const unknown = Object.keys(item).filter((key) => !['adapterId', 'model', 'motivo'].includes(key));
      if (unknown.length) fail(`${where} tem o campo desconhecido ${unknown[0]}`);
      if (typeof item.adapterId !== 'string' || !/^[a-z0-9-]{1,40}$/.test(item.adapterId)) fail(`${where}.adapterId`);
      if (typeof item.model !== 'string' || !MODEL_PATTERN.test(item.model)) fail(`${where}.model`);
      try {
        return Object.freeze({ adapterId: item.adapterId, model: item.model, motivo: text('motivo', item.motivo, 200) });
      } catch (error) {
        return fail(`${where}.${error.message}`);
      }
    });
    Object.freeze(funcoes[slug]);
  }
  return Object.freeze({ revisadoEm: data.revisadoEm, funcoes: Object.freeze(funcoes) });
}

function loadRecommendations({ file = DEFAULT_FILE, readFile = fs.readFileSync } = {}) {
  return parseRecommendations(readFile(file, 'utf8'));
}

// Primeira recomendação da função cujo modelo o usuário tem. `available` mapeia
// adapterId → modelos listados pelo CLI; adaptadores ausentes não recomendam nada.
function recommendFor(recommendations, slug, available) {
  for (const item of recommendations.funcoes[slug] || []) {
    const models = available[item.adapterId];
    if (Array.isArray(models) && models.includes(item.model)) return item;
  }
  return null;
}

module.exports = { loadRecommendations, parseRecommendations, recommendFor, DEFAULT_FILE };
