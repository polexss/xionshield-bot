'use strict';
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { ID_TYPES, toMs, safeCmd, sleep } = require('../lib/util');

const CATALOG = {
  Admin: ['Menu', 'Commands'],
  Client: [
    'BypassDevTools', 'BypassThermalVision', 'BypassNightVision', 'BypassEditHitBox', 'BypassChangeOutfit',
    'BypassHealth', 'BypassGodMod', 'BypassGiveArmor', 'BypassNoclip', 'BypassFreecam', 'BypassInvisible',
    'BypassInfiniteStamina', 'BypassSpeedHack', 'BypassSuperJump', 'BypassMagneto', 'BypassControlsRequest',
    'BypassPlayerKill', 'BypassSuperPunch', 'BypassStunGun', 'BypassOXStealItem', 'BypassOCRDetection',
    'BypassPedChanger',
  ],
  Entities: ['BypassAttachEntity', 'BypassMaliciousEntity', 'BypassPickup'],
  Vehicle: ['BypassRepairVehicle', 'BypassVehicleCustom', 'BypassPlateChanger', 'BypassAntiTeleportToVehicle'],
  Weapons: ['BypassAimBot', 'BypassSilentAim', 'BypassMagicBullet', 'BypassModifiedMeleeDamage', 'BypassGiveWeapon', 'BypassRapidFire'],
  Explosions: ['BypassExplosionsProtection'],
  Particles: ['BypassParticlesProtection'],
  Blacklist: ['BlacklistPeds', 'BlacklistWeapons'],
};
const CATEGORIES = Object.keys(CATALOG);
const PERM_CAT = new Map();
const ALL_PERMS = [];
for (const c of CATEGORIES) for (const p of CATALOG[c]) {
  PERM_CAT.set(p.toLowerCase(), c);
  ALL_PERMS.push(`${c}:${p}`);
}
const CAT_LOWER = new Map(CATEGORIES.map((c) => [c.toLowerCase(), c]));
const LOG_TYPES = ['ptFxEvent', 'explosionEvent', 'objectsEvent', 'delObjectsEvent'];
const DELETE_TYPES = ['peds', 'vehicles', 'entities'];
const MODULES = ['wrapper', 'anti-trigger', 'anti-injector'];

function resolvePerm(input) {
  const s = String(input || '').trim();
  const c = s.indexOf(':');
  if (c > 0) {
    const cat = CAT_LOWER.get(s.slice(0, c).toLowerCase());
    const perm = s.slice(c + 1);
    const real = cat && CATALOG[cat].find((p) => p.toLowerCase() === perm.toLowerCase());
    return real ? { cat, perm: real } : null;
  }
  const cat = PERM_CAT.get(s.toLowerCase());
  return cat ? { cat, perm: CATALOG[cat].find((p) => p.toLowerCase() === s.toLowerCase()) } : null;
}

function expandEntries(list) {
  const out = new Set();
  for (const e of list || []) {
    if (e === '*') {
      for (const p of ALL_PERMS) out.add(p);
      continue;
    }
    const cat = CAT_LOWER.get(String(e).toLowerCase());
    if (cat) {
      for (const p of CATALOG[cat]) out.add(`${cat}:${p}`);
      continue;
    }
    const r = resolvePerm(e);
    if (r) out.add(`${r.cat}:${r.perm}`);
  }
  return out;
}

const pick = (o, keys) => {
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};

const K_ID = ['id', 'banId', 'banid', 'ban_id', 'banID', 'BanID'];
const K_NAME = ['name', 'playerName', 'player_name', 'username', 'player', 'Name'];
const K_REASON = ['reason', 'banReason', 'ban_reason', 'detection', 'Reason'];
const K_BY = ['bannedBy', 'banned_by', 'admin', 'author', 'staff', 'by', 'moderator'];
const K_DATE = ['date', 'time', 'timestamp', 'created', 'created_at', 'createdAt', 'banDate', 'bannedAt', 'banned_at'];
const K_EXP = ['expire', 'expires', 'expiration', 'expiresAt', 'expires_at', 'until', 'unbanDate'];
const K_TOK = ['tokens', 'hwid', 'hwids', 'hardwareIds'];
const K_IDS = ['identifiers', 'ids', 'identifier'];
const KNOWN = new Set([...K_ID, ...K_NAME, ...K_REASON, ...K_BY, ...K_DATE, ...K_EXP, ...K_TOK, ...K_IDS, ...ID_TYPES, 'manual']);

