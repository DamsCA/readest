'use client';

import { useEffect } from 'react';
import { mesurer } from '@/utils/mesure';

// The offered classics seen (/offerts), counted on /stats (28 Nov 2026).
const MesureOfferts = () => {
  useEffect(() => {
    mesurer('offerts_vus');
  }, []);
  return null;
};

export default MesureOfferts;
