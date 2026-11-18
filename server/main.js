'use strict';
const path = require('path');

const RES = GetCurrentResourceName();
const ROOT = path.resolve(GetResourcePath(RES));
const SRC = path.join(ROOT, 'server') + path.sep;
const win = process.platform === 'win32';
if (require.cache) for (const k of Object.keys(require.cache)) if (win ? k.toLowerCase().startsWith(SRC.toLowerCase()) : k.startsWith(SRC)) delete require.cache[k];
const load = (p) => require(path.join(ROOT, 'server', p));

const { loadConfig } = load('lib/config.js');
const { Store } = load('lib/store.js');
const { Rest } = load('lib/rest.js');
const { Gateway } = load('lib/gateway.js');
const U = load('lib/util.js');
const { Players } = load('game/players.js');
const { Xion } = load('game/xion.js');
const { Actions } = load('game/actions.js');
const con = load('game/console.js');
const { EmbedLog, TextLog } = load('features/logger.js');
const { RoleSync, Members } = load('features/rolesync.js');
const { Guard } = load('features/guard.js');
const { Status } = load('features/status.js');
const { Router } = load('bot/router.js');
const ui = load('bot/ui.js');

const TAG = '^5[XionShield Bot]^7 ';
const log = {
  info: (m) => console.log(`${TAG}${m}`),
  warn: (m) => console.log(`${TAG}^3${m}^7`),
  error: (m) => console.log(`${TAG}^1${m}^7`),
  debug: () => {},
};
const INVITE_PERMS = 117760;

