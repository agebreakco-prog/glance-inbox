// Glance Inbox: glasses controller. One message at a time; act in one tap.
import {
  AudioInputSource,
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  MenuContainerProperty,
  MenuItemProperty,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk';
import { ApiError, api } from './api.ts';
import {
  CLAIMED_OPTIONS,
  MENU,
  REPLY_EXTRA,
  busyPage,
  cardBody,
  cardFooter,
  cardHeader,
  cardPage,
  claimedPage,
  confirmPage,
  digestPage,
  emptyPage,
  errorPage,
  listeningPage,
  repliesPage,
  sendingHeader,
  sendingPage,
  sentPage,
  viewOnlyPage,
  type Msg,
  type Page,
} from './screens.ts';
import { companion } from './companion.ts';

const POLL_MS = 4000;
const SEND_DELAY_S = 3;
const MAX_LISTEN_S = 30;

let bridge: EvenAppBridge;
let created = false;
let page: Page = busyPage('Glance Inbox', 'Connecting…');
/** Message ids already shown in the inbox, to announce new arrivals. */
const seen = new Set<string>();

const state = {
  unread: [] as Msg[],
  idx: 0,
  version: -1 as number | string,
  current: null as Msg | null,
  drafts: [] as string[],
  source: 'rules',
  pendingText: '',
  heard: '',
  sendTimer: 0 as ReturnType<typeof setInterval> | 0,
  listenTimer: 0 as ReturnType<typeof setInterval> | 0,
  audio: [] as Uint8Array[],
  listening: false,
  busy: false,
};

// ---------- rendering ----------

function toContainers(p: Page) {
  const captureList = Boolean(p.list);
  const textObject = p.texts.map(
    t =>
      new TextContainerProperty({
        xPosition: t.x,
        yPosition: t.y,
        width: t.w,
        height: t.h,
        borderWidth: t.border ?? 0,
        borderColor: 8,
        borderRadius: t.radius ?? 0,
        paddingLength: t.pad ?? 0,
        containerID: t.id,
        containerName: t.name,
        content: t.content,
        ...(t.color !== undefined ? { textColor: t.color } : {}),
        isEventCapture: !captureList && t.capture ? 1 : 0,
      }),
  );
  const listObject = p.list
    ? [
        new ListContainerProperty({
          xPosition: p.list.x,
          yPosition: p.list.y,
          width: p.list.w,
          height: p.list.h,
          borderWidth: 0,
          paddingLength: 4,
          containerID: p.list.id,
          containerName: p.list.name,
          itemContainer: new ListItemContainerProperty({
            itemCount: p.list.items.length,
            itemName: p.list.items,
            isItemSelectBorderEn: 1,
          }),
          isEventCapture: 1,
        }),
      ]
    : undefined;
  // Pages without a capturing text box (e.g. "busy") still need one capture container.
  if (!captureList && !textObject.some(t => t.isEventCapture === 1)) textObject[textObject.length - 1].isEventCapture = 1;
  const menuObject = p.menu
    ? new MenuContainerProperty({ menuItems: MENU.map(m => new MenuItemProperty({ itemID: m.itemID, itemName: m.itemName })) })
    : undefined;
  return {
    containerTotalNum: textObject.length + (listObject?.length ?? 0),
    textObject,
    ...(listObject ? { listObject } : {}),
    ...(menuObject ? { menuObject } : {}),
  };
}

async function show(p: Page) {
  page = p;
  companion.currentId = state.current?.id || '';
  companion.render(p);
  const c = toContainers(p);
  if (!created) {
    created = true;
    const r = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(c));
    console.log('[glance] startup page', r === 0 ? 'ok' : `failed (${r})`);
  } else {
    const ok = await bridge.rebuildPageContainer(new RebuildPageContainer(c));
    if (!ok) console.warn('[glance] rebuild failed for', p.key);
  }
}

/** Flicker-free in-place update of one text box on the current page. */
async function patch(id: number, content: string) {
  const box = page.texts.find(t => t.id === id);
  if (!box) return;
  box.content = content;
  companion.render(page);
  await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: id, containerName: box.name, content }));
}

// ---------- inbox ----------

