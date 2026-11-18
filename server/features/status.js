'use strict';
const { tpl, clip } = require('../lib/util');
const S = require('../bot/shared');

class Status {
  constructor(bot) {
    this.bot = bot;
    this.lastText = null;
    this.presenceTimer = null;
    this.lastPresence = 0;
    this.panelTimer = null;
    this.panelHash = '';
    this.panelBusy = false;
  }

  start() {
    const c = this.bot.cfg;
    if (c.presence.enabled) this.presence();
    if (c.statusPanel.enabled && c.channels.status) {
      this.panel();
      this.panelTimer = setInterval(() => this.panel(), Math.max(15, c.statusPanel.intervalSeconds | 0) * 1000);
    }
  }

  stop() {
    clearInterval(this.panelTimer);
    clearTimeout(this.presenceTimer);
  }

  presence() {
    const c = this.bot.cfg.presence;
    if (!c.enabled || this.presenceTimer) return;
    const wait = Math.max(0, 15000 - (Date.now() - this.lastPresence));
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      const online = this.bot.players.size;
      const text = online || !c.emptyText ? tpl(c.text, { online, max: GetConvarInt('sv_maxclients', 48) }) : c.emptyText;
      if (text === this.lastText) return;
      this.lastText = text;
      this.lastPresence = Date.now();
      this.bot.gateway.setPresence(clip(text, 128), c.type);
    }, wait);
  }

  async panel() {
    if (this.panelBusy) return;
    this.panelBusy = true;
    const bot = this.bot;
    const ch = bot.cfg.channels.status;
    try {
      const e = S.statusEmbed(bot);
      if (bot.cfg.statusPanel.showPlayers) {
        const list = [...bot.players.map.values()].sort((a, b) => a.id - b.id);
        const lines = S.playerLines(list.slice(0, 40), false);
        if (list.length > 40) lines.push(`…and ${list.length - 40} more`);
        e.description = clip(lines.join('\n') || 'Nobody is online.', 4000);
      }
      e.fields = e.fields.filter((f) => f.name !== 'JS heap' && f.name !== 'Process RSS' && f.name !== 'Gateway' && f.name !== 'Queued bans');
      const hash = JSON.stringify([e.description, e.fields]);
      if (hash === this.panelHash) return;
      delete e.timestamp;
      e.footer = { text: `${e.footer.text} · auto-updating` };
      const body = { embeds: [e], allowed_mentions: { parse: [] } };
      const id = bot.store.meta.panelId;
      if (id && bot.store.meta.panelChannel === ch) {
        try {
          await bot.rest.patch(`/channels/${ch}/messages/${id}`, body);
          this.panelHash = hash;
          return;
        } catch (err) {
          if (err.status !== 404) throw err;
        }
      }
      const m = await bot.rest.post(`/channels/${ch}/messages`, body);
      bot.store.meta.panelId = m.id;
      bot.store.meta.panelChannel = ch;
      bot.store.save();
      this.panelHash = hash;
    } catch (err) {
      bot.log.warn(`Status panel update failed: ${err.message}`);
    } finally {
      this.panelBusy = false;
    }
  }
}

module.exports = { Status };
