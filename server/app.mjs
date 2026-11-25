// HTTP API used by the glasses web app. Plain node:http, no framework.
import { createServer } from 'node:http';
import { ruleDigest, ruleDrafts, rulePolish } from './rules.mjs';
import { llmDigest, llmDrafts, llmEnabled, llmModel, llmPolish } from './llm.mjs';
import { demoTranscript, rms, sttEnabled, transcribe } from './stt.mjs';
import { DEMO_CUSTOMERS, colleagueClaims, demoIncoming, seedDemo } from './demo.mjs';
import { createClaims, publicClaim } from './claims.mjs';
import { contextLine, createCustomerContext, memoryProvider } from './customers.mjs';

const MAX_BODY = 2_000_000; // ~60 s of 16 kHz PCM

/**
 * Try the LLM, fall back to rules on any error. Returns { value, source }.
 * @template T
 * @param {() => Promise<T>} llm
 * @param {() => T} rules
 * @param {(msg: string) => void} log
 */
async function withFallback(llm, rules, log) {
  if (llmEnabled()) {
    try {
      return { value: await llm(), source: 'claude' };
    } catch (err) {
      log(`[llm] ${/** @type {Error} */ (err).message}; using rule-based fallback`);
    }
  }
  return { value: rules(), source: 'rules' };
}

/**
 * @param {{
 *   store: ReturnType<typeof import('./store.mjs').createStore>,
 *   telegram?: ReturnType<typeof import('./telegram.mjs').createTelegram> | null,
 *   demo: boolean,
 *   appToken?: string,
 *   customers?: ReturnType<typeof createCustomerContext>,
 *   claims?: ReturnType<typeof createClaims>,
 *   shopToken?: string,
 *   log?: (...a: any[]) => void,
 * }} deps
 */
