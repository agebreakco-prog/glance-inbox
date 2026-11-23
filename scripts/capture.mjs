// Drives the full demo in the EvenHub simulator and saves:
//   docs/screenshots/NN-*.png  glasses display, green-on-black, 2x
//   docs/screenshots/webview.png  the companion page (phone side)
//   docs/demo.gif  animated walkthrough of the glasses display
//
// Needs, in three terminals:  npm run server  (demo mode)  ·  npm run dev  ·  npm run sim
// Then: npm run capture
import { mkdir, writeFile } from 'node:fs/promises';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { SIM, glassesRaw, input, sleep, toViewable, waitForConsole, webviewPng } from './sim-lib.mjs';

const API = process.env.API_URL || 'http://127.0.0.1:8787';
const OUT = new URL('../docs/screenshots/', import.meta.url);
await mkdir(OUT, { recursive: true });

// ---- background frame recorder for the GIF ----
/** @type {{ rgba: Uint8Array, width: number, height: number, at: number }[]} */
const frames = [];
let recording = true;
const recorder = (async () => {
  while (recording) {
    try {
      const v = toViewable(await glassesRaw(), { scale: 1, margin: 8 });
      frames.push({ rgba: v.rgba, width: v.width, height: v.height, at: Date.now() });
    } catch {
      /* simulator busy, skip frame */
    }
    await sleep(200);
  }
})();

let n = 0;
async function shot(name) {
  const v = toViewable(await glassesRaw());
  const file = `${String(++n).padStart(2, '0')}-${name}.png`;
  await writeFile(new URL(file, OUT), v.png);
  console.log('saved', file);
}

async function act(action, wait = 900) {
  await input(action);
  await sleep(wait);
}

const post = path => fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });

// Fresh demo inbox, then wait for the app's 4 s poll to pick it up.
await post('/api/demo/reset');
await sleep(5000);
for (let i = 0; i < 4; i++) await act('up', 300);
await sleep(800);

await shot('inbox-card');
await act('click', 1500); // AI / quick reply drafts
await shot('reply-drafts');
await act('click', 700); // pick the first draft: 3 s countdown starts
await shot('sending-countdown');
await sleep(3200);
await shot('sent');
await sleep(2200); // auto-advances to the next unread message
await shot('next-message');
await act('down', 1200); // swipe to the next message
await shot('swipe-next');
await act('long_press', 2200); // hold to speak
await shot('voice-listening');
await act('long_press_release', 2500); // release: transcribe + clean up
await shot('voice-confirm');
await act('click', 1200); // tap to send
await shot('voice-sent');
await sleep(2500);
await fetch(`${SIM}/api/console`, { method: 'DELETE' });
await post('/api/demo/incoming'); // a new message arrives while wearing the glasses
await waitForConsole(/new message banner/, 10000);
await sleep(400);
await shot('new-message-arrives');
await act('context_menu', 1200);
await shot('menu');
await act('click', 2500); // first menu item: Digest
await shot('digest');
await act('click', 1500);
await post('/api/read-all');
await sleep(5000);
await shot('inbox-zero');

recording = false;
await recorder;

try {
  await writeFile(new URL('webview.png', OUT), await webviewPng());
  console.log('saved webview.png');
} catch (e) {
  console.warn('webview screenshot failed:', /** @type {Error} */ (e).message);
}

// ---- GIF: drop duplicate frames, keep real timing ----
const gif = GIFEncoder();
let last = null;
let kept = 0;
for (let i = 0; i < frames.length; i++) {
  const f = frames[i];
  if (last && Buffer.compare(Buffer.from(f.rgba), Buffer.from(last.rgba)) === 0 && i < frames.length - 1) continue;
  const next = frames.slice(i + 1).find(g => Buffer.compare(Buffer.from(g.rgba), Buffer.from(f.rgba)) !== 0);
  const delay = Math.min(2500, Math.max(200, (next ? next.at : f.at + 2000) - f.at));
  const palette = quantize(f.rgba, 16);
  gif.writeFrame(applyPalette(f.rgba, palette), f.width, f.height, { palette, delay });
  last = f;
  kept++;
}
gif.finish();
await writeFile(new URL('../demo.gif', OUT), gif.bytes());
console.log(`saved docs/demo.gif (${kept} frames)`);
