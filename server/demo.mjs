// Fictional demo data. No real people, chats or messages.
// Used when TELEGRAM_BOT_TOKEN is not set (or DEMO_MODE=1).

const MIN = 60_000;

export const DEMO_MESSAGES = [
  { chatId: 'demo-team', chatTitle: 'Falcon team', from: 'Maya Lind', text: 'Can you send the client deck before 3pm? They moved the call up.', ago: 14 },
  { chatId: 'demo-sam', chatTitle: 'Sam Ortega', from: 'Sam Ortega', text: 'Where are you? Table is booked for 7:30', ago: 6 },
  { chatId: 'demo-shop', chatTitle: 'Bakery Bot orders', from: 'Customer #4821', text: 'Hi! Do you still have the rye loaf today?', ago: 3 },
  { chatId: 'demo-team', chatTitle: 'Falcon team', from: 'Jonas Berg', text: 'Standup moved to 10:15, join from the car?', ago: 1 },
];

/** Messages that "arrive" one by one when the demo button is pressed. */
export const DEMO_INCOMING = [
  { chatId: 'demo-sam', chatTitle: 'Sam Ortega', from: 'Sam Ortega', text: 'Also, can you grab tickets for Saturday?' },
  { chatId: 'demo-shop', chatTitle: 'Bakery Bot orders', from: 'Customer #4822', text: 'Thanks for the quick delivery yesterday!' },
  { chatId: 'demo-team', chatTitle: 'Falcon team', from: 'Maya Lind', text: 'Client says the deck looks great. Ship it?' },
];

/** @param {ReturnType<typeof import('./store.mjs').createStore>} store */
export function seedDemo(store, now = Date.now()) {
  for (const m of DEMO_MESSAGES) {
    const { ago, ...rest } = m;
    store.add({ ...rest, date: now - ago * MIN });
  }
}

let next = 0;
/** @param {ReturnType<typeof import('./store.mjs').createStore>} store */
export function demoIncoming(store) {
  const m = DEMO_INCOMING[next++ % DEMO_INCOMING.length];
  return store.add({ ...m, date: Date.now() });
}
