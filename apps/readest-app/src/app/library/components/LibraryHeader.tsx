import clsx from 'clsx';
import React, { useCallback, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Menu, Plus, Search, SquareCheckBig, SquareDashed, X } from 'lucide-react';

import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useTrafficLight } from '@/hooks/useTrafficLight';
import { APP_DISPLAY_NAME } from '@/services/constants';
import { debounce } from '@/utils/debounce';
import useShortcuts from '@/hooks/useShortcuts';
import WindowButtons from '@/components/WindowButtons';
import Dropdown from '@/components/Dropdown';
import SettingsMenu from './SettingsMenu';
import ImportMenu from './ImportMenu';

interface LibraryHeaderProps {
  isSelectMode: boolean;
  isSelectAll: boolean;
  onPullLibrary: () => void;
  onImportBooksFromFiles: () => void;
  onImportBooksFromDirectory?: () => void;
  onImportBookFromUrl?: () => void;
  onOpenCatalogManager: () => void;
  onToggleSelectMode: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

const ROUND_BUTTON =
  'bg-base-100 text-base-content flex h-11 min-h-11 w-11 items-center justify-center rounded-full border-0 p-0';

/**
 * The library's top bar: the app's name, then round buttons — search,
 * selection (on wide screens), the menu, and "+" to add books. The search
 * field opens under the bar only when it is wanted.
 */
const LibraryHeader: React.FC<LibraryHeaderProps> = ({
  isSelectMode,
  isSelectAll,
  onPullLibrary,
  onImportBooksFromFiles,
  onImportBooksFromDirectory,
  onImportBookFromUrl,
  onOpenCatalogManager,
  onToggleSelectMode,
  onSelectAll,
  onDeselectAll,
}) => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { appService } = useEnv();
  const { systemUIVisible, statusBarHeight, safeAreaInsets: insets } = useThemeStore();
  const { currentBookshelf } = useLibraryStore();
  const [searchQuery, setSearchQuery] = useState(searchParams?.get('q') ?? '');
  const [isSearchOpen, setIsSearchOpen] = useState(() => !!searchParams?.get('q'));

  const headerRef = useRef<HTMLDivElement>(null);
  const { isTrafficLightVisible } = useTrafficLight(headerRef);

