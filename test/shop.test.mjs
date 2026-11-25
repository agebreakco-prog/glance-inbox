// Shop features: customer context line and the multi-staff claim lock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONTEXT_MAX, contextLine, createCustomerContext, httpProvider, jsonFileProvider, memoryProvider, mergeCustomer,
} from '../server/customers.mjs';
import { createClaims } from '../server/claims.mjs';
import { createStore } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import { createTelegram } from '../server/telegram.mjs';
import { seedDemo } from '../server/demo.mjs';
import { ruleDrafts } from '../server/rules.mjs';
import { draftsPrompt } from '../server/llm.mjs';

delete process.env.ANTHROPIC_API_KEY;
delete process.env.STT_URL;

// ---------- customer context ----------

test('context line: last order, note, override, clipped to one card line', () => {
  assert.equal(
    contextLine({ orders: [{ id: '1', items: 'old' }, { id: '1042', items: '2 croissants', status: 'paid', pickup: '15:00' }] }),
    'Last order #1042 · 2 croissants · paid, pickup 15:00',
  );
  assert.equal(contextLine({ note: 'regular' }), 'Customer: regular');
  assert.equal(contextLine({ line: 'VIP', orders: [{ id: '9' }] }), 'VIP');
  assert.equal(contextLine(null), '');
  const long = contextLine({ orders: [{ id: '7', items: 'a very long list of pastries '.repeat(5), status: 'paid' }] });
  assert.ok(long.length <= CONTEXT_MAX && long.endsWith('…'));
});

test('merge: webhook appends new orders and updates known ones', () => {
  let c = mergeCustomer(undefined, { name: 'A', order: { id: 1042, items: '2 croissants', status: 'paid', evil: 'x' } });
  assert.deepEqual(c.orders, [{ id: '1042', items: '2 croissants', status: 'paid' }]);
  c = mergeCustomer(c, { order: { id: '1042', status: 'ready' } });
  assert.equal(c.orders.length, 1);
  assert.equal(c.orders[0].status, 'ready');
  c = mergeCustomer(c, { order: { id: '1050', items: 'bagel' } });
  assert.equal(contextLine(c), 'Last order #1050 · bagel');
});

test('JSON file provider: re-reads on change, webhook writes back', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'glance-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'customers.json');
  const p = jsonFileProvider(file, { log: () => {} });
  assert.equal(p.lookup('42'), null); // missing file = empty
  await writeFile(file, JSON.stringify({ 42: { orders: [{ id: '1', items: 'rye' }] } }));
  assert.equal(contextLine(p.lookup('42')), 'Last order #1 · rye');
  await writeFile(file, JSON.stringify({ 42: { orders: [{ id: '2', items: 'buns' }] } }));
  const later = new Date(Date.now() + 5000);
  await utimes(file, later, later); // make sure the mtime differs on coarse filesystems
  assert.equal(contextLine(p.lookup('42')), 'Last order #2 · buns');
  p.upsert('43', { order: { id: '3', items: 'cake', status: 'paid' } });
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved['43'].orders[0].items, 'cake');
  assert.equal(saved['42'].orders[0].id, '2');
});

test('providers chain: first hit wins, failing provider is skipped, username key works', async () => {
  let calls = 0;
  const http = httpProvider('http://shop.example/lookup', {
    fetchImpl: async url => {
      calls++;
      assert.equal(new URL(url).searchParams.get('user_id'), '77');
      return { ok: true, json: async () => ({ orders: [{ id: '5', items: 'pie' }] }) };
    },
  });
  const broken = { name: 'broken', lookup: () => { throw new Error('down'); } };
  const ctx = createCustomerContext({ providers: [broken, memoryProvider({ '@ann': { note: 'regular' } }), http], log: () => {} });
  assert.equal((await ctx.lookup(['77'])).line, 'Last order #5 · pie');
  await ctx.lookup(['77']);
  assert.equal(calls, 1, 'http lookups are cached');
  assert.equal((await ctx.lookup(['1', '@ann'])).line, 'Customer: regular');
  assert.equal(await createCustomerContext().lookup(['1']), null);
});

