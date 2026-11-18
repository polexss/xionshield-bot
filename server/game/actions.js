'use strict';
const { tpl } = require('../lib/util');

const started = (r) => GetResourceState(r) === 'started';

class Actions {
  constructor(cfg, log) {
    this.cfg = cfg;
    this.log = log;
  }

  get shotsAvailable() {
    return started(this.cfg.screenshot.resource);
  }

  screenshot(src, timeoutSec = 15) {
    const res = this.cfg.screenshot.resource;
    return new Promise((resolve, reject) => {
      if (!started(res)) return reject(new Error(`${res} is not running`));
      let done = false;
      const t = setTimeout(() => {
        done = true;
        reject(new Error('Screenshot timed out'));
      }, timeoutSec * 1000);
      try {
        globalThis.exports[res].requestClientScreenshot(
          String(src),
          { encoding: 'jpg', quality: this.cfg.screenshot.quality },
          (err, data) => {
            if (done) return;
            done = true;
            clearTimeout(t);
            if (err || typeof data !== 'string') return reject(new Error(err ? String(err) : 'Empty screenshot'));
            const i = data.indexOf(',');
            resolve(Buffer.from(i >= 0 ? data.slice(i + 1) : data, 'base64'));
          }
        );
      } catch (e) {
        clearTimeout(t);
        reject(e);
      }
    });
  }

  kick(src, reason, staff) {
    DropPlayer(String(src), tpl(this.cfg.messages.kick, { reason, staff }));
  }

  chat(target, title, message) {
    const c = this.cfg.chat;
    if (c.event) return emitNet(c.event, target, message, title);
    emitNet('chat:addMessage', target, { color: c.color, multiline: true, args: [title, message] });
  }

  announce(message, staff) {
    this.chat(-1, this.cfg.chat.announceTitle, message, staff);
  }

  revive(src) {
    const ev = this.cfg.revive.event;
    if (ev) return emitNet(ev, src), ev;
    if (started('esx_ambulancejob')) return emitNet('esx_ambulancejob:revive', src), 'esx_ambulancejob';
    if (started('qb-ambulancejob')) return emitNet('hospital:client:Revive', src), 'qb-ambulancejob';
    emitNet('xionshield-bot:revive', src);
    return 'native';
  }
}

module.exports = { Actions, started };
