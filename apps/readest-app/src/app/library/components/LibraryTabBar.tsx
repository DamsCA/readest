import { BookOpen, LibraryBig, SlidersHorizontal } from 'lucide-react';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';

/** Height of the bar above the safe area, so the shelf can leave room for it. */
export const LIBRARY_TAB_BAR_HEIGHT = 84;

interface LibraryTabBarProps {
  onOpenReading: (() => void) | null;
  onOpenSettings: () => void;
}

/**
 * The phone's bottom bar: the library (here), back to the book in progress,
 * and the settings. Hidden on wide screens, where the header holds them.
 */
const LibraryTabBar: React.FC<LibraryTabBarProps> = ({ onOpenReading, onOpenSettings }) => {
  const _ = useTranslation();
  const { safeAreaInsets } = useThemeStore();
  const bottomInset = safeAreaInsets?.bottom ?? 0;

  return (
    <nav
      aria-label={_('Main Navigation')}
      className='bg-base-100 border-base-300/70 fixed inset-x-0 bottom-0 z-30 flex items-center justify-around rounded-t-[1.75rem] border-t px-3 sm:hidden'
      style={{ height: LIBRARY_TAB_BAR_HEIGHT + bottomInset, paddingBottom: bottomInset }}
    >
      <span
        aria-current='page'
        className='bg-neutral text-base-content flex h-12 items-center gap-2 rounded-full px-[18px] text-sm font-bold'
      >
        <LibraryBig aria-hidden='true' className='h-5 w-5' />
        {_('Library')}
      </span>
      <button
        type='button'
        aria-label={_('Continue Reading')}
        onClick={onOpenReading ?? undefined}
        disabled={!onOpenReading}
        className='text-neutral-content flex h-12 w-12 items-center justify-center rounded-full disabled:opacity-40'
      >
        <BookOpen aria-hidden='true' className='h-[22px] w-[22px]' />
      </button>
      <button
        type='button'
        aria-label={_('Settings')}
        onClick={onOpenSettings}
        className='text-neutral-content flex h-12 w-12 items-center justify-center rounded-full'
      >
        <SlidersHorizontal aria-hidden='true' className='h-[22px] w-[22px]' />
      </button>
    </nav>
  );
};

export default LibraryTabBar;
