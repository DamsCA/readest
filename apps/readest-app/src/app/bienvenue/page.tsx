import type { Metadata } from 'next';
import LienBibliotheque from './LienBibliotheque';

// The page people land on from a shared link (22 Nov 2026): what Lis et Lead
// does, shown rather than told, the gift book, the prices, and one button.
// Every claim here is checked against the app: the idiom examples are the
// ones measured on 12 Oct 2026 (services/translators/providers/ai.ts), the
// formats come from SUPPORTED_BOOK_EXTS, the quotas from the API routes.

export const metadata: Metadata = {
  title: { absolute: 'Lis et Lead — tous les livres du monde, en français' },
  description:
    'Ouvrez un livre en anglais : Lis et Lead le traduit pendant que vous lisez, avec des phrases naturelles, et vous le lit à voix haute. Gratuit, un livre offert à l’inscription.',
};

const INSCRIPTION = '/auth?inscription=1';

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
        <span className='mt-0.5 shrink-0 self-start whitespace-nowrap rounded-full bg-[#d6ebe0] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#16241f]'>
          Lis et Lead
        </span>
        <span className='font-semibold text-[#f3ecdd]'>{nous}</span>
      </p>
    </div>
  </div>
);

const Etape = ({ n, titre, texte }: { n: number; titre: string; texte: string }) => (
  <li className='flex gap-4'>
    <span className='flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#16241f] text-sm font-bold text-[#f3ecdd]'>
      {n}
    </span>
    <div>
      <p className='font-semibold'>{titre}</p>
      <p className='mt-1 text-[15px] text-[#16241f]/70'>{texte}</p>
    </div>
  </li>
);

const Coche = ({ children }: { children: React.ReactNode }) => (
  <li className='flex gap-3'>
    <span aria-hidden className='mt-0.5 text-[#2f7a57]'>
      ✓
    </span>
    <span>{children}</span>
  </li>
);

const Question = ({ q, children }: { q: string; children: React.ReactNode }) => (
  <details className='group border-b border-[#16241f]/10 py-4'>
    <summary className='flex cursor-pointer list-none items-center justify-between gap-4 font-semibold'>
      {q}
      <span className='text-xl text-[#16241f]/40 transition group-open:rotate-45'>+</span>
    </summary>
    <div className='mt-3 text-[15px] leading-relaxed text-[#16241f]/75'>{children}</div>
  </details>
);

