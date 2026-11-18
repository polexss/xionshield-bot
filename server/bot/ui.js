'use strict';
const { COLORS, clip, esc, mono, stamp, duration, identifierLines } = require('../lib/util');

let FOOTER = { text: 'XionShield' };
let BRAND = COLORS.brand;

function brand(cfg) {
  FOOTER = { text: cfg.branding.footer };
  BRAND = cfg.branding.colorInt;
}

function embed(color, description, title, fields) {
  const e = { color: color === null ? BRAND : color, footer: FOOTER, timestamp: new Date().toISOString() };
  if (title) e.title = clip(title, 256);
  if (description) e.description = clip(description, 4096);
  if (fields && fields.length) e.fields = fields.slice(0, 25);
  return e;
}

const info = (d, t, f) => embed(null, d, t, f);
const ok = (d, t) => ({ embeds: [embed(COLORS.ok, d, t)] });
const fail = (d) => ({ embeds: [embed(COLORS.err, `**✖** ${d}`)], ephemeral: true });
const warn = (d) => ({ embeds: [embed(COLORS.warn, d)] });
const field = (name, value, inline = false) => ({ name: clip(name, 256), value: clip(value || '—', 1024), inline });

const button = (custom_id, label, style = 2, disabled = false, emoji) => {
  const b = { type: 2, style, custom_id, label, disabled };
  if (emoji) b.emoji = { name: emoji };
  return b;
};
const row = (...components) => ({ type: 1, components });

function pager(prefix, page, pages, suffix = '') {
  const s = suffix ? `:${suffix}` : '';
  return row(
    button(`xs:${prefix}:${page - 1}${s}`, '◀', 2, page <= 0),
    button(`xs:nop:${prefix}`, `${page + 1} / ${pages}`, 2, true),
    button(`xs:${prefix}:${page + 1}${s}`, '▶', 2, page >= pages - 1),
    button(`xs:${prefix}:${page}${s}:r`, '↻', 2, false)
  );
}

function modal(custom_id, title, inputs) {
  return {
    custom_id,
    title: clip(title, 45),
    components: inputs.map((i) => row({ type: 4, custom_id: i.id, label: i.label, style: i.long ? 2 : 1, required: i.required !== false, max_length: i.max || 400, min_length: i.min || 0, placeholder: i.placeholder, value: i.value })),
  };
}

function banEmbed(b, title = null, color = null) {
  const f = [field('Ban ID', mono(b.id), true)];
  if (b.name) f.push(field('Player', esc(b.name), true));
  f.push(field('Banned by', esc(b.by || 'XionShield'), true));
  if (b.date) f.push(field('Date', `${stamp(b.date, 'f')}\n${stamp(b.date)}`, true));
  f.push(field('Expires', b.expire ? `${stamp(b.expire, 'f')}\n${stamp(b.expire)}` : 'Permanent', true));
  if (b.tokens) f.push(field('HWID tokens', String(b.tokens), true));
  f.push(field('Reason', esc(b.reason || 'No reason provided')));
  f.push(field('Identifiers', identifierLines(b.ids, false)));
  if (b.extra && b.extra.length) f.push(field('Details', b.extra.map(([k, v]) => `**${esc(k)}** ${esc(clip(v, 120))}`).join('\n')));
  return embed(color, null, title || `Ban #${b.id}`, f);
}

function playerEmbed(p, x) {
  const f = [
    field('Server ID', mono(p.id), true),
    field('Ping', `${x.ping} ms`, true),
    field('Session', duration(Date.now() - p.joined), true),
  ];
  if (x.health !== undefined) f.push(field('Health', String(x.health), true));
  if (x.tokens !== undefined) f.push(field('HWID tokens', String(x.tokens), true));
  if (x.warnings !== undefined) f.push(field('Warnings', String(x.warnings), true));
  f.push(field('Identifiers', identifierLines(p.ids, x.showIp)));
  if (x.bans && x.bans.length) f.push(field('Ban history', x.bans.map((b) => `${mono(`#${b.id}`)} ${esc(clip(b.reason || 'No reason', 70))}`).join('\n')));
  return embed(null, null, clip(p.name, 200), f);
}

module.exports = { brand, embed, info, ok, fail, warn, field, button, row, pager, modal, banEmbed, playerEmbed };
