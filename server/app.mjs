// HTTP API used by the glasses web app. Plain node:http, no framework.
import { createServer } from 'node:http';
import { ruleDigest, ruleDrafts, rulePolish } from './rules.mjs';
import { llmDigest, llmDrafts, llmEnabled, llmModel, llmPolish } from './llm.mjs';
import { demoTranscript, rms, sttEnabled, transcribe } from './stt.mjs';
import { demoIncoming, seedDemo } from './demo.mjs';

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
 *   log?: (...a: any[]) => void,
 * }} deps
 */
export function createApp({ store, telegram = null, demo, appToken = '', log = console.log }) {
  let version = 0;
  store.onChange(() => version++);

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

  /** @type {Record<string, (req: import('node:http').IncomingMessage, url: URL) => Promise<any>>} */
  const routes = {
    'GET /api/health': async () => ({
      ok: true,
      mode: demo ? 'demo' : 'telegram',
      ai: llmEnabled() ? `claude (${llmModel})` : 'rules',
      stt: sttEnabled() ? 'configured' : demo ? 'demo' : 'off',
    }),

    'GET /api/inbox': async () => {
      const unread = store.unread();
      return { version, unread: unread.map(publicMsg), count: unread.length };
    },

    'POST /api/drafts': async req => {
      const { id } = await readJson(req);
      const msg = store.get(id);
      if (!msg) return { status: 404, error: 'unknown message' };
      const context = store.history(msg.chatId, 6).filter(m => m.id !== msg.id);
      const { value, source } = await withFallback(() => llmDrafts(msg, context), () => ruleDrafts(msg), log);
      return { drafts: value, source };
    },

    'POST /api/send': async req => {
      const { id, text } = await readJson(req);
      const msg = store.get(id);
      const body = String(text || '').trim();
      if (!msg) return { status: 404, error: 'unknown message' };
      if (!body || body.length > 4096) return { status: 400, error: 'empty or too long' };
      if (telegram && !demo) {
        await telegram.send({ chatId: msg.chatId, text: body, replyToMessageId: msg.telegramMessageId });
      }
      store.markRead(id);
      const sent = store.recordSent({ chatId: msg.chatId, chatTitle: msg.chatTitle, inReplyTo: id, text: body });
      log(`[send] ${demo ? '(demo, not sent to Telegram) ' : ''}-> ${msg.chatTitle}: ${body}`);
      return { ok: true, sentAt: sent.date, delivered: !demo };
    },

    'POST /api/read': async req => {
      const { id } = await readJson(req);
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

    // Demo only: start the walkthrough again with the four seeded messages.
    'POST /api/demo/reset': async () => {
      if (!demo) return { status: 403, error: 'demo mode only' };
      store.markAllRead();
      seedDemo(store);
      return { ok: true };
    },

    'POST /api/demo/incoming': async () => {
      if (!demo) return { status: 403, error: 'demo mode only' };
      return { message: publicMsg(demoIncoming(store)) };
    },
  };

  const server = createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type, x-app-token');
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
    if (appToken && url.pathname !== '/api/health' && req.headers['x-app-token'] !== appToken) {
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
