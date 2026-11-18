'use strict';
const { COLORS, clip, esc, mono, stamp } = require('../../lib/util');
const { CATALOG, CATEGORIES, ALL_PERMS, resolvePerm } = require('../../game/xion');
const ui = require('../ui');
const S = require('../shared');

const { T, L, opt, sub } = S;
const PAGE = 20;

function playersPage(bot, page) {
  const list = [...bot.players.map.values()].sort((a, b) => a.id - b.id);
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  page = Math.min(Math.max(0, page | 0), pages - 1);
  const lines = S.playerLines(list.slice(page * PAGE, page * PAGE + PAGE), true);
  const e = ui.info(lines.join('\n') || 'Nobody is online.', `Online players · ${list.length}/${GetConvarInt('sv_maxclients', 48)}`);
  return { embeds: [e], components: [ui.pager('pl', page, pages)] };
}

function playerPanel(bot, p, level) {
  const sid = String(p.id);
  const ped = GetPlayerPed(sid);
  const rec = bot.store.warnings[S.primaryKey(p)];
  const e = ui.playerEmbed(p, {
    ping: GetPlayerPing(sid),
    health: ped ? GetEntityHealth(ped) : undefined,
    tokens: GetNumPlayerTokens(sid),
    warnings: rec ? rec.list.length : 0,
    bans: bot.xion.cached().filter((b) => bot.xion.matchPlayer(b, p)).slice(0, 5),
    showIp: bot.cfg.privacy.showIp && level >= L.admin,
  });
  const st = bot.players.stampOf(p);
  const k = `${p.id}:${st}`;
  return {
    embeds: [e],
    components: [
      ui.row(
        ui.button(`xs:pa:f:${k}`, 'Refresh', 2, false, '↻'),
        ui.button(`xs:pa:s:${k}`, 'Screenshot', 1, level < L.moderator || !bot.actions.shotsAvailable, '📸'),
        ui.button(`xs:pa:r:${k}`, 'Revive', 3, level < L.moderator, '❤️'),
        ui.button(`xs:pa:k:${k}`, 'Kick', 2, level < L.moderator, '👢'),
        ui.button(`xs:pa:b:${k}`, 'Ban', 4, level < L.admin, '🔨')
      ),
    ],
  };
}

