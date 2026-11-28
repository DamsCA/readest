import liste from '../../../public/catalogue/liste.json';

/**
 * The Lis et Lead library (owner's go, 28 Nov 2026: « fais tous les livres, le
 * plus de livres qu'on peut… il faut s'abonner pour pouvoir avoir accès au
 * catalogue »): public-domain classics of personal development, translated
 * into French by us, for Plus subscribers only.
 *
 * The list and the small covers are public (public/catalogue/), so everyone sees
 * what Plus opens. The books themselves sit in the private bucket under
 * `catalogue/<id>.epub`; /api/catalogue hands a short-lived link to Plus readers
 * only. They are made by ktaffilliate/lancement-lis-et-lead/catalogue/ (one
 * recipe per book; `hash` is the book's fingerprint, utils/md5.ts partialMD5,
 * so a book already in the library is recognised).
 */
export type LivreCatalogue = (typeof liste.livres)[number];

export const CATALOGUE: LivreCatalogue[] = liste.livres;
