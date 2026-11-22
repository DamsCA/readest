import type { ReactNode } from 'react';

/** Layout shared by Lis et Lead's legal pages: a scrollable column of readable text. */
const LegalPage = ({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) => (
  <main className='bg-base-100 text-base-content h-screen overflow-y-auto'>
    <article className='mx-auto max-w-2xl px-6 pb-16 pt-10 text-[15px] leading-relaxed'>
      <a href='/library' className='text-base-content/70 text-sm underline'>
        ← Retour à Lis et Lead
      </a>
      <h1 className='mb-2 mt-6 text-3xl font-bold'>{title}</h1>
      <p className='text-base-content/60 mb-8 text-sm'>Dernière mise à jour : {updated}</p>
      <div className='[&_h2]:mb-2 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:mb-1 [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5'>
        {children}
      </div>
    </article>
  </main>
);

export default LegalPage;
