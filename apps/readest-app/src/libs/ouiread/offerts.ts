import liste from '../../../public/offerts/liste.json';

/**
 * The English classics Lis et Lead offers (owner's go, 28 Nov 2026: « Oui, ces
 * trois-là » — a shelf of public-domain books to read in French). Their files
 * sit in public/offerts/: the EPUB (the Project Gutenberg text, with our cover
 * and a clean title), the cover in two sizes, and liste.json, which the phone
 * app reads too. They are made by ktaffilliate's offerts/fabriquer_epub.py;
 * `hash` is the book's fingerprint (utils/md5.ts, partialMD5), so a book
 * already in the library is recognised.
 */
export type LivreOffert = (typeof liste.livres)[number];

export const LIVRES_OFFERTS: LivreOffert[] = liste.livres;

/** The book's EPUB as a File, ready for the library's import; null when it cannot be fetched. */
export const fichierOffert = async (id: string): Promise<File | null> => {
  const livre = LIVRES_OFFERTS.find((l) => l.id === id);
  if (!livre) return null;
  try {
    const reponse = await fetch(livre.epub);
    if (!reponse.ok) return null;
    const contenu = await reponse.blob();
    return new File([contenu], `${livre.title}.epub`, { type: 'application/epub+zip' });
  } catch {
    return null;
  }
};
