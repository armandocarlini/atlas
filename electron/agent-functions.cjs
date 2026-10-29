const { randomUUID } = require('node:crypto');
const { MODEL_PATTERN } = require('./agent-adapters.cjs');

// Funções de agente (v0.2, LLM por função). Cada função guarda o CLI e o modelo
// que o usuário escolheu para ela; isso só preenche a escolha, nunca inicia nada.
// O Orquestrador (principal) e as cinco padrão vêm da migration 10: não se
// apagam nem se renomeiam. As do usuário entram até o limite total.

const MAX_FUNCTIONS = 12; // padrão + do usuário; o Orquestrador é reservado e fica fora da conta.
const SLUG_PATTERN = /^[a-z0-9-]{2,32}$/;
const ADAPTER_PATTERN = /^[a-z0-9-]{1,40}$/;

const FUNCTION_SELECT = `SELECT id, slug, kind, name, description, adapter_id AS adapterId, model, position, version,
  created_at AS createdAt, updated_at AS updatedAt FROM agent_functions WHERE project_id IS NULL`;

// Texto escrito pelo usuário e lido pela principal: sem controles nem formatação invisível.
function functionText(label, value, max, { required = true } = {}) {
  if (typeof value === 'string') value = value.replace(/\r\n/g, '\n');
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`${label}: informe texto válido com até ${max} caracteres.`);
  if (/\p{Cf}|[^\P{Cc}\n\t]/u.test(value)) throw new Error(`${label}: remova caracteres de controle ou formatação invisível.`);
  return value.trim();
}

// CLI e modelo andam juntos: modelo sem CLI não faz sentido; CLI sem modelo vale
// para CLIs que não informam modelos (usam a própria configuração).
function launchChoice(adapterId, model) {
  const adapter = adapterId === undefined || adapterId === null || adapterId === '' ? null : adapterId;
  const chosen = model === undefined || model === null || model === '' ? null : model;
  if (adapter !== null && (typeof adapter !== 'string' || !ADAPTER_PATTERN.test(adapter))) throw new Error('CLI inválido.');
  if (chosen !== null && (typeof chosen !== 'string' || !MODEL_PATTERN.test(chosen))) throw new Error('Modelo inválido.');
  if (chosen !== null && adapter === null) throw new Error('Escolha o CLI antes do modelo.');
  return { adapterId: adapter, model: chosen };
}

function createAgentFunctions({ db, now, transaction }) {
  const get = (id) => db.prepare(`${FUNCTION_SELECT} AND id = ?`).get(id);

  function requireCurrent(id, expectedVersion) {
    if (typeof id !== 'string' || !id) throw new Error('Função inválida.');
    const current = get(id);
    if (!current) throw new Error('Função não encontrada.');
    if (current.version !== expectedVersion) throw new Error('A função mudou desde que foi aberta. Recarregue e tente de novo.');
    return current;
  }

  return {
    listFunctions: () => db.prepare(`${FUNCTION_SELECT} ORDER BY position, slug`).all(),
    getFunction: (id) => get(id) || null,
    getFunctionBySlug: (slug) => db.prepare(`${FUNCTION_SELECT} AND slug = ?`).get(slug) || null,
    createFunction({ slug, name, description = '', adapterId, model }) {
      if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) throw new Error('Identificador: use de 2 a 32 letras minúsculas, números ou hífens.');
      const fields = { name: functionText('Nome', name, 40), description: functionText('Descrição', description, 300, { required: false }), ...launchChoice(adapterId, model) };
      return transaction(db, () => {
        if (db.prepare('SELECT 1 FROM agent_functions WHERE project_id IS NULL AND slug = ?').get(slug)) throw new Error(`Já existe uma função com o identificador ${slug}.`);
        const total = db.prepare("SELECT count(*) AS total FROM agent_functions WHERE project_id IS NULL AND kind != 'orchestrator'").get().total;
        if (total >= MAX_FUNCTIONS) throw new Error(`Limite de ${MAX_FUNCTIONS} funções atingido. Apague uma função sua antes de criar outra.`);
        const position = db.prepare('SELECT coalesce(max(position), 0) + 1 AS next FROM agent_functions WHERE project_id IS NULL').get().next;
        const id = randomUUID();
        const at = now();
        db.prepare(`INSERT INTO agent_functions (id, project_id, slug, kind, name, description, adapter_id, model, position, version, created_at, updated_at)
          VALUES (?, NULL, ?, 'custom', ?, ?, ?, ?, ?, 1, ?, ?)`).run(id, slug, fields.name, fields.description, fields.adapterId, fields.model, position, at, at);
        return get(id);
      });
    },
    // Padrão e Orquestrador aceitam descrição, CLI e modelo; o nome é fixo.
    updateFunction({ id, expectedVersion, ...changes }) {
      return transaction(db, () => {
        const current = requireCurrent(id, expectedVersion);
        if ('name' in changes && current.kind !== 'custom' && changes.name !== current.name) throw new Error('O nome das funções padrão é fixo.');
        const name = 'name' in changes ? functionText('Nome', changes.name, 40) : current.name;
        const description = 'description' in changes ? functionText('Descrição', changes.description, 300, { required: false }) : current.description;
        const launch = 'adapterId' in changes || 'model' in changes
          ? launchChoice(changes.adapterId, changes.model)
          : { adapterId: current.adapterId, model: current.model };
        db.prepare('UPDATE agent_functions SET name = ?, description = ?, adapter_id = ?, model = ?, version = version + 1, updated_at = ? WHERE id = ?')
          .run(name, description, launch.adapterId, launch.model, now(), id);
        return get(id);
      });
    },
    // Rótulo de função de uma run em execução, trocado pelo usuário.
    setRunFunction({ runId, functionSlug }) {
      return transaction(db, () => {
        const run = db.prepare("SELECT id FROM agent_runs WHERE id = ? AND state = 'running'").get(runId);
        if (!run) throw new Error('Run em execução não encontrada.');
        db.prepare('UPDATE agent_runs SET function_slug = ?, function_overridden = ? WHERE id = ?').run(functionSlug, functionSlug ? 1 : null, runId);
        return { runId, functionSlug };
      });
    },
    // Só funções do usuário. Runs passadas guardam o slug e não dependem da linha.
    deleteFunction({ id, expectedVersion }) {
      return transaction(db, () => {
        const current = requireCurrent(id, expectedVersion);
        if (current.kind !== 'custom') throw new Error('As funções padrão e o Orquestrador não podem ser apagados.');
        db.prepare('DELETE FROM agent_functions WHERE id = ?').run(id);
        return { id, deleted: true };
      });
    },
  };
}

module.exports = { createAgentFunctions, MAX_FUNCTIONS, SLUG_PATTERN };
