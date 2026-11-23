import clsx from 'clsx';
import { IconSun } from '@/components/icons/lisetlead';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useDeviceControlStore } from '@/store/deviceStore';
import { saveSysSettings } from '@/helpers/settings';
import { Palette, themes } from '@/styles/themes';
import { debounce } from '@/utils/debounce';
import Slider from '@/components/Slider';

const _ = (key: string) => key;

/** The four ways to read: day, warm paper, night, and true black for OLED. */
const READING_THEMES = [
  { id: 'light', label: _('Light'), color: 'default', dark: false },
  { id: 'sepia', label: _('Sepia'), color: 'sepia', dark: false },
  { id: 'dark', label: _('Dark'), color: 'default', dark: true },
  { id: 'black', label: _('Black'), color: 'black', dark: true },
] as const;

const getPalette = (color: string, dark: boolean): Palette => {
  const theme = themes.find((t) => t.name === color) || themes[0]!;
  return dark ? theme.colors.dark : theme.colors.light;
};

const SCREEN_BRIGHTNESS_LIMITS = {
  MIN: 0,
  MAX: 100,
  DEFAULT: 50,
} as const;

interface ColorPanelProps {
  actionTab: string;
  bottomOffset: string;
  forceMobileLayout: boolean;
}

export const ColorPanel: React.FC<ColorPanelProps> = ({
  actionTab,
  bottomOffset,
  forceMobileLayout,
}) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { getScreenBrightness, setScreenBrightness } = useDeviceControlStore();
  const { themeMode, themeColor, isDarkMode, setThemeMode, setThemeColor } = useThemeStore();

  const [screenBrightnessValue, setScreenBrightnessValue] = useState(
    settings.screenBrightness >= 0 ? settings.screenBrightness : SCREEN_BRIGHTNESS_LIMITS.DEFAULT,
  );

  useEffect(() => {
    if (!appService?.isMobileApp) return;
    if (actionTab !== 'color') return;

    getScreenBrightness().then((brightness) => {
      if (brightness >= 0.0 && brightness <= 1.0) {
        const screenBrightness = Math.round(brightness * 100);
        setScreenBrightnessValue(screenBrightness);
      }
    });
  }, [actionTab, appService, getScreenBrightness]);

  const debouncedSetScreenBrightness = useMemo(
    () =>
      debounce(async (value: number) => {
        saveSysSettings(envConfig, 'screenBrightness', value);
        saveSysSettings(envConfig, 'autoScreenBrightness', false);
        await setScreenBrightness(value / 100);
      }, 100),
    [envConfig, setScreenBrightness],
  );

  const handleScreenBrightnessChange = useCallback(
    async (value: number) => {
      if (!appService?.isMobileApp) return;

      setScreenBrightnessValue(value);
      debouncedSetScreenBrightness(value);
    },
    [appService, debouncedSetScreenBrightness],
  );

  // A theme is a colour and a side, light or dark: picking one pins both, so the
  // page stays as chosen whatever the phone does ("Follow the phone" undoes it).
  const pickTheme = (color: string, dark: boolean) => {
    setThemeColor(color);
    setThemeMode(dark ? 'dark' : 'light');
  };
  const otherThemes = themes.filter(
    ({ name }) => !READING_THEMES.some((theme) => theme.color === name),
  );

  const classes = clsx(
    'footerbar-color-mobile not-eink:bg-base-100 eink:bg-base-100 absolute flex w-full flex-col items-center gap-y-8 px-5 transition-all',
    // A sheet rising from the bottom bar, in one piece with it.
    'rounded-t-[2rem] not-eink:shadow-[0_-16px_40px_rgba(0,0,0,0.12)]',
    'eink:border-base-content eink:border-t',
    !forceMobileLayout && 'sm:hidden',
    actionTab === 'color'
      ? 'pointer-events-auto translate-y-0 pb-4 pt-8 ease-out'
      : 'pointer-events-none invisible translate-y-full overflow-hidden pb-0 pt-0 ease-in',
  );

  return (
    <div
      className={classes}
      style={{
        bottom: appService?.isAndroidApp
          ? `calc(env(safe-area-inset-bottom) + 64px)`
          : bottomOffset,
      }}
    >
      {appService?.hasScreenBrightness && (
        <Slider
          label={_('Screen Brightness')}
          initialValue={screenBrightnessValue}
          bubbleLabel={`${screenBrightnessValue}`}
          minIcon={<IconSun size={16} />}
          maxIcon={<IconSun size={24} />}
          onChange={handleScreenBrightnessChange}
          min={SCREEN_BRIGHTNESS_LIMITS.MIN}
          max={SCREEN_BRIGHTNESS_LIMITS.MAX}
          valueToPosition={(value: number, min: number, max: number): number => {
            if (value <= min) return 0;
            if (value >= max) return 100;
            // Use exponential mapping: position = 100 * ((value/max)^0.5)
            const normalized = value / max;
            const position = Math.pow(normalized, 0.5) * 100;
            return position;
          }}
          positionToValue={(position: number, min: number, max: number): number => {
            if (position <= 0) return min;
            if (position >= 100) return max;
            // Inverse of the above: value = max * (position/100)^2
            const normalized = position / 100;
            const value = Math.pow(normalized, 2) * max;
            return Math.max(min, Math.min(max, value));
          }}
        />
      )}

      <div className='flex w-full flex-col gap-3'>
        <span className='text-neutral-content px-1 text-xs font-bold uppercase tracking-[0.08em]'>
          {_('Theme')}
        </span>
        <div role='radiogroup' aria-label={_('Theme')} className='grid grid-cols-4 gap-2.5'>
          {READING_THEMES.map((theme) => {
            const palette = getPalette(theme.color, theme.dark);
            const selected = themeColor === theme.color && isDarkMode === theme.dark;
            return (
              <button
                key={theme.id}
                type='button'
                role='radio'
                aria-checked={selected}
                onClick={() => pickTheme(theme.color, theme.dark)}
                className={clsx(
                  'flex h-[5.5rem] flex-col items-center justify-center gap-1.5 rounded-[1.1rem] transition-transform active:scale-95',
                  selected ? 'ring-secondary ring-2' : 'ring-base-300 ring-1',
                )}
                style={{ backgroundColor: palette['base-100'], color: palette['base-content'] }}
              >
                <span className='font-serif text-2xl leading-none'>Aa</span>
                <span
                  className='text-[11px] font-semibold'
                  style={{ color: palette['neutral-content'] }}
                >
                  {_(theme.label)}
                </span>
              </button>
            );
          })}
        </div>
        <div className='flex items-center justify-between gap-3 px-1 pt-1'>
          <span className='text-sm font-semibold'>{_('Follow the phone (light / dark)')}</span>
          <input
            type='checkbox'
            role='switch'
            aria-label={_('Follow the phone (light / dark)')}
            aria-checked={themeMode === 'auto'}
            className='toggle toggle-primary'
            checked={themeMode === 'auto'}
            onChange={(e) =>
              setThemeMode(e.target.checked ? 'auto' : isDarkMode ? 'dark' : 'light')
            }
          />
        </div>
        {otherThemes.length > 0 && (
          <div className='flex flex-col gap-2'>
            <span className='text-neutral-content px-1 text-xs font-bold uppercase tracking-[0.08em]'>
              {_('More Colors')}
            </span>
            <div
              className='flex gap-2 overflow-x-auto pb-1'
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              {otherThemes.map(({ name, label, colors }) => (
                <button
                  key={name}
                  type='button'
                  aria-pressed={themeColor === name}
                  onClick={() => setThemeColor(name)}
                  className={clsx(
                    'h-11 shrink-0 rounded-full px-4 text-xs font-semibold',
                    themeColor === name ? 'ring-secondary ring-2' : 'ring-base-300 ring-1',
                  )}
                  style={{
                    backgroundColor: isDarkMode
                      ? colors.dark['base-100']
                      : colors.light['base-100'],
                    color: isDarkMode ? colors.dark['base-content'] : colors.light['base-content'],
                  }}
                >
                  {_(label)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
