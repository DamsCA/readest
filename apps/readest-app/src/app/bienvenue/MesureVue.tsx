'use client';

import { useEffect } from 'react';
import { mesurer } from '@/utils/mesure';

// The Plus offer seen (/bienvenue), counted on /stats (28 Nov 2026).
const MesureVue = () => {
  useEffect(() => {
    mesurer('plus_vu');
  }, []);
  return null;
};

export default MesureVue;
