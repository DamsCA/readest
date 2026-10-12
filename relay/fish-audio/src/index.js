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
  const short = String(code || '')
    .toLowerCase()
    .split(/[-_]/)[0];
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

// --- Relecture IA d'une page (/v1/proofread) -------------------------------
// POST { paragraphs: string[] } -> { corrections: [{ p, find, replace }] }
//
// Repere les erreurs de conversion d'un EPUB (fautes de frappe, mots doubles ou
// manquants, confusions de numerisation, cesures restees) sans toucher au
// style. Chaque correction doit citer EXACTEMENT un passage unique de son
// paragraphe : les autres sont ecartees ici, l'app n'applique donc que des
// citations verifiees. Meme modele et meme allocation gratuite que la
// traduction.
const MAX_PROOFREAD_PARAGRAPHS = 40;
const MAX_PROOFREAD_CHARS = 9000;
const proofreadPrompt =
  'You proofread one page of an ebook converted from print. Its text may contain conversion ' +
  'errors: typos, doubled words, missing words, OCR confusions (rn/m, vv/w, l/1, 0/O), leftover ' +
  'hyphenation ("some- thing"), stray spaces or characters, wrongly joined or split words, ' +
  "garbled fragments. The user message is a JSON array of the page's paragraphs. Reply with " +
  'only a JSON object {"corrections":[{"p":<paragraph index>,"find":"<exact text copied from ' +
  'that paragraph>","replace":"<corrected text>"}]}. Fix only clear errors. A real word used ' +
  'correctly in any variety of English is never an error: keep style, wording, British or ' +
  'American spellings, dialect, slang, archaic forms, names, numbers and deliberate ' +
  'punctuation (for example "whilst", "colour", "grey", "ain\'t", "Mr." stay as they are). ' +
  'The way a character or narrator speaks is never an error either: keep nonstandard grammar ' +
  'such as "could of", double negatives or dropped letters. Only fix what a conversion broke. ' +
  'Also catch a real word that a conversion swapped for another and that does not fit its ' +
  'sentence (e.g. "a small, tried smile" for "tired", "came form the sea" for "from"). ' +
  'Make "find" the shortest exact excerpt that contains the error and occurs once in its ' +
  'paragraph (add a neighbouring word if needed). Read every sentence word by word for a ' +
  'missing small word (article, preposition, auxiliary verb): for a gap, quote the words on ' +
  'both sides in "find" and give them with the missing word inserted in "replace" (e.g. ' +
  '"find":"opened envelope","replace":"opened the envelope"). If nothing needs fixing, reply ' +
  '{"corrections":[]}.';
// Passe dediee aux mots manquants (task "missing") : melee aux autres fautes,
// l'IA en ratait 3 sur 4 sur le banc d'essai ; seule a chercher, elle lit
// chaque phrase pour ce seul defaut.
const missingWordsPrompt =
  'You check one page of an ebook converted from print for MISSING WORDS only: a small word ' +
  '(article, preposition, auxiliary or linking verb, pronoun) that the conversion dropped, ' +
  'leaving a sentence ungrammatical. Read each sentence word by word. The user message is a ' +
  "JSON array of the page's paragraphs. Reply with only a JSON object " +
  '{"corrections":[{"p":<paragraph index>,"find":"<the words on both sides of the gap, copied ' +
  'exactly>","replace":"<the same words with the missing word inserted>"}]}, for example ' +
  '{"p":0,"find":"opened envelope","replace":"opened the envelope"}. Report only sentences ' +
  "that are clearly broken; style, dialect and characters' speech are never errors. If no " +
  'word is missing, reply {"corrections":[]}.';
const PROOFREAD_PROMPTS = { all: proofreadPrompt, missing: missingWordsPrompt };
// Modeles essayes pour la relecture (12/10/2026) ; le premier sert par defaut.
const PROOFREAD_MODELS = [
  TRANSLATE_MODEL,
  '@cf/qwen/qwen3-30b-a3b-fp8',
  '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/openai/gpt-oss-120b',
];