test('drafts use the order: rules fallback and Claude prompt', () => {
  const customer = { orders: [{ id: '1047', items: 'sourdough', status: 'paid', pickup: '12:30' }] };
  const moved = ruleDrafts({ from: 'C', text: 'Can I pick up my order at 16:00 instead?' }, customer);
  assert.equal(moved[0], 'Yes, #1047 moved to 16:00');
  assert.ok(moved.every(r => r.length <= 40));
  assert.match(ruleDrafts({ from: 'C', text: 'Is my order ready?' }, customer)[0], /#1047 is ready at 12:30/);
  assert.equal(ruleDrafts({ from: 'C', text: 'Do you still have rye?' }, customer)[1], 'Add one to order #1047?');
  assert.doesNotMatch(ruleDrafts({ from: 'C', text: 'Is my order ready?' }).join(' '), /#/); // no customer: no order talk

  const prompt = draftsPrompt({ from: 'C', chatTitle: 'Bakery', text: 'ready?' }, [], 'Last order #1042 · 2 croissants');
  assert.match(prompt, /Last order #1042 · 2 croissants/);
  assert.match(prompt, /Do not invent/);
  assert.doesNotMatch(draftsPrompt({ from: 'C', chatTitle: 'Bakery', text: 'ready?' }), /order system/);
});

test('telegram messages carry the sender id and username for the lookup', () => {
  const s = createStore();
  const tg = createTelegram({ token: 'x', allowedChatIds: [], store: s, log: () => {} });
  const m = tg.ingest({
    update_id: 1,
    message: { message_id: 3, date: 1, text: 'hi', chat: { id: 555, type: 'private' }, from: { id: 555, first_name: 'Ann', username: 'ann' } },
  });
  assert.equal(m.fromId, '555');
  assert.equal(m.fromUsername, '@ann');
});

// ---------- claim lock ----------

test('claims: first claim wins, renew, release by holder only, expiry', () => {
  let t = 1000;
  const c = createClaims({ ttlMs: 120_000, now: () => t });
  const ana = { id: 'a', name: 'Ana' };
  const ben = { id: 'b', name: 'Ben' };
  assert.equal(c.claim('chat', ana).ok, true);
  const lost = c.claim('chat', ben);
  assert.equal(lost.ok, false);
  assert.equal(lost.claim.by, 'Ana');
  assert.equal(c.heldByOther('chat', ben).by, 'Ana');
  assert.equal(c.heldByOther('chat', ana), null);
  t += 100_000;
  assert.equal(c.claim('chat', ana).ok, true, 'holder renews');
  t += 100_000;
  assert.equal(c.claim('chat', ben).ok, false, 'renewed claim still holds');
  assert.equal(c.release('chat', ben), false, 'only the holder releases');
  t += 30_000;
  assert.equal(c.get('chat'), null, 'expired after 2 min without activity');
  assert.equal(c.claim('chat', ben).ok, true);
  assert.equal(c.release('chat', ben), true);
  assert.equal(c.list().length, 0);
});

async function startApp(t, opts = {}) {
  const store = createStore();
  seedDemo(store);
  const server = createApp({ store, demo: true, log: () => {}, ...opts });
  await new Promise(r => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const as = (id, name) => {
    const headers = { 'content-type': 'application/json', 'x-staff-id': id, 'x-staff-name': name };
    return {
      get: p => fetch(base + p, { headers }).then(async r => ({ status: r.status, ...(await r.json()) })),
      post: (p, b = {}, extra = {}) =>
        fetch(base + p, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(b) }).then(async r => ({ status: r.status, ...(await r.json()) })),
    };
  };
  return { store, base, as };
}

test('HTTP: two staff on one bot, first tap claims, other sees name and is blocked', async t => {
  let now = Date.now();
  const claims = createClaims({ now: () => now });
  const { as, base } = await startApp(t, { claims });
  const ana = as('ana-g2', 'Ana');
  const ben = as('ben-g2', 'Ben');

  const inbox = await ben.get('/api/inbox');
  const customer = inbox.unread.find(m => m.from === 'Customer #4821');
  assert.equal(customer.context, 'Last order #1042 · 2 croissants · paid, pickup 15:00');
  assert.equal(inbox.unread.find(m => m.from === 'Maya Lind').context, undefined);

  const drafts = await ana.post('/api/drafts', { id: customer.id });
  assert.equal(drafts.status, 200);
  assert.equal(drafts.drafts[1], 'Add one to order #1042?', 'rule drafts reference the order');

  const benInbox = await ben.get('/api/inbox');
  assert.notEqual(benInbox.version, inbox.version, 'claim changes the inbox version');
  assert.deepEqual(benInbox.unread.find(m => m.id === customer.id).claim, { by: 'Ana', leftS: 120 });
  assert.equal((await ana.get('/api/inbox')).unread.find(m => m.id === customer.id).claim, undefined, 'own claim not shown');

  const blockedDrafts = await ben.post('/api/drafts', { id: customer.id });
  assert.equal(blockedDrafts.status, 409);
  assert.equal(blockedDrafts.error, 'Being answered by Ana');
  assert.equal((await ben.post('/api/send', { id: customer.id, text: 'Hi' })).status, 409);
  assert.equal((await ben.post('/api/claim', { id: customer.id })).status, 409);
  const voice = await fetch(`${base}/api/voice-reply?id=${customer.id}`, {
    method: 'POST',
    headers: { 'x-staff-id': 'ben-g2', 'x-staff-name': 'Ben' },
    body: new Uint8Array(3200),
  });
  assert.equal(voice.status, 409, 'voice replies are blocked too');

  // Ana sends: claim released, message read.
  assert.equal((await ana.post('/api/send', { id: customer.id, text: 'Yes, we have it!' })).ok, true);
  assert.equal(claims.get('demo-u4821'), null);

  // Expiry: Ben claims another chat and walks away; after 2 min Ana can take it.
  const sam = benInbox.unread.find(m => m.from === 'Sam Ortega');
  assert.equal((await ben.post('/api/claim', { id: sam.id })).ok, true);
  assert.equal((await ana.post('/api/drafts', { id: sam.id })).status, 409);
  now += 121_000;
  assert.equal((await ana.post('/api/drafts', { id: sam.id })).status, 200);
  // Backing out releases.
  assert.equal((await ana.post('/api/release', { id: sam.id })).ok, true);
  assert.equal((await ben.post('/api/claim', { id: sam.id })).ok, true);
});

test('HTTP demo: colleague Lena holds a customer chat; shop webhook updates the card line', async t => {
  const { as } = await startApp(t, { shopToken: 'shop-secret' });
  const me = as('me', 'Me');
  await me.post('/api/demo/reset');
  const inbox = await me.get('/api/inbox');
  const lenas = inbox.unread.find(m => m.from === 'Customer #4823');
  assert.equal(lenas.claim.by, 'Lena');
  assert.match(lenas.context, /#1047/);
  assert.equal((await me.post('/api/drafts', { id: lenas.id })).status, 409);

  const maya = inbox.unread.find(m => m.from === 'Maya Lind');
  const took = await me.post('/api/demo/colleague', { id: maya.id });
  assert.equal(took.claim.by, 'Lena');
  assert.equal((await me.get('/api/inbox')).unread.find(m => m.id === maya.id).claim.by, 'Lena');

  // Webhook: needs the shop token, then the new order shows on the card.
  assert.equal((await me.post('/api/shop/order', { userId: 'demo-u4821', order: { id: '1043' } })).status, 401);
  const hook = await me.post(
    '/api/shop/order',
    { userId: 'demo-u4821', order: { id: '1043', items: 'rye loaf', status: 'paid', pickup: '17:00' } },
    { 'x-shop-token': 'shop-secret' },
  );
  assert.equal(hook.line, 'Last order #1043 · rye loaf · paid, pickup 17:00');
  const card = (await me.get('/api/inbox')).unread.find(m => m.from === 'Customer #4821');
  assert.equal(card.context, hook.line);
  assert.equal((await me.get('/api/health')).customers, 'memory');
});

test('HTTP: shop webhook is off outside demo mode without SHOP_HOOK_TOKEN', async t => {
  const server = createApp({ store: createStore(), demo: false, log: () => {} });
  await new Promise(r => server.listen(0, r));
  t.after(() => server.close());
  const r = await fetch(`http://127.0.0.1:${server.address().port}/api/shop/order`, { method: 'POST', body: '{"userId":"1"}' });
  assert.equal(r.status, 403);
});