async function refresh(force = false) {
  try {
    const inbox = await api.inbox();
    const changed = inbox.version !== state.version;
    state.version = inbox.version;
    const prevSeen = new Set(seen);
    state.unread = inbox.unread;
    companion.status(`${inbox.count} unread`);
    if (!changed && !force && page.key !== 'error') return;
    if (page.key === 'card' || page.key === 'empty' || page.key === 'error' || page.key === 'busy' || force) {
      if (page.key === 'error') force = true;
      const keep = state.current && state.unread.findIndex(m => m.id === state.current!.id);
      state.idx = typeof keep === 'number' && keep >= 0 ? keep : Math.min(state.idx, Math.max(0, state.unread.length - 1));
      if (page.key === 'card' && !force && keep !== null && keep !== undefined && keep >= 0) {
        // Same message still on screen: update the header in place (no flicker).
        // A newly arrived message is announced there for a moment, then the counter returns.
        // The customer context line and "<name> is answering" are patched in place too.
        state.current = state.unread[state.idx];
        const bodyNow = cardBody(state.current);
        const footNow = cardFooter(state.current);
        if (page.texts.find(t => t.id === 2)?.content !== bodyNow) await patch(2, bodyNow);
        if (page.texts.find(t => t.id === 3)?.content !== footNow) await patch(3, footNow);
        const header = () => cardHeader(state.idx, state.unread.length, state.unread[state.idx]);
        const fresh = state.unread.filter(m => !prevSeen.has(m.id));
        if (fresh.length) {
          const f = fresh[fresh.length - 1];
          await patch(1, `●  New: ${f.from}  ·  ${state.unread.length} unread, swipe to read`);
          console.log('[glance] new message banner');
          const shownId = state.current?.id;
          setTimeout(() => {
            if (page.key === 'card' && state.current?.id === shownId) patch(1, header());
          }, 3000);
        } else {
          await patch(1, header());
        }
      } else {
        await showCard();
      }
    }
    inbox.unread.forEach(m => seen.add(m.id));
  } catch (err) {
    console.warn('[glance] inbox error', err);
    if (page.key === 'busy' || page.key === 'empty' || page.key === 'card' || page.key === 'error') {
      await show(errorPage(`${(err as Error).message} (${api.base})`));
    }
  }
}

async function showCard() {
  if (!state.unread.length) {
    state.current = null;
    return show(emptyPage());
  }
  state.idx = Math.max(0, Math.min(state.idx, state.unread.length - 1));
  state.current = state.unread[state.idx];
  return show(cardPage(state.current, state.idx, state.unread.length));
}

async function step(dir: 1 | -1) {
  if (!state.unread.length) return;
  const next = state.idx + dir;
  if (next < 0 || next >= state.unread.length) return; // stay at the ends
  state.idx = next;
  await showCard();
}

// ---------- replies ----------

async function openReplies() {
  const msg = state.current;
  if (!msg || state.busy) return;
  state.busy = true;
  await show(busyPage(`Reply to ${msg.from}`, 'Drafting replies…'));
  try {
    // Asking for drafts claims the conversation for this wearer.
    const { drafts, source } = await api.drafts(msg.id);
    state.drafts = drafts;
    state.source = source;
    await show(repliesPage(msg, drafts, source));
  } catch (err) {
    if (!(await showIfClaimed(msg, err))) await show(errorPage((err as Error).message));
  } finally {
    state.busy = false;
  }
}

/** Someone else is answering: show who, block the reply, offer view only. */
async function showIfClaimed(msg: Msg, err: unknown) {
  if (!(err instanceof ApiError) || err.status !== 409 || !err.claim) return false;
  msg.claim = err.claim;
  await show(claimedPage(msg, err.claim));
  return true;
}

async function onClaimedSelected(index: number) {
  const msg = state.current;
  if (!msg) return showCard();
  const option = CLAIMED_OPTIONS[index];
  if (option === 'View only') return show(viewOnlyPage(msg, msg.claim));
  if (option === 'Next message') {
    if (state.idx < state.unread.length - 1) state.idx += 1;
    return showCard();
  }
  return showCard();
}

