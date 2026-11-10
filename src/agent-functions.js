// Funções de agente na interface (v0.2). Só preenchem a escolha de CLI e modelo.

export const KIND_LABELS = { orchestrator: 'Sessão principal', builtin: 'Padrão', custom: 'Sua função' };

export const isConfigured = (item) => Boolean(item?.adapterId);

// Funções que ainda pedem configuração (o Orquestrador e as padrão nascem vazios).
export function pendingConfiguration(items) {
  return (items || []).filter((item) => item.kind !== 'custom' && !isConfigured(item)).length;
}

// Recomendação curada pelo mantenedor: a primeira cujo CLI foi detectado. A
// confirmação de que o modelo existe acontece ao usá-la, contra a lista do CLI.
export function pickRecommendation(recommendations, slug, adapters) {
  const available = new Set((adapters || []).filter((adapter) => adapter.status === 'available').map((adapter) => adapter.id));
  return (recommendations?.funcoes?.[slug] || []).find((item) => available.has(item.adapterId)) || null;
}

export function describeChoice(item, adapters) {
  if (!isConfigured(item)) return 'Não configurada';
  const name = (adapters || []).find((adapter) => adapter.id === item.adapterId)?.name || item.adapterId;
  return item.model ? `${name} · ${item.model}` : `${name} · modelo da configuração do CLI`;
}

// Escolha inicial vinda de uma função salva; sem função ou sem CLI, começa vazia.
export function choiceFromFunction(item) {
  return item?.adapterId ? { adapterId: item.adapterId, model: item.model || '', ready: false } : { adapterId: '', model: '', ready: false };
}

// Mesma IA: mesmo CLI e mesmo modelo, sem diferença de maiúsculas e espaços. Sem
// modelo registrado de um dos lados, basta o mesmo CLI (o modelo fica desconhecido).
const normalizeModel = (model) => (typeof model === 'string' && model.trim() ? model.trim().toLowerCase() : null);
export function sameAiWorkers(workedBy, choice, functionSlug) {
  if (!choice?.adapterId || !Array.isArray(workedBy)) return [];
  const chosen = normalizeModel(choice.model);
  return workedBy.filter((worker) => worker.adapter === choice.adapterId && (worker.function || '') !== (functionSlug || '')
    && (chosen === null || normalizeModel(worker.model) === null || normalizeModel(worker.model) === chosen));
}
