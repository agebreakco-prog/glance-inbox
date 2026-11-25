import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleDigest, ruleDrafts, rulePolish } from '../server/rules.mjs';
import { createStore } from '../server/store.mjs';
import { createTelegram } from '../server/telegram.mjs';
import { createApp } from '../server/app.mjs';
import { seedDemo } from '../server/demo.mjs';
import { pcmToWav, rms } from '../server/stt.mjs';

delete process.env.ANTHROPIC_API_KEY; // tests never call the network
delete process.env.STT_URL;

test('rule drafts: 3 short replies matched to intent', () => {
  const eta = ruleDrafts({ from: 'Sam Ortega', text: 'Where are you? Table is booked' });
  assert.equal(eta.length, 3);
  assert.match(eta[0], /way/i);
  const req = ruleDrafts({ from: 'Maya', text: 'Can you send the deck before 3pm?' });
  assert.ok(req.every(r => r.length <= 40));
  assert.deepEqual(ruleDrafts({ from: 'A', text: 'ok' }).length, 3);
  assert.match(ruleDrafts({ from: 'Lea Park', text: 'hey' })[0], /Lea/);
});

test('rule polish cleans dictation', () => {
  assert.equal(rulePolish('um yeah sending it in five minutes'), 'Yeah sending it in five minutes.');
  assert.equal(rulePolish('  '), '');
});

test('rule digest groups by chat, max 4 lines', () => {
  const lines = ruleDigest([
    { chatTitle: 'Team', from: 'A', text: 'one' },
    { chatTitle: 'Team', from: 'B', text: 'two' },
    { chatTitle: 'Sam', from: 'Sam', text: 'hi' },
  ]);
  assert.deepEqual(lines, ['Team (2): two', 'Sam (1): hi']);
  assert.deepEqual(ruleDigest([]), ['Inbox zero. Nothing new.']);
});

test('store: unread excludes read and outgoing', () => {
  const s = createStore();
  const a = s.add({ chatId: 'c', chatTitle: 'C', from: 'X', text: 'a', date: 1 });
  s.add({ chatId: 'c', chatTitle: 'C', from: 'X', text: 'b', date: 2 });
  s.markRead(a.id);
  s.recordSent({ chatId: 'c', chatTitle: 'C', inReplyTo: a.id, text: 'reply' });
  assert.deepEqual(s.unread().map(m => m.text), ['b']);
  assert.equal(s.outbox()[0].text, 'reply');
});

test('telegram: allowlist filters chats and maps fields', () => {
  const s = createStore();
  const tg = createTelegram({ token: 'x', allowedChatIds: ['42'], store: s, log: () => {} });
  const msg = (chatId, text) => ({
    update_id: 1,
    message: { message_id: 7, date: 1700000000, text, chat: { id: chatId, type: 'private', first_name: 'Test' }, from: { first_name: 'Test', last_name: 'User' } },
  });
  assert.equal(tg.ingest(msg(99, 'ignored')), null);
  const m = tg.ingest(msg(42, 'hello'));
  assert.equal(m.from, 'Test User');
  assert.equal(m.telegramMessageId, 7);
  assert.equal(s.unread().length, 1);
  assert.equal(tg.ingest({ update_id: 2, message: { chat: { id: 42 }, photo: [] } }), null);
});

test('telegram: send uses reply_parameters', async () => {
  let body;
  const fetchImpl = async (_url, init) => {
    body = JSON.parse(init.body);
    return { json: async () => ({ ok: true, result: { message_id: 8 } }) };
  };
  const tg = createTelegram({ token: 'x', allowedChatIds: [], store: createStore(), log: () => {}, fetchImpl });
  await tg.send({ chatId: '42', text: 'hi', replyToMessageId: 7 });
  assert.deepEqual(body, { chat_id: '42', text: 'hi', reply_parameters: { message_id: 7, allow_sending_without_reply: true } });
});

test('wav header wraps PCM', () => {
  const wav = pcmToWav(new Uint8Array(3200));
  assert.equal(wav.length, 44 + 3200);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(rms(new Uint8Array(3200)), 0);
});

test('HTTP API end to end in demo mode', async t => {
  const store = createStore();
  seedDemo(store);
  const server = createApp({ store, demo: true, log: () => {} });
  await new Promise(r => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = p => fetch(base + p).then(r => r.json());
  const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());

  const health = await get('/api/health');
  assert.equal(health.mode, 'demo');
  assert.equal(health.ai, 'rules');

  const inbox = await get('/api/inbox');
  assert.equal(inbox.count, 5);
  const first = inbox.unread[0];

  const d = await post('/api/drafts', { id: first.id });
  assert.equal(d.drafts.length, 3);
  assert.equal(d.source, 'rules');

  const sent = await post('/api/send', { id: first.id, text: d.drafts[0] });
  assert.equal(sent.ok, true);
  assert.equal(sent.delivered, false);
  assert.equal((await get('/api/inbox')).count, 4);
  assert.equal((await get('/api/outbox')).outbox[0].text, d.drafts[0]);

  const voice = await fetch(`${base}/api/voice-reply?id=${inbox.unread[1].id}`, { method: 'POST', body: new Uint8Array(3200) }).then(r => r.json());
  assert.match(voice.reply, /^Parking now/);

  const digest = await get('/api/digest');
  assert.ok(digest.lines.length >= 1 && digest.lines.length <= 4);

  await post('/api/demo/incoming', {});
  assert.equal((await get('/api/inbox')).count, 5);
  await post('/api/read-all', {});
  assert.equal((await get('/api/inbox')).count, 0);

  const bad = await fetch(base + '/api/send', { method: 'POST', body: JSON.stringify({ id: 'nope', text: 'x' }) });
  assert.equal(bad.status, 404);
});

test('HTTP API enforces APP_TOKEN when set', async t => {
  const server = createApp({ store: createStore(), demo: true, appToken: 'secret', log: () => {} });
  await new Promise(r => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/api/inbox')).status, 401);
  assert.equal((await fetch(base + '/api/inbox', { headers: { 'x-app-token': 'secret' } })).status, 200);
  assert.equal((await fetch(base + '/api/health')).status, 200);
});
