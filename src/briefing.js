export function briefingDestination(sessions, selection) {
  return sessions.find((session) => session.terminalId && !session.external && (
    selection === undefined ? session.role === 'orchestrator' : session.id === selection
  )) ?? null;
}

export function briefingCanSend(destination, text) {
  return Boolean(destination && text.trim() && Array.from(text).length <= 4000);
}
