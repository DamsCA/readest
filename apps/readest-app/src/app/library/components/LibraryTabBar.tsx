import { useThemeStore } from '@/store/themeStore';
import { IconLibrary, IconReading, IconSettings } from '@/components/icons/lisetlead';
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
      className='lel-glass fixed inset-x-3 z-30 flex items-center justify-around rounded-[1.75rem] px-2 sm:hidden'
      style={{ height: LIBRARY_TAB_BAR_HEIGHT - 16, bottom: bottomInset + 12 }}
    >
      <span
        aria-current='page'
        className='text-base-content flex h-12 items-center gap-2 rounded-full bg-[#e8c06a]/30 px-[18px] text-sm font-bold'
      >
        <IconLibrary aria-hidden='true' className='h-5 w-5' />
        {_('Library')}
      </span>
      <button
        type='button'
        aria-label={_('Continue Reading')}
        onClick={onOpenReading ?? undefined}
        disabled={!onOpenReading}
        className='text-neutral-content flex h-12 w-12 items-center justify-center rounded-full disabled:opacity-40'
      >
        <IconReading aria-hidden='true' className='h-[22px] w-[22px]' />
      </button>
      <button
        type='button'
        aria-label={_('Settings')}
        onClick={onOpenSettings}
        className='text-neutral-content flex h-12 w-12 items-center justify-center rounded-full'
      >
        <IconSettings aria-hidden='true' className='h-[22px] w-[22px]' />
      </button>
    </nav>
  );
};

export default LibraryTabBar;