/** Leave the reply flow without sending: free the conversation for colleagues. */
function release(msg: Msg | null) {
  if (msg) api.release(msg.id).catch(() => {});
}

async function onReplySelected(index: number) {
  const msg = state.current;
  if (!msg) return;
  if (index < state.drafts.length) return startSend(state.drafts[index]);
  const extra = REPLY_EXTRA[index - state.drafts.length];
  if (extra === 'Speak a reply') return startListening();
  if (extra === 'Mark read') {
    await api.read(msg.id).catch(() => {});
    state.current = null;
    return refresh(true);
  }
  release(msg);
  return showCard(); // Back
}

/** Drafts are sent after a short countdown; a double-tap cancels. */
async function startSend(text: string) {
  const msg = state.current;
  if (!msg) return;
  state.pendingText = text;
  let left = SEND_DELAY_S;
  await show(sendingPage(msg, text, left));
  clearInterval(state.sendTimer);
  state.sendTimer = setInterval(async () => {
    left -= 1;
    if (page.key !== 'sending') return clearInterval(state.sendTimer);
    if (left > 0) return patch(1, sendingHeader(msg, left));
    clearInterval(state.sendTimer);
    await sendNow(msg, text);
  }, 1000);
}

async function sendNow(msg: Msg, text: string) {
  try {
    const r = await api.send(msg.id, text);
    await show(sentPage(msg, text, r.delivered));
    companion.outbox();
    setTimeout(() => {
      state.current = null;
      refresh(true);
    }, 1600);
  } catch (err) {
    if (await showIfClaimed(msg, err)) return;
    await show(errorPage(`Not sent: ${(err as Error).message}`));
  }
}

function cancelSend() {
  clearInterval(state.sendTimer);
  state.sendTimer = 0;
  return state.current ? show(repliesPage(state.current, state.drafts, state.source)) : showCard();
}

// ---------- voice ----------

async function startListening() {
  const msg = state.current;
  if (!msg || state.listening) return;
  try {
    await api.claim(msg.id); // speaking a reply claims the conversation, like tapping reply
  } catch (err) {
    if (await showIfClaimed(msg, err)) return;
  }
  state.listening = true;
  state.audio = [];
  let secs = 0;
  await show(listeningPage(msg, 0));
  await bridge.audioControl(true, AudioInputSource.Glasses);
  clearInterval(state.listenTimer);
  state.listenTimer = setInterval(() => {
    secs += 1;
    if (page.key !== 'listening') return clearInterval(state.listenTimer);
    patch(1, `●  Listening   ${secs}s`);
    if (secs >= MAX_LISTEN_S) stopListening(true);
  }, 1000);
}

async function stopListening(keep: boolean) {
  if (!state.listening) return;
  state.listening = false;
  clearInterval(state.listenTimer);
  await bridge.audioControl(false);
  const msg = state.current;
  if (!msg) return;
  if (!keep) {
    release(msg);
    return showCard();
  }
  const total = state.audio.reduce((n, c) => n + c.length, 0);
  const pcm = new Uint8Array(total);
  let o = 0;
  for (const c of state.audio) {
    pcm.set(c, o);
    o += c.length;
  }
  await show(busyPage(`Reply to ${msg.from}`, 'Transcribing…'));
  try {
    const r = await api.voiceReply(msg.id, pcm);
    if (!r.reply) {
      await show(busyPage('Voice reply', r.error || 'Did not catch that.'));
      setTimeout(() => showCard(), 1500);
      return;
    }
    state.pendingText = r.reply;
    state.heard = r.transcript;
    await show(confirmPage(msg, r.reply, r.transcript));
  } catch (err) {
    await show(errorPage((err as Error).message));
  }
}

// ---------- digest / menu ----------

async function showDigest() {
  await show(busyPage('Digest', 'Summarising unread…'));
  try {
    const d = await api.digest();
    await show(digestPage(d.lines, state.unread.length, d.source));
  } catch (err) {
    await show(errorPage((err as Error).message));
  }
}

async function onMenu(itemID: number) {
  if (itemID === 1) return showDigest();
  if (itemID === 2) return refresh(true);
  if (itemID === 3) {
    await api.readAll().catch(() => {});
    return refresh(true);
  }
}

