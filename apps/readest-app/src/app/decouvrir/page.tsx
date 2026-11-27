import type { Metadata } from 'next';

// lisetlead.com/decouvrir: what Lis et Lead is, in plain text, for search
// engines and AI assistants (owner's ask, 27 Nov 2026: « Fais maintenant le
// référencement SEO et GEO »). The app itself (/) only draws in the browser,
// and most AI assistants' robots do not run JavaScript: this page is drawn on
// the server (components/Providers.tsx, PAGES_DE_TEXTE).
//
// Every claim comes from /bienvenue, where each one was checked against the app
// (examples measured on 12 Oct 2026, formats from SUPPORTED_BOOK_EXTS, the free
// and Plus lists). Two rules of the owner's: no price on a first public contact
// (« donner envie avant le prix », 26 Nov 2026), and Lis et Lead stays apart
// from his other work (no author or channel of his here). The button opens the
// app itself, where the gift window waits (23 Nov 2026: never a forced sign-up).

const SITE = (process.env['NEXT_PUBLIC_API_BASE_URL'] || 'https://lisetlead.com').replace(
  /\/$/,
  '',
);
const TITRE = 'Lis et Lead — lisez en français les livres écrits en anglais';
const DESCRIPTION =
  'Lis et Lead est une liseuse en ligne : elle traduit vos livres en français pendant que vous lisez, ' +
  'avec des phrases naturelles, et vous les lit à voix haute. EPUB, PDF, MOBI. Gratuit, dans votre navigateur.';

export const metadata: Metadata = {
  title: { absolute: TITRE },
  description: DESCRIPTION,
  alternates: { canonical: '/decouvrir' },
  openGraph: {
    type: 'website',
    url: '/decouvrir',
    title: TITRE,
    description: DESCRIPTION,
    locale: 'fr_FR',
    siteName: 'Lis et Lead',
    images: [{ url: '/og-ouiread.png', width: 1200, height: 630, alt: 'Lis et Lead' }],
  },
};

const LISEUSE = '/';

const QUESTIONS: { q: string; r: string }[] = [
  {
    q: 'Comment lire un livre en anglais quand on ne parle pas anglais ?',
    r: 'Ouvrez-le dans Lis et Lead et touchez « Traduire » : chaque page s’affiche en français pendant que vous lisez, avec des phrases naturelles plutôt qu’une traduction mot à mot.',
  },
  {
    q: 'Comment traduire un livre EPUB en français ?',
    r: 'Ajoutez votre fichier EPUB à votre bibliothèque Lis et Lead, ouvrez-le, puis touchez « Traduire ». Il n’y a rien à convertir : la traduction se fait page après page, pendant la lecture.',
  },
  {
    q: 'Comment écouter un livre à voix haute ?',
    r: 'Dans un livre ouvert, touchez « Écouter » : Lis et Lead vous le lit à voix haute, en français, dans les transports, en marchant ou les yeux fermés.',
  },
  {
    q: 'Faut-il installer une application ?',
    r: 'Non. Lis et Lead s’ouvre dans votre navigateur, sur téléphone comme sur ordinateur. Sur téléphone, ajoutez-le à votre écran d’accueil pour l’ouvrir comme une appli.',
  },
  {
    q: 'Quels livres puis-je lire ?',
    r: 'Les livres que vous avez en fichier : EPUB, PDF, MOBI, AZW3, FB2, CBZ ou TXT. Les livres achetés sur Kindle restent verrouillés par Amazon et ne peuvent pas être ouverts ailleurs.',
  },
  {
    q: 'De quelles langues vers quelles langues ?',
    r: 'De l’anglais, de l’espagnol, de l’allemand, de l’italien et de bien d’autres langues, vers le français. Vous pouvez aussi traduire vers d’autres langues.',
  },
  {
    q: 'Lis et Lead est-il gratuit ?',
    r: 'Oui. Le compte gratuit donne la traduction standard sans limite, la lecture à voix haute et votre bibliothèque sur tous vos appareils, avec chaque jour un avant-goût de la traduction IA et des voix premium. L’abonnement Plus ajoute la traduction IA et les voix premium sans compter.',
  },
  {
    q: 'Mes livres restent-ils privés ?',
    r: 'Oui. Vos livres et vos notes ne sont visibles que par vous.',
  },
];

