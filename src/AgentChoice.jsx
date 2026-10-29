import { useEffect, useRef, useState } from 'react';

const cleanError = (error) => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

// Escolha do CLI e do modelo de uma sessão de agente, inclusive da principal.
// Nada vem pré-selecionado pelo ATLAS: o usuário escolhe entre os CLIs detectados
// e os modelos que cada um informa, ou parte de uma escolha que ele mesmo salvou
// (uma função). A recomendação curada só é aplicada com o clique dele.
// `value.ready` diz se a escolha está completa.
export function AgentChoice({ adapters, value, onChange, desktop = window.atlasDesktop, disabled = false, recommendation = null }) {
  const [models, setModels] = useState({ adapterId: '', status: 'idle', items: [], error: '', missing: '' });
  const [filter, setFilter] = useState('');
  // Última consulta pedida: respostas de CLIs anteriores são descartadas.
  const latest = useRef(0);
  const available = Array.isArray(adapters) ? adapters.filter((adapter) => adapter.status === 'available') : [];
  const adapter = available.find((item) => item.id === value.adapterId);

  // `keep`: modelo salvo ou recomendado, mantido só se ainda estiver na lista do CLI.
  function load(adapterId, refresh = false, keep = '') {
    const request = ++latest.current;
    setModels({ adapterId, status: 'loading', items: [], error: '', missing: '' });
    // Enquanto a lista carrega, a escolha anterior não vale.
    onChange({ adapterId, model: '', ready: false });
    desktop.listAgentModels({ adapterId, refresh }).then((result) => {
      if (request !== latest.current) return;
      const kept = keep && result.models.includes(keep) ? keep : '';
      setModels({ adapterId, status: 'ready', items: result.models, error: '', missing: keep && !kept && result.models.length ? keep : '' });
      // Sem modelos identificados, o CLI usa a própria configuração.
      onChange({ adapterId, model: kept, ready: Boolean(kept) || result.models.length === 0 });
    }).catch((error) => {
      if (request === latest.current) setModels({ adapterId, status: 'error', items: [], error: cleanError(error), missing: '' });
    });
  }

  // Escolha salva pelo usuário (por exemplo de uma função): carrega os modelos do
  // CLI assim que os adaptadores chegam, sem trocar o que ele escolheu.
  const savedAdapterAvailable = available.some((item) => item.id === value.adapterId);
  useEffect(() => {
    if (value.adapterId && savedAdapterAvailable && models.status === 'idle') load(value.adapterId, false, value.model);
  }, [savedAdapterAvailable]);

  function selectAdapter(adapterId) {
    setFilter('');
    if (adapterId) load(adapterId);
    else onChange({ adapterId, model: '', ready: false });
  }

  const query = filter.trim().toLowerCase();
  const matching = models.items.filter((model) => !query || model.toLowerCase().includes(query));
  // O modelo escolhido continua na lista mesmo fora do filtro, para o select não perdê-lo.
  const options = value.model && !matching.includes(value.model) ? [value.model, ...matching] : matching;
  const loaded = adapter && models.adapterId === adapter.id;

  return <div className="agent-choice">
    <label>CLI do agente
      <select name="cli" value={value.adapterId} onChange={(event) => selectAdapter(event.target.value)} required disabled={disabled || !available.length}>
        <option value="" disabled>{adapters == null ? 'Detectando CLIs no PATH…' : available.length ? 'Escolha o CLI…' : 'Nenhum CLI de agente encontrado'}</option>
        {(adapters || []).map((item) => <option key={item.id} value={item.id} disabled={item.status !== 'available'}>
          {item.name}{item.version ? ` ${item.version}` : ''}{item.status !== 'available' ? ' — não encontrado' : ''}
        </option>)}
      </select>
    </label>
    {Array.isArray(adapters) && value.adapterId && !savedAdapterAvailable && <p className="agent-choice-note error" role="alert">O CLI salvo ({value.adapterId}) não foi encontrado no PATH. Escolha outro.</p>}
    {recommendation && !(value.adapterId === recommendation.adapterId && value.model === recommendation.model) && <div className="agent-choice-recommendation">
      <span><strong>Recomendado pelo ATLAS:</strong> {recommendation.model} no {available.find((item) => item.id === recommendation.adapterId)?.name || recommendation.adapterId}. {recommendation.motivo}</span>
      <button type="button" className="button secondary compact" disabled={disabled} onClick={() => { setFilter(''); load(recommendation.adapterId, false, recommendation.model); }}>Usar recomendado</button>
    </div>}
    {Array.isArray(adapters) && !available.length && <p className="agent-choice-note error" role="alert">{adapters[0]?.error || 'Instale um CLI de agente compatível e reabra o ATLAS.'}</p>}
    {loaded && models.status === 'loading' && <p className="agent-choice-note" role="status">Consultando os modelos do {adapter.name}…</p>}
    {loaded && models.status === 'error' && <div className="agent-choice-note error" role="alert">
      <span>{models.error}</span>
      <button type="button" className="button secondary compact" onClick={() => load(adapter.id, true)}>Tentar de novo</button>
    </div>}
    {loaded && models.status === 'ready' && models.missing && <p className="agent-choice-note error" role="alert">O modelo {models.missing} não está na lista do {adapter.name}. Escolha outro.</p>}
    {loaded && models.status === 'ready' && !models.items.length && <p className="agent-choice-note">Nenhum modelo identificado no {adapter.name}; ele usa o modelo da própria configuração.</p>}
    {loaded && models.status === 'ready' && models.items.length > 0 && <>
      {models.items.length > 12 && <label>Filtrar modelos
        <input type="search" name="model-filter" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="ex.: nvidia, llama, deepseek" disabled={disabled} />
      </label>}
      <label>Modelo
        <select name="model" value={value.model} onChange={(event) => onChange({ adapterId: adapter.id, model: event.target.value, ready: Boolean(event.target.value) })} required disabled={disabled}>
          <option value="" disabled>{options.length ? 'Escolha o modelo…' : 'Nenhum modelo corresponde ao filtro'}</option>
          {options.map((model) => <option key={model} value={model}>{model}</option>)}
        </select>
      </label>
      <div className="agent-choice-note">
        <span>{query ? `${matching.length} de ${models.items.length}` : models.items.length} modelos identificados no {adapter.name}.</span>
        <button type="button" className="button secondary compact" onClick={() => load(adapter.id, true)} disabled={disabled}>Atualizar lista</button>
      </div>
    </>}
  </div>;
}
