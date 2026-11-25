// Layout checks against the G2 limits. src/screens.ts is transpiled on the fly
// with esbuild (ships with Vite), so the tests need no TypeScript runtime.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const src = await readFile(new URL('../src/screens.ts', import.meta.url), 'utf8');
const { code } = await transform(src, { loader: 'ts', format: 'esm' });
const {
  H, LIST_MAX_BYTES, MENU, W, cardPage, clipBytes, clipChars, confirmPage, digestPage, emptyPage,
  listeningPage, repliesPage, sendingPage, sentPage, utf8Len, ago,
  CARD_BODY_MAX, CONTEXT_MAX, cardBody, cardFooter, claimedPage, viewOnlyPage,
} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const msg = { id: 'm1', chatTitle: 'Falcon team', from: 'Maya Lind', text: 'Can you send the client deck before 3pm? '.repeat(10), date: Date.now() - 5 * 60000 };

const shopMsg = {
  ...msg,
  from: 'Customer #4821',
  context: 'Last order #1042 · 2 croissants · paid, pickup 15:00 · extra words that overflow',
  claim: { by: 'Lena Virtanen', leftS: 95 },
};

const pages = [
  cardPage(msg, 0, 3),
  cardPage(shopMsg, 1, 3),
  claimedPage(shopMsg, shopMsg.claim),
  viewOnlyPage(shopMsg, shopMsg.claim),
  emptyPage(),
  repliesPage(msg, ['Sure, on it', 'Yes, by end of day', 'A very long draft reply that will need to be clipped for the list item byte limit ok'], 'claude'),
  sendingPage(msg, 'Sure, on it', 3),
  sentPage(msg, 'Sure, on it', false),
  listeningPage(msg, 4),
  confirmPage(msg, 'Sending it in five minutes.', 'um sending it in five minutes'),
  digestPage(['a', 'b'], 2, 'rules'),
];

test('every page fits the 576x288 canvas and SDK limits', () => {
  for (const p of pages) {
    const boxes = [...p.texts, ...(p.list ? [p.list] : [])];
    assert.ok(boxes.length <= 8, p.key);
    const ids = new Set(boxes.map(b => b.id));
    assert.equal(ids.size, boxes.length, `${p.key}: unique ids`);
    for (const b of boxes) {
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= W && b.y + b.h <= H, `${p.key}/${b.name} in bounds`);
      assert.ok(b.name.length <= 16, `${p.key}/${b.name} name length`);
    }
    for (const t of p.texts) assert.ok(t.content.length <= 1000, `${p.key}/${t.name} content length`);
    if (p.list) {
      assert.ok(p.list.items.length <= 20);
      for (const i of p.list.items) assert.ok(utf8Len(i) <= LIST_MAX_BYTES, `list item "${i}" bytes`);
    } else {
      assert.ok(p.texts.some(t => t.capture), `${p.key}: one capture box`);
    }
  }
});

test('menu labels fit 32 bytes and ids are unique non-zero', () => {
  assert.ok(MENU.every(m => utf8Len(m.itemName) <= 32 && m.itemID > 0));
  assert.equal(new Set(MENU.map(m => m.itemID)).size, MENU.length);
});

test('clipping helpers', () => {
  assert.equal(clipChars('hello world', 50), 'hello world');
  assert.ok(clipChars('word '.repeat(50), 30).length <= 30);
  assert.ok(utf8Len(clipBytes('ääääääääääääääääääääääääääääääääääääääää', 20)) <= 20);
  assert.equal(ago(Date.now() - 3 * 3600000), '3h');
});

test('customer context line: one line, shares the ~170-char card budget', () => {
  const body = cardBody(shopMsg);
  const [from, ctx, blank, ...text] = body.split('\n');
  assert.equal(from, 'Customer #4821');
  assert.ok(ctx.startsWith('▶ Last order #1042') && ctx.length <= CONTEXT_MAX + 2, ctx);
  assert.equal(blank, '');
  assert.ok(ctx.length - 2 + text.join('\n').length <= CARD_BODY_MAX, 'context + message within budget');
  assert.equal(cardBody(msg).split('\n')[1], '', 'no context: layout unchanged');
});

test('claim: card footer names the colleague, claimed page offers view only', () => {
  assert.match(cardFooter(shopMsg), /^Lena is answering/);
  assert.match(cardFooter(msg), /^tap reply/);
  const p = claimedPage(shopMsg, shopMsg.claim);
  assert.equal(p.texts[0].content, 'Being answered by Lena Virtanen');
  assert.match(p.texts[1].content, /1:35/);
  assert.deepEqual(p.list.items, ['View only', 'Next message', 'Back']);
  const v = viewOnlyPage(shopMsg, shopMsg.claim);
  assert.match(v.texts[0].content, /View only/);
  assert.ok(!v.list && !v.menu, 'view only has no reply actions');
});
