'use strict';
const { EventEmitter } = require('events');
const { WebSocket } = require('./ws');

const FATAL = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
const RESET = new Set([4007, 4009]);
const DEFAULT_URL = 'wss://gateway.discord.gg';

class Gateway extends EventEmitter {
  constructor({ token, intents = 0, log }) {
    super();
    this.token = token;
    this.intents = intents;
    this.log = log;
    this.url = DEFAULT_URL;
    this.ws = null;
    this.seq = null;
    this.sessionId = null;
    this.resumeUrl = null;
    this.hbTimer = null;
    this.acked = true;
    this.lastBeat = 0;
    this.ping = -1;
    this.attempt = 0;
    this.quick = false;
    this.resuming = false;
    this.dead = false;
    this.presence = null;
    this.readyAt = 0;
    this.identified = false;
  }

  start(url) {
    if (url) this.url = url.replace(/\/+$/, '');
    this.connect();
  }

  connect() {
    if (this.dead) return;
    this.resuming = !!(this.sessionId && this.seq !== null);
    const base = (this.resuming && this.resumeUrl) || this.url;
    const ws = new WebSocket(`${base}/?v=10&encoding=json`);
    this.ws = ws;
    ws.on('message', (m) => this.onMessage(m));
    ws.on('error', (e) => this.log.debug(`Gateway socket error: ${e.message}`));
    ws.on('close', (code, reason) => this.onClose(ws, code, reason));
  }

  onMessage(raw) {
    let p;
    try {
      p = JSON.parse(raw);
    } catch {
      return;
    }
    if (p.s !== null && p.s !== undefined) this.seq = p.s;
    switch (p.op) {
      case 0:
        if (p.t === 'READY') {
          this.sessionId = p.d.session_id;
          this.resumeUrl = p.d.resume_gateway_url ? p.d.resume_gateway_url.replace(/\/+$/, '') : null;
          this.attempt = 0;
          this.readyAt = Date.now();
          this.identified = true;
        } else if (p.t === 'RESUMED') {
          this.attempt = 0;
          this.identified = true;
          if (this.presence) this.send({ op: 3, d: this.presence });
        }
        this.emit('dispatch', p.t, p.d);
        break;
      case 1:
        this.beat(true);
        break;
      case 7:
        this.reconnect();
        break;
      case 9:
        if (!p.d) this.sessionId = this.seq = null;
        setTimeout(() => this.reconnect(), 1000 + Math.random() * 4000);
        break;
      case 10:
        this.heartbeat(p.d.heartbeat_interval);
        this.identify();
        break;
      case 11:
        this.acked = true;
        this.ping = Date.now() - this.lastBeat;
        break;
    }
  }

  identify() {
    if (this.resuming) {
      this.send({ op: 6, d: { token: this.token, session_id: this.sessionId, seq: this.seq } });
      return;
    }
    const d = {
      token: this.token,
      intents: this.intents,
      large_threshold: 50,
      properties: { os: process.platform, browser: 'xionshield-bot', device: 'xionshield-bot' },
    };
    if (this.presence) d.presence = this.presence;
    this.send({ op: 2, d });
  }

  heartbeat(interval) {
    this.stopHeartbeat();
    this.acked = true;
    this.hbTimer = setTimeout(() => {
      this.beat();
      this.hbTimer = setInterval(() => this.beat(), interval);
    }, Math.floor(interval * Math.random()));
  }

  beat(force) {
    if (!force && !this.acked) {
      this.log.warn('Gateway heartbeat was not acknowledged, reconnecting');
      return this.reconnect();
    }
    this.acked = false;
    this.lastBeat = Date.now();
    this.send({ op: 1, d: this.seq });
  }

  stopHeartbeat() {
    if (this.hbTimer) {
      clearTimeout(this.hbTimer);
      clearInterval(this.hbTimer);
      this.hbTimer = null;
    }
  }

  reconnect() {
    this.quick = true;
    this.stopHeartbeat();
    if (this.ws) this.ws.close(4000, 'Reconnecting');
  }

  onClose(ws, code, reason) {
    if (ws !== this.ws) return;
    this.stopHeartbeat();
    this.ws = null;
    this.identified = false;
    if (this.dead) return;
    if (code === 4014 && this.intents & 2) {
      this.log.warn('Server Members Intent is not enabled in the Discord developer portal. Live role sync disabled.');
      this.intents &= ~2;
      this.sessionId = this.seq = null;
      this.emit('intentsDowngraded');
    } else if (FATAL.has(code)) {
      this.dead = true;
      this.emit('fatal', code, reason);
      return;
    }
    if (RESET.has(code)) this.sessionId = this.seq = null;
    const delay = this.quick ? 250 : Math.min(30000, 1000 * 2 ** this.attempt) + Math.random() * 1000;
    this.quick = false;
    this.attempt = Math.min(this.attempt + 1, 6);
    this.log.debug(`Gateway closed (${code}${reason ? ` ${reason}` : ''}), reconnecting in ${Math.round(delay)}ms`);
    setTimeout(() => this.connect(), delay);
  }

  send(payload) {
    return this.ws ? this.ws.send(JSON.stringify(payload)) : false;
  }

  setPresence(text, type = 3, status = 'online') {
    this.presence = { since: null, afk: false, status, activities: text ? [{ name: text, type }] : [] };
    if (this.identified) this.send({ op: 3, d: this.presence });
  }

  destroy() {
    this.dead = true;
    this.stopHeartbeat();
    if (this.ws) this.ws.close(1000, 'Shutdown');
  }
}

module.exports = { Gateway };
