// Thin client for the Glance Inbox backend (server/app.mjs).
import type { Claim, Msg } from './screens.ts';

const BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) || `${location.protocol}//${location.hostname || 'localhost'}:8787`;
const TOKEN: string = (import.meta.env.VITE_APP_TOKEN as string | undefined) || '';

function stored(key: string, make: () => string): string {
  try {
    const v = localStorage.getItem(key);
    if (v) return v;
    const n = make();
    localStorage.setItem(key, n);
    return n;
  } catch {
    return make();
  }
}

/**
 * This wearer's identity for the multi-staff claim lock: a stable random id per
 * device, and a display name from ?staff=Name, VITE_STAFF_NAME or "Staff <id>".
 */
const STAFF_ID = stored('glance.staffId', () => Math.random().toString(36).slice(2, 10));
const STAFF_NAME =
  new URLSearchParams(location.search).get('staff') ||
  (import.meta.env.VITE_STAFF_NAME as string | undefined) ||
  `Staff ${STAFF_ID.slice(0, 3).toUpperCase()}`;

/** Thrown for non-2xx answers; a 409 carries the other staff member's claim. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly claim?: Claim,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string>),
    'x-staff-id': STAFF_ID,
    'x-staff-name': encodeURIComponent(STAFF_NAME),
  };
  if (TOKEN) headers['x-app-token'] = TOKEN;
  const res = await fetch(`${BASE}${path}`, { ...init, headers, signal: AbortSignal.timeout(20000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error || `HTTP ${res.status}`, res.status, body.claim);
  return body as T;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  base: BASE,
  staffName: STAFF_NAME,
  health: () => req<{ mode: string; ai: string; stt: string; customers?: string }>('/api/health'),
  inbox: () => req<{ version: number | string; unread: Msg[]; count: number }>('/api/inbox'),
  /** Also claims the conversation; throws ApiError 409 with `.claim` if someone else holds it. */
  drafts: (id: string) => req<{ drafts: string[]; source: string; context?: string }>('/api/drafts', json({ id })),
  claim: (id: string) => req<{ ok: boolean; until: number }>('/api/claim', json({ id })),
  release: (id: string) => req<{ ok: boolean }>('/api/release', json({ id })),
  send: (id: string, text: string) => req<{ ok: boolean; delivered: boolean }>('/api/send', json({ id, text })),
  read: (id: string) => req<{ ok: boolean }>('/api/read', json({ id })),
  readAll: () => req<{ ok: boolean }>('/api/read-all', json({})),
  digest: () => req<{ lines: string[]; source: string }>('/api/digest'),
  voiceReply: (id: string, pcm: Uint8Array) =>
    req<{ transcript: string; reply: string; error?: string; source?: string }>(`/api/voice-reply?id=${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Blob([pcm as Uint8Array<ArrayBuffer>]),
    }),
  outbox: () => req<{ outbox: { chatTitle: string; text: string; date: number }[]; demo: boolean }>('/api/outbox'),
  demoIncoming: () => req<{ message: Msg }>('/api/demo/incoming', json({})),
  demoColleague: (id?: string) => req<{ ok: boolean; claim: Claim | null }>('/api/demo/colleague', json(id ? { id } : {})),
};