  useShortcuts({
    onToggleSelectMode,
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedUpdateQueryParam = useCallback(
    debounce((value: string) => {
      const params = new URLSearchParams(searchParams?.toString());
      if (value) {
        params.set('q', value);
      } else {
        params.delete('q');
      }
      router.push(`?${params.toString()}`);
    }, 500),
    [searchParams],
  );

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value;
    setSearchQuery(newQuery);
    debouncedUpdateQueryParam(newQuery);
  };

  const closeSearch = () => {
    setIsSearchOpen(false);
    if (searchQuery) {
      setSearchQuery('');
      debouncedUpdateQueryParam('');
    }
  };

  const windowButtonVisible = appService?.hasWindowBar && !isTrafficLightVisible;
  const currentBooksCount = currentBookshelf.reduce(
    (acc, item) => acc + ('books' in item ? item.books.length : 1),
    0,
  );

  if (!insets) return null;

  const isMobile = appService?.isMobile || window.innerWidth <= 640;

  return (
    <div
      ref={headerRef}
      className={clsx('titlebar z-10 flex w-full flex-col', isTrafficLightVisible && 'pl-16')}
      style={{
        marginTop: appService?.hasSafeAreaInset
          ? `max(${insets.top}px, ${systemUIVisible ? statusBarHeight : 0}px)`
          : '0px',
      }}
    >
      <div
        className={clsx(
          'flex h-[64px] w-full items-center justify-between gap-3 pe-4 ps-5 sm:h-[56px]',
          windowButtonVisible ? 'sm:pe-4' : 'sm:pe-6',
        )}
      >
        <span className='font-display text-base-content truncate text-[26px] font-extrabold tracking-[-0.03em]'>
          {APP_DISPLAY_NAME}
        </span>
        {isSelectMode ? (
          <button
            onClick={isSelectAll ? onDeselectAll : onSelectAll}
            className='exclude-title-bar-mousedown bg-base-100 text-base-content h-11 shrink-0 rounded-full px-5 text-sm font-semibold'
            aria-label={isSelectAll ? _('Deselect') : _('Select All')}
          >
            {isSelectAll ? _('Deselect') : _('Select All')}
          </button>
        ) : (
          <div className='exclude-title-bar-mousedown flex shrink-0 items-center gap-2'>
            <button
              type='button'
              aria-label={_('Search')}
              aria-expanded={isSearchOpen}
              onClick={() => (isSearchOpen ? closeSearch() : setIsSearchOpen(true))}
              className={ROUND_BUTTON}
            >
              <Search aria-hidden='true' className='h-5 w-5' />
            </button>
            {!isMobile && (
              <button
                type='button'
                onClick={onToggleSelectMode}
                aria-label={_('Select Books')}
                title={_('Select Books')}
                className={ROUND_BUTTON}
              >
                <SquareDashed aria-hidden='true' className='h-5 w-5' />
              </button>
            )}
            <Dropdown
              label={_('Settings Menu')}
              className='dropdown-bottom dropdown-end'
              buttonClassName={ROUND_BUTTON}
              toggleButton={<Menu role='none' className='h-5 w-5' />}
            >
              <SettingsMenu onPullLibrary={onPullLibrary} />
            </Dropdown>
            <Dropdown
              label={_('Import Books')}
              className='dropdown-bottom dropdown-end'
              buttonClassName='bg-base-content text-base-100 flex h-11 min-h-11 w-11 items-center justify-center rounded-full border-0 p-0'
              toggleButton={<Plus role='none' className='h-5 w-5' />}
            >
              <ImportMenu
                onImportBooksFromFiles={onImportBooksFromFiles}
                onImportBooksFromDirectory={onImportBooksFromDirectory}
                onImportBookFromUrl={onImportBookFromUrl}
                onOpenCatalogManager={onOpenCatalogManager}
              />
            </Dropdown>
            {appService?.hasWindowBar && (
              <WindowButtons
                headerRef={headerRef}
                showMinimize={windowButtonVisible}
                showMaximize={windowButtonVisible}
                showClose={windowButtonVisible}
              />
            )}
          </div>
        )}
        {isSelectMode && !isMobile && (
          <button
            type='button'
            onClick={onToggleSelectMode}
            aria-label={_('Select Books')}
            className={clsx(ROUND_BUTTON, 'exclude-title-bar-mousedown shrink-0')}
          >
            <SquareCheckBig aria-hidden='true' className='h-5 w-5' />
          </button>
        )}
      </div>
      {isSearchOpen && (
        <div className='exclude-title-bar-mousedown relative mx-4 mb-1 flex items-center'>
          <Search
            aria-hidden='true'
            className='text-neutral-content pointer-events-none absolute start-4 h-4 w-4'
          />
          <input
            type='text'
            autoFocus
            value={searchQuery}
            aria-label={_('Search Books...')}
            placeholder={
              currentBooksCount > 1
                ? _('Search in {{count}} Book(s)...', { count: currentBooksCount })
                : _('Search Books...')
            }
            onChange={handleSearchChange}
            spellCheck='false'
            className={clsx(
              'search-input bg-base-100 h-11 w-full truncate rounded-full border-0 pe-12 ps-11',
              'font-sans text-sm',
              'placeholder:text-neutral-content focus:outline-none focus:ring-0',
            )}
          />
          <button
            type='button'
            onClick={closeSearch}
            aria-label={_('Clear Search')}
            className='text-neutral-content absolute end-1 flex h-11 w-11 items-center justify-center rounded-full'
          >
            <X aria-hidden='true' className='h-4 w-4' />
          </button>
        </div>
      )}
    </div>
  );
};

export default LibraryHeader;
