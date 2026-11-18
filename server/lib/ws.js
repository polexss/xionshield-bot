'use strict';
const tls = require('tls');
const net = require('net');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const EMPTY = Buffer.alloc(0);
const HEAD_END = Buffer.from('\r\n\r\n');

class WebSocket extends EventEmitter {
  constructor(url, { timeout = 15000, agent = 'xionshield-bot' } = {}) {
    super();
    const u = new URL(url);
    const secure = u.protocol === 'wss:';
    const port = +u.port || (secure ? 443 : 80);
    const key = crypto.randomBytes(16).toString('base64');
    this.accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    this.open = false;
    this.closed = false;
    this.closing = false;
    this.buf = null;
    this.frags = null;
    this.fragOp = 0;
    const s = secure
      ? tls.connect({ host: u.hostname, port, servername: u.hostname, ALPNProtocols: ['http/1.1'] })
      : net.connect(port, u.hostname);
    this.sock = s;
    s.setNoDelay(true);
    s.setTimeout(timeout, () => this.destroy(new Error('WebSocket handshake timeout')));
    s.once(secure ? 'secureConnect' : 'connect', () => {
      s.write(
        `GET ${u.pathname || '/'}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nUser-Agent: ${agent}\r\n\r\n`
      );
    });
    s.on('data', (c) => (this.open ? this.parse(c) : this.handshake(c)));
    s.on('error', (e) => this.destroy(e));
    s.on('close', () => this.finish(1006, 'Connection lost'));
  }

  handshake(chunk) {
    const b = this.buf ? Buffer.concat([this.buf, chunk]) : chunk;
    const end = b.indexOf(HEAD_END);
    if (end < 0) {
      if (b.length > 16384) return this.destroy(new Error('Oversized handshake'));
      this.buf = b;
      return;
    }
    this.buf = null;
    const head = b.toString('latin1', 0, end);
    if (!/^HTTP\/1\.1 101/.test(head)) return this.destroy(new Error(`Handshake rejected: ${head.split('\r\n', 1)[0]}`));
    const m = /\r\nsec-websocket-accept:\s*(\S+)/i.exec(head);
    if (!m || m[1] !== this.accept) return this.destroy(new Error('Invalid Sec-WebSocket-Accept'));
    this.open = true;
    this.sock.setTimeout(0);
    this.emit('open');
    if (b.length > end + 4) this.parse(b.subarray(end + 4));
  }

  parse(chunk) {
    const b = this.buf ? Buffer.concat([this.buf, chunk]) : chunk;
    const n = b.length;
    let o = 0;
    while (n - o >= 2) {
      const b0 = b[o];
      const b1 = b[o + 1];
      let len = b1 & 127;
      let h = 2;
      if (len === 126) {
        if (n - o < 4) break;
        len = b.readUInt16BE(o + 2);
        h = 4;
      } else if (len === 127) {
        if (n - o < 10) break;
        len = b.readUInt32BE(o + 2) * 4294967296 + b.readUInt32BE(o + 6);
        h = 10;
      }
      const masked = (b1 & 128) !== 0;
      if (masked) h += 4;
      if (n - o < h + len) break;
      let p = b.subarray(o + h, o + h + len);
      if (masked) {
        const k = o + h - 4;
        p = Buffer.from(p);
        for (let i = 0; i < p.length; i++) p[i] ^= b[k + (i & 3)];
      }
      o += h + len;
      this.frame(b0 & 15, (b0 & 128) !== 0, p);
      if (this.closed) return;
    }
    this.buf = o < n ? b.subarray(o) : null;
  }

  frame(op, fin, p) {
    if (op >= 8) {
      if (op === 8) {
        const code = p.length >= 2 ? p.readUInt16BE(0) : 1005;
        const reason = p.length > 2 ? p.toString('utf8', 2) : '';
        if (!this.closing) {
          this.closing = true;
          this.write(8, p.length >= 2 ? p.subarray(0, 2) : EMPTY);
        }
        this.finish(code, reason);
        this.sock.end();
      } else if (op === 9) this.write(10, p);
      return;
    }
    if (op !== 0) {
      if (fin) return this.emit('message', op === 1 ? p.toString('utf8') : p);
      this.fragOp = op;
      this.frags = [p];
      return;
    }
    if (!this.frags) return;
    this.frags.push(p);
    if (!fin) return;
    const full = Buffer.concat(this.frags);
    const fo = this.fragOp;
    this.frags = null;
    this.emit('message', fo === 1 ? full.toString('utf8') : full);
  }

  write(op, payload) {
    if (this.closed || this.sock.destroyed) return false;
    const len = payload.length;
    const h = len < 126 ? 6 : len < 65536 ? 8 : 14;
    const f = Buffer.allocUnsafe(h + len);
    f[0] = 0x80 | op;
    if (len < 126) f[1] = 0x80 | len;
    else if (len < 65536) {
      f[1] = 0xfe;
      f.writeUInt16BE(len, 2);
    } else {
      f[1] = 0xff;
      f.writeUInt32BE(Math.floor(len / 4294967296), 2);
      f.writeUInt32BE(len >>> 0, 6);
    }
    crypto.randomFillSync(f, h - 4, 4);
    const m0 = f[h - 4], m1 = f[h - 3], m2 = f[h - 2], m3 = f[h - 1];
    let i = 0;
    for (const end = len - 3; i < end; i += 4) {
      f[h + i] = payload[i] ^ m0;
      f[h + i + 1] = payload[i + 1] ^ m1;
      f[h + i + 2] = payload[i + 2] ^ m2;
      f[h + i + 3] = payload[i + 3] ^ m3;
    }
    for (; i < len; i++) f[h + i] = payload[i] ^ f[h - 4 + (i & 3)];
    return this.sock.write(f);
  }

  send(data) {
    return this.open && !this.closing && this.write(1, Buffer.from(data, 'utf8'));
  }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    if (!this.open) return this.destroy();
    if (!this.closing) {
      this.closing = true;
      const r = Buffer.from(String(reason).slice(0, 120), 'utf8');
      const p = Buffer.allocUnsafe(2 + r.length);
      p.writeUInt16BE(code, 0);
      r.copy(p, 2);
      this.write(8, p);
    }
    this.code = code;
    setTimeout(() => this.finish(code, reason), 3000).unref?.();
  }

  destroy(err) {
    if (err && !this.closed) this.emit('error', err);
    this.finish(1006, err ? err.message : 'Destroyed');
  }

  finish(code, reason) {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.buf = this.frags = null;
    this.sock.destroy();
    this.emit('close', this.code || code, reason);
  }
}

module.exports = { WebSocket };
