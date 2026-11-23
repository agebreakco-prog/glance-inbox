// Pure screen layouts for the 576 x 288 G2 display. No SDK imports here, so the
// layouts can be unit-tested in Node and mirrored in the companion page.

export const W = 576;
export const H = 288;

export type TextBox = {
  id: number;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  content: string;
  border?: number;
  radius?: number;
  pad?: number;
  /** Glyph brightness 0..4 (4 = brightest). */
  color?: number;
  capture?: boolean;
};

export type ListBox = {
  id: number;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  items: string[];
};

export type Page = {
  key: 'card' | 'empty' | 'replies' | 'sending' | 'sent' | 'listening' | 'confirm' | 'digest' | 'busy' | 'error';
  texts: TextBox[];
  /** When present, the list captures input (otherwise the `capture` text box does). */
  list?: ListBox;
  /** Attach the contextual menu (Digest / Refresh / Mark all read). */
  menu?: boolean;
};

export type Msg = { id: string; chatTitle: string; from: string; text: string; date: number };

export const MENU = [
  { itemID: 1, itemName: 'Digest' },
  { itemID: 2, itemName: 'Refresh' },
  { itemID: 3, itemName: 'Mark all read' },
] as const;

export const LIST_MAX_BYTES = 63;
export const CARD_BODY_MAX = 170;

const enc = new TextEncoder();
export const utf8Len = (s: string) => enc.encode(s).length;

/** Truncate to a UTF-8 byte budget (list items and menu labels are byte-limited). */
export function clipBytes(s: string, max: number): string {
  if (utf8Len(s) <= max) return s;
  let out = '';
  for (const ch of s) {
    if (utf8Len(out + ch + '…') > max) break;
    out += ch;
  }
  return out.trimEnd() + '…';
}

/** Truncate to a character budget on a word boundary when possible. */
export function clipChars(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + '…';
}

export function ago(date: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - date) / 60000));
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

const header = (content: string): TextBox => ({ id: 1, name: 'header', x: 0, y: 0, w: W, h: 40, pad: 6, content });
const footer = (content: string): TextBox => ({ id: 3, name: 'footer', x: 0, y: 248, w: W, h: 40, pad: 6, color: 2, content });
const body = (content: string, extra: Partial<TextBox> = {}): TextBox => ({
  id: 2,
  name: 'body',
  x: 0,
  y: 44,
  w: W,
  h: 200,
  border: 1,
  radius: 8,
  pad: 12,
  capture: true,
  content,
  ...extra,
});

export function cardHeader(index: number, total: number, msg: Msg, now = Date.now()) {
  return `● ${total} new   ${index + 1}/${total}   ${msg.chatTitle}  ·  ${ago(msg.date, now)}`;
}

export function cardPage(msg: Msg, index: number, total: number, now = Date.now()): Page {
  return {
    key: 'card',
    menu: true,
    texts: [
      header(cardHeader(index, total, msg, now)),
      body(`${msg.from}\n\n${clipChars(msg.text, CARD_BODY_MAX)}`),
      footer('tap reply   ·   swipe next   ·   hold speak'),
    ],
  };
}

export function emptyPage(note = ''): Page {
  return {
    key: 'empty',
    menu: true,
    texts: [
      header('Glance Inbox'),
      body(`Inbox zero.\n\nNew messages from the chats you picked\nshow up here.${note ? `\n\n${note}` : ''}`),
      footer('tap refresh   ·   double-tap exit'),
    ],
  };
}

export const REPLY_EXTRA = ['Speak a reply', 'Mark read', 'Back'] as const;

export function repliesPage(msg: Msg, drafts: string[], source: string): Page {
  const items = [...drafts.map(d => clipBytes(`> ${d}`, LIST_MAX_BYTES)), ...REPLY_EXTRA.map(s => clipBytes(s, LIST_MAX_BYTES))];
  return {
    key: 'replies',
    texts: [
      header(`Reply to ${firstName(msg.from)}   ·   ${source === 'claude' ? 'AI drafts by Claude' : 'quick replies'}`),
      { id: 2, name: 'quote', x: 0, y: 40, w: W, h: 40, pad: 6, color: 2, content: `"${clipChars(msg.text, 50)}"` },
    ],
    list: { id: 4, name: 'replies', x: 0, y: 84, w: W, h: 204, items },
  };
}

export function sendingPage(msg: Msg, text: string, seconds: number): Page {
  return {
    key: 'sending',
    texts: [
      header(sendingHeader(msg, seconds)),
      body(clipChars(text, 200)),
      footer('double-tap cancel'),
    ],
  };
}

export const sendingHeader = (msg: Msg, seconds: number) => `Sending to ${firstName(msg.from)} in ${seconds}…`;

export function sentPage(msg: Msg, text: string, delivered: boolean): Page {
  return {
    key: 'sent',
    texts: [
      header(delivered ? 'Sent.' : 'Sent.   (demo mode: not delivered)'),
      body(`To ${msg.chatTitle}:\n\n${clipChars(text, 160)}`, { capture: true }),
      footer('next message…'),
    ],
  };
}

export function listeningPage(msg: Msg, seconds = 0): Page {
  return {
    key: 'listening',
    texts: [
      header(`●  Listening   ${seconds}s`),
      body(`Say your reply to ${firstName(msg.from)}.\n\nRelease (or tap) when done.`),
      footer('double-tap cancel'),
    ],
  };
}

export function confirmPage(msg: Msg, reply: string, heard: string): Page {
  return {
    key: 'confirm',
    texts: [
      header(`Reply to ${firstName(msg.from)}?`),
      body(`${clipChars(reply, 180)}${heard && heard !== reply ? `\n\nheard: ${clipChars(heard, 60)}` : ''}`),
      footer('tap send   ·   double-tap discard'),
    ],
  };
}

export function digestPage(lines: string[], count: number, source: string): Page {
  return {
    key: 'digest',
    texts: [
      header(`Digest   ·   ${count} new   ·   ${source === 'claude' ? 'Claude' : 'summary'}`),
      body(lines.map(l => `▶ ${l}`).join('\n'), { border: 0, pad: 8 }),
      footer('tap back'),
    ],
  };
}

export function busyPage(title: string, note: string): Page {
  return { key: 'busy', texts: [header(title), body(note), footer('')] };
}

export function errorPage(note: string): Page {
  return {
    key: 'error',
    texts: [header('Glance Inbox'), body(`Can't reach the inbox server.\n\n${clipChars(note, 120)}`), footer('tap retry   ·   double-tap exit')],
  };
}
