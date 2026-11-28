'use client';

import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isWebAppPlatform } from '@/services/environment';
import { UpdaterContent } from '@/components/UpdaterWindow';
import { useTheme } from '@/hooks/useTheme';
import Spinner from '@/components/Spinner';

const UpdaterPage = () => {
  useTheme();

  return (
    <Suspense
      fallback={
        <div className='fixed inset-0 z-50 flex items-center justify-center'>
          <Spinner loading />
        </div>
      }
    >
      <div className='bg-base-100 px-12 py-4'>
        <UpdaterContent />
      </div>
    </Suspense>
  );
};

// lisetlead.com, 28 Nov 2026: Google Safe Browsing flagged the site « Pages
// trompeuses » (social engineering: pushing people to download software) on
// 26 Nov. Readest's own download and update prompts, shown under the Lis et Lead
// name, are the likely cause: none of them may appear on the web.
const VersAccueil = () => {
  const router = useRouter();
  useEffect(() => {
    router.replace('/');
  }, [router]);
  return null;
};

const Page = () => (isWebAppPlatform() ? <VersAccueil /> : <UpdaterPage />);

export default Page;
