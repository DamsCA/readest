import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ColorPanel } from '@/app/reader/components/footerbar/ColorPanel';
import { NavigationBar } from '@/app/reader/components/footerbar/NavigationBar';
import { consumeListenOnOpen, requestListenOnOpen } from '@/utils/listenOnOpen';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isMobileApp: false, hasScreenBrightness: false } }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { screenBrightness: 50 } }),
}));
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    getScreenBrightness: vi.fn(async () => 0.5),
    setScreenBrightness: vi.fn(),
  }),
}));

const theme = {
  themeMode: 'light',
  themeColor: 'default',
  isDarkMode: false,
  setThemeMode: vi.fn(),
  setThemeColor: vi.fn(),
};
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => theme,
}));

const viewState = { ttsEnabled: false };
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getViewState: () => viewState }),
}));
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({ isSideBarVisible: false, isSideBarPinned: false }),
}));

const insets = { top: 0, right: 0, bottom: 0, left: 0 };

beforeEach(() => {
  theme.themeMode = 'light';
  theme.themeColor = 'default';
  theme.isDarkMode = false;
  viewState.ttsEnabled = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe('ColorPanel themes', () => {
  const renderPanel = () =>
    render(<ColorPanel actionTab='color' bottomOffset='64px' forceMobileLayout />);

  it('offers the four ways to read, the current one checked', () => {
    renderPanel();
    const names = screen.getAllByRole('radio').map((radio) => radio.textContent);
    expect(names).toEqual(['AaLight', 'AaSepia', 'AaDark', 'AaBlack']);
    expect(screen.getByRole('radio', { name: /Light/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('pins colour and side together when a theme is picked', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('radio', { name: /Black/ }));
    expect(theme.setThemeColor).toHaveBeenCalledWith('black');
    expect(theme.setThemeMode).toHaveBeenCalledWith('dark');
  });

  it('hands the light and dark choice back to the phone', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('switch', { name: 'Follow the phone (light / dark)' }));
    expect(theme.setThemeMode).toHaveBeenCalledWith('auto');
  });

  it('keeps the other colours one row below', () => {
    renderPanel();
    expect(screen.getByText('More Colors')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Default' })).toBeNull();
  });
});

describe('NavigationBar', () => {
  it('names every tool and marks the open one', () => {
    const onSetActionTab = vi.fn();
    render(
      <NavigationBar
        bookKey='book'
        actionTab='font'
        gridInsets={insets}
        forceMobileLayout
        onSetActionTab={onSetActionTab}
      />,
    );
    expect(screen.getByRole('button', { name: 'Text' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    expect(onSetActionTab).toHaveBeenCalledWith('tts');
  });

  it('shows the voice as on while it reads', () => {
    viewState.ttsEnabled = true;
    render(
      <NavigationBar
        bookKey='book'
        actionTab=''
        gridInsets={insets}
        forceMobileLayout
        onSetActionTab={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Listen' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});

describe('listen on open', () => {
  it('is taken once, by the book that asked', () => {
    requestListenOnOpen('alice');
    expect(consumeListenOnOpen('other')).toBe(false);
    expect(consumeListenOnOpen('alice')).toBe(true);
    expect(consumeListenOnOpen('alice')).toBe(false);
  });

  it('ignores a book without a hash', () => {
    requestListenOnOpen('alice');
    expect(consumeListenOnOpen(undefined)).toBe(false);
  });
});
