import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import {
  MdCheck,
  MdExpandLess,
  MdExpandMore,
  MdFastForward,
  MdFastRewind,
  MdOutlineCloudDownload,
  MdPause,
  MdPlayArrow,
  MdSkipNext,
  MdSkipPrevious,
  MdVolumeDown,
  MdVolumeUp,
} from 'react-icons/md';
import { TTSVoicesGroup } from '@/services/tts';
import { TTSUtils } from '@/services/tts/TTSUtils';
import type { TTSHighlightGranularity } from '@/services/tts/types';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import SegmentedControl from '@/components/SegmentedControl';
import { saveViewSettings } from '@/helpers/settings';
import { eventDispatcher } from '@/utils/event';
import { getLocale } from '@/utils/misc';
import { baseLang, languageLabel, mergeVoiceGroups, voicesForLang } from '@/utils/voiceMenu';
import {
  RATE_PRESETS,
  TIMER_PRESETS,
  clampRate,
  formatDuration,
  formatRate,
} from '@/utils/ttsPlayer';
import SpeedWheel from './SpeedWheel';

type TTSPanelProps = {
  bookKey: string;
  ttsLang: string;
  isPlaying: boolean;
  timeoutOption: number;
  timeoutTimestamp: number;
  chapterRemainingSec: number | null;
  bookRemainingSec: number | null;
  onTogglePlay: () => void;
  onBackward: (byMark: boolean) => void;
  onForward: (byMark: boolean) => void;
  onSetRate: (rate: number) => void;
  onSetLangVolume: (lang: string, volume: number) => void;
  onGetVoices: (lang: string) => Promise<TTSVoicesGroup[]>;
  onSetVoice: (voice: string, lang: string) => void;
  onGetVoiceIdForLang: (lang: string) => Promise<string>;
  onSelectTimeout: (bookKey: string, value: number) => void;
  onToogleTTSBar: () => void;
};

const Card: React.FC<{ title?: string; children: React.ReactNode; aside?: React.ReactNode }> = ({
  title,
  children,
  aside,
}) => (
  <section className='bg-base-200 rounded-2xl p-4'>
    {title && (
      <div className='mb-3 flex items-center justify-between gap-2'>
        <h3 className='text-sm font-semibold uppercase tracking-wide opacity-70'>{title}</h3>
        {aside}
      </div>
    )}
    {children}
  </section>
);

const RoundButton: React.FC<{
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}> = ({ label, onClick, children, className }) => (
  <button
    type='button'
    title={label}
    aria-label={label}
    onClick={onClick}
    className={clsx(
      'flex items-center justify-center rounded-full transition-transform active:scale-95',
      className ?? 'hover:bg-base-300 h-11 w-11',
    )}
  >
    {children}
  </button>
);

