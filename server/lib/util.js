'use strict';

const COLORS = { brand: 0x6366f1, ok: 0x22c55e, err: 0xef4444, warn: 0xf59e0b, muted: 0x64748b };
const LEVELS = ['everyone', 'support', 'moderator', 'admin', 'owner'];
const ID_TYPES = ['license', 'license2', 'discord', 'steam', 'fivem', 'xbl', 'live', 'ip'];
const NO_MENTIONS = { parse: [] };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (v, n) => {
  const s = v === null || v === undefined ? '' : String(v);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
const esc = (v) => String(v === null || v === undefined ? '' : v).replace(/([\\`*_~|>#[\]()@<:-])/g, '\\$1');
const mono = (v) => `\`${String(v).replace(/`/g, 'ˋ') || ' '}\``;
const strip = (s) => String(s).replace(/\^[0-9]|\x1b\[[0-9;]*m/g, '');
const unix = (ms) => Math.floor(ms / 1000);
const stamp = (ms, f = 'R') => `<t:${unix(ms)}:${f}>`;
const tpl = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : vars[k]));
const safeCmd = (s) => String(s).replace(/[\r\n;"`]/g, ' ').replace(/\s+/g, ' ').trim();
const b64e = (s) => Buffer.from(s, 'utf8').toString('base64url');
const b64d = (s) => {
  try {
    return Buffer.from(s, 'base64url').toString('utf8');
  } catch {
    return '';
  }
};

function duration(ms) {
  let s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  s %= 86400;
  const h = Math.floor(s / 3600);
  s %= 3600;
  const m = Math.floor(s / 60);
  s %= 60;
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

function bytes(n) {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB'];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < 2);
  return `${n.toFixed(1)} ${u[i]}`;
}

function toMs(v) {
  if (v === null || v === undefined || v === '' || v === false) return null;
  if (typeof v === 'number') return v <= 0 ? null : v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') {
    if (/^\d+(\.\d+)?$/.test(v)) return toMs(+v);
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function parseIdentifier(s) {
  const v = String(s || '').trim();
  const c = v.indexOf(':');
  if (c < 1) return null;
  const type = v.slice(0, c).toLowerCase();
  const value = v.slice(c + 1).trim();
  if (!ID_TYPES.includes(type) || !value || /\s/.test(value)) return null;
  return `${type}:${value.toLowerCase()}`;
}

function steamProfile(hex) {
  try {
    return `https://steamcommunity.com/profiles/${BigInt(`0x${hex}`).toString()}`;
  } catch {
    return null;
  }
}

function maskIp(ip) {
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(ip);
  return m ? `${m[1]}.${m[2]}.x.x` : 'hidden';
}

function identifierLines(ids, showIp) {
  const out = [];
  if (ids.discord) out.push(`**Discord** <@${ids.discord}> ${mono(ids.discord)}`);
  if (ids.license) out.push(`**License** ${mono(ids.license)}`);
  if (ids.license2) out.push(`**License2** ${mono(ids.license2)}`);
  if (ids.steam) {
    const url = steamProfile(ids.steam);
    out.push(`**Steam** ${url ? `[${ids.steam}](${url})` : mono(ids.steam)}`);
  }
  if (ids.fivem) out.push(`**FiveM** ${mono(ids.fivem)}`);
  if (ids.xbl) out.push(`**XBL** ${mono(ids.xbl)}`);
  if (ids.live) out.push(`**Live** ${mono(ids.live)}`);
  if (ids.ip) out.push(`**IP** ${mono(showIp ? ids.ip : maskIp(ids.ip))}`);
  return out.join('\n') || 'None';
}

function embedSize(e) {
  let n = (e.title || '').length + (e.description || '').length;
  if (e.footer) n += (e.footer.text || '').length;
  if (e.author) n += (e.author.name || '').length;
  if (e.fields) for (const f of e.fields) n += f.name.length + f.value.length;
  return n;
}

module.exports = {
  COLORS,
  LEVELS,
  ID_TYPES,
  NO_MENTIONS,
  sleep,
  clip,
  esc,
  mono,
  strip,
  unix,
  stamp,
  tpl,
  safeCmd,
  b64e,
  b64d,
  duration,
  bytes,
  toMs,
  parseIdentifier,
  steamProfile,
  maskIp,
  identifierLines,
  embedSize,
};
