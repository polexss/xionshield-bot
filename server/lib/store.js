'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = () => ({ v: 1, warnings: {}, queue: {}, meta: {} });

class Store {
  constructor(file, log) {
    this.file = file;
    this.tmp = `${file}.tmp`;
    this.log = log;
    this.timer = null;
    this.writing = false;
    this.pending = false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.data = DEFAULTS();
    try {
      Object.assign(this.data, JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (e) {
      if (e.code !== 'ENOENT') log.warn(`Could not read ${path.basename(file)}: ${e.message}`);
    }
  }

  get warnings() {
    return this.data.warnings;
  }
  get queue() {
    return this.data.queue;
  }
  get meta() {
    return this.data.meta;
  }

  save() {
    if (!this.timer) this.timer = setTimeout(() => this.flush(), 1500);
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.writing) {
      this.pending = true;
      return;
    }
    this.writing = true;
    fs.writeFile(this.tmp, JSON.stringify(this.data), (err) => {
      if (err) return this.done(err);
      fs.rename(this.tmp, this.file, (e) => this.done(e));
    });
  }

  done(err) {
    this.writing = false;
    if (err) this.log.error(`Failed to save data: ${err.message}`);
    if (this.pending) {
      this.pending = false;
      this.flush();
    }
  }

  flushSync() {
    if (!this.timer && !this.pending) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.pending = false;
    try {
      fs.writeFileSync(this.tmp, JSON.stringify(this.data));
      fs.renameSync(this.tmp, this.file);
    } catch (e) {
      this.log.error(`Failed to save data: ${e.message}`);
    }
  }
}

module.exports = { Store };