// For search engines and AI assistants: who we are, what the app does, and the
// questions above. No price, no rating (we have none to show).
const DONNEES = [
  {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Lis et Lead',
    url: `${SITE}/`,
    logo: `${SITE}/icon.png`,
    email: 'contact@lisetlead.com',
  },
  {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'Lis et Lead',
    url: `${SITE}/`,
    description: DESCRIPTION,
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Web',
    inLanguage: 'fr',
    browserRequirements: 'JavaScript',
    featureList: [
      'Traduction des livres en français pendant la lecture',
      'Lecture à voix haute',
      'Bibliothèque sur tous vos appareils',
      'EPUB, PDF, MOBI, AZW3, FB2, CBZ, TXT',
    ],
  },
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: QUESTIONS.map(({ q, r }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: r },
    })),
  },
];

const Exemple = ({ vo, classique, nous }: { vo: string; classique: string; nous: string }) => (
  <div className='rounded-2xl bg-white/5 p-5 ring-1 ring-white/10'>
    <p className='text-[15px] italic text-[#f3ecdd]/80'>« {vo} »</p>
    <div className='mt-4 space-y-3 text-[15px]'>
      <p className='flex gap-3'>
        <span className='mt-0.5 shrink-0 self-start whitespace-nowrap rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#f3ecdd]/60'>
          Mot à mot
        </span>
        <span className='text-[#f3ecdd]/55 line-through decoration-[#e07a6b]/70'>{classique}</span>
      </p>
      <p className='flex gap-3'>
        <span className='mt-0.5 shrink-0 self-start whitespace-nowrap rounded-full bg-[#e8efff] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#101728]'>
          Lis et Lead
        </span>
        <span className='font-semibold text-[#f3ecdd]'>{nous}</span>
      </p>
    </div>
  </div>
);

const Etape = ({ n, titre, texte }: { n: number; titre: string; texte: string }) => (
  <li className='flex gap-4'>
    <span className='flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#101728] text-sm font-bold text-[#f3ecdd]'>
      {n}
    </span>
    <div>
      <h3 className='font-semibold'>{titre}</h3>
      <p className='mt-1 text-[15px] text-[#101728]/70'>{texte}</p>
    </div>
  </li>
);

