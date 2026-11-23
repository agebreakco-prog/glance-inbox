// Thin client for the Glance Inbox backend (server/app.mjs).
import type { Msg } from './screens.ts';

const BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) || `${location.protocol}//${location.hostname || 'localhost'}:8787`;
const TOKEN: string = (import.meta.env.VITE_APP_TOKEN as string | undefined) || '';

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (TOKEN) headers['x-app-token'] = TOKEN;
  const res = await fetch(`${BASE}${path}`, { ...init, headers, signal: AbortSignal.timeout(20000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body as T;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  base: BASE,
  health: () => req<{ mode: string; ai: string; stt: string }>('/api/health'),
  inbox: () => req<{ version: number; unread: Msg[]; count: number }>('/api/inbox'),
  drafts: (id: string) => req<{ drafts: string[]; source: string }>('/api/drafts', json({ id })),
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
};
