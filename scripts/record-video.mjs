// Records the full demo in the EvenHub simulator and renders docs/demo.mp4
// (1920x1080 H.264, silent): title card, glasses display (2x) with a caption per step,
// the phone companion page on the side, and an end card.
//
// Needs, in three terminals:  npm run server  (demo mode)  ·  npm run dev  ·  npm run sim
// (or npm run sim:headless). Then:  npm run video
//
//   node scripts/record-video.mjs                  record + render
//   node scripts/record-video.mjs --render-only    re-render from the last recording
//   FRAMES_DIR=/some/dir                           where raw frames go (default: OS temp dir)
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import ffmpegPath from 'ffmpeg-static';
import { SIM, input, sleep, toViewable, waitForConsole, webviewPng } from './sim-lib.mjs';

const API = process.env.API_URL || 'http://127.0.0.1:8787';
const FRAMES = process.env.FRAMES_DIR || join(tmpdir(), 'glance-inbox-video');
const DOCS = fileURLToPath(new URL('../docs/', import.meta.url));
const FPS = 10;

// ------------------------------------------------------------------ record

async function record() {
  await rm(FRAMES, { recursive: true, force: true });
  await mkdir(FRAMES, { recursive: true });
  const post = path => fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });

  // Fresh demo inbox, then wait for the app's 4 s poll to pick it up.
  await post('/api/demo/reset');
  await sleep(5000);
  for (let i = 0; i < 4; i++) {
    await input('up');
    await sleep(300);
  }
  await sleep(1500);

  const t0 = Date.now();
  const now = () => (Date.now() - t0) / 1000;
  /** @type {{ t: number, file: string }[]} */ const glasses = [];
  /** @type {{ t: number, file: string }[]} */ const webview = [];
  /** @type {{ t: number, title: string, sub: string }[]} */ const steps = [];
  /** @type {{ t: number, label: string }[]} */ const inputs = [];

  let recording = true;
  const grab = async (list, prefix, fetcher, every) => {
    let i = 0;
    let lastBuf = null;
    while (recording) {
      const start = Date.now();
      try {
        const buf = await fetcher();
        // Store only changed frames; the renderer holds the last one.
        if (!lastBuf || Buffer.compare(buf, lastBuf) !== 0) {
          const file = `${prefix}-${String(i++).padStart(5, '0')}.png`;
          await writeFile(join(FRAMES, file), buf);
          list.push({ t: now(), file });
          lastBuf = buf;
        }
      } catch {
        /* simulator busy, skip frame */
      }
      await sleep(Math.max(0, every - (Date.now() - start)));
    }
  };
  const glassesBuf = async () => {
    const res = await fetch(`${SIM}/api/screenshot/glasses`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  };
  const recorders = [grab(glasses, 'g', glassesBuf, 1000 / FPS), grab(webview, 'w', webviewPng, 300)];

  const step = (title, sub = '') => {
    steps.push({ t: now(), title, sub });
    console.log(`${now().toFixed(1).padStart(6)}s  ${title}`);
  };
  const act = async (action, label, wait) => {
    inputs.push({ t: now(), label });
    await input(action);
    await sleep(wait);
  };

  await sleep(300);
  step('One message at a time', 'Sender, chat, age and unread count. Only the chats you picked.');
  await sleep(8000);

  step('Tap  →  3 AI reply drafts', 'Yes / in-between / decline, drafted from the chat context');
  await act('click', 'Tap', 7000);

  step('Swipe to pick a draft', 'Temple touchpad or R1 ring scrolls the list');
  await act('down', 'Swipe down', 1400);
  await act('down', 'Swipe down', 1400);
  await act('up', 'Swipe up', 1400);
  await act('up', 'Swipe up', 1800);

  step('Tap a draft  →  3 s to cancel', 'Double-tap cancels. Nothing is sent without a tap.');
  await act('click', 'Tap', 3300);

  step('Sent as a threaded reply', 'Shows up in the companion page log (demo mode: not sent to Telegram)');
  await sleep(2600);

  step('Next unread message comes up by itself', 'No need to go back to a list');
  await sleep(5000);

  step('Swipe  →  next message', 'Up / down moves through the unread messages');
  await act('down', 'Swipe down', 5000);

  step('Hold to speak a longer reply', 'G2 mic audio → server speech-to-text → cleaned-up text');
  await act('long_press', 'Hold', 4000);

  step('Release  →  check the text, tap to send', 'demo mode: canned transcript; real speech-to-text when STT_URL is set');
  await act('long_press_release', 'Release', 7000);

  step('Tap  →  sent', 'The reply goes back to the same chat');
  await act('click', 'Tap', 4500);

  step('A new message arrives', 'Shown in the header, without covering what you are reading');
  await fetch(`${SIM}/api/console`, { method: 'DELETE' });
  await post('/api/demo/incoming');
  await waitForConsole(/new message banner/, 10000);
  await sleep(6000);

  step('Menu  →  Digest', 'Everything unread in four lines, most urgent first');
  await act('context_menu', 'Menu', 2500);
  await act('click', 'Tap', 10000);

  step('Mark all read  →  inbox zero', 'Menu: Digest · Refresh · Mark all read');
  await act('click', 'Tap', 2000);
  await act('context_menu', 'Menu', 2000);
  await act('down', 'Swipe down', 1200);
  await act('down', 'Swipe down', 1200);
  await act('click', 'Tap', 6000);

  const end = now();
  recording = false;
  await Promise.all(recorders);
  const meta = { fps: FPS, duration: end, glasses, webview, steps, inputs };
  await writeFile(join(FRAMES, 'meta.json'), JSON.stringify(meta, null, 1));
  console.log(`recorded ${end.toFixed(1)} s: ${glasses.length} glasses frames, ${webview.length} webview frames`);
}

