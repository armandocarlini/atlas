// A fixture recebe entrada do PTY e nunca abre conexão com um modelo.
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdout.write('\x1b[?2004hBriefing fixture pronta\r\n');
let line = '';
let pasted = false;
process.stdin.on('data', (input) => {
  line += input;
  if (line.startsWith('\x1b[200~')) {
    const end = line.indexOf('\x1b[201~');
    if (end < 0) return;
    line = line.slice(6, end).replaceAll('\r', '|') + line.slice(end + 6);
    pasted = true;
  }
  const enter = line.indexOf('\r');
  if (!pasted || enter < 0) return;
  process.stdout.write(`Recebido pela fixture: ${line.slice(0, enter)}\r\n`);
  line = line.slice(enter + 1);
  pasted = false;
});
