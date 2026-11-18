'use strict';
const { tpl } = require('../lib/util');

const race = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

function discordOf(src) {
  const n = GetNumPlayerIdentifiers(src);
  for (let i = 0; i < n; i++) {
    const v = GetPlayerIdentifier(src, i);
    if (v && v.startsWith('discord:')) return v.slice(8);
  }
  return null;
}

class Guard {
  constructor(bot) {
    this.bot = bot;
    const g = bot.cfg.guard;
    const r = bot.cfg.permissions.roles;
    this.cfg = g;
    this.staff = new Set([...(g.bypassRoles || []), ...Object.values(r).flat()]);
    this.owners = new Set(bot.cfg.permissions.owners || []);
    this.required = new Set(g.requiredRoles || []);
  }

  prune(roles) {
    if (!this.required.size) return;
    const valid = [...this.required].filter((r) => roles.has(r));
    if (valid.length) return void (this.required = new Set(valid));
    this.required = new Set();
    if (this.cfg.enabled) this.bot.log.warn('guard.requiredRoles has no valid role of this server, the role requirement is OFF until it is fixed');
  }

  get maintenance() {
    const m = this.bot.store.meta.maintenance;
    return m && m.on ? m : null;
  }

  isStaff(discordId, m) {
    if (this.owners.has(discordId)) return true;
    return !!m && m.roles.some((r) => this.staff.has(r));
  }

  install() {
    on('playerConnecting', (name, setKickReason, deferrals) => {
      const maint = this.maintenance;
      if (!this.cfg.enabled && !maint) return;
      const src = global.source;
      deferrals.defer();
      setTimeout(() => this.check(src, deferrals, maint), 0);
    });
  }

  async check(src, deferrals, maint) {
    const msg = this.bot.cfg.messages;
    const g = this.cfg;
    try {
      const id = discordOf(String(src));
      const needMember = maint || (g.enabled && (g.requireGuild || this.required.size));
      if (!id) {
        if (maint) return deferrals.done(tpl(msg.maintenance, { reason: maint.reason || '' }));
        if (g.enabled && (g.requireDiscord || needMember)) return deferrals.done(msg.noDiscord);
        return deferrals.done();
      }
      if (!needMember) return deferrals.done();
      deferrals.update(msg.checking);
      const m = await race(this.bot.members.get(id), 8000);
      if (maint && !this.isStaff(id, m)) return deferrals.done(tpl(msg.maintenance, { reason: maint.reason || '' }));
      if (!g.enabled || this.isStaff(id, m)) return deferrals.done();
      if (!m && (g.requireGuild || this.required.size)) return deferrals.done(tpl(msg.notInGuild, { invite: msg.invite }));
      if (this.required.size && !m.roles.some((r) => this.required.has(r))) return deferrals.done(msg.missingRole);
      return deferrals.done();
    } catch (e) {
      this.bot.log.warn(`Connection check failed for #${src}: ${e.message}`);
      if (g.failOpen && !maint) return deferrals.done();
      return deferrals.done(msg.unavailable);
    }
  }

  async kickNonStaff(reason) {
    const text = tpl(this.bot.cfg.messages.maintenance, { reason: reason || '' });
    let n = 0;
    await Promise.all(
      [...this.bot.players.map.values()].map(async (p) => {
        const id = p.ids.discord;
        let m = null;
        if (id) m = await this.bot.members.get(id).catch(() => null);
        if (id && this.isStaff(id, m)) return;
        DropPlayer(String(p.id), text);
        n++;
      })
    );
    return n;
  }
}

module.exports = { Guard };
