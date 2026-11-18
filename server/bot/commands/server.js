'use strict';
const { COLORS, LEVELS, clip, esc, mono, safeCmd } = require('../../lib/util');
const { LOG_TYPES, DELETE_TYPES, MODULES } = require('../../game/xion');
const { capture } = require('../../game/console');
const ui = require('../ui');
const S = require('../shared');

const { T, L, opt, sub } = S;
const RES_RE = /^[\w.\-[\]@]{1,64}$/;

function outputEmbed(title, cmd, out) {
  const body = out === null ? 'Executed. (Console capture is not supported by this server build.)' : out ? `\`\`\`\n${clip(out.replace(/```/g, 'ˋˋˋ'), 3900)}\n\`\`\`` : 'Executed with no console output.';
  return { embeds: [ui.info(body, title, [ui.field('Command', mono(cmd))])] };
}

async function exec(ctx, cmd, title, ms = 1500) {
  await ctx.defer();
  const out = await capture(cmd, ms);
  S.audit(ctx, title, mono(cmd));
  return ctx.edit(outputEmbed(title, cmd, out));
}

const commands = [
  {
    level: L.support,
    data: { name: 'status', description: 'Server, XionShield and bot status' },
    run: (ctx) => ctx.reply({ embeds: [S.statusEmbed(ctx.bot)] }),
  },
  {
    level: L.admin,
    data: {
      name: 'xion',
      description: 'Run XionShield server commands',
      options: [
        sub('version', 'Show the installed XionShield version'),
        sub('cleanup', 'Delete entities around the map', [opt(T.STRING, 'type', 'What to delete', { required: true, choices: S.choices(DELETE_TYPES) })]),
        sub('logs', 'Toggle XionShield event logs', [
          opt(T.STRING, 'type', 'Log type', { required: true, choices: S.choices(LOG_TYPES) }),
          opt(T.BOOL, 'enabled', 'On or off', { required: true }),
        ]),
        sub('module', 'Install or uninstall a protection module', [
          opt(T.STRING, 'name', 'Module', { required: true, choices: S.choices(MODULES) }),
          opt(T.STRING, 'action', 'Action', { required: true, choices: S.choices(['install', 'uninstall']) }),
          opt(T.STRING, 'resource', 'Only this resource (empty = all resources)', { autocomplete: true, max_length: 64 }),
        ]),
      ],
    },
    levels: { version: L.support, module: L.owner },
    auto: (ctx, f, v) => S.autoResources(v),
    async run(ctx) {
      const x = ctx.bot.xion;
      if (!x.started) return ctx.fail(`XionShield (${mono(x.name)}) is not running.`);
      switch (ctx.sub) {
        case 'version':
          return exec(ctx, 'xion version', `XionShield v${x.version}`, 1000);
        case 'cleanup':
          return exec(ctx, `xion delete ${ctx.get('type')}`, 'Entity cleanup');
        case 'logs':
          return exec(ctx, `xion logs ${ctx.get('type')} ${ctx.get('enabled') ? 'on' : 'off'}`, 'XionShield logs');
        case 'module': {
          const r = ctx.get('resource');
          if (r && !RES_RE.test(r)) return ctx.fail('Invalid resource name.');
          return exec(ctx, `xion ${ctx.get('name')} ${ctx.get('action')}${r ? ` ${r}` : ''}`, 'XionShield module', 6000);
        }
      }
    },
  },
  {
    level: L.admin,
    data: {
      name: 'maintenance',
      description: 'Lock the server to staff only',
      options: [
        opt(T.BOOL, 'enabled', 'Turn maintenance on or off', { required: true }),
        opt(T.STRING, 'reason', 'Shown to players trying to join', { max_length: 200 }),
        opt(T.BOOL, 'kick', 'Kick online non-staff players now'),
      ],
    },
    async run(ctx) {
      const { bot } = ctx;
      const on = ctx.get('enabled');
      const reason = ctx.get('reason', '');
      bot.store.meta.maintenance = on ? { on: true, reason, by: ctx.staff, at: Date.now() } : { on: false };
      bot.store.save();
      let kicked = 0;
      if (on && ctx.get('kick')) {
        await ctx.defer();
        kicked = await bot.guard.kickNonStaff(reason);
      }
      const d = on ? `Only staff can join now.${reason ? `\nReason: ${esc(reason)}` : ''}${kicked ? `\nKicked ${kicked} player(s).` : ''}` : 'Everyone can join again.';
      S.audit(ctx, `Maintenance ${on ? 'enabled' : 'disabled'}`, d, { color: on ? COLORS.warn : COLORS.ok });
      return ctx.reply({ embeds: [ui.embed(on ? COLORS.warn : COLORS.ok, d, `Maintenance ${on ? 'enabled' : 'disabled'}`)] });
    },
  },
  {
    level: L.owner,
    data: {
      name: 'resource',
      description: 'Start, stop, restart or ensure a server resource',
      options: [
        opt(T.STRING, 'action', 'Action', { required: true, choices: S.choices(['start', 'stop', 'restart', 'ensure', 'refresh']) }),
        opt(T.STRING, 'name', 'Resource name', { autocomplete: true, max_length: 64 }),
      ],
    },
    auto: (ctx, f, v) => S.autoResources(v),
    run(ctx) {
      const action = ctx.get('action');
      if (action === 'refresh') return exec(ctx, 'refresh', 'Resources refreshed', 2500);
      const name = ctx.get('name');
      if (!name || !RES_RE.test(name)) return ctx.fail('Provide a valid resource name.');
      const self = GetCurrentResourceName();
      if ((name === self || name === ctx.bot.xion.name) && action !== 'start' && action !== 'ensure') return ctx.fail(`For safety, ${mono(name)} can only be stopped or restarted from the server console.`);
      if (GetResourceState(name) === 'missing') return ctx.fail(`Resource ${mono(name)} does not exist. Try \`/resource refresh\`.`);
      return exec(ctx, `${action} ${name}`, `Resource ${action}`, 2000);
    },
  },
  {
    level: L.owner,
    enabled: (cfg) => cfg.console.enabled,
    data: { name: 'console', description: 'Execute a raw server console command', options: [opt(T.STRING, 'command', 'Command', { required: true, max_length: 300 })] },
    run(ctx) {
      const cmd = safeCmd(ctx.get('command'));
      if (!cmd) return ctx.fail('Empty command.');
      return exec(ctx, cmd, 'Console', 2000);
    },
  },
  {
    level: L.everyone,
    data: { name: 'help', description: 'Show the commands you can use' },
    run(ctx) {
      const { router } = ctx.bot;
      const groups = {};
      for (const c of router.commands.values()) {
        if (c.data.type === 2) continue;
        const lvl = router.levelFor(c.data.name, null, c.level);
        const subs = (c.data.options || []).filter((o) => o.type === 1);
        const lines = subs.length
          ? subs.filter((s) => router.levelFor(c.data.name, s.name, (c.levels && c.levels[s.name]) ?? c.level) <= ctx.level).map((s) => `\`/${c.data.name} ${s.name}\` ${s.description}`)
          : lvl <= ctx.level
            ? [`\`/${c.data.name}\` ${c.data.description}`]
            : [];
        if (!lines.length) continue;
        (groups[LEVELS[lvl]] = groups[LEVELS[lvl]] || []).push(...lines);
      }
      const fields = LEVELS.filter((l) => groups[l]).map((l) => ui.field(l[0].toUpperCase() + l.slice(1), groups[l].join('\n')));
      const desc = `Your access level: **${LEVELS[ctx.level]}**\nRight-click a member → Apps → **XionShield Lookup** for a quick profile.`;
      return ctx.reply({ embeds: [ui.info(desc, 'XionShield Bot', fields)], ephemeral: true });
    },
  },
];

module.exports = { commands, components: {} };
