import { redirect } from 'next/navigation';

// The free English classics of the morning of 28 Nov 2026 became the Lis et Lead
// library, in French and for Plus readers (owner's decision the same day).
export default function OffertsPage() {
  redirect('/bibliotheque');
}
