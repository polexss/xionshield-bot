'use strict';

const RECENT_MAX = 150;

function readIdentifiers(src) {
  const ids = {};
  const all = [];
  const n = GetNumPlayerIdentifiers(src);
  for (let i = 0; i < n; i++) {
    const v = GetPlayerIdentifier(src, i);
    if (!v) continue;
    all.push(v);
    const c = v.indexOf(':');
    if (c < 1) continue;
    const t = v.slice(0, c);
    if (ids[t] === undefined) ids[t] = v.slice(c + 1);
  }
  return { ids, all };
}

class Players {
  constructor() {
    this.map = new Map();
    this.recent = [];
  }

  get size() {
    return this.map.size;
  }

  add(src) {
    src = +src;
    const { ids, all } = readIdentifiers(String(src));
    const name = GetPlayerName(String(src)) || `Player ${src}`;
    const p = { id: src, name, ids, all, joined: Date.now(), key: `${src} ${name.toLowerCase()}` };
    p.hay = `${p.key}\u0001${all.join('\u0001').toLowerCase()}`;
    this.map.set(src, p);
    return p;
  }

  remove(src, reason) {
    src = +src;
    const p = this.map.get(src);
    if (!p) return null;
    this.map.delete(src);
    p.left = Date.now();
    p.reason = reason || '';
    const i = this.recent.findIndex((r) => r.ids.license && r.ids.license === p.ids.license);
    if (i >= 0) this.recent.splice(i, 1);
    this.recent.unshift(p);
    if (this.recent.length > RECENT_MAX) this.recent.length = RECENT_MAX;
    return p;
  }

  get(src) {
    return this.map.get(+src) || null;
  }

  stampOf(p) {
    return p.joined.toString(36);
  }

  verify(src, st) {
    const p = this.map.get(+src);
    return p && this.stampOf(p) === st ? p : null;
  }

  scan() {
    const n = GetNumPlayerIndices();
    for (let i = 0; i < n; i++) {
      const src = GetPlayerFromIndex(i);
      if (src && !this.map.has(+src)) this.add(src);
    }
  }

  byDiscord(id) {
    for (const p of this.map.values()) if (p.ids.discord === id) return p;
    return null;
  }

  byIdentifier(identifier) {
    const v = identifier.toLowerCase();
    for (const p of this.map.values()) for (const x of p.all) if (x.toLowerCase() === v) return p;
    return null;
  }

  search(q, limit = 25, recent = false) {
    q = String(q || '').toLowerCase().trim();
    const out = [];
    const src = recent ? this.recent : this.map.values();
    for (const p of src) {
      if (q && !p.hay.includes(q)) continue;
      out.push(p);
      if (out.length >= limit) break;
    }
    return out;
  }

  ping(src) {
    return GetPlayerPing(String(src));
  }

  tokens(src) {
    const n = GetNumPlayerTokens(String(src));
    const out = [];
    for (let i = 0; i < n; i++) out.push(GetPlayerToken(String(src), i));
    return out;
  }
}

module.exports = { Players };
