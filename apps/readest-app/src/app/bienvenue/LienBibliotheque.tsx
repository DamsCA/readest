'use client';

import type { ReactNode } from 'react';

// Remembers that this browser has seen the welcome page, so the home page
// stops sending it here (see app/page.tsx), then follows the link.
export const BIENVENUE_VUE = 'lel-bienvenue-vue';

const LienBibliotheque = ({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) => (
  <a
    href={href}
    className={className}
    onClick={() => {
      try {
        localStorage.setItem(BIENVENUE_VUE, '1');
      } catch {
        // Private browsing: the page simply shows again next time.
      }
    }}
  >
    {children}
  </a>
);

export default LienBibliotheque;
