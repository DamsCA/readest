import type { Metadata } from 'next';
import { LIVRES_OFFERTS } from '@/libs/ouiread/offerts';
import MesureOfferts from './MesureOfferts';

// lisetlead.com/offerts: the English classics we offer (owner's go, 28 Nov 2026:
// « Oui, ces trois-là »). Drawn on the server (components/Providers.tsx,
// PAGES_DE_TEXTE) so search engines and AI assistants read it. Public-domain
// books only; no price here (owner's rule of 26 Nov 2026), and nothing of his
// other work. « Lire en français » opens the reader's library with ?offert=<id>,
// which adds the book and opens it (library/page.tsx).

const SITE = (process.env['NEXT_PUBLIC_API_BASE_URL'] || 'https://lisetlead.com').replace(
  /\/$/,
  '',
);
const TITRE = 'Classiques anglais offerts, à lire en français — Lis et Lead';
const DESCRIPTION =
  'As a Man Thinketh, The Science of Getting Rich, The Game of Life, Acres of Diamonds, ' +
  'Meditations : cinq classiques du domaine public, offerts, que la liseuse Lis et Lead ' +
  'traduit en français pendant que vous lisez.';
const MAJ = '2026-11-28';
const MAJ_TEXTE = '28 novembre 2026';

export const metadata: Metadata = {
  title: { absolute: TITRE },
  description: DESCRIPTION,
  alternates: { canonical: '/offerts' },
  openGraph: {
    type: 'website',
    url: '/offerts',
    title: TITRE,
    description: DESCRIPTION,
    locale: 'fr_FR',
    siteName: 'Lis et Lead',
    images: [{ url: '/og-ouiread.png', width: 1200, height: 630, alt: 'Lis et Lead' }],
  },
};

const DONNEES = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: 'Classiques anglais offerts par Lis et Lead',
  url: `${SITE}/offerts`,
  dateModified: MAJ,
  itemListElement: LIVRES_OFFERTS.map((l, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    item: {
      '@type': 'Book',
      name: l.title,
      author: { '@type': 'Person', name: l.author },
      inLanguage: 'en',
      isAccessibleForFree: true,
      image: `${SITE}${l.cover}`,
      url: `${SITE}/offerts#${l.id}`,
      description: l.resume,
    },
  })),
};

const QUESTIONS: Array<[string, string]> = [
  [
    'Faut-il parler anglais pour les lire ?',
    'Non. Ouvrez le livre et touchez « Traduire » : chaque passage s’affiche en français sous le texte anglais, pendant que vous lisez. La liseuse peut aussi vous le lire à voix haute.',
  ],
  [
    'Est-ce vraiment gratuit ?',
    'Oui. Ces livres sont dans le domaine public : vous pouvez les lire, les garder et les télécharger librement. La liseuse s’ouvre dans le navigateur, sur téléphone comme sur ordinateur, sans rien installer.',
  ],
  [
    'Pourquoi pas une traduction française déjà faite ?',
    'Parce que vous lisez l’original : les mots de l’auteur, traduits phrase par phrase au moment où vous les lisez, avec le texte anglais toujours sous les yeux.',
  ],
];