export function createApp({
  store,
  telegram = null,
  demo,
  appToken = '',
  customers = createCustomerContext({ providers: demo ? [memoryProvider(DEMO_CUSTOMERS)] : [] }),
  claims = createClaims(),
  shopToken = '',
  log = console.log,
}) {
  let version = 0;
  store.onChange(() => version++);

  /**
   * Who is asking. Each G2 session sends a stable random id and a display name;
   * clients without them share one anonymous identity (single-user setups).
   * @param {import('node:http').IncomingMessage} req
   */
  const staffOf = req => ({
    id: String(req.headers['x-staff-id'] || 'staff').slice(0, 64),
    name: decodeURIComponent(String(req.headers['x-staff-name'] || 'Staff')).replace(/\s+/g, ' ').trim().slice(0, 24) || 'Staff',
  });

  /** @param {import('./store.mjs').Message} m */
  const customerOf = m => customers.lookup([m.fromId, m.fromUsername]);

  /**
   * Short signature of the claims other staff hold, so the inbox version changes
   * when someone starts or stops answering a conversation.
   * @param {{ id: string }} staff
   */
  const claimsKey = staff => {
    let h = 5381;
    for (const c of claims.list()) {
      if (!c || c.staffId === staff.id) continue;
      for (const ch of `${c.chatId}:${c.staffId};`) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
    }
    return h.toString(36);
  };

  /** 409 body when someone else is answering this conversation. @param {import('./claims.mjs').Claim} c */
  const blocked = c => ({ status: 409, error: `Being answered by ${c.by}`, claim: publicClaim(c) });

  /** @param {import('node:http').IncomingMessage} req */
  const readBody = req =>
    new Promise((resolve, reject) => {
      /** @type {Buffer[]} */
      const chunks = [];
      let size = 0;
      req.on('data', c => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new Error('body too large'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });

  /** @param {import('node:http').IncomingMessage} req */
  const readJson = async req => {
    const buf = /** @type {Buffer} */ (await readBody(req));
    return buf.length ? JSON.parse(buf.toString('utf8')) : {};
  };

  /** @param {import('./store.mjs').Message} m */
  const publicMsg = m => ({ id: m.id, chatTitle: m.chatTitle, from: m.from, text: m.text, date: m.date });

  /**
   * Inbox entry: the message plus the customer context line and, when another
   * staff member is answering this conversation, their claim.
   * @param {import('./store.mjs').Message} m @param {{ id: string, name: string }} staff
   */
  const inboxMsg = async (m, staff) => {
    const ctx = await customerOf(m);
    const claim = publicClaim(claims.heldByOther(m.chatId, staff));
    return { ...publicMsg(m), ...(ctx?.line ? { context: ctx.line } : {}), ...(claim ? { claim } : {}) };
  };

  /** @type {Record<string, (req: import('node:http').IncomingMessage, url: URL) => Promise<any>>} */
  const routes = {
    'GET /api/health': async () => ({
      ok: true,
      mode: demo ? 'demo' : 'telegram',
      ai: llmEnabled() ? `claude (${llmModel})` : 'rules',
      stt: sttEnabled() ? 'configured' : demo ? 'demo' : 'off',
      customers: customers.enabled ? customers.providers.join('+') : 'off',
      claimTtlS: Math.round(claims.ttlMs / 1000),
    }),

    // The inbox version also changes when claims change, so other wearers see
    // "Being answered by ..." within one poll. `version` stays a single number.
    'GET /api/inbox': async req => {
      const staff = staffOf(req);
      const unread = store.unread();
      const list = await Promise.all(unread.map(m => inboxMsg(m, staff)));
      return { version: `${version}.${claimsKey(staff)}`, unread: list, count: unread.length };
    },

    // Tapping reply claims the conversation. If another staff member holds it,
    // the reply is blocked (409) and the glasses offer "view only".
    'POST /api/drafts': async req => {
      const { id } = await readJson(req);
      const msg = store.get(id);
      if (!msg) return { status: 404, error: 'unknown message' };
      const got = claims.claim(msg.chatId, staffOf(req));
      if (!got.ok) return blocked(got.claim);
      const context = store.history(msg.chatId, 6).filter(m => m.id !== msg.id);
      const ctx = await customerOf(msg);
      const { value, source } = await withFallback(
        () => llmDrafts(msg, context, ctx?.line || ''),
        () => ruleDrafts(msg, ctx?.customer),
        log,
      );
      return { drafts: value, source, ...(ctx?.line ? { context: ctx.line } : {}) };
    },

    'POST /api/claim': async req => {
      const { id } = await readJson(req);
      const msg = store.get(id);
      if (!msg) return { status: 404, error: 'unknown message' };
      const got = claims.claim(msg.chatId, staffOf(req));
      if (!got.ok) return blocked(got.claim);
      return { ok: true, until: got.claim.until };
    },

    'POST /api/release': async req => {
      const { id } = await readJson(req);
      const msg = store.get(id);
      if (!msg) return { status: 404, error: 'unknown message' };
      return { ok: claims.release(msg.chatId, staffOf(req)) };
    },

    'POST /api/send': async req => {
      const { id, text } = await readJson(req);
      const msg = store.get(id);
      const body = String(text || '').trim();
      if (!msg) return { status: 404, error: 'unknown message' };
      if (!body || body.length > 4096) return { status: 400, error: 'empty or too long' };
      const staff = staffOf(req);
      // Claim at send time too: covers an expired claim and clients that skip drafts.
      const got = claims.claim(msg.chatId, staff);
      if (!got.ok) return blocked(got.claim);
      if (telegram && !demo) {
        await telegram.send({ chatId: msg.chatId, text: body, replyToMessageId: msg.telegramMessageId });
      }
      claims.release(msg.chatId, staff);
      store.markRead(id);
      const sent = store.recordSent({ chatId: msg.chatId, chatTitle: msg.chatTitle, inReplyTo: id, text: body });
      log(`[send] ${demo ? '(demo, not sent to Telegram) ' : ''}-> ${msg.chatTitle}: ${body}`);
      return { ok: true, sentAt: sent.date, delivered: !demo };
    },

    'POST /api/read': async req => {
      const { id } = await readJson(req);
      const msg = store.get(id);
      if (msg) claims.release(msg.chatId, staffOf(req));
      return { ok: store.markRead(id) };
    },

    'POST /api/read-all': async () => {
      store.markAllRead();
      return { ok: true };
    },

    'GET /api/digest': async () => {
      const unread = store.unread();
      if (!unread.length) return { lines: ['Inbox zero. Nothing new.'], source: 'rules' };
      const { value, source } = await withFallback(() => llmDigest(unread), () => ruleDigest(unread), log);
      return { lines: value, source };
    },

    // Body: raw PCM s16le 16 kHz mono. Query: ?id=<message id being answered>
    'POST /api/voice-reply': async (req, url) => {
      const msg = store.get(url.searchParams.get('id') || '');
      if (!msg) return { status: 404, error: 'unknown message' };
      const got = claims.claim(msg.chatId, staffOf(req));
      if (!got.ok) return blocked(got.claim);
      const pcm = new Uint8Array(/** @type {Buffer} */ (await readBody(req)));
      let transcript = '';
      let sttSource = 'demo';
      if (sttEnabled()) {
        if (rms(pcm) < 0.003) return { transcript: '', reply: '', error: 'Did not catch that' };
        transcript = await transcribe(pcm);
        sttSource = 'stt';
      } else if (demo) {
        transcript = demoTranscript(msg.text);
      } else {
        return { status: 501, error: 'Voice needs STT_URL' };
      }
      if (!transcript) return { transcript: '', reply: '', error: 'Did not catch that' };
      const { value, source } = await withFallback(() => llmPolish(transcript, msg), () => rulePolish(transcript), log);
      return { transcript, reply: value, sttSource, source };
    },

    'GET /api/outbox': async () => ({ outbox: store.outbox(), demo }),

    'GET /api/claims': async () => ({ claims: claims.list().map(c => ({ chatId: c.chatId, ...publicClaim(c) })) }),

    // Shop webhook: the shop's order system (or a script) pushes order updates.
    // Body: { userId, name?, note?, line?, order?: { id, items, status, pickup, total } }
    // Auth: header x-shop-token = SHOP_HOOK_TOKEN (not needed in demo mode).
    'POST /api/shop/order': async req => {
      if (!demo && !shopToken) return { status: 403, error: 'set SHOP_HOOK_TOKEN to enable the shop webhook' };
      if (shopToken && req.headers['x-shop-token'] !== shopToken) return { status: 401, error: 'bad shop token' };
      const { userId, ...patch } = await readJson(req);
      if (!userId) return { status: 400, error: 'userId required' };
      let rec;
      try {
        rec = customers.upsert(String(userId), patch);
      } catch (err) {
        return { status: 501, error: `${/** @type {Error} */ (err).message}: set CUSTOMER_CONTEXT_FILE` };
      }
      version++; // cards refresh their context line on the next poll
      return { ok: true, line: contextLine(rec) };
    },

    // Demo only: start the walkthrough again with the seeded messages, and the
    // simulated colleague (Lena) already answering one customer.
    'POST /api/demo/reset': async () => {
      if (!demo) return { status: 403, error: 'demo mode only' };
      store.markAllRead();
      claims.clear();
      seedDemo(store);
      colleagueClaims(claims);
      return { ok: true };
    },

    // Demo only: Lena (a second G2 wearer) taps reply on a conversation.
    // Body: { id?: message id } (default: her usual customer).
    'POST /api/demo/colleague': async req => {
      if (!demo) return { status: 403, error: 'demo mode only' };
      const { id } = await readJson(req);
      const msg = id ? store.get(id) : null;
      if (id && !msg) return { status: 404, error: 'unknown message' };
      const got = colleagueClaims(claims, msg?.chatId);
      return { ok: got.ok, claim: publicClaim(got.claim) };
    },

    'POST /api/demo/incoming': async () => {
      if (!demo) return { status: 403, error: 'demo mode only' };
      return { message: publicMsg(demoIncoming(store)) };
    },
  };

  const server = createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type, x-app-token, x-staff-id, x-staff-name');
    res.setHeader('access-control-max-age', '86400');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    const url = new URL(req.url || '/', 'http://localhost');
    const handler = routes[`${req.method} ${url.pathname}`];
    /** @param {number} status @param {any} body */
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    if (!handler) return send(404, { error: 'not found' });
    // The shop webhook has its own token (SHOP_HOOK_TOKEN); everything else uses APP_TOKEN.
    if (appToken && url.pathname !== '/api/health' && url.pathname !== '/api/shop/order' && req.headers['x-app-token'] !== appToken) {
      return send(401, { error: 'bad app token' });
    }
    try {
      const out = await handler(req, url);
      const { status = 200, ...body } = out || {};
      send(status, body);
    } catch (err) {
      log(`[api] ${req.method} ${url.pathname} failed: ${/** @type {Error} */ (err).message}`);
      send(500, { error: 'server error' });
    }
  });

  return server;
}
