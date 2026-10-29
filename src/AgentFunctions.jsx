import { useEffect, useState } from 'react';
import { ChevronRight, Plus, X } from 'lucide-react';
import useModalFocus from './useModalFocus.js';
import { AgentChoice } from './AgentChoice.jsx';
import { KIND_LABELS, describeChoice, isConfigured, pickRecommendation } from './agent-functions.js';

const cleanError = (error) => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

function FunctionEditor({ item, adapters, recommendations, desktop, onDone }) {
  const creating = item === null;
  const [slug, setSlug] = useState('');
  const [name, setName] = useState(item?.name || '');
  const [description, setDescription] = useState(item?.description || '');
  const [choice, setChoice] = useState({ adapterId: item?.adapterId || '', model: item?.model || '', ready: Boolean(item?.adapterId) });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fixedName = item && item.kind !== 'custom';
  // CLI escolhido exige a escolha completa; sem CLI, a função fica "não configurada".
  const valid = (!choice.adapterId || choice.ready) && name.trim() && (!creating || /^[a-z0-9-]{2,32}$/.test(slug));
  const recommendation = pickRecommendation(recommendations, creating ? slug : item.slug, adapters);

  async function run(kind, action) {
    if (busy) return;
    setBusy(kind);
    setError('');
    try {
      await action();
      onDone();
    } catch (failure) {
      setError(cleanError(failure));
      setBusy('');
    }
  }

  function save(event) {
    event.preventDefault();
    if (!valid) return;
    const launch = { adapterId: choice.adapterId || null, model: choice.adapterId ? choice.model || null : null };
    run('save', () => creating
      ? desktop.createAgentFunction({ slug, name, description, ...launch })
      : desktop.updateAgentFunction({ id: item.id, expectedVersion: item.version, description, ...(fixedName ? {} : { name }), ...launch }));
  }

  // Validação própria (noValidate): a função pode ficar sem CLI, e o select do CLI é required.
  return <form className="function-editor" onSubmit={save} aria-busy={Boolean(busy)} noValidate>
    {fixedName && <p className="function-editor-note">{KIND_LABELS[item.kind]}: o nome é fixo; descrição, CLI e modelo são seus.</p>}
    {creating && <label>Identificador
      <input name="slug" value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase())} maxLength={32} required autoFocus placeholder="ex.: documentar" aria-describedby="function-slug-help" />
      <small id="function-slug-help">Letras minúsculas, números e hífens. É como o Orquestrador pede esta função e não muda depois.</small>
    </label>}
    {!fixedName && <label>Nome
      <input name="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={40} required />
    </label>}
    <label>Descrição, lida pelo Orquestrador para escolher a função
      <textarea name="description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} rows={3} />
      <small>{description.length}/300</small>
    </label>
    <AgentChoice adapters={adapters} value={choice} onChange={setChoice} desktop={desktop} disabled={Boolean(busy)} recommendation={recommendation} />
    {choice.adapterId && <button type="button" className="button secondary compact function-clear" disabled={Boolean(busy)} onClick={() => setChoice({ adapterId: '', model: '', ready: false })}>Deixar sem CLI e modelo</button>}
    <p className="function-editor-note">A função só preenche a escolha. Cada sessão continua iniciando apenas com a sua confirmação, e você pode trocar CLI e modelo na hora.</p>
    {error && <p className="agent-request-error" role="alert">{error}</p>}
    {confirmDelete
      ? <div className="function-delete-confirm" role="alert">
        <span>Apagar a função {item.name}? As runs que a usaram mantêm o registro.</span>
        <button type="button" className="button secondary compact" onClick={() => setConfirmDelete(false)} disabled={Boolean(busy)}>Manter</button>
        <button type="button" className="button secondary danger compact" onClick={() => run('delete', () => desktop.deleteAgentFunction({ id: item.id, expectedVersion: item.version }))} disabled={Boolean(busy)}>{busy === 'delete' ? 'Apagando…' : 'Apagar'}</button>
      </div>
      : <footer>
        {item?.kind === 'custom' && <button type="button" className="button secondary compact function-delete" onClick={() => setConfirmDelete(true)} disabled={Boolean(busy)}>Apagar função</button>}
        <button type="button" className="button secondary" onClick={onDone} disabled={Boolean(busy)}>Cancelar</button>
        <button type="submit" className="button primary" disabled={Boolean(busy) || !valid}>{busy === 'save' ? 'Salvando…' : creating ? 'Criar função' : 'Salvar'}</button>
      </footer>}
  </form>;
}

