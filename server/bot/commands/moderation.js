'use strict';
const { COLORS, clip, esc, mono, stamp, tpl, b64e, b64d, parseIdentifier } = require('../../lib/util');
const ui = require('../ui');
const S = require('../shared');

const { T, L, opt, sub } = S;

function banListPage(bot, q, page) {
  q = String(q || '').trim();
  while (q && b64e(q).length > 80) q = q.slice(0, -1);
  const list = bot.xion.search(q);
  const pages = Math.max(1, Math.ceil(list.length / 10));
  page = Math.min(Math.max(0, page | 0), pages - 1);
  const lines = list.slice(page * 10, page * 10 + 10).map((b) => {
    let s = `${mono(`#${b.id}`)} **${esc(clip(b.name || 'Unknown', 32))}** · ${esc(clip(b.reason || 'No reason', 70))}`;
    if (b.date) s += ` · ${stamp(b.date)}`;
    return s;
  });
  const e = ui.info(lines.join('\n') || 'No bans found.', q ? `Bans matching "${clip(q, 40)}"` : 'XionShield bans');
  e.footer = { text: `${list.length} ban${list.length === 1 ? '' : 's'} · ${e.footer.text}` };
  return { embeds: [e], components: [ui.pager('bl', page, pages, q ? b64e(q) : '-')] };
}

function queuePage(bot) {
  const entries = Object.entries(bot.store.queue);
  const lines = entries.slice(0, 20).map(([id, q]) => `${mono(id)}\n└ ${esc(clip(q.reason, 80))} · by ${esc(q.by)} · ${stamp(q.at)}`);
  if (entries.length > 20) lines.push(`…and ${entries.length - 20} more`);
  return { embeds: [ui.info(lines.join('\n') || 'No queued bans.', `Queued offline bans (${entries.length})`)] };
}

function warnRecord(bot, key) {
  return bot.store.warnings[key] || null;
}

function warnLines(rec) {
  return rec.list.map((w) => `${mono(w.id)} ${esc(clip(w.reason, 120))}\n└ ${esc(w.by)} · ${stamp(w.at)}`).join('\n');
}

function resolveWarnTarget(bot, input) {
  const s = String(input || '').trim();
  if (/^\d+$/.test(s)) {
    const p = bot.players.get(s);
    if (p) return S.primaryKey(p);
  }
  if (bot.store.warnings[s]) return s;
  const id = parseIdentifier(s);
  if (!id) return null;
  if (bot.store.warnings[id]) return id;
  for (const [k, w] of Object.entries(bot.store.warnings)) {
    for (const [t, v] of Object.entries(w.ids || {})) if (`${t}:${v}` === id) return k;
  }
  return id;
}

function autoWarnTargets(bot, q) {
  const out = S.autoPlayers(bot, q).map((c) => {
    const p = bot.players.get(c.value);
    return { name: c.name, value: S.primaryKey(p) };
  });
  const lq = q.toLowerCase();
  for (const [k, w] of Object.entries(bot.store.warnings)) {
    if (out.length >= 25) break;
    if (lq && !k.toLowerCase().includes(lq) && !(w.name || '').toLowerCase().includes(lq)) continue;
    if (out.some((c) => c.value === k)) continue;
    out.push({ name: clip(`${w.name || 'Unknown'} · ${w.list.length} warning(s) · ${k}`, 100), value: clip(k, 100) });
  }
  return out;
}

