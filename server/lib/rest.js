'use strict';
const https = require('https');
const crypto = require('crypto');

const API = '/api/v10';
const agent = new https.Agent({ keepAlive: true, keepAliveMsecs: 30000, maxSockets: 12 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class DiscordError extends Error {
  constructor(status, body, method, path) {
    super(`${method} ${path} -> ${status}${body && body.message ? ` ${body.message}` : ''}`);
    this.status = status;
    this.code = body && body.code;
    this.body = body;
  }
}

function routeKey(method, path) {
  const q = path.indexOf('?');
  if (q >= 0) path = path.slice(0, q);
  return (
    method +
    path.replace(/\/(\d{16,21})/g, (m, id, off, str) =>
      /\/(channels|guilds|webhooks)$/.test(str.slice(0, off)) ? m : '/:id'
    )
  );
}

function multipart(payload, files) {
  const boundary = `xsbot${crypto.randomBytes(12).toString('hex')}`;
  const parts = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="payload_json"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(payload)}\r\n`
    ),
  ];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files[${i}]"; filename="${f.name}"\r\nContent-Type: ${f.type || 'application/octet-stream'}\r\n\r\n`
      ),
      f.data,
      Buffer.from('\r\n')
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

class Rest {
  constructor(token, log) {
    this.auth = `Bot ${token}`;
    this.log = log;
    this.routes = new Map();
    this.buckets = new Map();
    this.queues = new Map();
    this.globalUntil = 0;
  }

  get(path) {
    return this.request('GET', path);
  }
  post(path, body, files) {
    return this.request('POST', path, { body, files });
  }
  patch(path, body, files) {
    return this.request('PATCH', path, { body, files });
  }
  put(path, body) {
    return this.request('PUT', path, { body });
  }
  delete(path) {
    return this.request('DELETE', path);
  }

  destroy() {
    agent.destroy();
  }

  request(method, path, opts = {}) {
    const key = routeKey(method, path);
    const tail = this.queues.get(key);
    const run = () => this.exec(method, path, opts, key);
    const p = tail ? tail.then(run, run) : run();
    const guard = p.then(
      () => {},
      () => {}
    );
    this.queues.set(key, guard);
    guard.then(() => {
      if (this.queues.get(key) === guard) this.queues.delete(key);
    });
    return p;
  }

  async exec(method, path, opts, key) {
    let body = null;
    const headers = { 'User-Agent': 'DiscordBot (xionshield-bot, 1.0.0)' };
    if (opts.auth !== false) headers.Authorization = this.auth;
    if (opts.files && opts.files.length) {
      const payload = opts.body || {};
      if (!payload.attachments) payload.attachments = opts.files.map((f, id) => ({ id, filename: f.name }));
      const mp = multipart(payload, opts.files);
      body = mp.body;
      headers['Content-Type'] = mp.type;
    } else if (opts.body !== undefined) {
      body = Buffer.from(JSON.stringify(opts.body));
      headers['Content-Type'] = 'application/json';
    }
    if (body) headers['Content-Length'] = body.length;

    for (let attempt = 0; ; attempt++) {
      const now = Date.now();
      if (this.globalUntil > now) await sleep(this.globalUntil - now);
      const hash = this.routes.get(key);
      const b = hash && this.buckets.get(hash);
      if (b && b.remaining <= 0 && b.reset > Date.now()) await sleep(b.reset - Date.now() + 50);

      let res;
      try {
        res = await this.raw(method, path, headers, body);
      } catch (e) {
        if (attempt < 2) {
          await sleep(500 * (attempt + 1));
          continue;
        }
        throw e;
      }
      const h = res.headers;
      const bh = h['x-ratelimit-bucket'];
      if (bh) {
        this.routes.set(key, bh);
        this.buckets.set(bh, {
          remaining: +h['x-ratelimit-remaining'],
          reset: Date.now() + (parseFloat(h['x-ratelimit-reset-after']) || 0) * 1000,
        });
      }
      if (res.status === 429) {
        const ra = ((res.body && res.body.retry_after) || parseFloat(h['retry-after']) || 1) * 1000;
        if (h['x-ratelimit-global'] || (res.body && res.body.global)) this.globalUntil = Date.now() + ra;
        this.log.debug(`Rate limited on ${key}, retrying in ${Math.round(ra)}ms`);
        if (attempt < 5) {
          await sleep(ra + 50);
          continue;
        }
      } else if (res.status >= 500 && attempt < 2) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (res.status >= 400) throw new DiscordError(res.status, res.body, method, path.split('?')[0]);
      return res.body;
    }
  }

  raw(method, path, headers, body) {
    return new Promise((resolve, reject) => {
      const req = https.request(
        { hostname: 'discord.com', path: API + path, method, headers, agent, timeout: 20000 },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('error', reject);
          res.on('end', () => {
            let data = null;
            if (chunks.length) {
              const s = Buffer.concat(chunks).toString('utf8');
              try {
                data = JSON.parse(s);
              } catch {
                data = { message: s.slice(0, 200) };
              }
            }
            resolve({ status: res.statusCode, headers: res.headers, body: data });
          });
        }
      );
      req.on('timeout', () => req.destroy(new Error(`Request timeout: ${method} ${path}`)));
      req.on('error', reject);
      req.end(body || undefined);
    });
  }
}

module.exports = { Rest, DiscordError, routeKey };
