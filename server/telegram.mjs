// Telegram Bot API client: long-polls getUpdates and sends replies.
// Only messages from chats in TELEGRAM_ALLOWED_CHAT_IDS reach the glasses
// ("see new messages only from the chats you pick").

const API = 'https://api.telegram.org';

/**
 * @param {{
 *   token: string,
 *   allowedChatIds: string[],
 *   store: ReturnType<typeof import('./store.mjs').createStore>,
 *   log?: (...a: any[]) => void,
 *   fetchImpl?: typeof fetch,
 * }} opts
 */
export function createTelegram({ token, allowedChatIds, store, log = console.log, fetchImpl = fetch }) {
  let offset = 0;
  let running = false;
  /** @type {AbortController | null} */
  let abort = null;
  const allow = new Set(allowedChatIds.map(String));

  /** @param {string} method @param {object} body @param {AbortSignal} [signal] */
  async function call(method, body, signal) {
    const res = await fetchImpl(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const json = await res.json();
    if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description || res.status}`);
    return json.result;
  }

  /** @param {any} chat */
  const chatTitle = chat =>
    chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || String(chat.id);

  /** Exposed for tests. @param {any} update */
  function ingest(update) {
    const m = update.message;
    if (!m || typeof m.text !== 'string') return null;
    const chatId = String(m.chat.id);
    if (allow.size && !allow.has(chatId)) {
      log(`[telegram] ignored message from chat ${chatId} (not in TELEGRAM_ALLOWED_CHAT_IDS)`);
      return null;
    }
    if (!allow.size) log(`[telegram] chat ${chatId} "${chatTitle(m.chat)}": add it to TELEGRAM_ALLOWED_CHAT_IDS to filter`);
    const from = m.from ? [m.from.first_name, m.from.last_name].filter(Boolean).join(' ') : chatTitle(m.chat);
    return store.add({
      id: `tg${chatId}_${m.message_id}`,
      chatId,
      chatTitle: chatTitle(m.chat),
      from,
      // Telegram user id (and @username): the key for the shop's customer context.
      fromId: m.from ? String(m.from.id) : chatId,
      ...(m.from?.username ? { fromUsername: `@${m.from.username}` } : {}),
      text: m.text,
      date: m.date * 1000,
      telegramMessageId: m.message_id,
    });
  }

  async function loop() {
    while (running) {
      abort = new AbortController();
      try {
        const updates = await call('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, abort.signal);
        for (const u of updates) {
          offset = u.update_id + 1;
          ingest(u);
        }
      } catch (err) {
        if (!running) break;
        log(`[telegram] poll error: ${/** @type {Error} */ (err).message}; retrying in 3 s`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  return {
    ingest,
    async start() {
      const me = await call('getMe', {});
      log(`[telegram] connected as @${me.username}`);
      running = true;
      loop();
      return me;
    },
    stop() {
      running = false;
      abort?.abort();
    },
    /**
     * Reply in the same chat, threaded to the original message.
     * @param {{ chatId: string, text: string, replyToMessageId?: number }} p
     */
    async send({ chatId, text, replyToMessageId }) {
      return call('sendMessage', {
        chat_id: chatId,
        text,
        ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId, allow_sending_without_reply: true } } : {}),
      });
    },
  };
}
