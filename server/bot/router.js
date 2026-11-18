'use strict';
const crypto = require('crypto');
const { LEVELS, NO_MENTIONS, clip } = require('../lib/util');
const ui = require('./ui');

class Ctx {
  constructor(bot, i) {
    this.bot = bot;
    this.i = i;
    this.member = i.member || null;
    this.user = i.member ? i.member.user : i.user;
    this.roles = i.member ? i.member.roles : [];
    this.level = bot.levelOf(this.user.id, this.roles);
    this.d = i.data || {};
    this.state = 0;
    this.pending = null;
    this.eph = bot.cfg.replies.ephemeral;
    this.sub = null;
    this.group = null;
    this.opts = null;
  }

  get staff() {
    return (this.member && this.member.nick) || this.user.global_name || this.user.username;
  }

  get mention() {
    return `<@${this.user.id}>`;
  }

  options() {
    if (this.opts) return this.opts;
    const m = new Map();
    let o = this.d.options;
    while (o && o.length && (o[0].type === 1 || o[0].type === 2)) {
      if (o[0].type === 2) this.group = o[0].name;
      else this.sub = o[0].name;
      o = o[0].options;
    }
    if (o) for (const x of o) m.set(x.name, x);
    this.opts = m;
    return m;
  }

  get(name, def) {
    const x = this.options().get(name);
    return x === undefined ? def : x.value;
  }

  focused() {
    for (const x of this.options().values()) if (x.focused) return x;
    return null;
  }

  resolvedUser(id) {
    const r = this.d.resolved;
    return (r && r.users && r.users[id]) || null;
  }

  field(id) {
    for (const r of this.d.components || []) for (const c of r.components || []) if (c.custom_id === id) return c.value;
    return undefined;
  }

  shape(data) {
    const out = {};
    for (const k of Object.keys(data)) if (k !== 'files' && k !== 'ephemeral') out[k] = data[k];
    if (out.allowed_mentions === undefined) out.allowed_mentions = NO_MENTIONS;
    return out;
  }

  cb(type, data, files) {
    return this.bot.rest.request('POST', `/interactions/${this.i.id}/${this.i.token}/callback`, {
      body: data === undefined ? { type } : { type, data },
      files,
      auth: false,
    });
  }

  reply(data) {
    if (this.state !== 0) return this.edit(data);
    this.state = 2;
    const d = this.shape(data);
    if (data.ephemeral !== undefined ? data.ephemeral : this.eph) d.flags = (d.flags | 0) | 64;
    return this.cb(4, d, data.files);
  }

  defer(ephemeral) {
    if (this.state !== 0) return this.pending || Promise.resolve();
    this.state = 1;
    if (ephemeral !== undefined) this.eph = ephemeral;
    this.pending = this.cb(5, this.eph ? { flags: 64 } : undefined);
    return this.pending;
  }

  async within(promise, ms = 2200) {
    const t = setTimeout(() => this.defer().catch(() => {}), ms);
    try {
      return await promise;
    } finally {
      clearTimeout(t);
    }
  }

  async edit(data) {
    if (this.state === 0) return this.reply(data);
    if (this.pending) await this.pending.catch(() => {});
    return this.bot.rest.request('PATCH', `/webhooks/${this.bot.appId}/${this.i.token}/messages/@original`, {
      body: this.shape(data),
      files: data.files,
      auth: false,
    });
  }

  update(data) {
    if (this.state !== 0) return this.edit(data);
    this.state = 2;
    return this.cb(7, this.shape(data), data.files);
  }

  deferUpdate() {
    if (this.state !== 0) return this.pending || Promise.resolve();
    this.state = 1;
    this.pending = this.cb(6);
    return this.pending;
  }

  modal(m) {
    this.state = 2;
    return this.cb(9, m);
  }

  choices(list) {
    this.state = 2;
    return this.cb(8, { choices: list.slice(0, 25) });
  }

  async followUp(data) {
    if (this.pending) await this.pending.catch(() => {});
    const d = this.shape(data);
    if (data.ephemeral !== undefined ? data.ephemeral : this.eph) d.flags = 64;
    return this.bot.rest.request('POST', `/webhooks/${this.bot.appId}/${this.i.token}`, { body: d, files: data.files, auth: false });
  }

  fail(msg) {
    const p = ui.fail(msg);
    return this.state === 0 ? this.reply(p) : this.edit(p);
  }
}

class Router {
  constructor(bot) {
    this.bot = bot;
    this.commands = new Map();
    this.components = new Map();
  }

  add(mod) {
    for (const c of mod.commands || []) {
      if (this.bot.cfg.commands.disabled.includes(c.data.name)) continue;
      if (c.enabled && !c.enabled(this.bot.cfg)) continue;
      this.commands.set(c.data.name, c);
    }
    for (const [k, v] of Object.entries(mod.components || {})) this.components.set(k, v);
  }

  levelFor(name, sub, def) {
    const o = this.bot.cfg.permissions.commandLevels;
    const v = (sub && o[`${name}.${sub}`]) || o[name];
    const i = v ? LEVELS.indexOf(String(v).toLowerCase()) : -1;
    return i >= 0 ? i : def;
  }

  definitions() {
    return [...this.commands.values()].map((c) => c.data);
  }

  hash() {
    return crypto.createHash('sha1').update(JSON.stringify(this.definitions())).digest('hex');
  }

  async handle(i) {
    if (i.guild_id !== this.bot.cfg.guildId) return;
    const ctx = new Ctx(this.bot, i);
    try {
      switch (i.type) {
        case 2:
          return await this.command(ctx);
        case 3:
        case 5:
          return await this.component(ctx);
        case 4:
          return await this.autocomplete(ctx);
      }
    } catch (e) {
      this.bot.log.error(`Interaction failed (${ctx.d.name || ctx.d.custom_id}): ${e.stack || e.message}`);
      if (i.type !== 4 && ctx.state !== 2) ctx.fail(`Something went wrong: ${clip(e.message, 300)}`).catch(() => {});
    }
  }

  async command(ctx) {
    const c = this.commands.get(ctx.d.name);
    if (!c) return ctx.fail('This command is no longer available.');
    ctx.options();
    const lvl = this.levelFor(c.data.name, ctx.sub, (c.levels && ctx.sub && c.levels[ctx.sub]) ?? c.level);
    if (ctx.level < lvl) return ctx.fail(`You need the **${LEVELS[lvl]}** level to use this command.`);
    await c.run(ctx);
  }

  async component(ctx) {
    const parts = String(ctx.d.custom_id || '').split(':');
    if (parts[0] !== 'xs') return;
    const h = this.components.get(parts[1]);
    if (!h) return ctx.i.type === 5 ? ctx.fail('Unknown form.') : ctx.deferUpdate();
    const lvl = this.levelFor(h.name || parts[1], null, h.level);
    if (ctx.level < lvl) return ctx.reply(ui.fail(`You need the **${LEVELS[lvl]}** level for this action.`));
    await h.run(ctx, parts.slice(2));
  }

  async autocomplete(ctx) {
    const c = this.commands.get(ctx.d.name);
    ctx.options();
    if (!c || !c.auto) return ctx.choices([]);
    const lvl = this.levelFor(c.data.name, ctx.sub, (c.levels && ctx.sub && c.levels[ctx.sub]) ?? c.level);
    if (ctx.level < lvl) return ctx.choices([]);
    const f = ctx.focused();
    const list = f ? await c.auto(ctx, f.name, String(f.value || '')) : [];
    return ctx.choices(list || []);
  }
}

module.exports = { Router, Ctx };