const countdown = (timestamp: number) => {
  const left = Math.max(0, Math.floor((timestamp - Date.now()) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
};

/**
 * The read-aloud player, opened from the floating button: transport, speed to
 * the hundredth, one voice and one volume per language, highlighting, sleep
 * timer. It replaces the small popup inherited from Readest (asked 15 Oct 2026).
 */
const TTSPanel = ({
  bookKey,
  ttsLang,
  isPlaying,
  timeoutOption,
  timeoutTimestamp,
  chapterRemainingSec,
  bookRemainingSec,
  onTogglePlay,
  onBackward,
  onForward,
  onSetRate,
  onSetLangVolume,
  onGetVoices,
  onSetVoice,
  onGetVoiceIdForLang,
  onSelectTimeout,
  onToogleTTSBar,
}: TTSPanelProps) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { getViewSettings, setViewSettings } = useReaderStore();
  const { getBookData } = useBookDataStore();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const viewSettings = getViewSettings(bookKey);
  const locale = getLocale();

  // The languages read aloud, the book's first, then the translation's.
  const [langs] = useState(() => {
    const list = [getBookData(bookKey)?.book?.primaryLanguage, ttsLang];
    if (viewSettings?.translationEnabled) {
      list.splice(1, 0, viewSettings.translateTargetLang || getLocale());
    }
    return [...new Set(list.filter((l): l is string => !!l).map(baseLang))].filter(Boolean);
  });

  const [rate, setRate] = useState(clampRate(viewSettings?.ttsRate ?? 1));
  const [voiceGroups, setVoiceGroups] = useState<TTSVoicesGroup[]>([]);
  const [selectedByLang, setSelectedByLang] = useState<Record<string, string>>({});
  const [volumes, setVolumes] = useState<Record<string, number>>(() =>
    Object.fromEntries(langs.map((l) => [l, TTSUtils.getLangVolume(l)])),
  );
  const [openLang, setOpenLang] = useState<string | null>(null);
  const [allEngines, setAllEngines] = useState<Record<string, boolean>>({});
  const [granularity, setGranularity] = useState<TTSHighlightGranularity>(
    viewSettings?.ttsHighlightGranularity ?? 'sentence',
  );
  const [bankedMinutes, setBankedMinutes] = useState(0);
  const [timerLeft, setTimerLeft] = useState(() =>
    timeoutTimestamp > Date.now() ? countdown(timeoutTimestamp) : '',
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshSelection = async () => {
    const chosen = await Promise.all(
      langs.map(async (lang) => [lang, await onGetVoiceIdForLang(lang)] as const),
    );
    setSelectedByLang(Object.fromEntries(chosen));
  };

  useEffect(() => {
    void (async () => {
      const lists = await Promise.all(langs.map(onGetVoices));
      setVoiceGroups(mergeVoiceGroups(lists.flat()));
      await refreshSelection();
    })();
    const onVoiceChanged = (event: CustomEvent) => {
      const detail = event.detail as { bookKey?: string };
      if (detail?.bookKey && detail.bookKey !== bookKey) return;
      void refreshSelection();
    };
    const onBanked = (event: CustomEvent) => {
      const detail = event.detail as { bookKey?: string; minutes?: number };
      if (detail?.bookKey && detail.bookKey !== bookKey) return;
      setBankedMinutes(detail?.minutes ?? 0);
    };
    eventDispatcher.on('tts-voice-changed', onVoiceChanged);
    eventDispatcher.on('tts-banked-ahead', onBanked);
    return () => {
      eventDispatcher.off('tts-voice-changed', onVoiceChanged);
      eventDispatcher.off('tts-banked-ahead', onBanked);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  useEffect(() => {
    if (!timeoutTimestamp || timeoutTimestamp <= Date.now()) {
      setTimerLeft('');
      return;
    }
    const tick = () =>
      setTimerLeft(timeoutTimestamp > Date.now() ? countdown(timeoutTimestamp) : '');
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timeoutTimestamp]);

  const applyRate = (next: number) => {
    const value = clampRate(next);
    setRate(value);
    onSetRate(value);
    const vs = getViewSettings(bookKey);
    if (vs) {
      vs.ttsRate = value;
      setViewSettings(bookKey, vs);
    }
    settings.globalViewSettings.ttsRate = value;
    // A slider sends a value per pixel: store once it settles.
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSettings(settings);
      void saveSettings(envConfig, settings);
    }, 400);
  };

  const applyVolume = (lang: string, value: number) => {
    setVolumes((prev) => ({ ...prev, [lang]: value }));
    onSetLangVolume(lang, value);
  };

  const selectVoice = (lang: string, voiceId: string, voiceLang: string) => {
    onSetVoice(voiceId, voiceLang);
    setSelectedByLang((prev) => ({ ...prev, [lang]: voiceId }));
    const vs = getViewSettings(bookKey);
    if (vs) {
      vs.ttsVoice = voiceId;
      setViewSettings(bookKey, vs);
    }
    setOpenLang(null);
  };

  const changeGranularity = (next: TTSHighlightGranularity) => {
    setGranularity(next);
    void saveViewSettings(envConfig, bookKey, 'ttsHighlightGranularity', next);
  };

  const remaining = [
    chapterRemainingSec !== null &&
      _('Chapter: {{time}}', { time: formatDuration(chapterRemainingSec) }),
    bookRemainingSec !== null && _('Book: {{time}}', { time: formatDuration(bookRemainingSec) }),
  ].filter(Boolean);

  return (
    <div className='flex flex-col gap-4 pb-6'>
      <section className='flex flex-col items-center gap-3 pt-1'>
        <div className='flex items-center justify-center gap-1 sm:gap-3'>
          <RoundButton label={_('Previous Paragraph')} onClick={() => onBackward(false)}>
            <MdFastRewind size={26} />
          </RoundButton>
          <RoundButton label={_('Previous Sentence')} onClick={() => onBackward(true)}>
            <MdSkipPrevious size={28} />
          </RoundButton>
          <RoundButton
            label={isPlaying ? _('Pause') : _('Play')}
            onClick={onTogglePlay}
            className='bg-primary text-primary-content mx-2 h-16 w-16 shadow-md'
          >
            {isPlaying ? <MdPause size={36} /> : <MdPlayArrow size={38} />}
          </RoundButton>
          <RoundButton label={_('Next Sentence')} onClick={() => onForward(true)}>
            <MdSkipNext size={28} />
          </RoundButton>
          <RoundButton label={_('Next Paragraph')} onClick={() => onForward(false)}>
            <MdFastForward size={26} />
          </RoundButton>
        </div>
        {(remaining.length > 0 || bankedMinutes > 0) && (
          <div className='text-base-content/60 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs'>
            {remaining.map((r) => (
              <span key={String(r)}>{r}</span>
            ))}
            {bankedMinutes > 0 && (
              <span className='flex items-center gap-1'>
                <MdOutlineCloudDownload size={14} />
                {_('{{time}} downloaded ahead', { time: formatDuration(bankedMinutes * 60) })}
              </span>
            )}
          </div>
        )}
      </section>

      <Card
        title={_('Speed')}
        aside={
          <span className='text-xl font-semibold tabular-nums'>{formatRate(rate, locale)}</span>
        }
      >
        <SpeedWheel
          value={rate}
          label={_('Speed')}
          haptics={appService?.hasHaptics}
          onChange={applyRate}
        />
        <div className='mt-3 flex flex-wrap gap-2'>
          {RATE_PRESETS.map((preset) => (
            <button
              key={preset}
              type='button'
              aria-pressed={preset === rate}
              onClick={() => applyRate(preset)}
              className={clsx(
                'rounded-full px-3 py-1 text-sm tabular-nums transition-colors',
                preset === rate ? 'bg-primary text-primary-content' : 'bg-base-300',
              )}
            >
              {formatRate(preset, locale)}
            </button>
          ))}
        </div>
      </Card>

      <Card title={_('Voices')}>
        <div className='flex flex-col'>
          {langs.map((lang) => {
            const engines = voicesForLang(voiceGroups, lang);
            const selected = selectedByLang[lang];
            const selectedName =
              engines.flatMap((e) => e.voices).find((v) => v.id === selected)?.name ?? '';
            const open = openLang === lang;
            const shown = allEngines[lang] ? engines : engines.slice(0, 1);
            const hidden = engines.slice(1).reduce((n, e) => n + e.voices.length, 0);
            const volume = volumes[lang] ?? 1;
            return (
              <div
                key={lang}
                className='border-base-300 border-t py-3 first:border-t-0 first:pt-0 last:pb-0'
              >
                <button
                  type='button'
                  aria-expanded={open}
                  onClick={() => setOpenLang(open ? null : lang)}
                  className='flex w-full items-center justify-between gap-3 text-start'
                >
                  <span className='font-medium'>{languageLabel(lang)}</span>
                  <span className='flex min-w-0 items-center gap-1 text-sm opacity-80'>
                    <span className='truncate'>{selectedName}</span>
                    {open ? <MdExpandLess size={20} /> : <MdExpandMore size={20} />}
                  </span>
                </button>
                {open && (
                  <div
                    role='radiogroup'
                    aria-label={languageLabel(lang)}
                    className='mt-2 flex flex-col'
                  >
                    {shown.map((engine) => (
                      <React.Fragment key={engine.engine}>
                        {allEngines[lang] && engines.length > 1 && (
                          <div className='px-2 pt-2 text-xs opacity-60'>{engine.engine}</div>
                        )}
                        {engine.voices.map((voice) => (
                          <button
                            key={voice.id}
                            type='button'
                            role='radio'
                            aria-checked={voice.id === selected}
                            onClick={() => selectVoice(lang, voice.id, voice.lang)}
                            className='hover:bg-base-300 flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-start'
                          >
                            <span className='truncate'>{voice.name}</span>
                            {voice.id === selected && (
                              <MdCheck size={20} className='text-primary shrink-0' />
                            )}
                          </button>
                        ))}
                      </React.Fragment>
                    ))}
                    {hidden > 0 && !allEngines[lang] && (
                      <button
                        type='button'
                        onClick={() => setAllEngines((prev) => ({ ...prev, [lang]: true }))}
                        className='text-primary px-2 py-2 text-start text-sm'
                      >
                        {_('More voices ({{count}})', { count: hidden })}
                      </button>
                    )}
                    {engines.length === 0 && (
                      <div className='px-2 py-2 text-sm opacity-60'>
                        {_('No voice for this language')}
                      </div>
                    )}
                  </div>
                )}
                <div className='mt-2 flex items-center gap-2'>
                  <MdVolumeDown size={20} className='shrink-0 opacity-60' />
                  <input
                    type='range'
                    className='range range-xs flex-1'
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(volume * 100)}
                    aria-label={_('Volume of {{lang}}', { lang: languageLabel(lang) })}
                    onChange={(e) => applyVolume(lang, Number(e.target.value) / 100)}
                  />
                  <MdVolumeUp size={20} className='shrink-0 opacity-60' />
                  <span className='w-11 text-end text-xs tabular-nums opacity-70'>
                    {Math.round(volume * 100)} %
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <div className='flex flex-col gap-4'>
          <div className='flex items-center justify-between gap-3'>
            <span>{_('Highlighting')}</span>
            <SegmentedControl<TTSHighlightGranularity>
              ariaLabel={_('Highlighting')}
              options={[
                { value: 'sentence', label: _('Sentence') },
                { value: 'word', label: _('Word') },
              ]}
              value={granularity}
              onChange={changeGranularity}
            />
          </div>
          <div>
            <div className='flex items-center justify-between gap-3'>
              <span>{_('Sleep timer')}</span>
              {timerLeft && (
                <span className='text-xs tabular-nums opacity-70'>
                  {_('Stops in {{time}}', { time: timerLeft })}
                </span>
              )}
            </div>
            <div className='mt-2 flex flex-wrap gap-2'>
              {TIMER_PRESETS.map((seconds) => (
                <button
                  key={seconds}
                  type='button'
                  aria-pressed={seconds === timeoutOption}
                  onClick={() => onSelectTimeout(bookKey, seconds)}
                  className={clsx(
                    'rounded-full px-3 py-1 text-sm transition-colors',
                    seconds === timeoutOption ? 'bg-primary text-primary-content' : 'bg-base-300',
                  )}
                >
                  {seconds ? formatDuration(seconds) : _('Off')}
                </button>
              ))}
            </div>
          </div>
          <label className='flex cursor-pointer items-center justify-between gap-3'>
            <span>{_('Player bar at the bottom')}</span>
            <input
              type='checkbox'
              className='toggle toggle-sm'
              checked={!!viewSettings?.showTTSBar}
              onChange={onToogleTTSBar}
            />
          </label>
        </div>
      </Card>
    </div>
  );
};

export default TTSPanel;
