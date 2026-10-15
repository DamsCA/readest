import clsx from 'clsx';
import React, { useState, useRef, useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useTTSControl } from '@/app/reader/hooks/useTTSControl';
import { Insets } from '@/types/misc';
import Dialog from '@/components/Dialog';
import TTSPanel from './TTSPanel';
import TTSIcon from './TTSIcon';
import TTSBar from './TTSBar';

interface TTSControlProps {
  bookKey: string;
  gridInsets: Insets;
}

const TTSControl: React.FC<TTSControlProps> = ({ bookKey, gridInsets }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { safeAreaInsets } = useThemeStore();
  const { hoveredBookKey, getViewSettings } = useReaderStore();

  const viewSettings = getViewSettings(bookKey);

  const [showPanel, setShowPanel] = useState(false);

  const iconRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backButtonTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showIndicatorWithinTimeout, setShowIndicatorWithinTimeout] = useState(true);

  const [shouldMountBackButton, setShouldMountBackButton] = useState(false);
  const [isBackButtonVisible, setIsBackButtonVisible] = useState(false);

  const tts = useTTSControl({
    bookKey,
    onRequestHidePanel: () => setShowPanel(false),
  });

  useEffect(() => {
    if (tts.showBackToCurrentTTSLocation) {
      setShouldMountBackButton(true);
      const fadeInTimeout = setTimeout(() => {
        setIsBackButtonVisible(true);
      }, 10);
      return () => clearTimeout(fadeInTimeout);
    } else {
      setIsBackButtonVisible(false);
      if (backButtonTimeoutRef.current) {
        clearTimeout(backButtonTimeoutRef.current);
      }
      backButtonTimeoutRef.current = setTimeout(() => {
        setShouldMountBackButton(false);
      }, 300);
      return;
    }
  }, [tts.showBackToCurrentTTSLocation]);

  useEffect(() => {
    if (hoveredBookKey) {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
      const showTimeout = setTimeout(() => {
        setShowIndicatorWithinTimeout(true);
      }, 100);
      hoverTimeoutRef.current = showTimeout;
    } else {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
      const hideTimeout = setTimeout(() => {
        setShowIndicatorWithinTimeout(false);
      }, 5000);
      hoverTimeoutRef.current = hideTimeout;
    }

    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, [hoveredBookKey]);

  useEffect(() => {
    if (tts.showTTSBar) {
      setShowPanel(false);
    }
  }, [tts.showTTSBar]);

  const togglePopup = () => {
    if (!showPanel && tts.isTTSActive) {
      tts.refreshTtsLang();
    }
    setShowPanel((prev) => !prev);
  };

  const handleDismissPopup = () => {
    setShowPanel(false);
  };

  return (
    <>
      {shouldMountBackButton && (
        <div
          className={clsx(
            'absolute left-1/2 top-0 z-50 -translate-x-1/2',
            'transition-opacity duration-300',
            isBackButtonVisible ? 'opacity-100' : 'opacity-0',
            safeAreaInsets?.top ? '' : 'py-1',
          )}
          style={{
            top: `${safeAreaInsets?.top || 0}px`,
          }}
        >
          <button
            onClick={tts.handleBackToCurrentTTSLocation}
            className={clsx(
              'not-eink:bg-base-300 eink-bordered whitespace-nowrap rounded-full px-4 py-2 font-sans text-sm shadow-lg',
              safeAreaInsets?.top ? 'h-11' : 'h-9',
            )}
          >
            {_('Back to TTS Location')}
          </button>
        </div>
      )}
      {(showPanel || (tts.showIndicator && showIndicatorWithinTimeout)) && (
        <div
          ref={iconRef}
          className={clsx(
            'absolute h-12 w-12',
            'transition-transform duration-300',
            viewSettings?.rtl ? 'left-8' : 'right-6',
            !appService?.hasSafeAreaInset && 'bottom-[70px] sm:bottom-14',
          )}
          style={{
            bottom: appService?.hasSafeAreaInset
              ? `calc(env(safe-area-inset-bottom, 0px) * ${appService?.isIOSApp ? 0.33 : 1} + ${hoveredBookKey ? 70 : 52}px)`
              : undefined,
          }}
        >
          <TTSIcon
            isPlaying={tts.isPlaying}
            ttsInited={tts.ttsClientsInited}
            onClick={togglePopup}
          />
        </div>
      )}
      {/* A sheet from the bottom on a phone, the page still showing above it. */}
      <Dialog
        id='tts-player'
        isOpen={showPanel && tts.ttsClientsInited}
        onClose={handleDismissPopup}
        snapHeight={0.66}
        title={_('Read Aloud')}
        bgClassName='sm:!bg-black/20 !bg-black/20'
        boxClassName='sm:!w-[480px] sm:!max-w-[480px] sm:!h-auto sm:max-h-[85vh]'
        contentClassName='!px-4 sm:!px-6'
      >
        {showPanel && tts.ttsClientsInited && (
          <TTSPanel
            bookKey={bookKey}
            ttsLang={tts.ttsLang}
            isPlaying={tts.isPlaying}
            timeoutOption={tts.timeoutOption}
            timeoutTimestamp={tts.timeoutTimestamp}
            chapterRemainingSec={tts.chapterRemainingSec}
            bookRemainingSec={tts.bookRemainingSec}
            onTogglePlay={tts.handleTogglePlay}
            onBackward={tts.handleBackward}
            onForward={tts.handleForward}
            onSetRate={tts.handleSetRate}
            onSetLangVolume={tts.handleSetLangVolume}
            onGetVoices={tts.handleGetVoices}
            onSetVoice={tts.handleSetVoice}
            onGetVoiceIdForLang={tts.handleGetVoiceIdForLang}
            onSelectTimeout={tts.handleSelectTimeout}
            onToogleTTSBar={tts.handleToggleTTSBar}
          />
        )}
      </Dialog>
      {tts.showIndicator && tts.showTTSBar && tts.ttsClientsInited && (
        <TTSBar
          bookKey={bookKey}
          isPlaying={tts.isPlaying}
          onBackward={tts.handleBackward}
          onTogglePlay={tts.handleTogglePlay}
          onForward={tts.handleForward}
          gridInsets={gridInsets}
        />
      )}
    </>
  );
};

export default TTSControl;
