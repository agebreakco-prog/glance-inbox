// Entry point: `npm run server` (reads .env if present).
import { createApp } from './app.mjs';
import { createStore } from './store.mjs';
import { createTelegram } from './telegram.mjs';
import { seedDemo } from './demo.mjs';
import { llmEnabled, llmModel } from './llm.mjs';
import { sttEnabled } from './stt.mjs';

const PORT = Number(process.env.PORT || 8787);
const token = process.env.TELEGRAM_BOT_TOKEN || '';
const demo = process.env.DEMO_MODE === '1' || !token;
const allowedChatIds = (process.env.TELEGRAM_ALLOWED_CHAT_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const store = createStore();
let telegram = null;

if (demo) {
  seedDemo(store);
  console.log('[mode] DEMO: fictional messages, replies are logged and not sent anywhere.');
} else {
  telegram = createTelegram({ token, allowedChatIds, store });
  await telegram.start();
  console.log(
    allowedChatIds.length
      ? `[mode] TELEGRAM: showing ${allowedChatIds.length} picked chat(s).`
      : '[mode] TELEGRAM: no TELEGRAM_ALLOWED_CHAT_IDS set, showing every chat the bot is in.',
  );
}
console.log(`[ai] ${llmEnabled() ? `Claude (${llmModel})` : 'rule-based drafts (set ANTHROPIC_API_KEY for Claude)'}`);
console.log(`[voice] ${sttEnabled() ? 'STT_URL configured' : demo ? 'demo transcripts' : 'off (set STT_URL)'}`);

const server = createApp({ store, telegram, demo, appToken: process.env.APP_TOKEN || '' });
server.listen(PORT, '0.0.0.0', () => console.log(`[api] http://localhost:${PORT}`));

const shutdown = () => {
  telegram?.stop();
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
