import { NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getSubscriptionPlan, validateUserAndToken } from '@/utils/access';
import { UsageStatsManager } from '@/utils/usage';

// Server-side proxy for Fish Audio TTS, the premium voices of Lis et Lead.
// Used by the web platform because the Fish Audio REST API does not send CORS
// headers and because the API key must stay on the server. The Tauri apps go
// through the relay (relay/fish-audio) instead. See FishAudioTTSClient.
//
// Premium voices are a Plus feature, metered per month so that every
// subscriber stays profitable: Fish Audio S2.1 Pro costs $15 per million UTF-8
// bytes, about $1.25 per hour of audio (docs.fish.audio, read 22 Nov 2026).
// A free reader gets a short taste each month to hear the difference.
const FISH_AUDIO_TTS_URL = 'https://api.fish.audio/v1/tts';
// ?timestamps=1: same synthesis plus per-word timings, streamed back untouched
// as Server-Sent Events (parsed by services/tts/fishTimestamps.ts).
const FISH_AUDIO_TIMED_URL = 'https://api.fish.audio/v1/tts/stream/with-timestamp';
// The paid model: the free one (s2.1-pro-free) is meant for personal use.
const FISH_AUDIO_MODEL = 's2.1-pro';
// About 1,250 characters of French per minute of speech.
const PAID_VOICE_CHARS_PER_MONTH = 75_000; // ~1 hour
const FREE_VOICE_CHARS_PER_MONTH = 2_500; // ~2 minutes
const USAGE_TYPE = 'premium_voice_chars';
const MAX_CHARS_PER_REQUEST = 2_000;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const refuse = (status: number, error: string) => Response.json({ error }, { status });

// Shared memory of the premium voice: the same sentence, read by the same
// voice with the same settings, is synthesized (and paid) once for everyone,
// then served from R2 (prefix voix/). Every reader of the welcome book, every
// second listening, every other device: free. A hit does not count against
// the reader's monthly allowance, since it costs nothing.
interface VoiceBucket {
  get: (key: string) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> } | null>;
  put: (
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ) => Promise<unknown>;
}
const getVoiceBucket = (): VoiceBucket | undefined => {
  try {
    return (getCloudflareContext().env as { VOICE_CACHE?: VoiceBucket }).VOICE_CACHE;
  } catch {
    return undefined;
  }
};
const cacheKeyFor = async (body: string, timed: boolean) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `voix/${FISH_AUDIO_MODEL}/${timed ? 'timed' : 'mp3'}/${hex}`;
};

export async function POST(req: NextRequest) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) return refuse(401, 'NOT_AUTHENTICATED');

  const apiKey = process.env['FISHAUDIO_API_KEY'];
  if (!apiKey) return refuse(503, 'Premium voices not configured');

  const body = await req.text();
  let text = '';
  try {
    const parsed = JSON.parse(body) as { text?: unknown };
    text = typeof parsed.text === 'string' ? parsed.text : '';
  } catch {
    return refuse(400, 'invalid json');
  }
  if (!text.trim()) return refuse(400, 'text required');
  if (text.length > MAX_CHARS_PER_REQUEST) return refuse(413, 'text too long');

  const timed = req.nextUrl.searchParams.get('timestamps') === '1';
  const contentType = timed ? 'text/event-stream' : 'audio/mpeg';
  const bucket = getVoiceBucket();
  const cacheKey = await cacheKeyFor(body, timed);
  if (bucket) {
    const hit = await bucket.get(cacheKey).catch(() => null);
    if (hit) {
      return new Response(await hit.arrayBuffer(), {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'no-store',
          'X-Voice-Cache': 'hit',
        },
      });
    }
  }

  const plan = getSubscriptionPlan(token);
  const paid = plan !== 'free';
  const used = await UsageStatsManager.getCurrentUsage(user.id, USAGE_TYPE, 'monthly');
  const allowance = paid ? PAID_VOICE_CHARS_PER_MONTH : FREE_VOICE_CHARS_PER_MONTH;
  if (used + text.length > allowance) {
    return refuse(paid ? 429 : 402, paid ? 'VOICE_QUOTA_EXCEEDED' : 'PLUS_REQUIRED');
  }

  let upstream: Response;
  try {
    upstream = await fetch(timed ? FISH_AUDIO_TIMED_URL : FISH_AUDIO_TTS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        model: FISH_AUDIO_MODEL,
      },
      body,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`Fish Audio upstream error: ${message}`, { status: 502 });
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    // The account's own refusals (no credit left, bad key) are not the
    // reader's: they must not read as "go Plus".
    const status = upstream.status === 402 || upstream.status === 401 ? 503 : upstream.status;
    return new Response(detail || `Fish Audio TTS failed (${upstream.status})`, { status });
  }

  // Read whole (the app reads the whole answer anyway) to keep a copy.
  const audio = await upstream.arrayBuffer();
  if (!audio.byteLength) return new Response('No audio data received.', { status: 502 });
  if (bucket) {
    await bucket
      .put(cacheKey, audio, { httpMetadata: { contentType } })
      .catch((err) => console.error('Voice cache write failed:', err));
  }

  await UsageStatsManager.trackUsage(user.id, USAGE_TYPE, text.length, {
    plan_type: plan,
    source: 'fish_audio',
  });

  return new Response(audio, {
    status: 200,
    headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Voice-Cache': 'miss' },
  });
}
