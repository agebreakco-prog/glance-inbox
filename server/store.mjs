// In-memory inbox. Nothing is written to disk: restart the server and it is gone.
// That is deliberate: the glasses only need "what is new right now".

/**
 * @typedef {{
 *   id: string, chatId: string, chatTitle: string, from: string, text: string,
 *   date: number, read: boolean, telegramMessageId?: number, outgoing?: boolean
 * }} Message
 */

export function createStore({ maxMessages = 200 } = {}) {
  /** @type {Message[]} */
  let messages = [];
  /** @type {{ id: string, chatId: string, chatTitle: string, inReplyTo: string, text: string, date: number }[]} */
  const outbox = [];
  let seq = 0;
  /** @type {Set<() => void>} */
  const listeners = new Set();
  const changed = () => listeners.forEach(fn => fn());

  return {
    /** @param {Omit<Message, 'id' | 'read'> & { id?: string }} m */
    add(m) {
      const msg = { read: false, ...m, id: m.id ?? `m${++seq}` };
      messages.push(msg);
      if (messages.length > maxMessages) messages = messages.slice(-maxMessages);
      changed();
      return msg;
    },
    /** @param {string} id */
    get: id => messages.find(m => m.id === id),
    /** Unread, oldest first: the order you would read them in. */
    unread: () => messages.filter(m => !m.read && !m.outgoing),
    /** @param {string} chatId @param {number} n */
    history(chatId, n = 6) {
      return messages.filter(m => m.chatId === chatId).slice(-n);
    },
    /** @param {string} id */
    markRead(id) {
      const m = messages.find(x => x.id === id);
      if (m) m.read = true;
      changed();
      return Boolean(m);
    },
    markAllRead() {
      messages.forEach(m => (m.read = true));
      changed();
    },
    /** @param {{ chatId: string, chatTitle: string, inReplyTo: string, text: string }} r */
    recordSent(r) {
      const entry = { id: `o${++seq}`, date: Date.now(), ...r };
      outbox.push(entry);
      messages.push({ id: entry.id, chatId: r.chatId, chatTitle: r.chatTitle, from: 'You', text: r.text, date: entry.date, read: true, outgoing: true });
      changed();
      return entry;
    },
    outbox: () => outbox.slice(-20).reverse(),
    /** @param {() => void} fn */
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
