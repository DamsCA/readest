'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { mesurer } from '@/utils/mesure';

// Counts each page shown on the web reader (utils/mesure.ts). The figures are
// on /stats, which is not counted itself.
export default function MesureAudience() {
  const chemin = usePathname();
  useEffect(() => {
    if (!chemin || chemin.startsWith('/stats')) return;
    mesurer('vue');
  }, [chemin]);
  return null;
}
