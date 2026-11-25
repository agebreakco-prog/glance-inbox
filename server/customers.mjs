// Customer context for shop bots: one short line about the customer's last
// order, shown on the inbox card and passed to the reply drafts.
//
// Pluggable: a provider is anything with `lookup(key)` (sync or async) that
// returns a customer record or null. Providers are tried in order; the first
// hit wins. Writable providers also have `upsert(key, patch)`, which the shop
// webhook (POST /api/shop/order) uses.
//
// Built in:
//   jsonFileProvider(path)  a JSON file the shop owner (or their script) fills,
//                           keyed by Telegram user id. Re-read when it changes.
//   memoryProvider(data)    in-memory, used by demo mode and tests.
//   httpProvider(url)       GET <url>?user_id=<id> on the shop's own system.
//
// Record shape (every field optional):
//   { name, note, line, orders: [{ id, items, status, pickup, total, date }] }
// `line` overrides the generated text. The last entry in `orders` is the latest.
import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';

/** Characters available for the context line on the 576 px card (one line of text). */
export const CONTEXT_MAX = 60;
const MAX_ORDERS = 10;

/**
 * @typedef {{ id?: string|number, items?: string, status?: string, pickup?: string, total?: string, date?: string }} Order
 * @typedef {{ name?: string, note?: string, line?: string, orders?: Order[] }} Customer
 * @typedef {{ name: string, lookup(key: string): Customer | null | undefined | Promise<Customer | null | undefined>, upsert?(key: string, patch: any): Customer }} Provider
 */

/** @param {string} s @param {number} n */
const clip = (s, n) => {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + '…';
};

/**
 * "Last order #1042 · 2 croissants · paid, pickup 15:00"
 * @param {Customer | null | undefined} c
 */
export function contextLine(c, max = CONTEXT_MAX) {
  if (!c) return '';
  if (c.line) return clip(c.line, max);
  const o = Array.isArray(c.orders) && c.orders.length ? c.orders[c.orders.length - 1] : null;
  if (o) {
    const state = [o.status, o.pickup && `pickup ${o.pickup}`].filter(Boolean).join(', ');
    const parts = [o.id !== undefined && o.id !== '' ? `Last order #${o.id}` : 'Last order', o.items, o.total, state].filter(Boolean);
    return clip(parts.join(' · '), max);
  }
  if (c.note) return clip(`Customer: ${c.note}`, max);
  return '';
}

/**
 * Merge a webhook payload into a record: new order ids are appended, a known
 * id is updated in place (e.g. status "paid" -> "ready").
 * @param {Customer | undefined} prev
 * @param {{ name?: string, note?: string, line?: string, order?: Order }} patch
 * @returns {Customer}
 */
export function mergeCustomer(prev, patch) {
  /** @type {Customer} */
  const next = { ...(prev || {}), orders: [...(prev?.orders || [])] };
  for (const k of /** @type {const} */ (['name', 'note', 'line'])) {
    if (typeof patch[k] === 'string') next[k] = patch[k].slice(0, 200);
  }
  if (patch.order && typeof patch.order === 'object') {
    const o = Object.fromEntries(
      Object.entries(patch.order)
        .filter(([k]) => ['id', 'items', 'status', 'pickup', 'total', 'date'].includes(k))
        .map(([k, v]) => [k, String(v).slice(0, 120)]),
    );
    const i = o.id !== undefined ? next.orders.findIndex(x => String(x.id) === o.id) : -1;
    if (i >= 0) next.orders[i] = { ...next.orders[i], ...o };
    else next.orders.push(o);
    next.orders = next.orders.slice(-MAX_ORDERS);
  }
  return next;
}

/** @param {Record<string, Customer>} [initial] @returns {Provider} */
export function memoryProvider(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    name: 'memory',
    lookup: key => data.get(String(key)) || null,
    upsert(key, patch) {
      const rec = mergeCustomer(data.get(String(key)), patch);
      data.set(String(key), rec);
      return rec;
    },
  };
}

/**
 * JSON file keyed by Telegram user id (or "@username"). The file is re-read
 * whenever its mtime changes, so a shop owner can edit it while the server runs.
 * A missing file counts as empty and is created on the first webhook write.
 * @param {string} path
 * @param {{ log?: (...a: any[]) => void }} [opts]
 * @returns {Provider}
 */
