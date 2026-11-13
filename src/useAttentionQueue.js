import { useCallback, useEffect, useRef, useState } from 'react';

const cleanError = (error) => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// Fila "Precisam de mim" vinda do processo principal (attention:list). Só a janela principal
// do desktop usa; no navegador não há fila nem dados de demonstração.
export default function useAttentionQueue(desktop, enabled) {
  const [state, setState] = useState({ view: null, loaded: false, error: '' });
  const sequence = useRef(0);

  const reload = useCallback(() => {
    if (!enabled || !desktop?.listAttention) return Promise.resolve();
    const current = ++sequence.current;
    return (desktop.getBriefing ? desktop.getBriefing() : desktop.listAttention()).then((view) => {
      if (current === sequence.current) setState((previous) => ({ ...previous, view, loaded: true }));
    }).catch((error) => {
      if (current === sequence.current) setState((previous) => ({ ...previous, loaded: true, error: `Não foi possível ler a fila: ${cleanError(error)}` }));
    });
  }, [enabled, desktop]);

  useEffect(() => {
    if (!enabled || !desktop?.listAttention) return undefined;
    reload();
    return desktop.onAttentionChanged ? desktop.onAttentionChanged(() => reload()) : undefined;
  }, [enabled, desktop, reload]);

  // Erros das ações aparecem na seção; a fila é relida de qualquer forma.
  async function act(label, action) {
    setState((previous) => ({ ...previous, error: '' }));
    try {
      await action();
    } catch (error) {
      setState((previous) => ({ ...previous, error: `${label}: ${cleanError(error)}` }));
    } finally {
      await reload();
    }
  }

  return {
    enabled: Boolean(enabled && desktop?.listAttention),
    view: state.view,
    items: state.view?.items || [],
    loaded: state.loaded,
    error: state.error,
    reload,
    clearError: () => setState((previous) => ({ ...previous, error: '' })),
    snooze: (item, until) => act('Não foi possível adiar', () => desktop.snoozeAttention({ itemId: item.id, until })),
    dismiss: (item) => act('Não foi possível dispensar', () => desktop.dismissAttention({ itemId: item.id })),
    fail: (message) => setState((previous) => ({ ...previous, error: message })),
  };
}
