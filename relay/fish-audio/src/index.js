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

const json = (status, obj, extraHeaders = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });

// --- Traduction naturelle (IA de Cloudflare, Workers AI) -------------------
// POST /v1/translate { text, source, target } -> { translation }
//
// Les traducteurs classiques (Google, DeepL...) rendent souvent les expressions
// mot a mot ("it's raining cats and dogs" -> "il pleut des chats et des
// chiens"). Un modele de langage, avec la consigne ci-dessous, donne
// l'equivalent naturel ("il pleut des cordes").
//
// Cout : gratuit dans la limite de 10 000 "neurones" par jour du forfait
// gratuit (Mistral Small 3.1 : 31 876 neurones par million de jetons lus,
// 50 488 par million ecrits — page de tarifs Cloudflare, lue le 12/10/2026).
// Au-dela, Workers AI refuse (aucune facturation sur le forfait gratuit) ; le
// relais repond alors 429 et l'app repasse sur son traducteur classique.
const TRANSLATE_MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct';
// Un paragraphe ; au-dela, c'est que quelqu'un pompe.
const MAX_TRANSLATE_CHARS = 6000;
const LANG_NAMES = {
  en: 'English',
  fr: 'French',
  es: 'Spanish',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  ru: 'Russian',
  ja: 'Japanese',
  zh: 'Chinese',
  ko: 'Korean',
  ar: 'Arabic',
};
const langName = (code) => {
  const short = String(code || '').toLowerCase().split(/[-_]/)[0];
  if (!short || short === 'auto') return '';
  return LANG_NAMES[short] || short;
};
// La version web de l'app appelle depuis un navigateur ; l'app Android passe
// par le module reseau natif et n'en a pas besoin.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Relay-Token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
// "a passage from a book... never continue": essai du 12/10/2026, le titre de
// deux mots "The Call" est revenu en un long texte invente ("L'Appel. Il y a des
// jours ou je me reveille...") — un texte court se lit comme une consigne
// d'ecriture. La consigne, le plafond de jetons et le controle de longueur
// ci-dessous ferment cette porte.
const systemPrompt = (source, target) =>
  `You are a literary translator. The user's message is a passage from a book, possibly ` +
  `just a title or a few words: translate exactly that ${source ? `from ${source} ` : ''}` +
  `into ${target}, and never continue, expand or explain it. Render the meaning, tone and ` +
  `register, never word for word: replace every idiom, phrasal verb and figure of speech ` +
  `with the natural ${target} equivalent a native writer would use. If the source has an ` +
  `obvious typo or a missing word, translate what was clearly meant. Keep names and numbers, ` +
  `and keep the sentences in their order without merging or dropping any. Follow ${target} ` +
  `typography (for French: « » quotation marks and a space before ; : ! ?). Reply with the ` +
  `translation only: no notes or explanations.`;
// Une traduction n'est jamais beaucoup plus longue que l'original (francais :
// environ 1,2 fois l'anglais). Au-dela, c'est que le modele a brode.
const looksExpanded = (source, translation) => translation.length > source.length * 2.5 + 40;

async function handleTranslate(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json(404, { error: 'not found' }, CORS);
  if (!env.RELAY_TOKEN || request.headers.get('X-Relay-Token') !== env.RELAY_TOKEN) {
    return json(403, { error: 'forbidden' }, CORS);
  }
  if (env.TRANSLATE_LIMITER) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.TRANSLATE_LIMITER.limit({ key: ip });
    if (!success) return json(429, { error: 'rate limited' }, CORS);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'invalid json' }, CORS);
  }
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const target = langName(body?.target);
  if (!text || !target) return json(400, { error: 'text and target required' }, CORS);
  if (text.length > MAX_TRANSLATE_CHARS) {
    return json(413, { error: `text over ${MAX_TRANSLATE_CHARS} chars` }, CORS);
  }
  try {
    const out = await env.AI.run(TRANSLATE_MODEL, {
      messages: [
        { role: 'system', content: systemPrompt(langName(body?.source), target) },
        { role: 'user', content: text },
      ],
      // Assez pour la traduction (environ 0,35 jeton par caractere source),
      // pas pour broder : le plafond par defaut (256) couperait les longs
      // paragraphes, un plafond large laissait un titre devenir une page.
      max_tokens: Math.min(4096, Math.ceil(text.length * 0.6) + 48),
      temperature: 0.2,
    });
    const translation = typeof out?.response === 'string' ? out.response.trim() : '';
    if (!translation) return json(502, { error: 'empty translation' }, CORS);
    // 502 : l'app passe ce paragraphe a Google plutot que d'afficher (et faire
    // lire a voix haute) un texte invente.
    if (looksExpanded(text, translation)) return json(502, { error: 'translation too long' }, CORS);
    return json(200, { translation, usage: out.usage ?? null }, CORS);
  } catch (err) {
    const message = String(err?.message || err);
    // 4006 : allocation gratuite du jour epuisee.
    if (/4006|neuron|allocation/i.test(message)) {
      return json(429, { error: 'daily free allocation exhausted' }, CORS);
    }
    return json(502, { error: message.slice(0, 200) }, CORS);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return json(200, { status: 'ok', model: FREE_MODEL, keyConfigured: !!env.FISH_KEY });
    }
    if (url.pathname === '/v1/translate') return handleTranslate(request, env);
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