async function screenshotReply(ctx, p) {
  const { bot } = ctx;
  if (!bot.actions.shotsAvailable) return ctx.fail(`\`${bot.cfg.screenshot.resource}\` is not running on the server.`);
  await ctx.defer();
  let img;
  try {
    img = await bot.actions.screenshot(p.id, 20);
  } catch (e) {
    return ctx.fail(`Screenshot failed: ${esc(e.message)}`);
  }
  const e = ui.embed(null, `${esc(p.name)} ${mono(`#${p.id}`)} · ${stamp(Date.now())}`, 'Screenshot');
  e.image = { url: 'attachment://screenshot.jpg' };
  await ctx.edit({ embeds: [e], files: [{ name: 'screenshot.jpg', data: img, type: 'image/jpeg' }] });
  S.audit(ctx, 'Screenshot', `${esc(p.name)} ${mono(`#${p.id}`)}`);
}

function revive(ctx, p) {
  const via = ctx.bot.actions.revive(p.id);
  S.audit(ctx, 'Revive', `${esc(p.name)} ${mono(`#${p.id}`)} · via ${via}`, { color: COLORS.ok });
  return ctx.reply(ui.ok(`Revived **${esc(p.name)}** ${mono(`#${p.id}`)} (${via}).`));
}

async function lookup(ctx, query, user) {
  const { bot } = ctx;
  const needle = user ? user.id : String(query || '').trim();
  if (!user && needle.length < 2) return ctx.fail('Search needs at least 2 characters.');
  await ctx.within(bot.xion.refresh());
  const lq = needle.toLowerCase();
  const online = user ? [bot.players.byDiscord(user.id)].filter(Boolean) : bot.players.search(lq, 10);
  const recent = (user ? bot.players.recent.filter((p) => p.ids.discord === user.id) : bot.players.search(lq, 10, true)).slice(0, 5);
  const bans = bot.xion.search(user ? `discord:${user.id}` : lq, 8);
  const warns = [];
  for (const [k, w] of Object.entries(bot.store.warnings)) {
    const hit = user ? w.ids && w.ids.discord === user.id : k.toLowerCase().includes(lq) || (w.name || '').toLowerCase().includes(lq) || Object.values(w.ids || {}).some((v) => String(v).toLowerCase().includes(lq));
    if (hit) warns.push([k, w]);
    if (warns.length >= 5) break;
  }
  const queued = Object.entries(bot.store.queue).filter(([k, q]) => (user ? k === `discord:${user.id}` : k.toLowerCase().includes(lq) || (q.name || '').toLowerCase().includes(lq)));
  const f = [];
  if (online.length) f.push(ui.field(`Online (${online.length})`, S.playerLines(online, false).join('\n')));
  if (recent.length) f.push(ui.field('Recently seen', recent.map((p) => `**${esc(clip(p.name, 32))}** · left ${stamp(p.left)}${p.ids.license ? ` · ${mono(p.ids.license.slice(0, 12))}…` : ''}`).join('\n')));
  if (bans.length) f.push(ui.field(`Bans (${bans.length})`, bans.map((b) => `${mono(`#${b.id}`)} **${esc(clip(b.name || 'Unknown', 28))}** · ${esc(clip(b.reason || 'No reason', 60))}`).join('\n')));
  if (warns.length) f.push(ui.field('Warnings', warns.map(([k, w]) => `**${esc(clip(w.name || k, 32))}** · ${w.list.length} warning(s)`).join('\n')));
  if (queued.length) f.push(ui.field('Queued bans', queued.slice(0, 5).map(([k, q]) => `${mono(k)} · ${esc(clip(q.reason, 60))}`).join('\n')));
  const title = user ? `Lookup · ${user.global_name || user.username}` : `Lookup · "${clip(needle, 60)}"`;
  return ctx.reply({ embeds: [ui.info(f.length ? null : 'Nothing matched this search.', title, f)] });
}

const commands = [
  {
    level: L.support,
    data: { name: 'players', description: 'List online players' },
    run: (ctx) => ctx.reply(playersPage(ctx.bot, 0)),
  },
  {
    level: L.support,
    data: { name: 'player', description: 'Show a live control panel for an online player', options: [S.playerOpt()] },
    auto: (ctx, f, v) => S.autoPlayers(ctx.bot, v),
    run(ctx) {
      const p = S.needPlayer(ctx);
      if (p) return ctx.reply(playerPanel(ctx.bot, p, ctx.level));
    },
  },
  {
    level: L.support,
    data: {
      name: 'lookup',
      description: 'Search online players, recent players, bans, warnings and queued bans',
      options: [
        opt(T.STRING, 'query', 'Name, identifier, ban id or reason', { max_length: 100 }),
        opt(T.USER, 'user', 'Discord member'),
      ],
    },
    run(ctx) {
      const uid = ctx.get('user');
      const user = uid ? ctx.resolvedUser(uid) || { id: uid, username: uid } : null;
      if (!user && !ctx.get('query')) return ctx.fail('Provide a `query` or a `user`.');
      return lookup(ctx, ctx.get('query'), user);
    },
  },
  {
    level: L.support,
    data: { name: 'XionShield Lookup', type: 2 },
    run(ctx) {
      const id = ctx.d.target_id;
      return lookup(ctx, null, ctx.resolvedUser(id) || { id, username: id });
    },
  },
  {
    level: L.moderator,
    data: { name: 'screenshot', description: 'Capture a screenshot of a player screen', options: [S.playerOpt()] },
    auto: (ctx, f, v) => S.autoPlayers(ctx.bot, v),
    run(ctx) {
      const p = S.needPlayer(ctx);
      if (p) return screenshotReply(ctx, p);
    },
  },
  {
    level: L.moderator,
    data: { name: 'revive', description: 'Revive a player (ESX, QBCore or native fallback)', options: [S.playerOpt()] },
    auto: (ctx, f, v) => S.autoPlayers(ctx.bot, v),
    run(ctx) {
      const p = S.needPlayer(ctx);
      if (p) return revive(ctx, p);
    },
  },
  {
    level: L.moderator,
    data: {
      name: 'dm',
      description: 'Send a private in-game message to a player',
      options: [S.playerOpt(), opt(T.STRING, 'message', 'Message', { required: true, max_length: 400 })],
    },
    auto: (ctx, f, v) => S.autoPlayers(ctx.bot, v),
    run(ctx) {
      const p = S.needPlayer(ctx);
      if (!p) return;
      const msg = ctx.get('message');
      ctx.bot.actions.chat(p.id, `${ctx.bot.cfg.chat.dmTitle} · ${ctx.staff}`, msg);
      S.audit(ctx, 'Private message', `To ${esc(p.name)} ${mono(`#${p.id}`)}\n${esc(msg)}`);
      return ctx.reply(ui.ok(`Message delivered to **${esc(p.name)}**.`));
    },
  },
  {
    level: L.moderator,
    data: { name: 'announce', description: 'Broadcast an announcement to every player', options: [opt(T.STRING, 'message', 'Announcement', { required: true, max_length: 500 })] },
    run(ctx) {
      const msg = ctx.get('message');
      ctx.bot.actions.announce(msg, ctx.staff);
      S.audit(ctx, 'Announcement', esc(msg));
      return ctx.reply(ui.ok(`Announcement sent to ${ctx.bot.players.size} player(s).`));
    },
  },
  {
    level: L.admin,
    data: {
      name: 'perms',
      description: 'Manage XionShield bypass permissions of an online player',
      options: [
        sub('set', 'Give or remove one permission', [
          S.playerOpt(),
          opt(T.STRING, 'permission', 'Permission (Category:Permission)', { required: true, autocomplete: true, max_length: 64 }),
          opt(T.BOOL, 'value', 'true = give, false = remove', { required: true }),
        ]),
        sub('category', 'Give or remove every permission of a category', [
          S.playerOpt(),
          opt(T.STRING, 'category', 'Category', { required: true, choices: S.choices(CATEGORIES) }),
          opt(T.BOOL, 'value', 'true = give, false = remove', { required: true }),
        ]),
        sub('all', 'Give or remove every permission', [S.playerOpt(), opt(T.BOOL, 'value', 'true = give, false = remove', { required: true })]),
        sub('sync', 'Re-apply Discord role based permissions', [S.playerOpt()]),
        sub('catalog', 'Show every XionShield permission'),
      ],
    },
    levels: { catalog: L.support },
    auto(ctx, f, v) {
      return f === 'permission' ? S.autoPerms(v) : S.autoPlayers(ctx.bot, v);
    },
    async run(ctx) {
      const { bot } = ctx;
      if (ctx.sub === 'catalog') {
        const fields = CATEGORIES.map((c) => ui.field(`${c} (${CATALOG[c].length})`, CATALOG[c].join(', ')));
        return ctx.reply({ embeds: [ui.info(`${ALL_PERMS.length} permissions. Format for roles and \`/perms set\`: \`Category:Permission\`.`, 'XionShield permissions', fields)] });
      }
      const p = S.needPlayer(ctx);
      if (!p) return;
      if (ctx.sub === 'sync') {
        if (!bot.roleSync.enabled) return ctx.fail('Role sync is disabled in config.json.');
        const r = await ctx.within(bot.roleSync.apply(p.id, true));
        return ctx.reply(ui.ok(r ? `Synced ${r.size} permission(s) for **${esc(p.name)}**.` : `**${esc(p.name)}** has no linked Discord member.`));
      }
      const value = ctx.get('value');
      let label;
      if (ctx.sub === 'set') {
        const raw = ctx.get('permission');
        const r = resolvePerm(raw);
        if (!r) return ctx.fail(`Unknown permission ${mono(raw)}. Use the autocomplete list.`);
        await ctx.within(bot.xion.setPerm(p.id, `${r.cat}:${r.perm}`, value));
        label = `${r.cat}:${r.perm}`;
      } else if (ctx.sub === 'category') {
        const cat = ctx.get('category');
        await ctx.within(bot.xion.setCategory(p.id, cat, value));
        label = `${cat} (${CATALOG[cat].length})`;
      } else {
        await ctx.within(bot.xion.setAll(p.id, value));
        label = 'All permissions';
      }
      const fields = [ui.field('Player', `${esc(p.name)} ${mono(`#${p.id}`)}`, true), ui.field(value ? 'Granted' : 'Removed', mono(label), true)];
      S.audit(ctx, 'Permissions changed', null, { color: value ? COLORS.ok : COLORS.warn, fields });
      return ctx.reply({ embeds: [ui.embed(value ? COLORS.ok : COLORS.warn, null, 'Permissions updated', fields)] });
    },
  },
];

const ACTION_LEVEL = { f: L.support, s: L.moderator, r: L.moderator, k: L.moderator, b: L.admin };

const components = {
  pl: {
    level: L.support,
    name: 'players',
    run: (ctx, [page]) => ctx.update(playersPage(ctx.bot, +page || 0)),
  },
  pa: {
    level: L.support,
    name: 'player',
    async run(ctx, [act, src, st]) {
      const { bot } = ctx;
      const need = ACTION_LEVEL[act];
      if (need === undefined) return ctx.deferUpdate();
      if (ctx.level < need) return ctx.reply(ui.fail('You do not have permission for this action.'));
      const p = bot.players.verify(src, st);
      if (!p) {
        if (act === 'f') return ctx.update({ embeds: [ui.embed(COLORS.muted, 'This player is no longer online.', 'Player panel')], components: [] });
        return ctx.reply(ui.fail('This player is no longer online.'));
      }
      switch (act) {
        case 'f':
          return ctx.update(playerPanel(bot, p, ctx.level));
        case 's':
          return screenshotReply(ctx, p);
        case 'r':
          return revive(ctx, p);
        case 'k':
          return ctx.modal(ui.modal(`xs:mk:${src}:${st}`, `Kick ${p.name}`, [{ id: 'reason', label: 'Reason', long: true, max: 400, min: 2 }]));
        case 'b':
          return ctx.modal(ui.modal(`xs:mb:${src}:${st}`, `Ban ${p.name}`, [{ id: 'reason', label: 'Reason', long: true, max: 400, min: 2 }]));
      }
    },
  },
  mk: {
    level: L.moderator,
    name: 'kick',
    async run(ctx, [src, st]) {
      const p = ctx.bot.players.verify(src, st);
      if (!p) return ctx.fail('This player is no longer online.');
      const reason = ctx.field('reason');
      ctx.bot.actions.kick(p.id, reason, ctx.staff);
      const fields = [ui.field('Player', `${esc(p.name)} ${mono(`#${p.id}`)}`, true), ui.field('Reason', esc(reason))];
      S.audit(ctx, 'Kick', null, { color: COLORS.warn, fields });
      return ctx.reply({ embeds: [ui.embed(COLORS.warn, null, 'Player kicked', fields)] });
    },
  },
  mb: {
    level: L.admin,
    name: 'ban',
    run(ctx, [src, st]) {
      const p = ctx.bot.players.verify(src, st);
      if (!p) return ctx.fail('This player is no longer online. Use `/offlineban add`.');
      return S.executeBan(ctx, p, ctx.field('reason'));
    },
  },
};

module.exports = { commands, components, playerPanel, playersPage };