// ---------- input ----------

type Gesture = 'tap' | 'double' | 'up' | 'down' | 'hold' | 'release';

async function onGesture(g: Gesture) {
  companion.gesture(g);
  switch (page.key) {
    case 'card':
      if (g === 'tap') return openReplies();
      if (g === 'down') return step(1);
      if (g === 'up') return step(-1);
      if (g === 'hold') return startListening();
      if (g === 'double') return bridge.shutDownPageContainer(1);
      return;
    case 'empty':
    case 'error':
      if (g === 'tap') return refresh(true);
      if (g === 'double') return bridge.shutDownPageContainer(1);
      return;
    case 'replies':
      if (g === 'double') {
        release(state.current);
        return showCard();
      }
      return;
    case 'claimed':
      if (g === 'double') return showCard();
      return;
    case 'view':
      if (g === 'tap' || g === 'double') return showCard();
      if (g === 'down') return step(1);
      if (g === 'up') return step(-1);
      return;
    case 'sending':
      if (g === 'double') return cancelSend();
      return;
    case 'listening':
      if (g === 'release' || g === 'tap') return stopListening(true);
      if (g === 'double') return stopListening(false);
      return;
    case 'confirm':
      if (g === 'tap' && state.current) return sendNow(state.current, state.pendingText);
      if (g === 'double') {
        release(state.current);
        return showCard();
      }
      return;
    case 'digest':
      if (g === 'tap' || g === 'double') return showCard();
      return;
    default:
      return;
  }
}

/** CLICK_EVENT is 0 and protobuf drops zero values, so a bare envelope means "click". */
const typeOf = (e?: { eventType?: OsEventTypeList }) => (e ? (e.eventType ?? OsEventTypeList.CLICK_EVENT) : null);

function wireInput() {
  bridge.onEvenHubEvent(ev => {
    if (ev.audioEvent) {
      if (state.listening) state.audio.push(ev.audioEvent.audioPcm);
      return;
    }
    if (ev.menuItemClickEvent) {
      onMenu(ev.menuItemClickEvent.itemID ?? 0);
      return;
    }
    const sys = typeOf(ev.sysEvent);
    if (sys === OsEventTypeList.LONG_PRESS_EVENT) return void onGesture('hold');
    if (sys === OsEventTypeList.LONG_PRESS_RELEASE_EVENT) return void onGesture('release');
    if (sys === OsEventTypeList.SYSTEM_EXIT_EVENT || sys === OsEventTypeList.ABNORMAL_EXIT_EVENT) return;

    if (ev.listEvent) {
      const t = typeOf(ev.listEvent);
      if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) return void onGesture('double');
      if (t === OsEventTypeList.CLICK_EVENT && page.key === 'replies') {
        return void onReplySelected(ev.listEvent.currentSelectItemIndex ?? 0);
      }
      if (t === OsEventTypeList.CLICK_EVENT && page.key === 'claimed') {
        return void onClaimedSelected(ev.listEvent.currentSelectItemIndex ?? 0);
      }
      return; // list scrolling is handled by the firmware
    }

    const text = typeOf(ev.textEvent);
    if (sys === OsEventTypeList.DOUBLE_CLICK_EVENT || text === OsEventTypeList.DOUBLE_CLICK_EVENT) return void onGesture('double');
    if (text === OsEventTypeList.SCROLL_BOTTOM_EVENT) return void onGesture('down');
    if (text === OsEventTypeList.SCROLL_TOP_EVENT) return void onGesture('up');
    if (sys === OsEventTypeList.CLICK_EVENT || text === OsEventTypeList.CLICK_EVENT) return void onGesture('tap');
  });
}

// ---------- boot ----------

async function main() {
  companion.init(api);
  bridge = await waitForEvenAppBridge();
  await show(busyPage('Glance Inbox', 'Connecting…'));
  wireInput();
  try {
    const h = await api.health();
    companion.health(h);
  } catch {
    /* refresh() shows the error page */
  }
  await refresh(true);
  setInterval(() => refresh(false), POLL_MS);
}

main();
