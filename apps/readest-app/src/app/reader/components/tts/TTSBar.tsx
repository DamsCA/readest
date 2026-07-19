import clsx from 'clsx';
import { useEffect, useState } from 'react';
import {
  MdPlayArrow,
  MdOutlinePause,
  MdFastRewind,
  MdFastForward,
  MdSkipPrevious,
  MdSkipNext,
  MdOutlineCloudDownload,
} from 'react-icons/md';
import { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';

type TTSBarProps = {
  bookKey: string;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onBackward: (byMark: boolean) => void;
  onForward: (byMark: boolean) => void;
  gridInsets: Insets;
};

const TTSBar = ({
  bookKey,
  isPlaying,
  onTogglePlay,
  onBackward,
  onForward,
  gridInsets,
}: TTSBarProps) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { hoveredBookKey, setHoveredBookKey } = useReaderStore();
  const iconSize32 = useResponsiveSize(30);
  const iconSize48 = useResponsiveSize(36);

  // "Minutes d'avance": how much audio the banker has pre-downloaded ahead of
  // the playhead (grows while paused, consumed while playing). Lets the reader
  // SEE the offline runway that's ready. Emitted by the Fish/Claire client.
  const [bankedMinutes, setBankedMinutes] = useState(0);
  useEffect(() => {
    const onBanked = (event: Event) => {
      const detail = (event as CustomEvent).detail as { bookKey?: string; minutes?: number };
      if (detail?.bookKey && detail.bookKey !== bookKey) return;
      setBankedMinutes(detail?.minutes ?? 0);
    };
    const onState = (event: Event) => {
      const detail = (event as CustomEvent).detail as { bookKey?: string; state?: string };
      if (detail?.bookKey && detail.bookKey !== bookKey) return;
      if (detail?.state === 'stopped') setBankedMinutes(0);
    };
    eventDispatcher.on('tts-banked-ahead', onBanked);
    eventDispatcher.on('tts-playback-state', onState);
    return () => {
      eventDispatcher.off('tts-banked-ahead', onBanked);
      eventDispatcher.off('tts-playback-state', onState);
    };
  }, [bookKey]);
  const bankedLabel = bankedMinutes >= 1 ? `~${Math.round(bankedMinutes)} min d'avance` : null;

  const isVisible = hoveredBookKey !== bookKey;

  return (
    <div
      className={clsx(
        'bg-base-100 absolute bottom-0 z-40',
        'inset-x-0 mx-auto flex w-full justify-center sm:w-fit',
        'transition-opacity duration-300',
        isVisible ? `pointer-events-auto opacity-100` : `pointer-events-none opacity-0`,
      )}
      style={{ paddingBottom: appService?.hasSafeAreaInset ? `${gridInsets.bottom * 0.33}px` : 0 }}
      onMouseEnter={() => !appService?.isMobile && setHoveredBookKey('')}
      onTouchStart={() => !appService?.isMobile && setHoveredBookKey('')}
    >
      <div className='flex flex-col items-center'>
        {bankedLabel && (
          <div
            className='text-base-content/60 pointer-events-none flex items-center gap-1 pt-1 text-xs'
            title='Audio déjà téléchargé en avance (lecture hors-ligne possible)'
          >
            <MdOutlineCloudDownload size={14} />
            <span>{bankedLabel}</span>
          </div>
        )}
        <div className='text-base-content flex h-[52px] items-center space-x-2 px-2'>
          <button
            onClick={onBackward.bind(null, false)}
            className='rounded-full p-1 transition-transform duration-200 hover:scale-105'
            title={_('Previous Paragraph')}
            aria-label={_('Previous Paragraph')}
          >
            <MdFastRewind size={iconSize32} />
          </button>
          <button
            onClick={onBackward.bind(null, true)}
            className='rounded-full p-1 transition-transform duration-200 hover:scale-105'
            title={_('Previous Sentence')}
            aria-label={_('Previous Sentence')}
          >
            <MdSkipPrevious size={iconSize32} />
          </button>
          <button
            onClick={onTogglePlay}
            className='rounded-full p-1 transition-transform duration-200 hover:scale-105'
            title={isPlaying ? _('Pause') : _('Play')}
            aria-label={isPlaying ? _('Pause') : _('Play')}
          >
            {isPlaying ? <MdOutlinePause size={iconSize48} /> : <MdPlayArrow size={iconSize48} />}
          </button>
          <button
            onClick={onForward.bind(null, true)}
            className='rounded-full p-1 transition-transform duration-200 hover:scale-105'
            title={_('Next Sentence')}
            aria-label={_('Next Sentence')}
          >
            <MdSkipNext size={iconSize32} />
          </button>
          <button
            onClick={onForward.bind(null, false)}
            className='rounded-full p-1 transition-transform duration-200 hover:scale-105'
            title={_('Next Paragraph')}
            aria-label={_('Next Paragraph')}
          >
            <MdFastForward size={iconSize32} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default TTSBar;
