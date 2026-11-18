'use strict';
const { expandEntries, ALL_PERMS, CATEGORIES } = require('../game/xion');

const TTL = 60000;
const NEG_TTL = 30000;

class Members {
  constructor(bot) {
    this.bot = bot;
    this.cache = new Map();
    this.inflight = new Map();
  }

  async get(userId, fresh = false) {
    const c = this.cache.get(userId);
    if (!fresh && c && Date.now() - c.at < (c.m ? TTL : NEG_TTL)) return c.m;
    const f = this.inflight.get(userId);
    if (f) return f;
    const p = this.bot.rest
      .get(`/guilds/${this.bot.cfg.guildId}/members/${userId}`)
      .then((m) => m, (e) => {
        if (e.status === 404) return null;
        throw e;
      })
      .then((m) => {
        this.set(userId, m);
        return m;
      })
      .finally(() => this.inflight.delete(userId));
    this.inflight.set(userId, p);
    return p;
  }

  set(userId, m) {
    if (this.cache.size > 2000) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(userId, { m: m ? { roles: m.roles || [] } : null, at: Date.now() });
  }

  drop(userId) {
    this.cache.delete(userId);
  }
}

class RoleSync {
  constructor(bot) {
    this.bot = bot;
    const c = bot.cfg.roleSync;
    this.enabled = !!c.enabled && Object.keys(c.roles || {}).length > 0;
    this.ace = c.mode === 'ace';
    this.prefix = c.acePrefix || 'XionShield';
    this.map = new Map();
    for (const [role, list] of Object.entries(c.roles || {})) this.map.set(role, expandEntries(Array.isArray(list) ? list : [list]));
    this.granted = new Map();
    this.groups = new Map();
    this.lastApply = new Map();
    if (this.enabled && this.ace) this.setupAce(c.roles);
  }

  setupAce(roles) {
    for (const [role, list] of Object.entries(roles)) {
      const g = `group.xsbot_${role}`;
      const set = new Set();
      for (const e of Array.isArray(list) ? list : [list]) {
        if (e === '*') CATEGORIES.forEach((c) => set.add(c));
        else set.add(String(e).includes(':') ? String(e).split(':')[1] : String(e));
      }
      for (const perm of set) ExecuteCommand(`add_ace ${g} ${this.prefix}.${perm} allow`);
    }
  }

  desired(roles) {
    const out = new Set();
    for (const r of roles) {
      const s = this.map.get(r);
      if (s) for (const p of s) out.add(p);
    }
    return out;
  }

  async apply(src, fresh = false) {
    if (!this.enabled) return null;
    const p = this.bot.players.get(src);
    if (!p || !p.ids.discord) return null;
    const m = await this.bot.members.get(p.ids.discord, fresh);
    if (!this.bot.players.get(src)) return null;
    const roles = m ? m.roles : [];
    if (this.ace) return this.applyAce(p, roles);
    const want = this.desired(roles);
    const had = this.granted.get(p.id) || new Set();
    const x = this.bot.xion;
    const jobs = [];
    if (want.size === ALL_PERMS.length && had.size !== want.size) jobs.push(x.setAll(p.id, true));
    else if (want.size === 0 && had.size === ALL_PERMS.length) jobs.push(x.setAll(p.id, false));
    else {
      for (const perm of want) if (!had.has(perm)) jobs.push(x.setPerm(p.id, perm, true));
      for (const perm of had) if (!want.has(perm)) jobs.push(x.setPerm(p.id, perm, false));
    }
    if (jobs.length) {
      const res = await Promise.allSettled(jobs);
      const bad = res.find((r) => r.status === 'rejected');
      if (bad) this.bot.log.warn(`Role sync for #${p.id} partially failed: ${bad.reason && bad.reason.message}`);
      this.bot.log.debug(`Role sync #${p.id}: ${want.size} permission(s)`);
    }
    this.granted.set(p.id, want);
    return want;
  }

  applyAce(p, roles) {
    const principal = `identifier.discord:${p.ids.discord}`;
    const had = this.groups.get(p.id) || new Set();
    const want = new Set(roles.filter((r) => this.map.has(r)));
    for (const r of want) if (!had.has(r)) ExecuteCommand(`add_principal ${principal} group.xsbot_${r}`);
    for (const r of had) if (!want.has(r)) ExecuteCommand(`remove_principal ${principal} group.xsbot_${r}`);
    this.groups.set(p.id, want);
    return this.desired([...want]);
  }

  schedule(src) {
    if (!this.enabled) return;
    const delay = Math.max(0, this.bot.cfg.roleSync.applyDelaySeconds) * 1000;
    setTimeout(() => this.apply(src).catch((e) => this.bot.log.debug(`Role sync failed: ${e.message}`)), delay);
  }

  onSpawn(src) {
    if (!this.enabled) return;
    const now = Date.now();
    if (now - (this.lastApply.get(src) || 0) < 20000) return;
    this.lastApply.set(src, now);
    if (!this.ace) this.granted.delete(+src);
    this.apply(src).catch(() => {});
  }

  forget(src) {
    src = +src;
    this.lastApply.delete(src);
    this.granted.delete(src);
    const g = this.groups.get(src);
    if (g && g.size) {
      const p = this.bot.players.get(src);
      const id = p && p.ids.discord;
      if (id) for (const r of g) ExecuteCommand(`remove_principal identifier.discord:${id} group.xsbot_${r}`);
    }
    this.groups.delete(src);
  }

  onMemberUpdate(d) {
    if (d.guild_id !== this.bot.cfg.guildId || !d.user) return;
    this.bot.members.set(d.user.id, d);
    const p = this.bot.players.byDiscord(d.user.id);
    if (p && this.enabled) this.apply(p.id).catch(() => {});
  }

  onMemberRemove(d) {
    if (d.guild_id !== this.bot.cfg.guildId || !d.user) return;
    this.bot.members.set(d.user.id, null);
    const p = this.bot.players.byDiscord(d.user.id);
    if (!p) return;
    if (this.enabled) this.apply(p.id).catch(() => {});
    if (this.bot.cfg.guard.kickOnGuildLeave) this.bot.actions.kick(p.id, 'You left the Discord server.', 'System');
  }
}

module.exports = { RoleSync, Members };
