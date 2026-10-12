import { NextRequest } from 'next/server';

// Server-side proxy for Fish Audio TTS. Used by the web platform because the
// Fish Audio REST API does not send CORS headers (a direct browser fetch is
// blocked) and because the API key must not be exposed to the client. The
// Tauri apps bypass this route and call api.fish.audio directly through the
// native HTTP plugin. See FishAudioTTSClient.
const FISH_AUDIO_TTS_URL = 'https://api.fish.audio/v1/tts';
// ?timestamps=1: same synthesis plus per-word timings, streamed back untouched
// as Server-Sent Events (parsed by services/tts/fishTimestamps.ts).
const FISH_AUDIO_TIMED_URL = 'https://api.fish.audio/v1/tts/stream/with-timestamp';
const FISH_AUDIO_MODEL = 's2.1-pro-free';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const apiKey = process.env['FISHAUDIO_API_KEY'] || process.env['NEXT_PUBLIC_FISHAUDIO_API_KEY'];
  if (!apiKey) {
    return new Response('Fish Audio API key not configured', { status: 500 });
  }

  const body = await req.text();
  const timed = req.nextUrl.searchParams.get('timestamps') === '1';

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
    return new Response(detail || `Fish Audio TTS failed (${upstream.status})`, {
      status: upstream.status,
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': timed ? 'text/event-stream' : 'audio/mpeg',
      'Cache-Control': 'no-store',
    },
  });
}
