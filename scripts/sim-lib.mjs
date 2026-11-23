// Helpers for driving the EvenHub simulator's automation API
// (start it with --automation-port 9898; `npm run sim` does).
import { PNG } from 'pngjs';

export const SIM = process.env.SIM_URL || 'http://127.0.0.1:9898';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** @param {'up'|'down'|'click'|'double_click'|'long_press'|'long_press_release'|'context_menu'} action */
export async function input(action) {
  const res = await fetch(`${SIM}/api/input`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error(`input ${action}: HTTP ${res.status}`);
}

/** Raw glasses framebuffer: RGBA PNG where brightness lives in alpha. */
export async function glassesRaw() {
  const res = await fetch(`${SIM}/api/screenshot/glasses`);
  if (!res.ok) throw new Error(`screenshot: HTTP ${res.status}`);
  return PNG.sync.read(Buffer.from(await res.arrayBuffer()));
}

export async function webviewPng() {
  const res = await fetch(`${SIM}/api/screenshot/webview`);
  if (!res.ok) throw new Error(`webview screenshot: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Render the framebuffer the way G2 looks: green light on black, with an optional
 * frame around it, scaled by `scale`. Returns { png, gray } where gray is a
 * 0..255 luminance array (used for GIF encoding).
 * @param {PNG} raw
 */
export function toViewable(raw, { scale = 2, margin = 16 } = {}) {
  const W = raw.width * scale + margin * 2;
  const H = raw.height * scale + margin * 2;
  const out = new PNG({ width: W, height: H });
  const gray = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = Math.floor((x - margin) / scale);
      const sy = Math.floor((y - margin) / scale);
      let v = 0;
      if (sx >= 0 && sy >= 0 && sx < raw.width && sy < raw.height) {
        const i = (sy * raw.width + sx) * 4;
        // Brightness: alpha scaled by the colour channel (whichever is larger).
        const c = Math.max(raw.data[i], raw.data[i + 1], raw.data[i + 2]);
        v = Math.round((raw.data[i + 3] / 255) * (c ? c : 255));
      }
      const o = (y * W + x) * 4;
      const edge = x < margin || y < margin || x >= W - margin || y >= H - margin;
      out.data[o] = edge ? 18 : Math.round(v * 0.36);
      out.data[o + 1] = edge ? 22 : v;
      out.data[o + 2] = edge ? 20 : Math.round(v * 0.54);
      out.data[o + 3] = 255;
      gray[y * W + x] = edge ? 0 : v;
    }
  }
  return { png: PNG.sync.write(out), width: W, height: H, rgba: out.data };
}

/** Wait until the simulator console contains a line matching `re`. */
export async function waitForConsole(re, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const r = await fetch(`${SIM}/api/console`).then(x => x.json()).catch(() => null);
    if (r?.entries?.some(e => re.test(e.message))) return true;
    await sleep(300);
  }
  return false;
}
