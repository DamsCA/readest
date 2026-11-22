import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getSubscriptionPlan, validateUserAndToken } from '@/utils/access';
import { UsageStatsManager } from '@/utils/usage';
import { preparePassage } from './proverbs';

// AI translation (Workers AI, Mistral Small 3.1) for the web app, the paid
// feature of Lis et Lead: subscribers translate freely (up to a fair-use daily
// cap), a free reader gets a daily taste so the difference with the standard
// translation is felt, then is sent back to the standard one with an
// invitation to subscribe. Cost measured on the Cloudflare price list
// (22 Nov 2026): $0.351 per million tokens read, $0.555 per million written,
// about $0.18 for a whole 80,000-word book.

const MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct';
const MAX_CHARS = 6000;
const FREE_AI_PARAGRAPHS_PER_DAY = 20;
// Plus at 6,99 € a month or 59,99 € a year (22 Nov 2026): about a book every
// four days, so that even a yearly subscriber who uses it all stays profitable.
const PAID_AI_CHARS_PER_DAY = 100_000;
const FREE_USAGE = 'ai_translation_free_paragraphs';
const PAID_USAGE = 'ai_translation_chars';

const LANG_NAMES: Record<string, string> = {
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
const langName = (code: unknown) => {
  const short = String(code || '')
    .toLowerCase()
    .split(/[-_]/)[0];
  if (!short || short === 'auto') return '';
  return LANG_NAMES[short] || short;
};

// Same instructions as the relay (relay/fish-audio, /v1/translate): a short
// text reads like a writing prompt, so the model is told never to continue it.
const systemPrompt = (source: string, target: string) =>
  `You are a literary translator. The user's message is a passage from a book, possibly ` +
  `just a title or a few words: translate exactly that ${source ? `from ${source} ` : ''}` +
  `into ${target}, and never continue, expand or explain it. Render the meaning, tone and ` +
  `register, never word for word: replace every idiom, phrasal verb and figure of speech ` +
  `with the natural ${target} equivalent a native writer would use. If the source has an ` +
  `obvious typo or a missing word, translate what was clearly meant. Keep names and numbers, ` +
  `and keep the sentences in their order without merging or dropping any. Follow ${target} ` +
  `typography (for French: « » quotation marks and a space before ; : ! ?). Reply with the ` +
  `translation only: no notes or explanations.`;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  laquo: '«',
  raquo: '»',
  hellip: '…',
  mdash: '—',
  ndash: '–',
};
const decodeEntities = (s: string) =>
  s.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi, (m, body: string) => {
    if (body[0] !== '#') return ENTITIES[body.toLowerCase()] ?? m;
    const code = /^#x/i.test(body) ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
      ? String.fromCodePoint(code)
      : m;
  });
const looksExpanded = (source: string, translation: string) =>
  translation.length > source.length * 2.5 + 40;

interface AiBinding {
  run: (
    model: string,
    input: Record<string, unknown>,
  ) => Promise<{ response?: unknown; usage?: unknown }>;
}

const json = (status: number, body: unknown) => Response.json(body, { status });

export async function POST(req: Request): Promise<Response> {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) return json(401, { error: 'NOT_AUTHENTICATED' });

  let body: { text?: unknown; source?: unknown; target?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid json' });
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const target = langName(body.target);
  if (!text || !target) return json(400, { error: 'text and target required' });
  if (text.length > MAX_CHARS) return json(413, { error: `text over ${MAX_CHARS} chars` });

  const plan = getSubscriptionPlan(token);
  const paid = plan !== 'free';
  if (paid) {
    const used = await UsageStatsManager.getCurrentUsage(user.id, PAID_USAGE, 'daily');
    if (used + text.length > PAID_AI_CHARS_PER_DAY) {
      return json(429, { error: 'DAILY_QUOTA_EXCEEDED' });
    }
  } else {
    const used = await UsageStatsManager.getCurrentUsage(user.id, FREE_USAGE, 'daily');
    if (used >= FREE_AI_PARAGRAPHS_PER_DAY) return json(402, { error: 'PLUS_REQUIRED' });
  }

  let ai: AiBinding | undefined;
  try {
    ai = (getCloudflareContext().env as { AI?: AiBinding }).AI;
  } catch {
    ai = undefined;
  }
  if (!ai) return json(503, { error: 'AI translation unavailable' });

  // Whole English sayings go in already in French (see ./proverbs.ts).
  const prepared = preparePassage(text, target);
  try {
    const out = await ai.run(MODEL, {
      messages: [
        {
          role: 'system',
          content: systemPrompt(langName(body.source), target) + prepared.instruction,
        },
        { role: 'user', content: prepared.text },
      ],
      max_tokens: Math.min(4096, Math.ceil(text.length * 0.6) + 48),
      temperature: 0.2,
    });
    const translation =
      typeof out?.response === 'string' ? decodeEntities(decodeEntities(out.response.trim())) : '';
    if (!translation || looksExpanded(text, translation)) {
      return json(502, { error: 'translation unusable' });
    }
    const count = await UsageStatsManager.trackUsage(
      user.id,
      paid ? PAID_USAGE : FREE_USAGE,
      paid ? text.length : 1,
      { plan_type: plan, source: 'workers_ai' },
    );
    return json(200, {
      translation,
      ...(paid ? {} : { free_left: Math.max(0, FREE_AI_PARAGRAPHS_PER_DAY - count) }),
    });
  } catch (err) {
    const message = String((err as Error)?.message || err);
    if (/4006|neuron|allocation/i.test(message)) {
      return json(429, { error: 'AI_ALLOCATION_EXHAUSTED' });
    }
    return json(502, { error: message.slice(0, 200) });
  }
}
