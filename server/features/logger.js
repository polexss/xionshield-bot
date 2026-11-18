'use strict';
const { NO_MENTIONS, embedSize } = require('../lib/util');

class EmbedLog {
  constructor(rest, channelId, log, delay = 2000) {
    this.rest = rest;
    this.channel = channelId;
    this.log = log;
    this.delay = delay;
    this.q = [];
    this.size = 0;
    this.timer = null;
  }

  get enabled() {
    return !!this.channel;
  }

  push(embed, files) {
    if (!this.channel) return;
    if (files && files.length) {
      this.flush();
      this.send([embed], files);
      return;
    }
    const n = embedSize(embed);
    if (this.q.length >= 10 || this.size + n > 5500) this.flush();
    this.q.push(embed);
    this.size += n;
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.delay);
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.q.length) return;
    const embeds = this.q;
    this.q = [];
    this.size = 0;
    this.send(embeds);
  }

  send(embeds, files) {
    this.rest
      .post(`/channels/${this.channel}/messages`, { embeds, allowed_mentions: NO_MENTIONS }, files)
      .catch((e) => this.log.warn(`Log delivery failed (${this.channel}): ${e.message}`));
  }
}

class TextLog {
  constructor(rest, channelId, log, delay = 3000) {
    this.rest = rest;
    this.channel = channelId;
    this.log = log;
    this.delay = delay;
    this.buf = '';
    this.timer = null;
    this.dropped = 0;
  }

  push(line) {
    if (!this.channel || !line) return;
    if (this.buf.length > 12000) {
      this.dropped++;
      return;
    }
    this.buf += line.endsWith('\n') ? line : `${line}\n`;
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.delay);
  }

  flush() {
    this.timer = null;
    let text = this.buf.replace(/```/g, 'ˋˋˋ');
    this.buf = '';
    if (this.dropped) {
      text += `… ${this.dropped} lines dropped (rate)\n`;
      this.dropped = 0;
    }
    while (text.length) {
      let cut = text.length > 1980 ? text.lastIndexOf('\n', 1980) : text.length;
      if (cut <= 0) cut = 1980;
      const part = text.slice(0, cut);
      text = text.slice(cut).replace(/^\n/, '');
      this.rest
        .post(`/channels/${this.channel}/messages`, { content: `\`\`\`\n${part}\n\`\`\``, allowed_mentions: NO_MENTIONS })
        .catch((e) => this.log.warn(`Console feed delivery failed: ${e.message}`));
    }
  }
}

module.exports = { EmbedLog, TextLog };