function normalizeBan(key, r) {
  if (!r || typeof r !== 'object') return null;
  const ids = {};
  const add = (v) => {
    if (typeof v !== 'string') return;
    const c = v.indexOf(':');
    if (c < 1) return;
    const t = v.slice(0, c).toLowerCase();
    if (ids[t] === undefined) ids[t] = v.slice(c + 1);
  };
  const src = pick(r, K_IDS);
  if (Array.isArray(src)) src.forEach(add);
  else if (typeof src === 'string') add(src);
  else if (src && typeof src === 'object') {
    for (const k of Object.keys(src)) {
      const v = src[k];
      if (Array.isArray(v)) v.forEach(add);
      else if (typeof v === 'string') {
        if (v.includes(':')) add(v);
        else if (ids[k.toLowerCase()] === undefined) ids[k.toLowerCase()] = v;
      }
    }
  }
  for (const t of ID_TYPES) {
    const v = r[t];
    if (typeof v !== 'string' || !v) continue;
    if (v.startsWith(`${t}:`)) add(v);
    else if (ids[t] === undefined) ids[t] = v;
  }
  const exp = pick(r, K_EXP);
  const expMs = toMs(exp);
  const tok = pick(r, K_TOK);
  const extra = [];
  for (const k of Object.keys(r)) {
    if (KNOWN.has(k)) continue;
    const v = r[k];
    if (v === null || v === undefined || v === '' || typeof v === 'object') continue;
    extra.push([k, String(v)]);
    if (extra.length >= 8) break;
  }
  const b = {
    id: String(pick(r, K_ID) ?? key),
    name: pick(r, K_NAME),
    reason: pick(r, K_REASON),
    by: pick(r, K_BY) ?? (r.manual === true ? 'Manual' : r.manual === false ? 'XionShield' : undefined),
    date: toMs(pick(r, K_DATE)),
    expire: expMs && expMs > 1e12 ? expMs : null,
    ids,
    tokens: Array.isArray(tok) ? tok.length : tok && typeof tok === 'object' ? Object.keys(tok).length : 0,
    extra,
  };
  if (typeof b.name !== 'string') b.name = b.name === undefined ? '' : String(b.name);
  if (typeof b.reason !== 'string') b.reason = b.reason === undefined ? '' : String(b.reason);
  if (b.by !== undefined) b.by = String(b.by);
  b.hay = `${b.id}\u0001${b.name}\u0001${b.reason}\u0001${Object.entries(ids).map(([t, v]) => `${t}:${v}`).join('\u0001')}`.toLowerCase();
  return b;
}

function normalizeList(raw) {
  if (!raw) return [];
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw) && typeof raw === 'object' && Array.isArray(raw.bans)) raw = raw.bans;
  const out = [];
  if (Array.isArray(raw)) raw.forEach((r, i) => { const b = normalizeBan(String(i + 1), r); if (b) out.push(b); });
  else if (typeof raw === 'object') for (const k of Object.keys(raw)) { const b = normalizeBan(k, raw[k]); if (b) out.push(b); }
  out.sort((a, b) => (b.date || 0) - (a.date || 0) || (+b.id || 0) - (+a.id || 0));
  return out;
}

function unwrap(r) {
  if (r && typeof r === 'object' && typeof r.__cfx_async_retval === 'function') {
    return new Promise((resolve, reject) =>
      r.__cfx_async_retval((rv, err) => (err ? reject(new Error(String(err))) : resolve(Array.isArray(rv) && rv.length <= 1 ? rv[0] : rv)))
    );
  }
  return r;
}

class Xion extends EventEmitter {
  constructor(cfg, log) {
    super();
    this.log = log;
    const want = cfg.xionshieldResource;
    this.name = want && want !== 'auto' ? want : GetConvar('XionShieldName', '') || 'XionShield';
    this.bans = [];
    this.byId = new Map();
    this.loadedAt = 0;
    this.seeded = false;
    this.inflight = null;
    this.watcher = null;
    this.pollTimer = null;
    this.debounce = null;
  }

  get started() {
    return GetResourceState(this.name) === 'started';
  }

  get state() {
    return GetResourceState(this.name);
  }

  get version() {
    return GetResourceMetadata(this.name, 'version', 0) || 'unknown';
  }

  get bansFile() {
    const p = GetResourcePath(this.name);
    return p ? path.join(p, 'bans.json') : null;
  }

  async call(fn, ...args) {
    const ex = globalThis.exports[this.name];
    if (!ex) throw new Error(`Resource "${this.name}" is not available`);
    return unwrap(await ex[fn](...args));
  }

  async ban(src, reason, logs) {
    try {
      const r = await this.call('BanPlayer', +src, reason, !!logs);
      return { ok: r !== false, id: typeof r === 'string' || typeof r === 'number' ? String(r) : null };
    } catch (e) {
      this.log.debug(`BanPlayer export failed (${e.message}), falling back to console command`);
      ExecuteCommand(`xion ban ${+src} ${safeCmd(reason)}`);
      return { ok: true, id: null, viaCommand: true };
    }
  }

  async unban(id) {
    id = String(id).trim();
    if (!/^[\w.-]{1,64}$/.test(id)) return { ok: false, err: 'Invalid ban id' };
    const args = [id];
    if (/^\d+$/.test(id) && +id <= Number.MAX_SAFE_INTEGER) args.push(+id);
    let last = { ok: false, err: 'Ban not found' };
    try {
      for (const a of args) {
        const r = await this.call('UnbanPlayer', a);
        const [ok, target, err] = Array.isArray(r) ? r : [r];
        last = { ok: !!ok, target, err: err ? String(err) : null };
        if (last.ok) break;
      }
    } catch (e) {
      this.log.debug(`UnbanPlayer export failed (${e.message}), falling back to console command`);
      ExecuteCommand(`xion unban ${id}`);
      last = { ok: true, viaCommand: true };
    }
    if (last.ok) this.dropLocal(id);
    return last;
  }

