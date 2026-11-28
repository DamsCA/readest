import type { Metadata } from 'next';
import { CATALOGUE } from '@/libs/ouiread/catalogue';
import MesureCatalogue from './MesureCatalogue';

// lisetlead.com/bibliotheque: the Lis et Lead library (owner's go, 28 Nov 2026:
// « fais tous les livres, le plus de livres qu'on peut… il faut s'abonner pour
// pouvoir avoir accès au catalogue »). Drawn on the server (components/
// Providers.tsx, PAGES_DE_TEXTE) so search engines and AI assistants read it.
// No price here (owner's rule of 26 Nov 2026). « Lire » opens the reader's
// library with ?livre=<id> (library/page.tsx): Plus readers get the book, the
// others the sign-up, then the Plus offer.

const SITE = (process.env['NEXT_PUBLIC_API_BASE_URL'] || 'https://lisetlead.com').replace(
  /\/$/,
  '',
);
const TITRE = 'La bibliothèque Lis et Lead — les classiques du développement personnel en français';
const DESCRIPTION =
  'La Science de l’enrichissement, Le Fonceur, L’homme est ce qu’il pense, Le jeu de la vie… ' +
  `${CATALOGUE.length} grands classiques du développement personnel, traduits en français, à lire et à écouter dans Lis et Lead.`;
const MAJ = '2026-11-28';
const MAJ_TEXTE = '28 novembre 2026';

export const metadata: Metadata = {
  title: { absolute: TITRE },
  description: DESCRIPTION,
  alternates: { canonical: '/bibliotheque' },
  openGraph: {
    type: 'website',
    url: '/bibliotheque',
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
  name: 'La bibliothèque Lis et Lead',
  url: `${SITE}/bibliotheque`,
  dateModified: MAJ,
  itemListElement: CATALOGUE.map((l, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    item: {
      '@type': 'Book',
      name: l.title,
      author: { '@type': 'Person', name: l.author },
      inLanguage: 'fr',
      translator: { '@type': 'Organization', name: 'Lis et Lead' },
      image: `${SITE}${l.cover}`,
      url: `${SITE}/bibliotheque#${l.id}`,
      description: l.resume,
    },
  })),
};

const QUESTIONS: Array<[string, string]> = [
  [
    'Qu’est-ce que la bibliothèque Lis et Lead ?',
    'Les grands classiques du développement personnel, écrits en anglais il y a un siècle et traduits en français par Lis et Lead. Vous les lisez dans la liseuse, et elle peut vous les lire à voix haute.',
  ],
  [
    'Comment y accéder ?',
    'La bibliothèque est incluse dans l’abonnement Lis et Lead Plus. Touchez un livre : il s’ajoute à votre bibliothèque et s’ouvre aussitôt, sur votre téléphone comme sur votre ordinateur.',
  ],
  [
    'Pourquoi ces livres ?',
    'Ce sont les livres qui ont inspiré des générations de lecteurs et d’auteurs : la prospérité, la volonté, la persévérance, la maîtrise de soi. Plusieurs sont conseillés par Kevin Trudeau.',
  ],
];

export default function BibliothequePage() {
  return (
    <main className='h-screen overflow-y-auto bg-[#faf6ee] text-[#101728] antialiased'>
      <script
        type='application/ld+json'
        // Fixed text of our own, not user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(DONNEES) }}
      />
      <MesureCatalogue />

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
            Inclus dans Lis et Lead Plus
          </p>
          <h1 className='mt-4 max-w-3xl font-serif text-[2.3rem] font-bold leading-[1.05] sm:text-6xl'>
            Les grands classiques du développement personnel, en français.
          </h1>
          <p className='mt-5 max-w-2xl text-lg leading-relaxed text-[#f3ecdd]/80'>
            {CATALOGUE.length} livres qui ont inspiré des générations, traduits pour vous.
            Lisez-les, ou laissez la liseuse vous les lire à voix haute.
          </p>
        </div>
      </section>

      <section className='mx-auto max-w-5xl px-5 py-12 sm:px-8'>
        <ul className='grid gap-6 md:grid-cols-2'>
          {CATALOGUE.map((l) => (
            <li
              key={l.id}
              id={l.id}
              className='flex gap-5 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-[#101728]/5'
            >
              <img
                src={l.cover}
                alt={`Couverture de ${l.title}`}
                width={300}
                height={480}
                loading='lazy'
                className='aspect-[5/8] w-28 shrink-0 self-start rounded-xl object-cover shadow-md sm:w-32'
              />
              <div className='flex min-w-0 flex-col'>
                <h2 className='font-serif text-xl font-bold leading-tight'>{l.title}</h2>
                <p className='mt-1 text-sm text-[#101728]/60'>
                  {l.author}
                  {l.year ? ` · ${l.year}` : ''}
                </p>
                {l.kevin && (
                  <p className='mt-2 w-max rounded-full bg-[#101728]/5 px-2.5 py-0.5 text-xs font-semibold text-[#354e89]'>
                    Conseillé par Kevin Trudeau
                  </p>
                )}
                <p className='mt-3 text-[15px] leading-relaxed text-[#101728]/75'>{l.resume}</p>
                <div className='mt-auto pt-4'>
                  <a
                    href={`/library?livre=${l.id}`}
                    className='inline-flex rounded-full bg-[#101728] px-5 py-2.5 text-sm font-bold text-[#f3ecdd] hover:bg-[#1d273f]'
                  >
                    Lire ce livre
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
          Textes originaux du domaine public. Traductions françaises : Lis et Lead, 2026.
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
