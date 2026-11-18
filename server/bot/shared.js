'use strict';
const { COLORS, clip, esc, mono, tpl, stamp, duration, bytes, strip } = require('../lib/util');
const { ALL_PERMS } = require('../game/xion');
const ui = require('./ui');

const T = { SUB: 1, GROUP: 2, STRING: 3, INT: 4, BOOL: 5, USER: 6 };
const L = { everyone: 0, support: 1, moderator: 2, admin: 3, owner: 4 };

const opt = (type, name, description, extra) => ({ type, name, description, ...extra });
const sub = (name, description, options = []) => ({ type: T.SUB, name, description, options });
const playerOpt = (required = true) => opt(T.INT, 'player', 'Online player (type a name or server id)', { required, autocomplete: true, min_value: 1 });
const reasonOpt = (required = true, max = 400) => opt(T.STRING, 'reason', 'Reason', { required, max_length: max });
const choices = (list) => list.map((v) => ({ name: v, value: v }));

function needPlayer(ctx, name = 'player') {
  const id = ctx.get(name);
  const p = ctx.bot.players.get(id);
  if (!p) {
    ctx.fail(`No online player with server id ${mono(id)}.`).catch(() => {});
    return null;
  }
  return p;
}

function autoPlayers(bot, q) {
  return bot.players.search(q, 25).map((p) => ({ name: clip(`#${p.id} · ${p.name}`, 100), value: p.id }));
}

function autoBans(bot, q) {
  return bot.xion.search(q, 25).map((b) => ({
    name: clip(`#${b.id} · ${b.name || 'Unknown'}${b.reason ? ` · ${b.reason}` : ''}`, 100),
    value: clip(b.id, 100),
  }));
}

function autoIdentifiers(bot, q) {
  const out = [];
  const seen = new Set();
  const push = (p, tag) => {
    const t = p.ids.license ? 'license' : p.ids.discord ? 'discord' : p.ids.steam ? 'steam' : p.ids.fivem ? 'fivem' : null;
    if (!t) return;
    const v = `${t}:${p.ids[t]}`;
    if (seen.has(v)) return;
    seen.add(v);
    out.push({ name: clip(`${p.name} (${tag}) · ${v}`, 100), value: v });
  };
  for (const p of bot.players.search(q, 10)) push(p, `#${p.id}`);
  for (const p of bot.players.search(q, 25, true)) {
    if (out.length >= 25) break;
    push(p, `left ${duration(Date.now() - p.left)} ago`);
  }
  if (out.length < 25 && /^[a-z0-9]+:\S+$/i.test(q) && !seen.has(q)) out.unshift({ name: clip(q, 100), value: clip(q, 100) });
  return out.slice(0, 25);
}

function autoPerms(q) {
  q = q.toLowerCase();
  const out = [];
  for (const p of ALL_PERMS) {
    if (q && !p.toLowerCase().includes(q)) continue;
    out.push({ name: p, value: p });
    if (out.length >= 25) break;
  }
  return out;
}

let resCache = null;
let resAt = 0;
function autoResources(q) {
  if (!resCache || Date.now() - resAt > 30000) {
    resCache = [];
    const n = GetNumResources();
    for (let i = 0; i < n; i++) {
      const r = GetResourceByFindIndex(i);
      if (r && r !== '_cfx_internal') resCache.push(r);
    }
    resCache.sort();
    resAt = Date.now();
  }
  q = q.toLowerCase();
  const out = [];
  for (const r of resCache) {
    if (q && !r.toLowerCase().includes(q)) continue;
    out.push({ name: `${r} (${GetResourceState(r)})`, value: r });
    if (out.length >= 25) break;
  }
  return out;
}

function primaryKey(p) {
  if (p.ids.license) return `license:${p.ids.license}`;
  if (p.ids.discord) return `discord:${p.ids.discord}`;
  return p.all[0] || `player:${p.name}`;
}

function avatar(u) {
  if (u.avatar) return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`;
  return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u.id) >> 22n) % 6n)}.png`;
}

function audit(ctx, title, description, { color = null, image = null, fields } = {}) {
  const log = ctx.bot.logs.actions;
  if (!log.enabled) return;
  const e = ui.embed(color, description, title, fields);
  e.author = { name: `${ctx.staff} · ${ctx.user.id}`, icon_url: avatar(ctx.user) };
  if (image) e.image = { url: 'attachment://evidence.jpg' };
  log.push(e, image ? [{ name: 'evidence.jpg', data: image, type: 'image/jpeg' }] : null);
}