export function jsonFileProvider(path, { log = console.log } = {}) {
  /** @type {Record<string, Customer>} */
  let data = {};
  let mtime = -1;
  const load = () => {
    let m;
    try {
      m = statSync(path).mtimeMs;
    } catch {
      data = {};
      mtime = -1;
      return;
    }
    if (m === mtime) return;
    mtime = m;
    try {
      const json = JSON.parse(readFileSync(path, 'utf8'));
      data = json && typeof json === 'object' && !Array.isArray(json) ? json : {};
    } catch (err) {
      log(`[customers] ${path}: ${/** @type {Error} */ (err).message}; keeping previous data`);
    }
  };
  return {
    name: 'file',
    lookup(key) {
      load();
      return data[String(key)] || null;
    },
    upsert(key, patch) {
      load();
      const rec = mergeCustomer(data[String(key)], patch);
      data = { ...data, [String(key)]: rec };
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
      renameSync(tmp, path);
      mtime = statSync(path).mtimeMs;
      return rec;
    },
  };
}

/**
 * Ask the shop's own system: GET <url>?user_id=<key>, expecting a Customer
 * JSON object (or 404). Results are cached for `ttlMs`.
 * @param {string} url
 * @param {{ token?: string, ttlMs?: number, fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Provider}
 */
export function httpProvider(url, { token = '', ttlMs = 60_000, fetchImpl = fetch, timeoutMs = 2000 } = {}) {
  /** @type {Map<string, { at: number, value: Customer | null }>} */
  const cache = new Map();
  return {
    name: 'http',
    async lookup(key) {
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return hit.value;
      const u = new URL(url);
      u.searchParams.set('user_id', key);
      const res = await fetchImpl(u, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(timeoutMs),
      });
      const value = res.ok ? /** @type {Customer} */ (await res.json()) : null;
      cache.set(key, { at: Date.now(), value });
      return value;
    },
  };
}

/**
 * @param {{ providers?: Provider[], log?: (...a: any[]) => void }} [opts]
 */
export function createCustomerContext({ providers = [], log = console.log } = {}) {
  return {
    enabled: providers.length > 0,
    providers: providers.map(p => p.name),
    /**
     * @param {(string | undefined)[]} keys e.g. [telegram user id, "@username"]
     * @returns {Promise<{ customer: Customer, line: string } | null>}
     */
    async lookup(keys) {
      for (const key of keys.filter(Boolean)) {
        for (const p of providers) {
          try {
            const customer = await p.lookup(String(key));
            if (customer) return { customer, line: contextLine(customer) };
          } catch (err) {
            log(`[customers] ${p.name} lookup failed: ${/** @type {Error} */ (err).message}`);
          }
        }
      }
      return null;
    },
    /** Write to the first writable provider. @param {string} key @param {any} patch */
    upsert(key, patch) {
      const p = providers.find(x => typeof x.upsert === 'function');
      if (!p || !p.upsert) throw new Error('no writable customer store');
      return p.upsert(String(key), patch);
    },
  };
}

/**
 * Providers from the environment:
 *   CUSTOMER_CONTEXT_FILE  JSON file (writable by the webhook)
 *   CUSTOMER_CONTEXT_URL   the shop's own lookup endpoint (+ CUSTOMER_CONTEXT_TOKEN)
 * Demo mode adds the fictional bakery customers from server/demo.mjs.
 * @param {Record<string, string | undefined>} env
 * @param {{ demoCustomers?: Record<string, Customer>, log?: (...a: any[]) => void }} [opts]
 */
export function customerContextFromEnv(env, { demoCustomers, log = console.log } = {}) {
  /** @type {Provider[]} */
  const providers = [];
  if (env.CUSTOMER_CONTEXT_FILE) providers.push(jsonFileProvider(env.CUSTOMER_CONTEXT_FILE, { log }));
  if (demoCustomers) providers.push(memoryProvider(demoCustomers));
  if (env.CUSTOMER_CONTEXT_URL) providers.push(httpProvider(env.CUSTOMER_CONTEXT_URL, { token: env.CUSTOMER_CONTEXT_TOKEN || '' }));
  return createCustomerContext({ providers, log });
}