function boot() {
  const cfg = loadConfig(ROOT, log);
  if (!cfg) return;
  if (cfg.debug) log.debug = (m) => console.log(`${TAG}^8${m}^7`);
  ui.brand(cfg);

  const rest = new Rest(cfg.token, log);
  const store = new Store(path.join(ROOT, 'data', 'db.json'), log);
  const players = new Players();
  const xion = new Xion(cfg, log);
  const live = (cfg.roleSync.enabled && cfg.roleSync.live) || cfg.guard.kickOnGuildLeave;
  const gateway = new Gateway({ token: cfg.token, intents: live ? 2 : 0, log });

  const owners = new Set(cfg.permissions.owners || []);
  const roleLevel = new Map();
  for (const [name, ids] of Object.entries(cfg.permissions.roles)) {
    const n = U.LEVELS.indexOf(name);
    if (n > 0) for (const id of ids || []) if ((roleLevel.get(id) || 0) < n) roleLevel.set(id, n);
  }

  const bot = {
    cfg,
    log,
    rest,
    store,
    players,
    xion,
    gateway,
    appId: null,
    user: null,
    bootAt: Date.now() - process.uptime() * 1000,
    actions: new Actions(cfg, log),
    logs: {
      actions: new EmbedLog(rest, cfg.channels.actions, log),
      bans: new EmbedLog(rest, cfg.banFeed.enabled ? cfg.channels.bans : '', log),
      joins: new EmbedLog(rest, cfg.joinLogs.enabled ? cfg.channels.joins : '', log, 3000),
    },
    levelOf(uid, roles) {
      if (owners.has(uid)) return 4;
      let l = 0;
      for (const r of roles) {
        const v = roleLevel.get(r);
        if (v > l) l = v;
      }
      return l;
    },
    serverName() {
      return U.strip(GetConvar('sv_projectName', '') || GetConvar('sv_hostname', '')).trim() || 'FiveM Server';
    },
    dm(uid, content) {
      return rest
        .post('/users/@me/channels', { recipient_id: uid })
        .then((c) => rest.post(`/channels/${c.id}/messages`, { content: U.clip(content, 2000) }))
        .catch((e) => log.debug(`DM to ${uid} failed: ${e.message}`));
    },
  };
  bot.members = new Members(bot);
  bot.roleSync = new RoleSync(bot);
  bot.guard = new Guard(bot);
  bot.status = new Status(bot);
  bot.router = new Router(bot);
  for (const m of ['moderation', 'players', 'server']) bot.router.add(load(`bot/commands/${m}.js`));

  const cleanups = [];
  const max = () => GetConvarInt('sv_maxclients', 48);

  xion.on('added', (list) => {
    const l = bot.logs.bans;
    if (!l.enabled) return;
    if (list.length > 15) return l.push(ui.embed(U.COLORS.err, `${list.length} new bans were detected at once.`, 'Bulk ban import'));
    for (const b of list) l.push(ui.banEmbed(b, `New ban · #${b.id}`, U.COLORS.err));
  });
  xion.on('removed', (list) => {
    const l = bot.logs.bans;
    if (!l.enabled) return;
    if (list.length > 15) return l.push(ui.embed(U.COLORS.ok, `${list.length} bans were removed at once.`, 'Bulk unban'));
    for (const b of list) {
      l.push(ui.embed(U.COLORS.ok, `${b.name ? `**${U.esc(b.name)}** · ` : ''}${U.esc(U.clip(b.reason || 'No reason', 300))}`, `Ban removed · #${b.id}`));
    }
  });

  function applyQueue(p) {
    const q = store.queue;
    let key = null;
    for (const id of p.all) {
      const k = id.toLowerCase();
      if (q[k]) {
        key = k;
        break;
      }
    }
    if (!key) return;
    const entry = q[key];
    const st = players.stampOf(p);
    setTimeout(async () => {
      if (!players.verify(p.id, st)) return;
      const r = await xion.ban(p.id, U.tpl(cfg.messages.banReason, { reason: entry.reason, staff: entry.by }), cfg.ban.xionLogs).catch(() => null);
      if (!r || !r.ok) return log.warn(`Queued ban for ${key} could not be applied`);
      delete q[key];
      store.save();
      bot.logs.actions.push(
        ui.embed(U.COLORS.err, null, 'Queued ban applied', [
          ui.field('Player', `${U.esc(p.name)} ${U.mono(`#${p.id}`)}`, true),
          ui.field('Queued by', U.esc(entry.by), true),
          ui.field('Identifier', U.mono(key)),
          ui.field('Reason', U.esc(entry.reason)),
        ])
      );
    }, 3000);
  }

  function onJoin(src) {
    const p = players.add(src);
    if (bot.logs.joins.enabled) {
      bot.logs.joins.push(
        ui.embed(U.COLORS.ok, null, `Joined · ${U.clip(p.name, 200)}`, [
          ui.field('Server ID', U.mono(p.id), true),
          ui.field('Online', `${players.size}/${max()}`, true),
          ui.field('Identifiers', U.identifierLines(p.ids, cfg.privacy.showIp)),
        ])
      );
    }
    applyQueue(p);
    bot.roleSync.schedule(p.id);
    bot.status.presence();
  }

  on('playerJoining', () => onJoin(global.source));

  on('playerDropped', (reason) => {
    const src = +global.source;
    bot.roleSync.forget(src);
    const p = players.remove(src, reason);
    bot.status.presence();
    if (!p || !bot.logs.joins.enabled) return;
    const f = [
      ui.field('Server ID', U.mono(p.id), true),
      ui.field('Session', U.duration(p.left - p.joined), true),
      ui.field('Online', `${players.size}/${max()}`, true),
      ui.field('Reason', U.esc(U.clip(reason || 'Unknown', 300))),
    ];
    if (p.ids.discord || p.ids.license) f.push(ui.field('Account', `${p.ids.discord ? `<@${p.ids.discord}> ` : ''}${p.ids.license ? U.mono(p.ids.license) : ''}`));
    bot.logs.joins.push(ui.embed(U.COLORS.muted, null, `Left · ${U.clip(p.name, 200)}`, f));
  });

  onNet('xionshield-bot:spawned', () => bot.roleSync.onSpawn(+global.source));

  on('onResourceStart', (name) => {
    if (name === xion.name) setTimeout(() => xion.refresh(true), 3000);
  });

  bot.guard.install();

  if (cfg.consoleFeed.enabled && cfg.channels.console) {
    const feed = new TextLog(rest, cfg.channels.console, log, Math.max(1, cfg.consoleFeed.flushSeconds) * 1000);
    const want = `script:${xion.name}`.toLowerCase();
    const inc = cfg.consoleFeed.include ? new RegExp(cfg.consoleFeed.include, 'i') : null;
    const exc = cfg.consoleFeed.exclude ? new RegExp(cfg.consoleFeed.exclude, 'i') : null;
    cleanups.push(
      con.listen((channel, msg) => {
        if (String(channel).toLowerCase() !== want) return;
        const line = U.strip(msg).trimEnd();
        if (!line || (inc && !inc.test(line)) || (exc && exc.test(line))) return;
        feed.push(line);
      })
    );
    if (!con.ensure()) log.warn('Console feed needs a newer FXServer build (RegisterConsoleListener is missing).');
  }

  let ready = false;
  async function registerCommands() {
    const defs = bot.router.definitions();
    const hash = `${bot.router.hash()}:${cfg.guildId}:${bot.appId}`;
    if (store.meta.cmdHash === hash) return log.debug('Slash commands are up to date');
    await rest.put(`/applications/${bot.appId}/guilds/${cfg.guildId}/commands`, defs);
    store.meta.cmdHash = hash;
    store.save();
    log.info(`Registered ${defs.length} commands in guild ${cfg.guildId}`);
  }

  async function onReady(d) {
    bot.appId = d.application.id;
    bot.user = d.user;
    log.info(`Connected as ^2${d.user.username}^7 · ${players.size} player(s) online · XionShield: ${xion.name} (${xion.state})`);
    const invite = `https://discord.com/oauth2/authorize?client_id=${bot.appId}&scope=bot+applications.commands&permissions=${INVITE_PERMS}`;
    if (!(d.guilds || []).some((g) => g.id === cfg.guildId)) log.warn(`The bot is not in guild ${cfg.guildId}. Invite it: ${invite}`);
    try {
      await registerCommands();
    } catch (e) {
      log.error(`Command registration failed: ${e.message}${e.code === 50001 ? ` · Re-invite with: ${invite}` : ''}`);
    }
    if (ready) return;
    ready = true;
    bot.status.start();
    validateIds().catch((e) => log.warn(`Could not verify config ids: ${e.message}`));
  }

  async function validateIds() {
    const g = cfg.guildId;
    const [roles, chans] = await Promise.all([rest.get(`/guilds/${g}/roles`), rest.get(`/guilds/${g}/channels`)]);
    const R = new Set(roles.map((r) => r.id));
    const C = new Set(chans.map((c) => c.id));
    const kind = (id) => (R.has(id) ? 'a role id' : C.has(id) ? 'a channel id' : id === g ? 'the server id' : 'not found in this server');
    const out = [];
    const roleList = (where, ids) => {
      for (const id of ids) if (!R.has(id)) out.push(`${where}: ${id} is ${kind(id)}, expected a role id`);
    };
    for (const id of cfg.permissions.owners) if (R.has(id) || C.has(id)) out.push(`permissions.owners: ${id} is ${kind(id)}, expected your user id`);
    for (const [k, ids] of Object.entries(cfg.permissions.roles)) roleList(`permissions.roles.${k}`, ids);
    for (const [k, id] of Object.entries(cfg.channels)) if (id && !C.has(id)) out.push(`channels.${k}: ${id} is ${kind(id)}, expected a channel id`);
    if (cfg.guard.enabled) {
      roleList('guard.requiredRoles', cfg.guard.requiredRoles);
      roleList('guard.bypassRoles', cfg.guard.bypassRoles);
    }
    if (bot.roleSync.enabled) roleList('roleSync.roles', Object.keys(cfg.roleSync.roles));
    for (const w of out) log.warn(`config.json ${w}`);
    bot.guard.prune(R);
    if (!out.length) log.debug('All config ids verified');
  }

  gateway.on('dispatch', (t, d) => {
    if (t === 'INTERACTION_CREATE') bot.router.handle(d);
    else if (t === 'READY') onReady(d).catch((e) => log.error(e.stack || e.message));
    else if (t === 'GUILD_MEMBER_UPDATE') bot.roleSync.onMemberUpdate(d);
    else if (t === 'GUILD_MEMBER_REMOVE') bot.roleSync.onMemberRemove(d);
  });
  gateway.on('fatal', (code) => {
    const why = { 4004: 'the bot token is invalid', 4013: 'invalid intents', 4014: 'disallowed intents' }[code] || `close code ${code}`;
    log.error(`Discord connection stopped: ${why}`);
  });

  players.scan();
  for (const p of players.map.values()) bot.roleSync.schedule(p.id);
  xion.refresh(true).then(() => log.debug(`Loaded ${xion.bans.length} bans`));
  if (cfg.banFeed.enabled) xion.watch(cfg.banFeed);
  else xion.watch({ watchFile: false, pollSeconds: 300 });

  rest.get('/gateway/bot').then(
    (g) => {
      const l = g.session_start_limit;
      if (l && l.remaining < 10) log.warn(`Only ${l.remaining} Discord logins left until ${new Date(Date.now() + l.reset_after).toISOString()}`);
      gateway.start(g.url);
    },
    (e) => {
      if (e.status === 401) return log.error('Discord rejected the bot token (401). Check "token" in config.json.');
      log.warn(`Could not query the gateway (${e.message}), using the default endpoint`);
      gateway.start();
    }
  );

  on('onResourceStop', (name) => {
    if (name !== RES) return;
    gateway.destroy();
    bot.status.stop();
    xion.unwatch();
    for (const off of cleanups) off();
    for (const l of Object.values(bot.logs)) l.flush();
    store.flushSync();
    setTimeout(() => rest.destroy(), 1500);
  });
}

try {
  boot();
} catch (e) {
  log.error(`Startup failed: ${e.stack || e.message}`);
}
