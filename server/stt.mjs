// Speech-to-text for voice replies.
// G2 sends raw PCM (16 kHz, s16le, mono). We wrap it in a WAV header and post it
// to any OpenAI-compatible /audio/transcriptions endpoint (hosted Whisper,
// a local whisper.cpp server, Groq, ...), configured by STT_URL / STT_API_KEY.
// Without STT_URL in demo mode we return a canned transcript so the flow can be shown.

export const sttEnabled = () => Boolean(process.env.STT_URL);

/** @param {Uint8Array} pcm */
export function pcmToWav(pcm, sampleRate = 16000) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, Buffer.from(pcm)]);
}

/** Rough loudness check so we do not send silence to the STT provider. @param {Uint8Array} pcm */
export function rms(pcm) {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let sum = 0;
  const n = Math.floor(pcm.byteLength / 2);
  for (let i = 0; i < n; i++) {
    const s = view.getInt16(i * 2, true) / 32768;
    sum += s * s;
  }
  return n ? Math.sqrt(sum / n) : 0;
}

/** @param {Uint8Array} pcm */
export async function transcribe(pcm) {
  const form = new FormData();
  form.append('file', new Blob([pcmToWav(pcm)], { type: 'audio/wav' }), 'reply.wav');
  form.append('model', process.env.STT_MODEL || 'whisper-1');
  const res = await fetch(/** @type {string} */ (process.env.STT_URL), {
    method: 'POST',
    headers: process.env.STT_API_KEY ? { authorization: `Bearer ${process.env.STT_API_KEY}` } : {},
    body: form,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`STT HTTP ${res.status}`);
  const json = await res.json();
  return String(json.text || '').trim();
}

/** Canned transcripts for the offline demo, picked to fit the message being answered. */
export function demoTranscript(/** @type {string} */ incoming) {
  if (/deck|send/i.test(incoming)) return 'um yeah sending it in five minutes';
  if (/where are you|table/i.test(incoming)) return 'parking now be there in two minutes';
  if (/rye|loaf|have/i.test(incoming)) return 'yes we have two left I can hold one for you until six';
  return 'sounds good talk later';
}
