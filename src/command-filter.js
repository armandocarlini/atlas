// Normaliza para buscar sem acento nem maiúsculas: "sessao" encontra "Sessão".
export function normalize(text) {
  return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Todas as palavras digitadas precisam aparecer no rótulo, no grupo ou nas palavras-chave.
export function filterCommands(commands, query) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return commands;
  return commands.filter((command) => {
    const haystack = normalize(`${command.label} ${command.group} ${command.keywords || ''}`);
    return words.every((word) => haystack.includes(word));
  });
}
