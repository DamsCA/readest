import clsx from 'clsx';
import React, { useLayoutEffect, useRef } from 'react';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';

// How close to the screen's edge a menu may come.
const EDGE = 8;

interface MenuProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onCancel?: () => void;
}

const Menu: React.FC<MenuProps> = ({ children, className, style, onCancel }) => {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useKeyDownActions({ onCancel, elementRef: menuRef });

  // Kept whole on the screen. A menu opens against its button and, near the
  // edge, it ran off the screen: on a phone the library menu showed its icons
  // cut and its labels clipped on the left (23 Nov 2026). It is now narrowed to
  // the screen and moved back inside it.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const place = () => {
      el.style.translate = '';
      el.style.maxWidth = `calc(100vw - ${2 * EDGE}px)`;
      const r = el.getBoundingClientRect();
      const width = document.documentElement.clientWidth || window.innerWidth;
      let dx = 0;
      if (r.right > width - EDGE) dx = width - EDGE - r.right;
      if (r.left + dx < EDGE) dx = EDGE - r.left;
      if (dx) el.style.translate = `${Math.round(dx)}px 0`;
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, []);

  return (
    <div
      ref={menuRef}
      role='none'
      className={clsx(
        'menu-container max-h-[calc(100vh-96px)] overflow-y-auto border-0',
        // As wide as its longest label, up to the screen's width: labels that
        // may now wrap must not shrink the menu to its longest word.
        !/(^|\s)!?w-/.test(className ?? '') && 'w-max',
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
};

export default Menu;