// ------------------------------------------------------------------ render

const W = 1920;
const H = 1080;
const C = {
  bg: '#0b0f0d',
  panel: '#131a16',
  line: '#24302a',
  text: '#eef3ef',
  dim: '#93a39a',
  green: '#5cf08a',
};
const FONT_DIR = '/usr/share/fonts/truetype/dejavu/';
GlobalFonts.registerFromPath(FONT_DIR + 'DejaVuSans.ttf', 'Sans');
GlobalFonts.registerFromPath(FONT_DIR + 'DejaVuSans-Bold.ttf', 'SansBold');

const DEMO_NOTE = 'demo mode: rule-based drafts; Claude drafts when ANTHROPIC_API_KEY is set';

/** Latest entry with t <= time (entries sorted by t). */
function at(list, time) {
  let lo = 0;
  let hi = list.length - 1;
  let best = list[0];
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t <= time) {
      best = list[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function fitText(ctx, text, maxW, size, family) {
  let s = size;
  do {
    ctx.font = `${s}px ${family}`;
    if (ctx.measureText(text).width <= maxW) break;
    s -= 2;
  } while (s > 12);
  return s;
}

function drawCard(ctx, lines) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  let y = 0;
  for (const l of lines) {
    y += l.gap ?? 0;
    ctx.fillStyle = l.color ?? C.text;
    ctx.font = `${l.size}px ${l.bold ? 'SansBold' : 'Sans'}`;
    ctx.textAlign = 'center';
    if (l.parts) {
      // multi-colour line
      const total = l.parts.reduce((s, p) => s + ctx.measureText(p[0]).width, 0);
      let x = W / 2 - total / 2;
      ctx.textAlign = 'left';
      for (const [t, col] of l.parts) {
        ctx.fillStyle = col;
        ctx.fillText(t, x, y);
        x += ctx.measureText(t).width;
      }
    } else ctx.fillText(l.text, W / 2, y);
  }
  ctx.textAlign = 'left';
}

function titleCard(ctx) {
  drawCard(ctx, [
    { gap: 400, size: 96, bold: true, parts: [['Glance ', C.text], ['Inbox', C.green]] },
    { gap: 80, size: 40, text: 'Telegram on Even Realities G2 glasses', color: C.text },
    { gap: 60, size: 32, text: 'Read one message. Reply in one tap.', color: C.dim },
    { gap: 200, size: 26, text: 'Recorded in the EvenHub simulator  ·  ' + DEMO_NOTE, color: C.dim },
  ]);
}

function endCard(ctx) {
  drawCard(ctx, [
    { gap: 250, size: 80, bold: true, parts: [['Glance ', C.text], ['Inbox', C.green]] },
    { gap: 70, size: 36, text: 'Reply to anything in two taps.', color: C.text },
    { gap: 110, size: 30, text: 'Telegram Bot API + a small Node backend. Keys stay on the server.', color: C.dim },
    { gap: 55, size: 30, text: 'Only the chats you pick are shown. Nothing is sent without a tap.', color: C.dim },
    { gap: 55, size: 30, text: 'Claude drafts the replies; rule-based fallback without an API key.', color: C.dim },
    { gap: 110, size: 30, text: 'github.com/agebreakco-prog/glance-inbox  ·  MIT', color: C.green },
  ]);
}

async function render() {
  const meta = JSON.parse(await readFile(join(FRAMES, 'meta.json'), 'utf8'));
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const imgCache = new Map();
  async function glassesImg(file) {
    if (!imgCache.has(file)) {
      if (imgCache.size > 40) imgCache.clear();
      const raw = PNG.sync.read(await readFile(join(FRAMES, file)));
      imgCache.set(file, await loadImage(toViewable(raw, { scale: 2, margin: 16 }).png));
    }
    return imgCache.get(file);
  }
  async function webviewImg(file) {
    const key = 'w:' + file;
    if (!imgCache.has(key)) imgCache.set(key, await loadImage(await readFile(join(FRAMES, file))));
    return imgCache.get(key);
  }

  const out = join(DOCS, 'demo.mp4');
  const ff = spawn(
    ffmpegPath,
    [
      '-y', '-loglevel', 'error',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-',
      '-vf', 'fps=30,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-tune', 'stillimage',
      '-movflags', '+faststart', out,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const done = new Promise((res, rej) => ff.on('close', code => (code === 0 ? res() : rej(new Error('ffmpeg exit ' + code)))));
  let lastFrame = null;
  const write = async (reuse = false) => {
    if (!reuse || !lastFrame) {
      const data = ctx.getImageData(0, 0, W, H).data;
      lastFrame = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    }
    if (!ff.stdin.write(lastFrame)) {
      await new Promise(r => ff.stdin.once('drain', r));
    }
  };

  const fade = async (drawFn, seconds) => {
    const n = Math.round(seconds * FPS);
    for (let i = 0; i < n; i++) {
      drawFn(ctx);
      const a = Math.min(1, i / 6, (n - 1 - i) / 6);
      if (a < 1) {
        ctx.fillStyle = `rgba(11,15,13,${1 - a})`;
        ctx.fillRect(0, 0, W, H);
      }
      await write();
    }
  };

  // 1. title card
  await fade(titleCard, 5);

  // 2. the recording
  const G = { x: 48, y: 170, w: 1184, h: 608 }; // glasses 576x288 at 2x + 16 px frame
  const V = { x: 1312, y: 170, w: 560, h: 747 }; // companion page, 600x800 scaled
  const total = Math.round(meta.duration * FPS);
  const stepCount = meta.steps.length;
  let lastKey = '';
  for (let f = 0; f < total; f++) {
    const t = f / FPS;
    // Most frames are identical to the previous one: only redraw when something changes.
    const li = [...meta.inputs].reverse().find(i => i.t <= t);
    const key = [at(meta.glasses, t)?.file, at(meta.webview, t)?.file, meta.steps.filter(s => s.t <= t + 0.05).length,
      li && t - li.t < 1.6 ? li.t : ''].join('|');
    if (key === lastKey) {
      await write(true);
      continue;
    }
    lastKey = key;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    // header
    ctx.font = '40px SansBold';
    ctx.fillStyle = C.text;
    ctx.fillText('Glance', 48, 78);
    const gw = ctx.measureText('Glance ').width;
    ctx.fillStyle = C.green;
    ctx.fillText('Inbox', 48 + gw, 78);
    ctx.font = '24px Sans';
    ctx.fillStyle = C.dim;
    ctx.textAlign = 'right';
    ctx.fillText('Telegram on Even Realities G2  ·  recorded in the EvenHub simulator', W - 48, 76);
    ctx.textAlign = 'left';

    // labels
    ctx.font = '22px SansBold';
    ctx.fillStyle = C.dim;
    ctx.fillText('G2 GLASSES DISPLAY  (576 × 288, shown 2×)', G.x, G.y - 16);
    ctx.fillText('PHONE COMPANION PAGE', V.x, V.y - 16);

    // glasses
    const g = at(meta.glasses, t);
    if (g) ctx.drawImage(await glassesImg(g.file), G.x, G.y, G.w, G.h);
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    roundRect(ctx, G.x - 1, G.y - 1, G.w + 2, G.h + 2, 6);
    ctx.stroke();

    // companion page
    const w = at(meta.webview, t);
    if (w) {
      ctx.save();
      roundRect(ctx, V.x, V.y, V.w, V.h, 12);
      ctx.clip();
      ctx.drawImage(await webviewImg(w.file), V.x, V.y, V.w, V.h);
      ctx.restore();
    }
    roundRect(ctx, V.x, V.y, V.w, V.h, 12);
    ctx.stroke();

    // gesture chip + step counter under the glasses
    const si = meta.steps.filter(s => s.t <= t + 0.05).length - 1;
    ctx.font = '24px Sans';
    ctx.fillStyle = C.dim;
    ctx.fillText(`Step ${Math.max(1, si + 1)} / ${stepCount}`, G.x, G.y + G.h + 52);
    const lastInput = [...meta.inputs].reverse().find(i => i.t <= t);
    if (lastInput && t - lastInput.t < 1.6) {
      const label = `INPUT:  ${lastInput.label.toUpperCase()}`;
      ctx.font = '26px SansBold';
      const tw = ctx.measureText(label).width;
      const cx = G.x + G.w - tw - 40;
      ctx.fillStyle = C.green;
      roundRect(ctx, cx, G.y + G.h + 20, tw + 40, 46, 23);
      ctx.fill();
      ctx.fillStyle = '#04120a';
      ctx.fillText(label, cx + 20, G.y + G.h + 53);
    }

    // caption bar
    const s = meta.steps[Math.max(0, si)];
    const by = 930;
    ctx.fillStyle = C.panel;
    roundRect(ctx, 48, by, W - 96, 108, 14);
    ctx.fill();
    ctx.fillStyle = C.green;
    ctx.fillRect(48, by, 8, 108);
    const ts = fitText(ctx, s.title, 820, 40, 'SansBold');
    ctx.font = `${ts}px SansBold`;
    ctx.fillStyle = C.text;
    ctx.fillText(s.title, 84, by + 68);
    const ss = fitText(ctx, s.sub, W - 96 - 920, 26, 'Sans');
    ctx.font = `${ss}px Sans`;
    ctx.fillStyle = C.dim;
    ctx.fillText(s.sub, 920, by + 64);

    // honesty note
    ctx.font = '19px Sans';
    ctx.fillStyle = '#6f7f76';
    ctx.fillText(DEMO_NOTE, G.x, G.y + G.h + 100);

    await write();
    if (f % 100 === 0) process.stdout.write(`\rrender ${f}/${total}`);
  }

  // 3. end card
  await fade(endCard, 7);
  ff.stdin.end();
  await done;
  console.log(`\nsaved docs/demo.mp4 (${(5 + meta.duration + 7).toFixed(1)} s)`);
}

if (!process.argv.includes('--render-only')) await record();
await render();
