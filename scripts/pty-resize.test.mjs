import assert from 'node:assert/strict';
import test from 'node:test';
import { createPtyResizer, isLayoutResizing, onLayoutResizing, setLayoutResizing } from '../src/pty-resize.js';

function clock() {
  let time = 0;
  const timers = new Map();
  let nextId = 1;
  return {
    now: () => time,
    setTimer: (callback, wait) => { const id = nextId++; timers.set(id, { at: time + wait, callback }); return id; },
    clearTimer: (id) => timers.delete(id),
    advance(ms) {
      time += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.callback(); }
    },
    pending: () => timers.size,
  };
}

test('fora do arraste, cada resize vai direto ao PTY', () => {
  const sent = [];
  const fake = clock();
  const resizer = createPtyResizer({ send: (...size) => sent.push(size), ...fake });
  resizer.request(80, 24);
  resizer.request(100, 30);
  assert.deepEqual(sent, [[80, 24], [100, 30]]);
});

test('durante o arraste, o PTY recebe no máximo um resize por intervalo, com o último tamanho', () => {
  const sent = [];
  const fake = clock();
  const resizer = createPtyResizer({ send: (...size) => sent.push(size), interval: 120, ...fake });
  resizer.request(80, 24, { throttle: true });
  for (let cols = 81; cols <= 90; cols += 1) {
    fake.advance(10);
    resizer.request(cols, 24, { throttle: true });
  }
  assert.deepEqual(sent, [[80, 24]], 'quadros intermediários não chegam ao PTY');
  fake.advance(30);
  assert.deepEqual(sent, [[80, 24], [90, 24]]);
});

test('ao soltar, flush envia o tamanho final na hora e cancela o atraso', () => {
  const sent = [];
  const fake = clock();
  const resizer = createPtyResizer({ send: (...size) => sent.push(size), interval: 120, ...fake });
  resizer.request(80, 24, { throttle: true });
  fake.advance(5);
  resizer.request(70, 20, { throttle: true });
  resizer.flush();
  assert.deepEqual(sent, [[80, 24], [70, 20]]);
  assert.equal(fake.pending(), 0);
  resizer.flush();
  assert.equal(sent.length, 2, 'flush sem pendência não repete');
});

test('tamanho igual ao último enviado não gera outro resize', () => {
  const sent = [];
  const resizer = createPtyResizer({ send: (...size) => sent.push(size), ...clock() });
  resizer.request(80, 24);
  resizer.request(80, 24);
  assert.equal(sent.length, 1);
});

test('dispose descarta o pendente', () => {
  const sent = [];
  const fake = clock();
  const resizer = createPtyResizer({ send: (...size) => sent.push(size), interval: 120, ...fake });
  resizer.request(80, 24, { throttle: true });
  fake.advance(1);
  resizer.request(60, 24, { throttle: true });
  resizer.dispose();
  fake.advance(500);
  assert.deepEqual(sent, [[80, 24]]);
});

test('o sinal de arraste avisa início e fim uma vez', () => {
  const events = [];
  const off = onLayoutResizing((active) => events.push(active));
  setLayoutResizing(true);
  setLayoutResizing(true);
  assert.equal(isLayoutResizing(), true);
  setLayoutResizing(false);
  off();
  setLayoutResizing(true);
  setLayoutResizing(false);
  assert.deepEqual(events, [true, false]);
});