export default function OffertsPage() {
  return (
    <main className='h-screen overflow-y-auto bg-[#faf6ee] text-[#101728] antialiased'>
      <script
        type='application/ld+json'
        // Fixed text of our own, not user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(DONNEES) }}
      />
      <MesureOfferts />

      <section className='bg-[radial-gradient(120%_80%_at_80%_0%,#1d273f_0%,#101728_55%,#0b1120_100%)] text-[#f3ecdd]'>
        <header className='mx-auto flex max-w-5xl items-center justify-between px-5 py-4 sm:px-8'>
          <a href='/' className='flex items-center gap-2 text-lg font-bold tracking-tight'>
            <img src='/icon.png?v=3' alt='' width={28} height={28} className='rounded-lg' />
            Lis et Lead
          </a>
          <a
            href='/'
            className='rounded-full px-4 py-2 text-sm font-semibold text-[#f3ecdd]/85 ring-1 ring-white/20 hover:bg-white/10'
          >
            Ouvrir la liseuse
          </a>
        </header>
        <div className='mx-auto max-w-5xl px-5 pb-14 pt-6 sm:px-8 md:pb-16 md:pt-10'>
          <p className='text-xs font-bold uppercase tracking-[0.16em] text-[#e8c06a]'>
            Offerts · domaine public
          </p>
          <h1 className='mt-4 max-w-3xl font-serif text-[2.3rem] font-bold leading-[1.05] sm:text-6xl'>
            Cinq grands classiques anglais, à lire en français.
          </h1>
          <p className='mt-5 max-w-2xl text-lg leading-relaxed text-[#f3ecdd]/80'>
            Les livres qui ont inspiré des générations de lecteurs, dans leur texte original.
            Ouvrez-en un : la liseuse le traduit en français pendant que vous lisez, et peut vous le
            lire à voix haute.
          </p>
        </div>
      </section>

      <section className='mx-auto max-w-5xl px-5 py-12 sm:px-8'>
        <ul className='grid gap-6 md:grid-cols-2'>
          {LIVRES_OFFERTS.map((l) => (
            <li
              key={l.id}
              id={l.id}
              className='flex gap-5 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-[#101728]/5'
            >
              <img
                src={l.coverSmall}
                alt={`Couverture de ${l.title}`}
                width={300}
                height={480}
                loading='lazy'
                className='aspect-[5/8] w-28 shrink-0 self-start rounded-xl object-cover shadow-md sm:w-32'
              />
              <div className='flex min-w-0 flex-col'>
                <h2 className='font-serif text-xl font-bold leading-tight'>{l.title}</h2>
                <p className='mt-1 text-sm text-[#101728]/60'>
                  {l.author} · {l.year}
                </p>
                <p className='mt-3 text-[15px] italic text-[#354e89]'>{l.accroche}</p>
                <p className='mt-2 text-[15px] leading-relaxed text-[#101728]/75'>{l.resume}</p>
                <div className='mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-4'>
                  <a
                    href={`/library?offert=${l.id}`}
                    className='rounded-full bg-[#101728] px-5 py-2.5 text-sm font-bold text-[#f3ecdd] hover:bg-[#1d273f]'
                  >
                    Lire en français
                  </a>
                  <a href={l.epub} download className='text-sm font-medium underline'>
                    Télécharger l’EPUB
                  </a>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className='mx-auto max-w-3xl px-5 pb-14 sm:px-8'>
        <h2 className='font-serif text-2xl font-bold'>Questions fréquentes</h2>
        <dl className='mt-6 space-y-6'>
          {QUESTIONS.map(([q, r]) => (
            <div key={q}>
              <dt className='font-semibold'>{q}</dt>
              <dd className='mt-1 text-[15px] leading-relaxed text-[#101728]/75'>{r}</dd>
            </div>
          ))}
        </dl>
        <p className='mt-8 text-sm text-[#101728]/55'>
          Textes du domaine public, présentés avec une couverture Lis et Lead.
        </p>
      </section>

      <footer className='mx-auto flex max-w-5xl flex-col gap-3 px-5 py-8 text-sm text-[#101728]/60 sm:flex-row sm:justify-between sm:px-8'>
        <p>
          © 2026 Lis et Lead · Mis à jour le <time dateTime={MAJ}>{MAJ_TEXTE}</time> ·{' '}
          <a href='mailto:contact@lisetlead.com' className='underline'>
            contact@lisetlead.com
          </a>
        </p>
        <nav className='flex flex-wrap gap-x-5 gap-y-2'>
          <a href='/decouvrir' className='underline'>
            Découvrir Lis et Lead
          </a>
          <a href='/mentions-legales' className='underline'>
            Mentions légales
          </a>
          <a href='/confidentialite' className='underline'>
            Confidentialité
          </a>
        </nav>
      </footer>
    </main>
  );
}
