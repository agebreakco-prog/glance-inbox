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
 * Three short reply suggestions for a message, chosen by simple intent rules.
 * @param {{ text: string, from: string }} msg
 * @returns {string[]}
 */
export function ruleDrafts(msg) {
  const text = (msg.text || '').trim();
  const who = firstName(msg.from);
  const rule = RULES.find(r => r.test.test(text));
  const replies = rule ? rule.replies(who) : ['Got it, thanks!', 'Will reply properly soon', 'Can I call you later?'];
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
