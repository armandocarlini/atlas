import React from 'react';
import { atlasDecisions, teamByTask } from './atlas-panel.js';

function SessionRow({ session, functionName, selected, onSelect, onFocus }) {
  const lead = session.roleKind === 'orchestrator';
  const model = session.currentModel || session.model;
  const state = session.archived ? 'lost' : session.exited ? 'idle' : 'live';
  return (
    <button
      type="button"
      className={`atlas-row ${lead ? 'lead' : ''}`}
      data-state={state}
      aria-pressed={selected}
      title={`${session.name} · ${session.cli}${model ? ` · ${model}` : ''} · ${state === 'live' ? 'ativa' : session.archived ? 'histórico' : 'encerrada'}. Clique para selecionar; duplo clique para focar.`}
      onClick={() => onSelect(session.id)}
      onDoubleClick={() => onFocus(session.id)}
    >
      <span className="atlas-row-dot" aria-hidden="true" />
      <span className="atlas-row-text">
        <strong>{lead ? 'Principal' : session.name}</strong>
        <small>{[functionName, session.cli, model].filter(Boolean).join(' · ')}</small>
      </span>
      {state === 'live' ? <span className="visually-hidden">ativa</span> : <span className="atlas-row-state">{session.archived ? 'histórico' : 'encerrada'}</span>}
    </button>
  );
}

// Painel do Atlas: quem coordena, o que espera o usuário e a equipe por tarefa.
// Só lê o estado que o cockpit já tem; cada linha leva ao lugar onde a ação acontece.
export default function AtlasPanel({ projectName, sessions, tasks, reviews, requests, needsPrincipal, functions, selectedId, onSelectSession, onFocusSession, onOpenRequest, onOpenTask, onStartPrincipal }) {
  const decisions = atlasDecisions({ requests, tasks, reviews, needsPrincipal });
  const { principal, groups, free } = teamByTask(sessions, tasks);
  const functionName = (slug) => (functions || []).find((item) => item.slug === slug)?.name || null;
  const active = sessions.filter((session) => !session.exited && session.roleKind !== 'orchestrator').length;

  return (
    <section className="atlas-panel" aria-label="Painel do Atlas">
      <header className="atlas-panel-hero">
        <span className="atlas-panel-statue" aria-hidden="true" />
        <div>
          <span className="atlas-panel-wordmark" aria-hidden="true">ATLAS</span>
          <strong>{projectName}</strong>
          <small>{principal ? `Principal ${principal.exited ? 'parada' : 'coordenando'}` : 'Sem principal'} · {active} {active === 1 ? 'agente ativo' : 'agentes ativos'}</small>
        </div>
      </header>

      <div className="atlas-panel-section" role="group" aria-labelledby="atlas-waiting-title">
        <div className="atlas-panel-heading"><span id="atlas-waiting-title">Espera você</span><b className={decisions.length ? 'hot' : ''}>{decisions.length}</b></div>
        {decisions.length ? decisions.map((decision) => (
          <button
            type="button"
            key={decision.id}
            className={`atlas-decision ${decision.kind}`}
            onClick={() => decision.kind === 'request' ? onOpenRequest(decision.targetId) : decision.kind === 'review' ? onOpenTask(decision.targetId) : onStartPrincipal()}
          >
            <span className="atlas-decision-mark" aria-hidden="true">{decision.kind === 'review' ? '✓' : decision.kind === 'principal' ? '!' : '?'}</span>
            <span><strong>{decision.title}</strong><small>{decision.detail}</small></span>
          </button>
        )) : <p className="atlas-panel-empty">Nada esperando você.</p>}
      </div>

      <div className="atlas-panel-section" role="group" aria-labelledby="atlas-team-title">
        <div className="atlas-panel-heading"><span id="atlas-team-title">Equipe</span><b>{sessions.length}</b></div>
        {principal && <SessionRow session={principal} functionName={functionName(principal.functionSlug)} selected={selectedId === principal.id} onSelect={onSelectSession} onFocus={onFocusSession} />}
        {groups.map(({ task, members }) => (
          <div className="atlas-task-group" key={task.id}>
            <button type="button" className="atlas-task-title" onClick={() => onOpenTask(task.id)} title="Abrir a tarefa nos painéis"><span>{task.title}</span><small>{task.stateLabel}</small></button>
            {members.map((session) => <SessionRow key={session.id} session={session} functionName={functionName(session.functionSlug)} selected={selectedId === session.id} onSelect={onSelectSession} onFocus={onFocusSession} />)}
          </div>
        ))}
        {free.length > 0 && <div className="atlas-task-group">
          {groups.length > 0 && <span className="atlas-task-title static"><span>Sem tarefa</span></span>}
          {free.map((session) => <SessionRow key={session.id} session={session} functionName={functionName(session.functionSlug)} selected={selectedId === session.id} onSelect={onSelectSession} onFocus={onFocusSession} />)}
        </div>}
        {!sessions.length && <p className="atlas-panel-empty">Nenhuma sessão neste projeto.</p>}
      </div>
    </section>
  );
}