export default function BienvenuePage() {
  return (
    <main className='h-screen overflow-y-auto bg-[#faf6ee] text-[#16241f] antialiased'>
      {/* En-tête + promesse */}
      <section className='bg-[radial-gradient(120%_80%_at_80%_0%,#24382f_0%,#16241f_55%,#101a16_100%)] text-[#f3ecdd]'>
        <header className='mx-auto flex max-w-5xl items-center justify-between px-5 py-4 sm:px-8'>
          <a href='/bienvenue' className='flex items-center gap-2 text-lg font-bold tracking-tight'>
            <img src='/icon.png' alt='' width={28} height={28} className='rounded-lg' />
            Lis et Lead
          </a>
          <LienBibliotheque
            href='/auth'
            className='rounded-full px-4 py-2 text-sm font-semibold text-[#f3ecdd]/85 ring-1 ring-white/20 hover:bg-white/10'
          >
            Se connecter
          </LienBibliotheque>
        </header>

        <div className='mx-auto grid max-w-5xl items-center gap-10 px-5 pb-14 pt-6 sm:px-8 md:grid-cols-[1.15fr_0.85fr] md:pb-20 md:pt-10'>
          <div>
            <p className='text-sm font-semibold uppercase tracking-[0.18em] text-[#d6ebe0]/80'>
              Les leaders sont des lecteurs
            </p>
            <h1 className='mt-4 font-serif text-[2.6rem] font-bold leading-[1.05] sm:text-6xl'>
              Tous les livres du monde, en français.
            </h1>
            <p className='mt-5 max-w-xl text-lg leading-relaxed text-[#f3ecdd]/80'>
              Ouvrez un livre en anglais : Lis et Lead le traduit pendant que vous lisez, avec des
              phrases naturelles, et peut vous le lire à voix haute.
            </p>
            <div className='mt-8 flex flex-col gap-3 sm:flex-row sm:items-center'>
              <LienBibliotheque
                href={INSCRIPTION}
                className='inline-flex items-center justify-center rounded-full bg-[#d6ebe0] px-7 py-4 text-base font-bold text-[#16241f] shadow-lg shadow-black/20 transition hover:bg-white'
              >
                Commencer gratuitement
              </LienBibliotheque>
              <p className='text-center text-sm text-[#f3ecdd]/65 sm:text-left'>
                Sans carte bancaire · un livre offert
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

      {/* Ce que ça change */}
      <section className='mx-auto max-w-5xl px-5 py-14 sm:px-8 md:py-20'>
        <h2 className='font-serif text-3xl font-bold sm:text-4xl'>
          Le livre que vous vouliez lire n’existe pas en français ?
        </h2>
        <p className='mt-4 max-w-2xl text-lg leading-relaxed text-[#16241f]/75'>
          Beaucoup de grands livres ne sont jamais traduits. Avec Lis et Lead, vous n’attendez
          plus : vous les lisez maintenant, dans votre langue.
        </p>
        <div className='mt-10 grid gap-5 md:grid-cols-3'>
          {[
            {
              t: 'Une traduction qui sonne juste',
              d: 'Les expressions sont rendues comme par un traducteur, pas mot à mot. Vous lisez du vrai français, pas une notice.',
            },
            {
              t: 'Vos livres à voix haute',
              d: 'Dans les transports, en marchant, les yeux fermés : appuyez sur lecture et écoutez votre livre en français.',
            },
            {
              t: 'Votre bibliothèque partout',
              d: 'Commencez sur l’ordinateur, continuez sur le téléphone : votre page, vos surlignages et vos notes vous suivent.',
            },
          ].map(({ t, d }) => (
            <div key={t} className='rounded-2xl bg-white p-6 shadow-sm ring-1 ring-[#16241f]/5'>
              <p className='text-lg font-semibold'>{t}</p>
              <p className='mt-2 text-[15px] leading-relaxed text-[#16241f]/70'>{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Comment ça marche */}
      <section className='bg-[#efe8da]'>
        <div className='mx-auto grid max-w-5xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-2 md:py-20'>
          <div>
            <h2 className='font-serif text-3xl font-bold sm:text-4xl'>
              Trois gestes, et vous lisez
            </h2>
            <ol className='mt-8 space-y-6'>
              <Etape
                n={1}
                titre='Créez votre compte'
                texte='Avec Google en un clic, ou avec votre e-mail. C’est gratuit.'
              />
              <Etape
                n={2}
                titre='Ajoutez votre livre'
                texte='EPUB, PDF, MOBI, AZW3, FB2, CBZ ou TXT, depuis votre téléphone ou votre ordinateur.'
              />
              <Etape
                n={3}
                titre='Lisez-le en français'
                texte='Choisissez « Traduire » : chaque page arrive dans votre langue, et vous pouvez l’écouter.'
              />
            </ol>
          </div>

          {/* Le cadeau */}
          <div className='flex flex-col items-center gap-6 rounded-3xl bg-[#16241f] p-6 text-center text-[#f3ecdd] sm:flex-row sm:p-8 sm:text-left'>
            <img
              src='/images/ca-marche-couverture.webp'
              alt='Couverture de « Ça marche », R. H. Jarrett'
              width={480}
              height={768}
              className='w-36 shrink-0 rounded-lg shadow-2xl shadow-black/40'
            />
            <div>
              <p className='text-xs font-semibold uppercase tracking-[0.16em] text-[#d6ebe0]/80'>
                Offert à l’inscription
              </p>
              <p className='mt-2 font-serif text-2xl font-bold'>« Ça marche »</p>
              <p className='mt-2 text-[15px] leading-relaxed text-[#f3ecdd]/75'>
                Le petit classique de R. H. Jarrett (1926) : « Si vous savez ce que vous voulez,
                vous pouvez l’avoir. » Il vous attend dans votre bibliothèque.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Prix */}
      <section className='mx-auto max-w-5xl px-5 py-14 sm:px-8 md:py-20'>
        <h2 className='text-center font-serif text-3xl font-bold sm:text-4xl'>
          Commencez gratuitement
        </h2>
        <p className='mx-auto mt-3 max-w-xl text-center text-lg text-[#16241f]/70'>
          Passez à Plus quand vous voulez la meilleure traduction et les plus belles voix.
        </p>
        <div className='mx-auto mt-10 grid max-w-3xl gap-5 md:grid-cols-2'>
          <div className='rounded-3xl bg-white p-7 shadow-sm ring-1 ring-[#16241f]/10'>
            <p className='text-lg font-semibold'>Gratuit</p>
            <p className='mt-2 text-4xl font-bold'>0 €</p>
            <ul className='mt-6 space-y-3 text-[15px]'>
              <Coche>Lecture de vos livres, sur tous vos appareils</Coche>
              <Coche>Traduction standard illimitée</Coche>
              <Coche>Un avant-goût de la traduction IA chaque jour</Coche>
              <Coche>Voix standard, et un avant-goût des voix premium</Coche>
              <Coche>« Ça marche » offert</Coche>
              <Coche>Bientôt : le classement des meilleurs lecteurs</Coche>
            </ul>
            <LienBibliotheque
              href={INSCRIPTION}
              className='mt-8 block rounded-full py-3 text-center font-semibold ring-1 ring-[#16241f]/20 hover:bg-[#16241f]/5'
            >
              Créer mon compte
            </LienBibliotheque>
          </div>

          <div className='relative rounded-3xl bg-[#16241f] p-7 text-[#f3ecdd] shadow-xl'>
            <span className='absolute -top-3 right-6 rounded-full bg-[#d6ebe0] px-3 py-1 text-xs font-bold text-[#16241f]'>
              Recommandé
            </span>
            <p className='text-lg font-semibold'>Plus</p>
            <p className='mt-2'>
              <span className='text-4xl font-bold'>5 €</span>
              <span className='text-[#f3ecdd]/70'> par mois</span>
            </p>
            <p className='text-sm text-[#f3ecdd]/60'>59,99 € par an, ou 6,99 € au mois</p>
            <ul className='mt-6 space-y-3 text-[15px]'>
              <Coche>Tout le gratuit, et en plus :</Coche>
              <Coche>Traduction IA naturelle, comme par un traducteur humain</Coche>
              <Coche>Voix premium expressives, proches d’un vrai lecteur</Coche>
              <Coche>De la place pour toute votre bibliothèque</Coche>
            </ul>
            <LienBibliotheque
              href={INSCRIPTION}
              className='mt-8 block rounded-full bg-[#d6ebe0] py-3 text-center font-bold text-[#16241f] hover:bg-white'
            >
              Essayer gratuitement
            </LienBibliotheque>
          </div>
        </div>
      </section>

      {/* Questions */}
      <section className='bg-[#efe8da]'>
        <div className='mx-auto max-w-3xl px-5 py-14 sm:px-8 md:py-20'>
          <h2 className='font-serif text-3xl font-bold sm:text-4xl'>Vos questions</h2>
          <div className='mt-6'>
            <Question q='Faut-il installer quelque chose ?'>
              Non. Lis et Lead s’ouvre dans votre navigateur, sur téléphone comme sur ordinateur.
              Sur téléphone, ajoutez-le à votre écran d’accueil pour l’ouvrir comme une appli.
            </Question>
            <Question q='Quels livres puis-je lire ?'>
              Les livres que vous avez en fichier : EPUB, PDF, MOBI, AZW3, FB2, CBZ ou TXT. Les
              livres achetés sur Kindle restent verrouillés par Amazon et ne peuvent pas être
              ouverts ailleurs.
            </Question>
            <Question q='De quelles langues vers quelles langues ?'>
              De l’anglais, de l’espagnol, de l’allemand, de l’italien et de bien d’autres langues,
              vers le français. Vous pouvez aussi traduire vers d’autres langues.
            </Question>
            <Question q='Mes livres restent-ils privés ?'>
              Oui. Vos livres et vos notes ne sont visibles que par vous. Le détail est dans notre{' '}
              <a href='/confidentialite' className='underline'>
                politique de confidentialité
              </a>
              .
            </Question>
            <Question q='Et si Plus ne me convient pas ?'>
              L’abonnement est sans engagement : vous l’arrêtez quand vous voulez depuis votre
              compte, et vous gardez Plus jusqu’à la fin de la période payée.
            </Question>
          </div>
        </div>
      </section>

      {/* Dernier appel */}
      <section className='bg-[#16241f] text-[#f3ecdd]'>
        <div className='mx-auto max-w-3xl px-5 py-16 text-center sm:px-8'>
          <h2 className='font-serif text-3xl font-bold sm:text-4xl'>
            Votre prochain livre vous attend.
          </h2>
          <p className='mt-3 text-lg text-[#f3ecdd]/75'>Et le premier est offert.</p>
          <LienBibliotheque
            href={INSCRIPTION}
            className='mt-8 inline-flex rounded-full bg-[#d6ebe0] px-8 py-4 font-bold text-[#16241f] hover:bg-white'
          >
            Commencer gratuitement
          </LienBibliotheque>
        </div>
      </section>

      <footer className='mx-auto flex max-w-5xl flex-col gap-3 px-5 py-8 text-sm text-[#16241f]/60 sm:flex-row sm:justify-between sm:px-8'>
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
          <LienBibliotheque href='/library' className='underline'>
            Ouvrir la bibliothèque
          </LienBibliotheque>
        </nav>
      </footer>
    </main>
  );
}
