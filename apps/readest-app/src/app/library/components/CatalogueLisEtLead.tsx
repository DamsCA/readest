'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PiLockSimpleDuotone } from 'react-icons/pi';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useLibraryStore } from '@/store/libraryStore';
import { CATALOGUE } from '@/libs/ouiread/catalogue';
import {
  pageDeverrouillage,
  statutLecteur,
  telechargerLivre,
  type StatutLecteur,
} from '@/libs/ouiread/catalogueClient';
import { eventDispatcher } from '@/utils/event';
import { mesurer } from '@/utils/mesure';
import { navigateToReader } from '@/utils/nav';

// Under the reader's books: the Lis et Lead library (libs/ouiread/catalogue.ts),
// classics of personal development translated into French, for Plus readers.
// Everyone sees the covers; a Plus reader adds a book in one touch and it opens;
// the others are taken to the sign-up, then to the Plus offer (28 Nov 2026).
const CatalogueLisEtLead = () => {
  const router = useAppRouter();
  const library = useLibraryStore((state) => state.library);
  const [statut, setStatut] = useState<StatutLecteur | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);
  const compte = useRef(false);

  useEffect(() => {
    statutLecteur().then(setStatut);
  }, []);

  const restants = useMemo(() => {
    const presents = new Set(library.filter((b) => !b.deletedAt).map((b) => b.hash));
    return CATALOGUE.filter((l) => !presents.has(l.hash));
  }, [library]);

  useEffect(() => {
    if (restants.length === 0 || compte.current) return;
    compte.current = true;
    mesurer('catalogue_vu');
  }, [restants.length]);

  if (restants.length === 0) return null;
  const plus = statut === 'plus';

  const ouvrir = async (id: string, hash: string) => {
    if (enCours) return;
    const actuel = statut ?? (await statutLecteur());
    if (actuel !== 'plus') {
      mesurer('catalogue_verrou');
      router.push(pageDeverrouillage(actuel, id));
      return;
    }
    setEnCours(id);
    const resultat = await telechargerLivre(id);
    if (!resultat.ok) {
      setEnCours(null);
      if (resultat.raison === 'reseau') {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: 'Le livre n’a pas pu être ajouté. Vérifiez votre connexion et réessayez.',
        });
      } else {
        router.push(
          pageDeverrouillage(resultat.raison === 'connexion' ? 'anonyme' : 'gratuit', id),
        );
      }
      return;
    }
    await eventDispatcher.dispatch('import-book-files', {
      files: [{ file: resultat.fichier }],
      groupId: '',
    });
    mesurer('catalogue_ajoute');
    setEnCours(null);
    if (useLibraryStore.getState().library.some((b) => b.hash === hash && !b.deletedAt)) {
      navigateToReader(router, [hash]);
    }
  };

  return (
    <section aria-label='La bibliothèque Lis et Lead' className='mx-4 mb-2 mt-8 sm:mx-5'>
      <div className='flex items-baseline justify-between gap-3'>
        <h2 className='text-base-content text-base font-semibold'>La bibliothèque Lis et Lead</h2>
        <a href='/bibliotheque' className='lel-accent-text shrink-0 text-sm font-medium'>
          Tout voir
        </a>
      </div>
      <p className='text-base-content/65 mt-1 text-sm'>
        {CATALOGUE.length} grands classiques du développement personnel, traduits en français, à
        lire et à écouter.{plus ? '' : ' Inclus dans Lis et Lead Plus.'}
      </p>
      <div className='mt-3 flex gap-3 overflow-x-auto pb-2'>
        {restants.map((livre) => (
          <button
            key={livre.id}
            type='button'
            onClick={() => ouvrir(livre.id, livre.hash)}
            disabled={!!enCours}
            className='w-[104px] shrink-0 text-left disabled:opacity-60 sm:w-[124px]'
          >
            <span className='relative block'>
              <img
                src={livre.cover}
                alt={`${livre.title}, ${livre.author}`}
                width={300}
                height={480}
                loading='lazy'
                className='aspect-[5/8] w-full rounded-xl object-cover shadow-md'
              />
              {!plus && (
                <span className='absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-[#e8c06a]'>
                  <PiLockSimpleDuotone size={16} aria-hidden='true' />
                </span>
              )}
            </span>
            <span className='text-base-content mt-2 line-clamp-2 block text-[13px] font-medium leading-tight'>
              {livre.title}
            </span>
            <span className='lel-accent-text mt-0.5 block text-xs font-medium'>
              {enCours === livre.id ? 'Ajout…' : plus ? 'Ajouter' : 'Avec Plus'}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
};

export default CatalogueLisEtLead;
