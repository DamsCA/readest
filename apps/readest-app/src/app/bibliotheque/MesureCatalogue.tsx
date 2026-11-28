'use client';

import { useEffect } from 'react';
import { mesurer } from '@/utils/mesure';

// The library page seen (/bibliotheque), counted on /stats (28 Nov 2026).
const MesureCatalogue = () => {
  useEffect(() => {
    mesurer('catalogue_vu');
  }, []);
  return null;
};

export default MesureCatalogue;