export default function DecouvrirPage() {
  return (
    <main className='h-screen overflow-y-auto bg-[#faf6ee] text-[#101728] antialiased'>
      <script
        type='application/ld+json'
        // Fixed text of our own, not user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(DONNEES) }}
      />

      <section className='bg-[radial-gradient(120%_80%_at_80%_0%,#1d273f_0%,#101728_55%,#0b1120_100%)] text-[#f3ecdd]'>
        <header className='mx-auto flex max-w-5xl items-center justify-between px-5 py-4 sm:px-8'>
          <a href={LISEUSE} className='flex items-center gap-2 text-lg font-bold tracking-tight'>
            <img src='/icon.png?v=3' alt='' width={28} height={28} className='rounded-lg' />
            Lis et Lead
          </a>
          <a
            href={LISEUSE}
            className='rounded-full px-4 py-2 text-sm font-semibold text-[#f3ecdd]/85 ring-1 ring-white/20 hover:bg-white/10'
          >
            Ouvrir la liseuse
          </a>
        </header>

        <div className='mx-auto grid max-w-5xl items-center gap-10 px-5 pb-14 pt-6 sm:px-8 md:grid-cols-[1.15fr_0.85fr] md:pb-20 md:pt-10'>
          <div>
            <p className='text-xs font-bold uppercase tracking-[0.16em] text-[#e8c06a]'>
              Les leaders sont des lecteurs
            </p>
            <h1 className='mt-4 font-serif text-[2.4rem] font-bold leading-[1.05] sm:text-6xl'>
              Lisez en français les livres écrits en anglais.
            </h1>
            <p className='mt-5 max-w-xl text-lg leading-relaxed text-[#f3ecdd]/80'>
              Lis et Lead est une liseuse en ligne. Ouvrez votre livre : elle le traduit en français
              pendant que vous lisez, avec des phrases naturelles, et peut vous le lire à voix
              haute.
            </p>
            <div className='mt-8 flex flex-col gap-3 sm:flex-row sm:items-center'>
              <a
                href={LISEUSE}
                className='inline-flex items-center justify-center rounded-full bg-[#e8efff] px-7 py-4 text-base font-bold text-[#101728] shadow-lg shadow-black/20 transition hover:bg-white'
              >
                Ouvrir la liseuse
              </a>
              <p className='text-center text-sm text-[#f3ecdd]/65 sm:text-left'>
                Gratuit · dans votre navigateur · sans carte bancaire
              </p>
            </div>
          </div>

          <div className='flex flex-col gap-4'>
            <Exemple
              vo='It’s raining cats and dogs'
              classique='Il pleut comme des chats et des chiens'
              nous='Il pleut des cordes'
            />
            <Exemple
              vo='Have your cake and eat it'
              classique='Avoir le gâteau et le manger'
              nous='Vouloir le beurre et l’argent du beurre'
            />
          </div>
        </div>
      </section>

      <section className='mx-auto max-w-5xl px-5 py-14 sm:px-8 md:py-20'>
        <h2 className='font-serif text-3xl font-bold sm:text-4xl'>
          Le livre que vous voulez lire n’existe pas en français ?
        </h2>
        <p className='mt-4 max-w-2xl text-lg leading-relaxed text-[#101728]/75'>
          Beaucoup de grands livres ne sont jamais traduits. Avec Lis et Lead, vous n’attendez plus
           : vous les lisez maintenant, dans votre langue.
        </p>
        <div className='mt-10 grid gap-5 md:grid-cols-3'>
          {[
            {
              t: 'Une traduction qui sonne juste',
              d: 'Les expressions sont rendues comme par un traducteur, pas mot à mot. Vous lisez du vrai français, pas une notice.',
            },
            {
              t: 'Vos livres à voix haute',
              d: 'Dans les transports, en marchant, les yeux fermés : touchez « Écouter » et votre livre vous est lu en français.',
            },
            {
              t: 'Votre bibliothèque partout',
              d: 'Commencez sur l’ordinateur, continuez sur le téléphone : votre page, vos surlignages et vos notes vous suivent.',
            },
          ].map(({ t, d }) => (
            <div key={t} className='rounded-2xl bg-white p-6 shadow-sm ring-1 ring-[#101728]/5'>
              <h3 className='text-lg font-bold'>{t}</h3>
              <p className='mt-2 text-[15px] leading-relaxed text-[#101728]/70'>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className='bg-white'>
        <div className='mx-auto grid max-w-5xl gap-12 px-5 py-14 sm:px-8 md:grid-cols-2 md:py-20'>
          <div>
            <h2 className='font-serif text-3xl font-bold sm:text-4xl'>
              Trois gestes, et vous lisez
            </h2>
            <ol className='mt-8 space-y-6'>
              <Etape
                n={1}
                titre='Ouvrez la liseuse'
                texte='Sur lisetlead.com, depuis votre téléphone ou votre ordinateur. Créez votre compte gratuit avec Google, Apple ou votre e-mail pour garder votre bibliothèque.'
              />
              <Etape
                n={2}
                titre='Ajoutez votre livre'
                texte='EPUB, PDF, MOBI, AZW3, FB2, CBZ ou TXT, depuis votre téléphone ou votre ordinateur.'
              />
              <Etape
                n={3}
                titre='Lisez-le en français'
                texte='Touchez « Traduire » : chaque page arrive dans votre langue. Touchez « Écouter » pour l’entendre.'
              />
            </ol>
          </div>
          <div className='rounded-3xl bg-[#101728] p-6 text-[#f3ecdd] sm:p-8'>
            <img
              src='/images/ca-marche-couverture.webp'
              alt='Couverture de « Ça marche », R. H. Jarrett'
              width={480}
              height={768}
              className='mx-auto w-40 rounded-lg shadow-2xl'
            />
            <p className='mt-6 text-xs font-bold uppercase tracking-[0.16em] text-[#e8c06a]'>
              Offert à l’inscription
            </p>
            <h3 className='mt-2 font-serif text-2xl font-bold'>« Ça marche »</h3>
            <p className='mt-2 text-[15px] leading-relaxed text-[#f3ecdd]/80'>
              Le petit classique de R. H. Jarrett (1926), dans une nouvelle traduction française : «
              Si vous savez ce que vous voulez, vous pouvez l’avoir. » Il vous attend dans votre
              bibliothèque.
            </p>
          </div>
        </div>
      </section>

      <section className='mx-auto max-w-5xl px-5 py-14 sm:px-8 md:py-20'>
        <h2 className='font-serif text-3xl font-bold sm:text-4xl'>
          Gratuit, et Plus pour aller loin
        </h2>
        <div className='mt-8 grid gap-5 md:grid-cols-2'>
          <div className='rounded-2xl bg-white p-6 shadow-sm ring-1 ring-[#101728]/5'>
            <h3 className='text-lg font-bold'>Le compte gratuit</h3>
            <ul className='mt-3 space-y-2 text-[15px] text-[#101728]/75'>
              <li>Vos livres sur tous vos appareils</li>
              <li>Traduction standard sans limite</li>
              <li>Lecture à voix haute</li>
              <li>Chaque jour, un avant-goût de la traduction IA et des voix premium</li>
              <li>« Ça marche » offert</li>
            </ul>
          </div>
          <div className='rounded-2xl bg-[#101728] p-6 text-[#f3ecdd]'>
            <h3 className='text-lg font-bold'>Plus</h3>
            <ul className='mt-3 space-y-2 text-[15px] text-[#f3ecdd]/80'>
              <li>La traduction IA, comme par un vrai traducteur, sans compter</li>
              <li>Des voix premium qui donnent vie à chaque page</li>
              <li>Sans engagement : vous arrêtez quand vous voulez</li>
            </ul>
          </div>
        </div>
      </section>

      <section className='bg-white'>
        <div className='mx-auto max-w-3xl px-5 py-14 sm:px-8 md:py-20'>
          <h2 className='font-serif text-3xl font-bold sm:text-4xl'>Vos questions</h2>
          <div className='mt-6'>
            {QUESTIONS.map(({ q, r }) => (
              <div key={q} className='border-b border-[#101728]/10 py-5'>
                <h3 className='font-semibold'>{q}</h3>
                <p className='mt-2 text-[15px] leading-relaxed text-[#101728]/75'>{r}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className='bg-[#101728] text-[#f3ecdd]'>
        <div className='mx-auto max-w-3xl px-5 py-16 text-center sm:px-8'>
          <h2 className='font-serif text-3xl font-bold sm:text-4xl'>
            Votre prochain livre vous attend.
          </h2>
          <p className='mt-3 text-lg text-[#f3ecdd]/75'>En français, et à voix haute.</p>
          <a
            href={LISEUSE}
            className='mt-8 inline-flex rounded-full bg-[#e8efff] px-8 py-4 font-bold text-[#101728] hover:bg-white'
          >
            Ouvrir la liseuse
          </a>
        </div>
      </section>

      <footer className='mx-auto flex max-w-5xl flex-col gap-3 px-5 py-8 text-sm text-[#101728]/60 sm:flex-row sm:justify-between sm:px-8'>
        <p>© 2026 Lis et Lead</p>
        <nav className='flex flex-wrap gap-x-5 gap-y-2'>
          <a href='/mentions-legales' className='underline'>
            Mentions légales
          </a>
          <a href='/confidentialite' className='underline'>
            Confidentialité
          </a>
          <a href='/cgv' className='underline'>
            CGV
          </a>
          <a href='/cgu' className='underline'>
            CGU
          </a>
        </nav>
      </footer>
    </main>
  );
}
