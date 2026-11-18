'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  token: '',
  guildId: '',
  xionshieldResource: 'auto',
  debug: false,
  permissions: { owners: [], roles: { admin: [], moderator: [], support: [] }, commandLevels: {} },
  replies: { ephemeral: true },
  channels: { actions: '', bans: '', joins: '', console: '', status: '' },
  presence: { enabled: true, text: '{online}/{max} players', emptyText: 'an empty server', type: 3 },
  statusPanel: { enabled: false, intervalSeconds: 60, showPlayers: true },
  ban: { xionLogs: true, screenshotEvidence: true, screenshotTimeout: 8, dmPlayer: false, appealUrl: '' },
  banFeed: { enabled: true, watchFile: true, pollSeconds: 45 },
  joinLogs: { enabled: true },
  consoleFeed: { enabled: false, include: '', exclude: '', flushSeconds: 3 },
  roleSync: { enabled: false, mode: 'exports', live: false, applyDelaySeconds: 4, acePrefix: 'XionShield', roles: {} },
  guard: {
    enabled: false,
    requireDiscord: true,
    requireGuild: false,
    requiredRoles: [],
    bypassRoles: [],
    failOpen: true,
    kickOnGuildLeave: false,
  },
  warnings: { notifyPlayer: true, kickAt: 0, banAt: 0 },
  screenshot: { resource: 'screenshot-basic', quality: 0.85 },
  revive: { event: '' },
  chat: { event: '', announceTitle: 'ANNOUNCEMENT', dmTitle: 'STAFF', color: [99, 102, 241] },
  console: { enabled: false },
  privacy: { showIp: false },
  branding: { footer: 'XionShield Bot', color: '#6366f1' },
  messages: {
    kick: 'You were kicked from the server.\nReason: {reason}\nStaff: {staff}',
    banReason: '{reason}',
    maintenance: 'The server is under maintenance. {reason}',
    noDiscord: 'Discord must be running and linked to FiveM to join this server.',
    notInGuild: 'You must join our Discord server to play: {invite}',
    missingRole: 'You do not have the required Discord role to join this server.',
    checking: 'Verifying your Discord account...',
    unavailable: 'Discord verification is temporarily unavailable, please try again shortly.',
    invite: 'discord.gg/yourserver',
    warn: 'You received a warning from {staff}: {reason} ({count} total)',
    banDm: 'You have been banned from **{server}**.\nReason: {reason}\nBan ID: {banId}\n{appeal}',
  },
  commands: { disabled: [] },
};

function merge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  if (over && typeof over === 'object' && !Array.isArray(over)) {
    for (const k of Object.keys(over)) {
      out[k] = k in base && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && k !== 'roles' && k !== 'commandLevels'
        ? merge(base[k], over[k])
        : over[k];
    }
  }
  return out;
}

function quoteIds(text) {
  let out = '';
  let quoted = 0;
  for (let i = 0, n = text.length; i < n; ) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c >= '0' && c <= '9') {
      let j = i;
      while (j < n && text[j] >= '0' && text[j] <= '9') j++;
      const tok = text.slice(i, j);
      const prev = out.trimEnd().slice(-1);
      if (tok.length >= 16 && (prev === ':' || prev === '[' || prev === ',') && !/[.eE]/.test(text[j] || '')) {
        out += `"${tok}"`;
        quoted++;
      } else out += tok;
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return { text: out, quoted };
}

function loadConfig(root, log) {
  const file = path.join(root, 'config.json');
  let raw;
  try {
    const q = quoteIds(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    raw = JSON.parse(q.text);
    if (q.quoted) log.info(`config.json: read ${q.quoted} unquoted Discord id(s) as text`);
  } catch (e) {
    log.error(`config.json is missing or invalid: ${e.message}`);
    return null;
  }
  const cfg = merge(DEFAULTS, raw);
  cfg.permissions.roles = { ...DEFAULTS.permissions.roles, ...(raw.permissions && raw.permissions.roles) };
  if (!cfg.token || cfg.token.length < 50) {
    log.error('Set a valid bot "token" in config.json');
    return null;
  }
  if (!/^\d{16,21}$/.test(cfg.guildId)) {
    log.error('Set your Discord server id as "guildId" in config.json');
    return null;
  }
  const list = (where, v) =>
    (Array.isArray(v) ? v : v ? [v] : []).map(String).filter((x) => {
      if (/^\d{16,21}$/.test(x)) return true;
      log.warn(`config.json ${where}: "${x}" is not a Discord id, ignored`);
      return false;
    });
  cfg.permissions.owners = list('permissions.owners', cfg.permissions.owners);
  for (const k of Object.keys(cfg.permissions.roles)) cfg.permissions.roles[k] = list(`permissions.roles.${k}`, cfg.permissions.roles[k]);
  for (const k of Object.keys(cfg.channels)) cfg.channels[k] = list(`channels.${k}`, cfg.channels[k])[0] || '';
  cfg.guard.requiredRoles = list('guard.requiredRoles', cfg.guard.requiredRoles);
  cfg.guard.bypassRoles = list('guard.bypassRoles', cfg.guard.bypassRoles);
  const c = cfg.branding.color;
  cfg.branding.colorInt = typeof c === 'number' ? c : parseInt(String(c).replace('#', ''), 16) || 0x6366f1;
  return cfg;
}

module.exports = { loadConfig };