// Garde-fous sur ce que le modele propose (essais du 12/10/2026) : sur une page
// correcte il a une fois "ajoute" une virgule deja presente ("not here" ->
// "not here," devant ", not in front" = deux virgules). Une correction qui ne
// change que ponctuation ou espaces ne peut donc que RETIRER (espace parasite,
// cesure "some- thing"), et aucune ne doit creer de ponctuation doublee.
// Passe "mots manquants" : une correction n'y insere qu'UN mot. Sinon c'est du
// style ("Most were" -> "Most of them were", vu sur le banc d'essai).
const wordsOf = (s) => s.split(/\s+/).filter(Boolean);
const insertsOneWord = (find, replace) => {
  const a = wordsOf(find);
  const b = wordsOf(replace);
  if (b.length !== a.length + 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const added = b[i];
  const doubles = (w) => w !== undefined && w.toLowerCase() === added.toLowerCase();
  // "of paper" -> "of of paper" n'insere qu'un mot... en doublant son voisin.
  if (doubles(b[i - 1]) || doubles(b[i + 1])) return false;
  // "was the small" -> "was a the small" : deux determinants d'affilee.
  const DETERMINERS = /^(a|an|the|this|that|these|those|my|his|her|its|our|your|their)$/i;
  if (DETERMINERS.test(added) && DETERMINERS.test(b[i + 1] ?? '')) return false;
  return /^[\p{L}']+$/u.test(added) && a.slice(i).every((w, k) => w === b[i + 1 + k]);
};

const lettersOf = (s) => s.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
const isDeletionOf = (shorter, longer) => {
  let i = 0;
  for (const ch of longer) if (ch === shorter[i]) i++;
  return i === shorter.length;
};
const doubledPunctuation = (s) => (s.match(/([,;:!?])\1|\s[,;:!?.]/g) || []).length;
const doubledWords = (s) => (s.match(/(?<!\p{L})(\p{L}+)\s+\1(?!\p{L})/giu) || []).length;
const onlySpacesAdded = (find, replace) =>
  replace.replace(/\s+/g, '') === find.replace(/\s+/g, '') && replace.length > find.length;
const plausible = (para, find, replace) => {
  if (
    lettersOf(find) === lettersOf(replace) &&
    !isDeletionOf(replace, find) &&
    !onlySpacesAdded(find, replace)
  ) {
    return false;
  }
  // Ajouter des mots, c'est inserer UN mot manquant ou couper deux mots colles ;
  // le reste est du style ("God rest him" -> "God rest his soul", vu au banc).
  if (
    wordsOf(replace).length > wordsOf(find).length &&
    !insertsOneWord(find, replace) &&
    !onlySpacesAdded(find, replace)
  ) {
    return false;
  }
  const fixed = para.replace(find, replace);
  // Ni ponctuation doublee, ni mot double ("of of paper", vu sur le banc d'essai).
  return (
    doubledPunctuation(fixed) <= doubledPunctuation(para) &&
    doubledWords(fixed) <= doubledWords(para)
  );
};

const parseCorrections = (raw, paragraphs, onlyInsertions = false) => {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let data;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  const list = Array.isArray(data?.corrections) ? data.corrections : [];
  const out = [];
  for (const c of list) {
    const p = Number(c?.p);
    const find = typeof c?.find === 'string' ? c.find : '';
    const replace = typeof c?.replace === 'string' ? c.replace : '';
    const para = Number.isInteger(p) ? paragraphs[p] : undefined;
    if (!para || !find || find === replace) continue;
    // Citation exacte et unique dans son paragraphe, sinon on ne sait pas ou
    // l'appliquer (et c'est souvent que le modele a reformule).
    const at = para.indexOf(find);
    if (at < 0 || para.indexOf(find, at + 1) >= 0) continue;
    if (find.length > 200 || Math.abs(replace.length - find.length) > 60) continue;
    if (!plausible(para, find, replace)) continue;
    if (onlyInsertions && !insertsOneWord(find, replace)) continue;
    out.push({ p, find, replace });
    if (out.length >= 20) break;
  }
  return out;
};

async function handleProofread(request, env) {
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
  const paragraphs = Array.isArray(body?.paragraphs)
    ? body.paragraphs.map((p) => (typeof p === 'string' ? p : ''))
    : [];
  const total = paragraphs.reduce((n, p) => n + p.length, 0);
  if (!paragraphs.some((p) => p.trim())) return json(400, { error: 'paragraphs required' }, CORS);
  if (paragraphs.length > MAX_PROOFREAD_PARAGRAPHS || total > MAX_PROOFREAD_CHARS) {
    return json(413, { error: 'page too long' }, CORS);
  }
  const model = PROOFREAD_MODELS.includes(body?.model) ? body.model : PROOFREAD_MODELS[0];
  // 'full' (l'app) = passe generale avec indices + passe dediee aux mots
  // manquants, en parallele, fusionnees ; 'all' et 'missing' servent aux essais.
  const task = ['all', 'missing'].includes(body?.task) ? body.task : 'full';
  // Indices de l'app (dictionnaire + detecteurs) : chaque mot inconnu ou
  // anomalie mecanique de la page, a examiner un par un. Lu "a l'oeil", le
  // modele seul ratait pres de la moitie des fautes du banc d'essai (29/54).
  const hints = Array.isArray(body?.hints)
    ? body.hints.filter((h) => typeof h === 'string' && h.trim()).slice(0, 60)
    : [];
  const userContent =
    JSON.stringify(paragraphs) +
    (hints.length
      ? '\n\nA spell checker flagged these spots. Examine every one and fix it, unless it is ' +
        'a name or a correct rare word:\n' +
        hints.map((h) => `- ${h.slice(0, 200)}`).join('\n')
      : '');
  const pass = async (kind) => {
    const out = await env.AI.run(model, {
      messages: [
        { role: 'system', content: PROOFREAD_PROMPTS[kind] },
        { role: 'user', content: kind === 'all' ? userContent : JSON.stringify(paragraphs) },
      ],
      max_tokens: 1024,
      // 0 : la meme page doit donner les memes propositions a chaque passage.
      temperature: 0,
    });
    // Certains modeles rendent deja un objet quand leur reponse est du JSON.
    const raw =
      typeof out?.response === 'string' ? out.response : JSON.stringify(out?.response ?? '');
    return { corrections: parseCorrections(raw, paragraphs, kind === 'missing'), usage: out.usage };
  };
  try {
    const kinds = task === 'full' ? ['all', 'missing'] : [task];
    const results = await Promise.all(kinds.map(pass));
    // Fusion : la passe generale d'abord ; une correction qui touche un endroit
    // deja corrige est ecartee (deux insertions au meme endroit doublaient un mot).
    const corrections = [];
    const taken = [];
    for (const c of results.flatMap((r) => r.corrections)) {
      const at = paragraphs[c.p].indexOf(c.find);
      const span = [c.p, at, at + c.find.length];
      if (taken.some(([p, a, b]) => p === span[0] && span[1] < b && a < span[2])) continue;
      taken.push(span);
      corrections.push(c);
    }
    const neurons = results.reduce((n, r) => n + (Number(r.usage?.neurons) || 0), 0);
    return json(200, { corrections, usage: { neurons } }, CORS);
  } catch (err) {
    const message = String(err?.message || err);
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
    if (url.pathname === '/v1/proofread') return handleProofread(request, env);
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
