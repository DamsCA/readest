'use client';

import LibraryPage from './library/page';

// lisetlead.com opens the app itself, for everyone. The owner's call
// (23 Nov 2026): a visitor lands straight in the app; a window then invites
// them to sign up with the gift book, and they may close it and look around
// (library/components/InvitationInscription.tsx). The welcome page stays at
// /bienvenue for whoever links to it.
export default function HomePage() {
  return <LibraryPage />;
}
