// Claude-backed drafts, digest and voice polish. Only active when
// ANTHROPIC_API_KEY is set; every call has a short timeout and the caller
// falls back to server/rules.mjs on any error, so the glasses never hang.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 8000);

export const llmEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

/** @type {Anthropic | null} */
let client = null;
const getClient = () => (client ??= new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 1 }));

const SYSTEM = [
  'You write replies that a person sends from smart glasses with one tap.',
  'Replies are read on a tiny monochrome display, so they must be short, plain text, no emoji, no markdown.',
  'Write as the user, in the same language as the incoming message. Never invent facts, times or commitments',
  'beyond what a reasonable short answer implies; offer a mix: one positive, one neutral or delaying, one decline or alternative.',
].join(' ');

/**
 * @param {string} user
 * @param {object} schema JSON schema for the answer
 * @param {string} [system]
 */
async function askJson(user, schema, system = SYSTEM) {
  const res = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  });
  if (res.stop_reason === 'refusal') throw new Error('refusal');
  const text = res.content.find(b => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('no text block');
  return JSON.parse(text.text);
}

const stringList = (key, max) => ({
  type: 'object',
  properties: { [key]: { type: 'array', items: { type: 'string' }, maxItems: max } },
  required: [key],
  additionalProperties: false,
});

/**
 * The user-turn prompt for reply drafts. Exported for tests.
 * @param {{ from: string, chatTitle: string, text: string }} msg
 * @param {{ from: string, text: string }[]} context earlier messages in the same chat, oldest first
 * @param {string} [customerLine] shop order context, e.g. "Last order #1042 · 2 croissants · paid, pickup 15:00"
 */
export function draftsPrompt(msg, context = [], customerLine = '') {
  const history = context.map(m => `${m.from}: ${m.text}`).join('\n');
  const shop = customerLine
    ? `This chat is a customer of my shop. From my order system: ${customerLine}\n` +
      'Refer to the order (number, items, pickup time) where it helps. Do not invent other order details, prices or stock.\n'
    : '';
  return (
    `Chat: ${msg.chatTitle}\n${shop}${history ? `Earlier:\n${history}\n` : ''}New message from ${msg.from}:\n"${msg.text}"\n\n` +
    'Give exactly 3 reply options, each at most 40 characters.'
  );
}

/**
 * @param {{ from: string, chatTitle: string, text: string }} msg
 * @param {{ from: string, text: string }[]} context earlier messages in the same chat, oldest first
 * @param {string} [customerLine] shop order context line, if the sender is a known customer
 */
export async function llmDrafts(msg, context = [], customerLine = '') {
  const out = await askJson(
    draftsPrompt(msg, context, customerLine),
    stringList('replies', 3),
  );
  const replies = out.replies.map(r => String(r).trim()).filter(Boolean).slice(0, 3);
  if (replies.length < 2) throw new Error('too few replies');
  return replies.map(r => (r.length > 40 ? r.slice(0, 39) + '…' : r));
}

/** @param {{ chatTitle: string, from: string, text: string }[]} unread */
export async function llmDigest(unread) {
  const list = unread.map(m => `[${m.chatTitle}] ${m.from}: ${m.text}`).join('\n');
  const out = await askJson(
    `Unread Telegram messages:\n${list}\n\nSummarise what needs my attention in at most 4 lines, ` +
      'each at most 60 characters, most urgent first. Plain text.',
    stringList('lines', 4),
    'You summarise a messaging inbox for a tiny smart-glasses display. Be concrete, no emoji, no markdown.',
  );
  return out.lines.map(l => String(l).slice(0, 60)).slice(0, 4);
}

/**
 * Clean up a dictated reply: fix ASR errors, drop fillers, keep meaning and language.
 * @param {string} transcript
 * @param {{ from: string, text: string }} msg the message being answered
 */
export async function llmPolish(transcript, msg) {
  const out = await askJson(
    `Incoming message from ${msg.from}: "${msg.text}"\nMy dictated answer (speech-to-text): "${transcript}"\n\n` +
      'Return my answer as a clean chat message, at most 200 characters. Keep my meaning; do not add new content.',
    { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'], additionalProperties: false },
  );
  return String(out.reply).slice(0, 200);
}

export const llmModel = MODEL;
