'use strict';
const { strip, sleep } = require('../lib/util');

const listeners = new Set();
let registered = null;

function ensure() {
  if (registered !== null) return registered;
  registered = typeof RegisterConsoleListener === 'function';
  if (registered) {
    RegisterConsoleListener((channel, message) => {
      if (listeners.size === 0) return;
      for (const l of listeners) l(channel, message);
    });
  }
  return registered;
}

function listen(fn) {
  if (!ensure()) return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function capture(command, ms = 1500, max = 3800) {
  let out = '';
  const off = listen((ch, msg) => {
    if (out.length < max) out += msg;
  });
  ExecuteCommand(command);
  await sleep(ms);
  off();
  const text = strip(out).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return registered ? text : null;
}

module.exports = { capture, listen, ensure };
