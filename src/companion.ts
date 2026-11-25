// Companion view inside the Even app WebView (the phone screen).
// It mirrors what the glasses show, lists sent replies and, in demo mode,
// can inject a new incoming message. The glasses never depend on it.
import type { Page } from './screens.ts';
import type { api as Api } from './api.ts';

let apiRef: typeof Api | null = null;
const $ = (id: string) => document.getElementById(id);

function esc(s: string) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export const companion = {
  init(api: typeof Api) {
    apiRef = api;
    $('demo-incoming')?.addEventListener('click', async () => {
      try {
        const r = await api.demoIncoming();
        companion.toast(`New message from ${r.message.from}`);
      } catch (e) {
        companion.toast((e as Error).message);
      }
    });
    // Demo: Lena, a second staff member, taps reply on the current customer chat.
    $('demo-colleague')?.addEventListener('click', async () => {
      try {
        const r = await api.demoColleague(companion.currentId || undefined);
        companion.toast(r.ok && r.claim ? `${r.claim.by} is now answering this chat` : 'Already taken by someone else');
      } catch (e) {
        companion.toast((e as Error).message);
      }
    });
    companion.outbox();
  },

  /** Message on the glasses right now (set by main.ts), for the colleague demo button. */
  currentId: '' as string,

  render(p: Page) {
    const el = $('mirror');
    if (!el) return;
    const boxes = p.texts.map(
      t =>
        `<div class="box${t.border ? ' bordered' : ''}" style="left:${t.x}px;top:${t.y}px;width:${t.w}px;height:${t.h}px;padding:${t.pad ?? 0}px;opacity:${0.4 + 0.15 * (t.color ?? 4)}">${esc(t.content)}</div>`,
    );
    if (p.list) {
      const l = p.list;
      boxes.push(
        `<div class="box list" style="left:${l.x}px;top:${l.y}px;width:${l.w}px;height:${l.h}px">${l.items.map(i => `<div>${esc(i)}</div>`).join('')}</div>`,
      );
    }
    el.innerHTML = boxes.join('');
    const k = $('page-key');
    if (k) k.textContent = p.key;
  },

  status(s: string) {
    const el = $('status');
    if (el) el.textContent = s;
  },

  health(h: { mode: string; ai: string; stt: string; customers?: string }) {
    const el = $('health');
    if (el) {
      el.innerHTML =
        `<b>${esc(h.mode)}</b> mode · AI: ${esc(h.ai)} · voice: ${esc(h.stt)}` +
        (h.customers ? ` · orders: ${esc(h.customers)}` : '') +
        ` · you: ${esc(apiRef?.staffName || '')}`;
    }
    for (const id of ['demo-incoming', 'demo-colleague']) {
      const b = $(id);
      if (b) b.hidden = h.mode !== 'demo';
    }
  },

  gesture(g: string) {
    const el = $('gesture');
    if (el) el.textContent = g;
  },

  async outbox() {
    const el = $('outbox');
    if (!el || !apiRef) return;
    try {
      const { outbox } = await apiRef.outbox();
      el.innerHTML = outbox.length
        ? outbox.map(o => `<li><span>${esc(o.chatTitle)}</span>${esc(o.text)}</li>`).join('')
        : '<li class="muted">No replies sent yet</li>';
    } catch {
      el.innerHTML = '<li class="muted">Server offline</li>';
    }
  },

  toast(s: string) {
    const el = $('toast');
    if (!el) return;
    el.textContent = s;
    el.classList.add('on');
    setTimeout(() => el.classList.remove('on'), 2200);
  },
};
