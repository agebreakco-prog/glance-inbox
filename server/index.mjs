// Entry point: `npm run server` (reads .env if present).
import { createApp } from './app.mjs';
import { createStore } from './store.mjs';
import { createTelegram } from './telegram.mjs';
import { DEMO_CUSTOMERS, colleagueClaims, seedDemo } from './demo.mjs';
import { CLAIM_TTL_MS, createClaims } from './claims.mjs';
import { customerContextFromEnv } from './customers.mjs';
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
const claims = createClaims({ ttlMs: Number(process.env.CLAIM_TTL_MS) || CLAIM_TTL_MS });
const customers = customerContextFromEnv(process.env, { demoCustomers: demo ? DEMO_CUSTOMERS : undefined });
let telegram = null;

if (demo) {
  seedDemo(store);
  colleagueClaims(claims);
  console.log('[mode] DEMO: fictional messages, replies are logged and not sent anywhere.');
  console.log('[mode] DEMO: colleague "Lena" is answering Customer #4823 (claim expires in 2 min).');
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
console.log(`[customers] ${customers.enabled ? `context from ${customers.providers.join(' + ')}` : 'off (set CUSTOMER_CONTEXT_FILE or CUSTOMER_CONTEXT_URL)'}`);
console.log(`[voice] ${sttEnabled() ? 'STT_URL configured' : demo ? 'demo transcripts' : 'off (set STT_URL)'}`);

const server = createApp({
  store,
  telegram,
  demo,
  customers,
  claims,
  appToken: process.env.APP_TOKEN || '',
  shopToken: process.env.SHOP_HOOK_TOKEN || '',
});
server.listen(PORT, '0.0.0.0', () => console.log(`[api] http://localhost:${PORT}`));

const shutdown = () => {
  telegram?.stop();
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
