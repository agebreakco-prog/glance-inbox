// Fictional demo data. No real people, chats, orders or messages.
// Used when TELEGRAM_BOT_TOKEN is not set (or DEMO_MODE=1).

const MIN = 60_000;

// Bot customers write to the shop bot in their own private chat, so each one
// has their own chatId (= their Telegram user id in real use) and fromId.
export const DEMO_MESSAGES = [
  { chatId: 'demo-team', chatTitle: 'Falcon team', from: 'Maya Lind', fromId: 'demo-maya', text: 'Can you send the client deck before 3pm? They moved the call up.', ago: 14 },
  { chatId: 'demo-sam', chatTitle: 'Sam Ortega', from: 'Sam Ortega', fromId: 'demo-sam', text: 'Where are you? Table is booked for 7:30', ago: 6 },
  { chatId: 'demo-u4821', chatTitle: 'Bakery Bot orders', from: 'Customer #4821', fromId: 'demo-u4821', text: 'Hi! Do you still have the rye loaf today?', ago: 3 },
  { chatId: 'demo-team', chatTitle: 'Falcon team', from: 'Jonas Berg', fromId: 'demo-jonas', text: 'Standup moved to 10:15, join from the car?', ago: 1 },
  { chatId: 'demo-u4823', chatTitle: 'Bakery Bot orders', from: 'Customer #4823', fromId: 'demo-u4823', text: 'Can I pick up my order at 16:00 instead?', ago: 0.5 },
];

/** Messages that "arrive" one by one when the demo button is pressed. */
export const DEMO_INCOMING = [
  { chatId: 'demo-sam', chatTitle: 'Sam Ortega', from: 'Sam Ortega', fromId: 'demo-sam', text: 'Also, can you grab tickets for Saturday?' },
  { chatId: 'demo-u4822', chatTitle: 'Bakery Bot orders', from: 'Customer #4822', fromId: 'demo-u4822', text: 'Thanks for the quick delivery yesterday!' },
  { chatId: 'demo-team', chatTitle: 'Falcon team', from: 'Maya Lind', fromId: 'demo-maya', text: 'Client says the deck looks great. Ship it?' },
];

/**
 * The bakery's order records, keyed by Telegram user id. In real use these come
 * from CUSTOMER_CONTEXT_FILE, CUSTOMER_CONTEXT_URL or the POST /api/shop/order webhook.
 * @type {Record<string, import('./customers.mjs').Customer>}
 */
export const DEMO_CUSTOMERS = {
  'demo-u4821': { orders: [{ id: '1042', items: '2 croissants', status: 'paid', pickup: '15:00' }] },
  'demo-u4822': { orders: [{ id: '1039', items: 'birthday cake', status: 'delivered yesterday' }] },
  'demo-u4823': { note: 'regular', orders: [{ id: '1047', items: 'sourdough + 6 buns', status: 'paid', pickup: '12:30' }] },
};

/** The simulated second staff member who also answers the bakery bot. */
export const DEMO_COLLEAGUE = { id: 'demo-colleague', name: 'Lena' };
/** Conversation Lena is already answering when the demo starts. */
export const DEMO_COLLEAGUE_CHAT = 'demo-u4823';

/** @param {ReturnType<typeof import('./store.mjs').createStore>} store */
export function seedDemo(store, now = Date.now()) {
  for (const m of DEMO_MESSAGES) {
    const { ago, ...rest } = m;
    store.add({ ...rest, date: now - ago * MIN });
  }
}

/**
 * Lena taps reply on a customer conversation, as a second G2 wearer would.
 * @param {ReturnType<typeof import('./claims.mjs').createClaims>} claims
 * @param {string} [chatId]
 */
export function colleagueClaims(claims, chatId = DEMO_COLLEAGUE_CHAT) {
  return claims.claim(chatId, DEMO_COLLEAGUE);
}

let next = 0;
/** @param {ReturnType<typeof import('./store.mjs').createStore>} store */
export function demoIncoming(store) {
  const m = DEMO_INCOMING[next++ % DEMO_INCOMING.length];
  return store.add({ ...m, date: Date.now() });
}