const commands = [
  {
    level: L.admin,
    data: {
      name: 'ban',
      description: 'Ban an online player through XionShield',
      options: [
        S.playerOpt(),
        S.reasonOpt(),
        opt(T.BOOL, 'xion_log', 'Save the ban to XionShield history (default from config)'),
        opt(T.BOOL, 'evidence', 'Capture a screenshot before banning (default from config)'),
      ],
    },
    auto: (ctx, f, v) => S.autoPlayers(ctx.bot, v),
    async run(ctx) {
      const p = S.needPlayer(ctx);
      if (p) await S.executeBan(ctx, p, ctx.get('reason'), { logs: ctx.get('xion_log'), evidence: ctx.get('evidence') });
    },
  },
  {
    level: L.admin,
    data: {
      name: 'unban',
      description: 'Remove a XionShield ban',
      options: [
        opt(T.STRING, 'ban_id', 'Ban id (search by name, reason or identifier)', { required: true, autocomplete: true, max_length: 64 }),
        opt(T.STRING, 'note', 'Note for the action log', { max_length: 300 }),
      ],
    },
    auto: (ctx, f, v) => S.autoBans(ctx.bot, v),
    run: (ctx) => S.executeUnban(ctx, ctx.get('ban_id'), ctx.get('note')),
  },
  {
    level: L.support,
    data: {
      name: 'baninfo',
      description: 'Show full details of a XionShield ban',
      options: [opt(T.STRING, 'ban_id', 'Ban id (search by name, reason or identifier)', { required: true, autocomplete: true, max_length: 64 })],
    },
    auto: (ctx, f, v) => S.autoBans(ctx.bot, v),
    async run(ctx) {
      const id = String(ctx.get('ban_id')).trim();
      const b = await ctx.within(ctx.bot.xion.info(id));
      if (!b) return ctx.fail(`No ban found with id ${mono(id)}.`);
      const components = ctx.level >= L.admin ? [ui.row(ui.button(`xs:ub:${clip(b.id, 80)}`, 'Unban', 4, false, '🔓'))] : [];
      await ctx.reply({ embeds: [ui.banEmbed(b)], components });
    },
  },
  {
    level: L.support,
    data: {
      name: 'banlist',
      description: 'Browse and search XionShield bans',
      options: [opt(T.STRING, 'search', 'Filter by name, reason, ban id or identifier', { max_length: 48 })],
    },
    async run(ctx) {
      await ctx.within(ctx.bot.xion.refresh());
      await ctx.reply(banListPage(ctx.bot, ctx.get('search', ''), 0));
    },
  },
  {
    level: L.admin,
    data: {
      name: 'offlineban',
      description: 'Queue a ban that XionShield applies when the identifier joins',
      options: [
        sub('add', 'Queue a ban for an identifier', [
          opt(T.STRING, 'identifier', 'license:, discord:, steam:, fivem:, xbl:, live: or ip:', { required: true, autocomplete: true, max_length: 100 }),
          S.reasonOpt(),
        ]),
        sub('list', 'Show queued bans'),
        sub('remove', 'Remove a queued ban', [opt(T.STRING, 'identifier', 'Queued identifier', { required: true, autocomplete: true, max_length: 100 })]),
      ],
    },
    levels: { list: L.support },
    auto(ctx, f, v) {
      if (ctx.sub === 'remove') {
        const q = v.toLowerCase();
        return Object.entries(ctx.bot.store.queue)
          .filter(([k, x]) => !q || k.toLowerCase().includes(q) || (x.name || '').toLowerCase().includes(q))
          .slice(0, 25)
          .map(([k, x]) => ({ name: clip(`${x.name ? `${x.name} · ` : ''}${k}`, 100), value: clip(k, 100) }));
      }
      return S.autoIdentifiers(ctx.bot, v);
    },
    async run(ctx) {
      const { bot } = ctx;
      if (ctx.sub === 'list') return ctx.reply(queuePage(bot));
      const id = parseIdentifier(ctx.get('identifier'));
      if (!id) return ctx.fail('Use the format `type:value`, for example `license:1a2b3c…` or `discord:123…`.');
      if (ctx.sub === 'remove') {
        if (!bot.store.queue[id]) return ctx.fail(`${mono(id)} is not queued.`);
        delete bot.store.queue[id];
        bot.store.save();
        S.audit(ctx, 'Queued ban removed', mono(id), { color: COLORS.ok });
        return ctx.reply(ui.ok(`Removed the queued ban for ${mono(id)}.`));
      }
      const reason = ctx.get('reason');
      const online = bot.players.byIdentifier(id);
      if (online) return S.executeBan(ctx, online, reason);
      const already = bot.xion.search(id, 1)[0];
      if (already) return ctx.fail(`This identifier is already banned (${mono(`#${already.id}`)}).`);
      const seen = bot.players.recent.find((p) => p.all.some((x) => x.toLowerCase() === id.toLowerCase()));
      bot.store.queue[id] = { reason, by: ctx.staff, byId: ctx.user.id, at: Date.now(), name: seen ? seen.name : '' };
      bot.store.save();
      const fields = [ui.field('Identifier', mono(id)), ui.field('Reason', esc(reason))];
      if (seen) fields.unshift(ui.field('Last known name', esc(seen.name), true));
      S.audit(ctx, 'Offline ban queued', null, { color: COLORS.warn, fields });
      return ctx.reply({ embeds: [ui.embed(COLORS.warn, 'XionShield will ban this player automatically the next time they join.', 'Ban queued', fields)] });
    },
  },
  {
    level: L.moderator,
    data: { name: 'kick', description: 'Kick an online player', options: [S.playerOpt(), S.reasonOpt()] },
    auto: (ctx, f, v) => S.autoPlayers(ctx.bot, v),
    async run(ctx) {
      const p = S.needPlayer(ctx);
      if (!p) return;
      const reason = ctx.get('reason');
      ctx.bot.actions.kick(p.id, reason, ctx.staff);
      const fields = [ui.field('Player', `${esc(p.name)} ${mono(`#${p.id}`)}`, true), ui.field('Reason', esc(reason))];
      S.audit(ctx, 'Kick', null, { color: COLORS.warn, fields });
      await ctx.reply({ embeds: [ui.embed(COLORS.warn, null, 'Player kicked', fields)] });
    },
  },
  {
    level: L.moderator,
    data: {
      name: 'warn',
      description: 'Manage player warnings',
      options: [
        sub('add', 'Warn an online player', [S.playerOpt(), S.reasonOpt(true, 300)]),
        sub('list', 'Show warnings of a player or identifier', [opt(T.STRING, 'target', 'Player or identifier', { required: true, autocomplete: true, max_length: 100 })]),
        sub('remove', 'Remove a single warning', [
          opt(T.STRING, 'target', 'Player or identifier', { required: true, autocomplete: true, max_length: 100 }),
          opt(T.STRING, 'warning', 'Warning id', { required: true, max_length: 16 }),
        ]),
        sub('clear', 'Remove all warnings', [opt(T.STRING, 'target', 'Player or identifier', { required: true, autocomplete: true, max_length: 100 })]),
      ],
    },
    levels: { list: L.support, remove: L.admin, clear: L.admin },
    auto(ctx, f, v) {
      return ctx.sub === 'add' ? S.autoPlayers(ctx.bot, v) : autoWarnTargets(ctx.bot, v);
    },
    async run(ctx) {
      const { bot } = ctx;
      if (ctx.sub === 'add') {
        const p = S.needPlayer(ctx);
        if (!p) return;
        const reason = ctx.get('reason');
        const key = S.primaryKey(p);
        const rec = bot.store.warnings[key] || (bot.store.warnings[key] = { name: p.name, ids: p.ids, list: [] });
        rec.name = p.name;
        rec.ids = p.ids;
        bot.store.meta.warnSeq = (bot.store.meta.warnSeq | 0) + 1;
        const w = { id: `W${bot.store.meta.warnSeq}`, reason, by: ctx.staff, byId: ctx.user.id, at: Date.now() };
        rec.list.push(w);
        bot.store.save();
        const n = rec.list.length;
        const wc = bot.cfg.warnings;
        if (wc.notifyPlayer) bot.actions.chat(p.id, bot.cfg.chat.dmTitle, tpl(bot.cfg.messages.warn, { staff: ctx.staff, reason, count: n }));
        const fields = [ui.field('Player', `${esc(p.name)} ${mono(`#${p.id}`)}`, true), ui.field('Total', String(n), true), ui.field('Warning', `${mono(w.id)} ${esc(reason)}`)];
        S.audit(ctx, 'Warning issued', null, { color: COLORS.warn, fields });
        if (wc.banAt > 0 && n >= wc.banAt) {
          await ctx.reply({ embeds: [ui.embed(COLORS.warn, `Threshold reached (${n}/${wc.banAt}), banning.`, 'Warning issued', fields)] });
          return S.executeBan(ctx, p, `Reached ${n} warnings. Last: ${reason}`).catch(() => {});
        }
        if (wc.kickAt > 0 && n >= wc.kickAt) {
          bot.actions.kick(p.id, `Reached ${n} warnings. Last: ${reason}`, ctx.staff);
          fields.push(ui.field('Action', `Kicked (threshold ${wc.kickAt})`));
        }
        return ctx.reply({ embeds: [ui.embed(COLORS.warn, null, 'Warning issued', fields)] });
      }
      const key = resolveWarnTarget(bot, ctx.get('target'));
      const rec = key && warnRecord(bot, key);
      if (!rec || !rec.list.length) return ctx.fail('No warnings found for that target.');
      if (ctx.sub === 'list') {
        return ctx.reply({ embeds: [ui.info(clip(warnLines(rec), 4000), `Warnings · ${clip(rec.name || key, 200)} (${rec.list.length})`)] });
      }
      if (ctx.sub === 'clear') {
        const n = rec.list.length;
        delete bot.store.warnings[key];
        bot.store.save();
        S.audit(ctx, 'Warnings cleared', `${mono(key)} · ${n} removed`, { color: COLORS.ok });
        return ctx.reply(ui.ok(`Cleared ${n} warning(s) for ${esc(rec.name || key)}.`));
      }
      const wid = String(ctx.get('warning')).trim().toUpperCase();
      const i = rec.list.findIndex((w) => w.id.toUpperCase() === wid);
      if (i < 0) return ctx.fail(`Warning ${mono(wid)} was not found.`);
      const [w] = rec.list.splice(i, 1);
      if (!rec.list.length) delete bot.store.warnings[key];
      bot.store.save();
      S.audit(ctx, 'Warning removed', `${mono(w.id)} ${esc(w.reason)} · ${mono(key)}`, { color: COLORS.ok });
      return ctx.reply(ui.ok(`Removed warning ${mono(w.id)} from ${esc(rec.name || key)}.`));
    },
  },
];

const components = {
  bl: {
    level: L.support,
    name: 'banlist',
    async run(ctx, [page, q]) {
      await ctx.within(ctx.bot.xion.refresh(true));
      return ctx.update(banListPage(ctx.bot, q && q !== '-' ? b64d(q) : '', +page || 0));
    },
  },
  ub: {
    level: L.admin,
    name: 'unban',
    run: (ctx, [id]) =>
      ctx.modal(ui.modal(`xs:mu:${id}`, `Unban #${id}`, [{ id: 'note', label: 'Note for the action log', long: true, required: false, max: 300 }])),
  },
  mu: {
    level: L.admin,
    name: 'unban',
    run: (ctx, [id]) => S.executeUnban(ctx, id, ctx.field('note')),
  },
};

module.exports = { commands, components, banListPage };
