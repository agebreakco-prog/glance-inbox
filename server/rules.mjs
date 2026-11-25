// Local, key-free fallbacks for every AI feature.
// The demo runs fully offline with these; with ANTHROPIC_API_KEY set,
// server/llm.mjs is used first and these only cover errors and timeouts.

const MAX_REPLY = 40;

/** @param {string} s */
const clip = (s, n = MAX_REPLY) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…');

/** First name only, never the full display name. @param {string} name */
export const firstName = (name = '') => name.trim().split(/\s+/)[0] || 'there';

const RULES = [
  {
    name: 'eta',
    test: /\b(where are you|eta|how long|on (your|the) way|running late|arriv)/i,
    replies: () => ['On my way, 10 min', 'Running late, 20 min', 'Just arrived'],
  },
  {
    name: 'request',
    test: /\b(can you|could you|would you|please|pls|send( me)?|need you)/i,
    replies: () => ['Sure, on it', 'Yes, by end of day', 'Not today, tomorrow ok?'],
  },
  {
    name: 'meeting',
    test: /\b(meeting|call|standup|sync|zoom|meet\b|join)/i,
    replies: () => ['Joining in 2 min', 'Can we push it 30 min?', "Can't make it, send notes?"],
  },
  {
    name: 'availability',
    test: /\b(do you (still )?have|in stock|available|any left|are you open)/i,
    replies: () => ['Yes, we have it!', 'Want me to hold one?', 'Sold out today, sorry'],
  },
  {
    name: 'time',
    test: /\b(when|what time|tonight|tomorrow|today|deadline|by \d)/i,
    replies: () => ['Works for me', 'Can we do tomorrow?', "I'll confirm in an hour"],
  },
  {
    name: 'thanks',
    test: /\b(thanks|thank you|thx|ty|appreciate)/i,
    replies: () => ["You're welcome!", 'Anytime', 'Happy to help'],
  },
  {
    name: 'greeting',
    test: /^(hi|hey|hello|yo|morning|good (morning|evening))\b/i,
    replies: (/** @type {string} */ who) => [`Hey ${who}!`, "Hi! What's up?", 'Busy now, call you later'],
  },
  {
    name: 'question',
    test: /\?\s*$/,
    replies: () => ['Yes', 'No, sorry', 'Let me check and get back'],
  },
];

/**
 * Latest order from a customer-context record (server/customers.mjs), or null.
 * @param {{ orders?: { id?: string|number, status?: string, pickup?: string }[] } | null | undefined} customer
 */
export const lastOrder = customer => (customer?.orders?.length ? customer.orders[customer.orders.length - 1] : null);

const ORDER_TALK = /\b(order|pick ?up|collect|ready|instead|change|cancel|status|deliver|move)/i;
const TIME = /\b(\d{1,2}[:.]\d{2}|\d{1,2}\s?(am|pm))\b/i;

/**
 * Order-aware drafts for shop bots, used when the customer has an order on file.
 * @param {string} text
 * @param {{ id?: string|number, status?: string, pickup?: string }} o
 * @returns {string[] | null}
 */
function orderDrafts(text, o) {
  const ref = o.id !== undefined && o.id !== '' ? `#${o.id}` : 'your order';
  if (ORDER_TALK.test(text)) {
    const time = text.match(TIME)?.[1];
    if (time) {
      return [`Yes, ${ref} moved to ${time}`, `${time} is tight, 30 min later ok?`, o.pickup ? `Sorry, only ${o.pickup} today` : 'Sorry, not possible today'];
    }
    return [
      o.pickup ? `${ref} is ready at ${o.pickup}` : `${ref} is on its way`,
      o.status ? `Yes, ${ref} is ${o.status}` : `Yes, ${ref} is confirmed`,
      `Let me check ${ref} and reply`,
    ];
  }
  return null;
}

/**
 * Three short reply suggestions for a message, chosen by simple intent rules.
 * With a shop customer record, drafts can reference the latest order.
 * @param {{ text: string, from: string }} msg
 * @param {{ orders?: { id?: string|number, status?: string, pickup?: string }[] } | null} [customer]
 * @returns {string[]}
 */
export function ruleDrafts(msg, customer = null) {
  const text = (msg.text || '').trim();
  const who = firstName(msg.from);
  const order = lastOrder(customer);
  const fromOrder = order && orderDrafts(text, order);
  if (fromOrder) return fromOrder.map(r => clip(r));
  const rule = RULES.find(r => r.test.test(text));
  const replies = rule ? rule.replies(who) : ['Got it, thanks!', 'Will reply properly soon', 'Can I call you later?'];
  if (order && rule?.name === 'availability' && order.id !== undefined) replies[1] = `Add one to order #${order.id}?`;
  return replies.map(r => clip(r));
}

/**
 * Turn a raw voice transcript into a sendable reply without an LLM:
 * trims fillers, capitalises, adds final punctuation.
 * @param {string} transcript
 */
export function rulePolish(transcript) {
  let t = (transcript || '')
    .replace(/\b(um+|uh+|erm|like,)\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '';
  t = t[0].toUpperCase() + t.slice(1);
  if (!/[.!?…]$/.test(t)) t += '.';
  return clip(t, 200);
}

/**
 * One line per chat: "Alex (2): last message…". Fits the glasses: max 4 lines.
 * @param {{ chatTitle: string, from: string, text: string }[]} unread
 * @returns {string[]}
 */
export function ruleDigest(unread) {
  if (!unread.length) return ['Inbox zero. Nothing new.'];
  /** @type {Map<string, { n: number, last: string, from: string }>} */
  const byChat = new Map();
  for (const m of unread) {
    const e = byChat.get(m.chatTitle) || { n: 0, last: '', from: m.from };
    e.n += 1;
    e.last = m.text;
    e.from = m.from;
    byChat.set(m.chatTitle, e);
  }
  const lines = [...byChat.entries()].map(([chat, e]) => clip(`${chat} (${e.n}): ${e.last}`, 60));
  return lines.slice(0, 4);
}
