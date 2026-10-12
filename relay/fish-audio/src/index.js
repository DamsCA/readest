// Relais Fish Audio pour l'app Readest (fork personnel).
//
// Pourquoi il existe : le depot est un fork PUBLIC, donc tout APK compile avec
// la cle Fish dedans publierait cette cle. Ici la cle vit dans les secrets du
// Worker (FISH_KEY) ; l'APK ne connait que l'adresse du relais.
//
// Ce que le relais garantit, quel que soit l'appelant :
//   - le modele est FORCE a s2.1-pro-free : la cle ne peut jamais servir un
//     modele payant, meme si quelqu'un trouve l'adresse ;
//   - le texte est plafonne a MAX_CHARS ;
//   - chaque adresse IP est limitee a RATE_LIMIT_PER_MIN requetes par minute,
//     assez pour lire a vitesse x2 avec prechargement, trop peu pour pomper ;
//   - la cle se remplace par `wrangler secret put FISH_KEY` SANS recompiler
//     l'app.
//
// Le statut de Fish Audio (402, 403, 429...) est renvoye tel quel : l'app s'en
// sert pour arreter la lecture et l'expliquer au lieu de sauter des phrases.

// Routes du relais -> point d'arrivee chez Fish. La seconde rend le meme audio
// PLUS l'instant de chaque mot (Server-Sent Events) : c'est ce qui permet a
// l'app de tourner la page sur le mot prononce. Le flux est renvoye tel quel,
// sans le lire : aucun calcul ici (le forfait gratuit accorde 10 ms de CPU).
const FISH_ROUTES = new Map([
  ['/v1/tts', 'https://api.fish.audio/v1/tts'],
  ['/v1/tts/stream/with-timestamp', 'https://api.fish.audio/v1/tts/stream/with-timestamp'],
]);
const FREE_MODEL = 's2.1-pro-free';
const DEFAULT_VOICE = 'da05ae30d8c0428eb47498df524e448c'; // "Claire"
// Large enough that no real sentence is ever refused (a refusal would skip it),
// small enough to stop someone pushing whole books through one request.
const MAX_CHARS = 5000;

const json = (status, obj) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return json(200, { status: 'ok', model: FREE_MODEL, keyConfigured: !!env.FISH_KEY });
    }
    const upstreamUrl = FISH_ROUTES.get(url.pathname);
    if (request.method !== 'POST' || !upstreamUrl) {
      return json(404, { error: 'not found' });
    }

    // Jeton d'acces : filtre les robots qui balaient les *.workers.dev. Il est
    // dans l'APK public, donc ce n'est PAS une protection forte — c'est la
    // limite par IP et le modele force qui protegent vraiment le compte.
    if (!env.RELAY_TOKEN || request.headers.get('X-Relay-Token') !== env.RELAY_TOKEN) {
      return json(403, { error: 'forbidden' });
    }

    if (env.LIMITER) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const { success } = await env.LIMITER.limit({ key: ip });
      if (!success) return json(429, { error: 'rate limited' });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: 'invalid json' });
    }
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) return json(400, { error: 'empty text' });
    if (text.length > MAX_CHARS) return json(413, { error: `text over ${MAX_CHARS} chars` });

    const upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.FISH_KEY}`,
        'Content-Type': 'application/json',
        model: FREE_MODEL,
      },
      body: JSON.stringify({
        text,
        reference_id:
          typeof body.reference_id === 'string' && body.reference_id
            ? body.reference_id
            : DEFAULT_VOICE,
        format: 'mp3',
        mp3_bitrate: 128,
      }),
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    });
  },
};
