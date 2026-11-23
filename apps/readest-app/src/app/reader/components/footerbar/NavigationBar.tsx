import clsx from 'clsx';
import {
  IconContents,
  IconListen,
  IconProgress,
  IconText,
  IconTheme,
} from '@/components/icons/lisetlead';
import React from 'react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useSidebarStore } from '@/store/sidebarStore';
import { Insets } from '@/types/misc';

interface NavigationBarProps {
  bookKey: string;
  actionTab: string;
  gridInsets: Insets;
  forceMobileLayout: boolean;
  onSetActionTab: (tab: string) => void;
}

interface TabProps {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}

/** One tool of the bar: an icon in a pill that fills when its panel is open. */
const Tab: React.FC<TabProps> = ({ label, icon, active, onClick }) => (
  <button
    type='button'
    aria-label={label}
    aria-pressed={active}
    onClick={onClick}
    className='flex min-w-0 flex-1 flex-col items-center gap-0.5'
  >
    <span
      className={clsx(
        'flex h-[30px] w-14 items-center justify-center rounded-full transition-colors',
        active ? 'text-base-content bg-[#e8c06a]/30' : 'text-neutral-content',
      )}
    >
      {icon}
    </span>
    <span
      className={clsx(
        'max-w-full truncate text-[11px] leading-4',
        active ? 'text-base-content font-bold' : 'text-neutral-content font-medium',
      )}
    >
      {label}
    </span>
  </button>
);

/** The reader's bottom bar on a phone: contents, theme, progress, text, voice. */
export const NavigationBar: React.FC<NavigationBarProps> = ({
  bookKey,
  actionTab,
  gridInsets,
  forceMobileLayout,
  onSetActionTab,
}) => {
  const isMobile = forceMobileLayout || window.innerWidth < 640 || window.innerHeight < 640;
  const _ = useTranslation();
  const { appService } = useEnv();
  const { getViewState } = useReaderStore();
  const { isSideBarVisible, isSideBarPinned } = useSidebarStore();

  const viewState = getViewState(bookKey);
  // 6 + 30 + 2 + 16 + 10 = 64 px above the safe area: the panels open right on top.
  const navPadding = isMobile ? `${gridInsets.bottom * 0.33 + 10}px` : '0px';
  const iconClass = 'h-5 w-5';

  return (
    <div
      className={clsx(
        // A glass dock floating off the screen's edges (Lis et Lead's look).
        'lel-glass not-eink:mx-3 not-eink:mb-2 not-eink:w-auto not-eink:rounded-[1.75rem]',
        'eink:bg-base-100 eink:w-full z-30 mt-auto flex justify-between px-2 pt-1.5',
        'eink:border-base-content eink:border-t',
        !forceMobileLayout && 'sm:hidden',
      )}
      style={{
        paddingBottom: appService?.isAndroidApp
          ? `calc(env(safe-area-inset-bottom) + 10px)`
          : navPadding,
      }}
    >
      {isSideBarVisible && isSideBarPinned ? null : (
        <Tab
          label={_('Contents')}
          icon={<IconContents aria-hidden='true' className={iconClass} />}
          active={actionTab === 'toc'}
          onClick={() => onSetActionTab('toc')}
        />
      )}
      <Tab
        label={_('Theme')}
        icon={<IconTheme aria-hidden='true' className={iconClass} />}
        active={actionTab === 'color'}
        onClick={() => onSetActionTab('color')}
      />
      <Tab
        label={_('Progress')}
        icon={<IconProgress aria-hidden='true' className={iconClass} />}
        active={actionTab === 'progress'}
        onClick={() => onSetActionTab('progress')}
      />
      <Tab
        label={_('Text')}
        icon={<IconText aria-hidden='true' className={iconClass} />}
        active={actionTab === 'font'}
        onClick={() => onSetActionTab('font')}
      />
      <Tab
        label={_('Listen')}
        icon={<IconListen aria-hidden='true' className={iconClass} />}
        active={!!viewState?.ttsEnabled}
        onClick={() => onSetActionTab('tts')}
      />
    </div>
  );
};
