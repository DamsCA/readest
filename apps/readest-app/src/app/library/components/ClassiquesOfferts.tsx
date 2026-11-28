'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useLibraryStore } from '@/store/libraryStore';
import { LIVRES_OFFERTS, fichierOffert } from '@/libs/ouiread/offerts';
import { eventDispatcher } from '@/utils/event';
import { mesurer } from '@/utils/mesure';
import { navigateToReader } from '@/utils/nav';

// Under the reader's books: the English classics we offer (libs/ouiread/offerts.ts).
// One touch adds the book to the library and opens it, so the reader sees the
// translation at once (owner's ask of 28 Nov 2026: give people a reason to stay,
// then to want Plus). Books already in the library are not shown again.
const ClassiquesOfferts = () => {
  const router = useAppRouter();
  const library = useLibraryStore((state) => state.library);
  const [enCours, setEnCours] = useState<string | null>(null);
  const compte = useRef(false);

  const restants = useMemo(() => {
    const presents = new Set(library.filter((b) => !b.deletedAt).map((b) => b.hash));
    return LIVRES_OFFERTS.filter((l) => !presents.has(l.hash));
  }, [library]);

  useEffect(() => {
    if (restants.length === 0 || compte.current) return;
    compte.current = true;
    mesurer('offerts_vus');
  }, [restants.length]);

  if (restants.length === 0) return null;

  const ajouter = async (id: string, hash: string) => {
    if (enCours) return;
    setEnCours(id);
    const fichier = await fichierOffert(id);
    if (!fichier) {
      setEnCours(null);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: 'Le livre n’a pas pu être ajouté. Vérifiez votre connexion et réessayez.',
      });
      return;
    }
    await eventDispatcher.dispatch('import-book-files', {
      files: [{ file: fichier }],
      groupId: '',
    });
    mesurer('offert_ajoute');
    setEnCours(null);
    if (useLibraryStore.getState().library.some((b) => b.hash === hash && !b.deletedAt)) {
      navigateToReader(router, [hash]);
    }
  };

  return (
    <section aria-label='Classiques anglais offerts' className='mx-4 mb-2 mt-8 sm:mx-5'>
      <div className='flex items-baseline justify-between gap-3'>
        <h2 className='text-base-content text-base font-semibold'>Classiques anglais offerts</h2>
        <a href='/offerts' className='lel-accent-text shrink-0 text-sm font-medium'>
          Tout voir
        </a>
      </div>
      <p className='text-base-content/65 mt-1 text-sm'>
        Touchez un livre : il s’ajoute à votre bibliothèque et la liseuse le traduit en français
        pendant que vous lisez.
      </p>
      <div className='mt-3 flex gap-3 overflow-x-auto pb-2'>
        {restants.map((livre) => (
          <button
            key={livre.id}
            type='button'
            onClick={() => ajouter(livre.id, livre.hash)}
            disabled={!!enCours}
            className='w-[104px] shrink-0 text-left disabled:opacity-60 sm:w-[124px]'
          >
            <img
              src={livre.coverSmall}
              alt={`${livre.title}, ${livre.author}`}
              width={300}
              height={480}
              loading='lazy'
              className='aspect-[5/8] w-full rounded-xl object-cover shadow-md'
            />
            <span className='text-base-content mt-2 line-clamp-2 block text-[13px] font-medium leading-tight'>
              {livre.title}
            </span>
            <span className='lel-accent-text mt-0.5 block text-xs font-medium'>
              {enCours === livre.id ? 'Ajout…' : 'Ajouter'}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
};

export default ClassiquesOfferts;