async function executeBan(ctx, p, reason, o = {}) {
  const { bot } = ctx;
  const c = bot.cfg.ban;
  await ctx.defer();
  let shot = null;
  const wantShot = o.evidence !== undefined ? o.evidence : c.screenshotEvidence;
  if (wantShot && bot.actions.shotsAvailable) shot = await bot.actions.screenshot(p.id, c.screenshotTimeout).catch(() => null);
  if (!bot.players.get(p.id)) return ctx.fail(`${esc(p.name)} left before the ban was applied. Use \`/offlineban add\` with their identifier.`);
  await bot.xion.refresh();
  const before = new Set(bot.xion.byId.keys());
  const logs = o.logs !== undefined ? o.logs : c.xionLogs;
  const res = await bot.xion.ban(p.id, tpl(bot.cfg.messages.banReason, { reason, staff: ctx.staff }), logs);
  if (!res.ok) return ctx.fail('XionShield rejected the ban request.');
  const ban = (res.id && bot.xion.byId.get(res.id)) || (await bot.xion.findNewBan(before, p));
  const banId = res.id || (ban && ban.id) || null;
  const fields = [
    ui.field('Player', `${esc(p.name)} ${mono(`#${p.id}`)}`, true),
    ui.field('Ban ID', banId ? mono(banId) : 'Not reported yet', true),
    ui.field('XionShield history', logs ? 'Saved' : 'Skipped', true),
    ui.field('Reason', esc(reason)),
  ];
  if (p.ids.license) fields.push(ui.field('License', mono(p.ids.license)));
  const e = ui.embed(COLORS.err, null, 'Player banned', fields);
  const files = shot ? [{ name: 'evidence.jpg', data: shot, type: 'image/jpeg' }] : undefined;
  if (shot) e.image = { url: 'attachment://evidence.jpg' };
  await ctx.edit({ embeds: [e], files });
  audit(ctx, 'Ban', null, { color: COLORS.err, image: shot, fields });
  if (c.dmPlayer && p.ids.discord) {
    bot.dm(p.ids.discord, tpl(bot.cfg.messages.banDm, {
      server: bot.serverName(),
      reason,
      banId: banId || 'unknown',
      appeal: c.appealUrl ? `Appeal: ${c.appealUrl}` : '',
    }));
  }
}

async function executeUnban(ctx, id, note) {
  const { bot } = ctx;
  id = String(id || '').trim();
  const known = bot.xion.byId.get(id);
  const r = await ctx.within(bot.xion.unban(id));
  if (!r.ok) return ctx.fail(`Could not unban ${mono(id)}: ${esc(r.err || 'ban not found')}`);
  const fields = [ui.field('Ban ID', mono(id), true)];
  if (known && known.name) fields.push(ui.field('Player', esc(known.name), true));
  if (known && known.reason) fields.push(ui.field('Original reason', esc(known.reason)));
  if (note) fields.push(ui.field('Note', esc(note)));
  await ctx.reply({ embeds: [ui.embed(COLORS.ok, null, 'Ban removed', fields)] });
  audit(ctx, 'Unban', null, { color: COLORS.ok, fields });
}

function statusEmbed(bot) {
  const online = bot.players.size;
  const max = GetConvarInt('sv_maxclients', 48);
  const st = bot.xion.stats();
  const mem = process.memoryUsage();
  const m = bot.store.meta.maintenance;
  const fields = [
    ui.field('Players', `${online} / ${max}`, true),
    ui.field('Online since', stamp(bot.bootAt, 'R'), true),
    ui.field('XionShield', `${bot.xion.started ? '🟢' : '🔴'} ${bot.xion.state} · v${bot.xion.version}`, true),
    ui.field('Bans', `${st.total} total · ${st.today} in 24h`, true),
    ui.field('Maintenance', m && m.on ? `On since ${stamp(m.at)}` : 'Off', true),
    ui.field('Gateway', `${bot.gateway.ping >= 0 ? `${bot.gateway.ping} ms` : '—'}`, true),
    ui.field('JS heap', `${bytes(mem.heapUsed)} / ${bytes(mem.heapTotal)}`, true),
    ui.field('Process RSS', bytes(mem.rss), true),
    ui.field('Queued bans', String(Object.keys(bot.store.queue).length), true),
  ];
  return ui.embed(null, null, bot.serverName(), fields);
}

function playerLines(list, withMeta) {
  return list.map((p) => {
    const parts = [`${mono(`#${p.id}`)} **${esc(clip(p.name, 32))}**`];
    if (withMeta) parts.push(`${GetPlayerPing(String(p.id))}ms`, duration(Date.now() - p.joined));
    if (p.ids.discord) parts.push(`<@${p.ids.discord}>`);
    return parts.join(' · ');
  });
}

module.exports = {
  T,
  L,
  opt,
  sub,
  playerOpt,
  reasonOpt,
  choices,
  needPlayer,
  autoPlayers,
  autoBans,
  autoIdentifiers,
  autoPerms,
  autoResources,
  primaryKey,
  avatar,
  audit,
  executeBan,
  executeUnban,
  statusEmbed,
  playerLines,
  strip,
};