  async info(id) {
    const cached = this.byId.get(String(id));
    const args = [String(id)];
    if (/^\d+$/.test(id) && +id <= Number.MAX_SAFE_INTEGER) args.push(+id);
    for (const a of args) {
      try {
        const r = await this.call('getBanInfo', a);
        if (r && typeof r === 'object' && Object.keys(r).length) return normalizeBan(String(id), r);
      } catch (e) {
        this.log.debug(`getBanInfo failed: ${e.message}`);
        break;
      }
    }
    return cached || null;
  }

  async fetchRaw() {
    try {
      return await this.call('listBans');
    } catch (e) {
      const f = this.bansFile;
      if (!f) throw e;
      return JSON.parse(await fs.promises.readFile(f, 'utf8'));
    }
  }

  refresh(force = false) {
    if (!force && this.seeded && Date.now() - this.loadedAt < 15000) return Promise.resolve(this.bans);
    if (this.inflight) return this.inflight;
    this.inflight = this.fetchRaw()
      .then((raw) => {
        const list = normalizeList(raw);
        const map = new Map();
        for (const b of list) map.set(b.id, b);
        if (this.seeded) {
          const added = [];
          for (const b of list) if (!this.byId.has(b.id)) added.push(b);
          const removed = [];
          for (const id of this.byId.keys()) if (!map.has(id)) removed.push(this.byId.get(id));
          if (added.length) this.emit('added', added);
          if (removed.length) this.emit('removed', removed);
        }
        this.bans = list;
        this.byId = map;
        this.loadedAt = Date.now();
        this.seeded = true;
        return list;
      })
      .catch((e) => {
        this.log.debug(`Ban list refresh failed: ${e.message}`);
        return this.bans;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  cached() {
    if (!this.seeded || Date.now() - this.loadedAt > 30000) this.refresh();
    return this.bans;
  }

  dropLocal(id) {
    const b = this.byId.get(id);
    if (!b) return;
    this.byId.delete(id);
    const i = this.bans.indexOf(b);
    if (i >= 0) this.bans.splice(i, 1);
    this.emit('removed', [b]);
  }

  search(q, limit = Infinity) {
    const list = this.cached();
    q = String(q || '').toLowerCase().trim();
    if (!q) return limit === Infinity ? list : list.slice(0, limit);
    const out = [];
    for (const b of list) {
      if (b.hay.includes(q)) {
        out.push(b);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  matchPlayer(b, p) {
    for (const t of ID_TYPES) if (b.ids[t] && p.ids[t] && b.ids[t] === p.ids[t] && t !== 'ip') return true;
    return false;
  }

  async findNewBan(before, p) {
    for (let i = 0; i < 4; i++) {
      await sleep(i ? 900 : 400);
      const list = await this.refresh(true);
      const hit = list.find((b) => !before.has(b.id) && this.matchPlayer(b, p));
      if (hit) return hit;
    }
    return null;
  }

  stats() {
    const day = Date.now() - 86400000;
    let today = 0;
    for (const b of this.bans) if (b.date && b.date >= day) today++;
    return { total: this.bans.length, today };
  }

  setPerm(src, perm, value) {
    const r = resolvePerm(perm);
    if (r) return this.call('SetPlayerPermissionsCategory', +src, r.cat, r.perm, !!value);
    return this.call('SetPlayerPermissions', +src, perm, !!value);
  }

  setCategory(src, cat, value) {
    return Promise.all(CATALOG[cat].map((p) => this.call('SetPlayerPermissionsCategory', +src, cat, p, !!value)));
  }

  setAll(src, value) {
    return this.call('SetPlayerPermissionsAll', +src, !!value);
  }

  watch({ watchFile, pollSeconds }) {
    this.unwatch();
    if (watchFile) this.arm();
    const every = Math.max(10, pollSeconds | 0) * 1000 * (this.watcher ? 3 : 1);
    this.pollTimer = setInterval(() => this.started && this.refresh(true), every);
  }

  arm() {
    const f = this.bansFile;
    if (!f || !fs.existsSync(f)) return;
    try {
      this.watcher = fs.watch(f, { persistent: false }, (evt) => {
        clearTimeout(this.debounce);
        this.debounce = setTimeout(() => {
          this.refresh(true);
          if (evt === 'rename') {
            this.unwatch(true);
            this.arm();
          }
        }, 700);
      });
      this.watcher.on('error', () => this.unwatch(true));
    } catch (e) {
      this.log.debug(`File watch unavailable: ${e.message}`);
    }
  }

  unwatch(keepPoll) {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (!keepPoll && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

module.exports = { Xion, CATALOG, CATEGORIES, ALL_PERMS, LOG_TYPES, DELETE_TYPES, MODULES, resolvePerm, expandEntries, normalizeBan, normalizeList };