function FunctionRow({ item, adapters, onEdit }) {
  const configured = isConfigured(item);
  return <li>
    <button type="button" className="function-row" onClick={() => onEdit(item)} aria-label={`Editar a função ${item.name}`}>
      <span className="function-row-main">
        <strong>{item.name}</strong>
        <small>{item.description || 'Sem descrição.'}</small>
      </span>
      <span className={`function-row-choice ${configured ? '' : 'pending'}`}>{describeChoice(item, adapters)}</span>
      <ChevronRight size={14} aria-hidden="true" />
    </button>
  </li>;
}

// Funções de agente: o Orquestrador, as cinco padrão e as do usuário. Cada uma
// guarda o CLI e o modelo que o usuário escolheu, só para preencher a escolha.
export function AgentFunctionsModal({ desktop, adapters, onClose }) {
  const dialogRef = useModalFocus();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(undefined);

  function refresh() {
    desktop.listAgentFunctions().then((result) => { setData(result); setLoadError(''); }).catch((error) => setLoadError(cleanError(error)));
  }

  useEffect(() => {
    refresh();
    return desktop.onAgentFunctionsChanged?.(refresh);
  }, []);

  const items = data?.items || [];
  const groups = [
    ['orchestrator', 'Sessão principal'],
    ['builtin', 'Funções padrão'],
    ['custom', 'Suas funções'],
  ];
  const counted = items.filter((item) => item.kind !== 'orchestrator').length;
  const canCreate = data && counted < data.maxFunctions;
  const current = editing === undefined ? undefined : editing === null ? null : items.find((item) => item.id === editing.id) || editing;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section ref={dialogRef} className="modal functions-modal" onMouseDown={(event) => event.stopPropagation()} aria-modal="true" role="dialog" aria-labelledby="functions-title">
        <header>
          <div><span className="eyebrow">LLM POR FUNÇÃO</span><h2 id="functions-title">{current === undefined ? 'Funções de agente' : current === null ? 'Nova função' : `Função: ${current.name}`}</h2></div>
          <button className="icon-button" onClick={onClose} title="Fechar" aria-label="Fechar funções de agente"><X size={18} /></button>
        </header>
        <div className="functions-content">
          {loadError && <p className="agent-request-error" role="alert">{loadError}</p>}
          {data?.recommendationsError && <p className="agent-choice-note error" role="alert">Recomendações do ATLAS indisponíveis: {data.recommendationsError}</p>}
          {!data && !loadError && <p className="agent-choice-note" role="status">Carregando funções…</p>}
          {data && current !== undefined && <FunctionEditor key={current?.id || 'new'} item={current} adapters={adapters} recommendations={data.recommendations} desktop={desktop} onDone={() => setEditing(undefined)} />}
          {data && current === undefined && <>
            <p className="functions-intro">Escolha o CLI e o modelo de cada função uma vez. O Orquestrador indica a função ao pedir um agente, e o cartão de aprovação vem preenchido para você confirmar ou trocar.</p>
            {groups.map(([kind, label]) => {
              const group = items.filter((item) => item.kind === kind);
              if (kind === 'custom' && !group.length && !canCreate) return null;
              return <section key={kind} className="functions-group" aria-label={label}>
                <h3>{label}</h3>
                {group.length ? <ul>{group.map((item) => <FunctionRow key={item.id} item={item} adapters={adapters} onEdit={setEditing} />)}</ul>
                  : <p className="agent-choice-note">Nenhuma função criada por você.</p>}
              </section>;
            })}
            <footer>
              <span>{counted} de {data.maxFunctions} funções</span>
              <button type="button" className="button secondary" onClick={() => setEditing(null)} disabled={!canCreate}><Plus size={14} />Nova função</button>
              <button type="button" className="button primary" onClick={onClose}>Concluir</button>
            </footer>
          </>}
        </div>
      </section>
    </div>
  );
}
