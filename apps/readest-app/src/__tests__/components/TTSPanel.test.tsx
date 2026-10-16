import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { TTSVoicesGroup } from '@/services/tts/types';

const viewSettings: Record<string, unknown> = {
  ttsRate: 1,
  translationEnabled: true,
  translateTargetLang: 'fr',
};
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, o?: Record<string, unknown>) =>
    s.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(o?.[k] ?? '')),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getViewSettings: () => viewSettings, setViewSettings: vi.fn() }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => ({ book: { primaryLanguage: 'en' } }) }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalViewSettings: {} },
    setSettings: vi.fn(),
    saveSettings: vi.fn(),
  }),
}));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn() }));
vi.mock('@/utils/misc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/misc')>()),
  getLocale: () => 'en',
}));

import TTSPanel from '@/app/reader/components/tts/TTSPanel';

const memoryStorage = (): Storage => {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
};

const FISH: TTSVoicesGroup = {
  id: 'fish-audio',
  name: 'Fish Audio',
  voices: [
    { id: 'sarah', name: 'Sarah (Fish Audio)', lang: 'en-US' },
    { id: 'selene', name: 'Selene (Fish Audio)', lang: 'en-US' },
    { id: 'claire', name: 'Claire (Fish Audio)', lang: 'fr-FR' },
  ],
};

const props = () => ({
  bookKey: 'book1-view1',
  ttsLang: 'en',
  isPlaying: true,
  timeoutOption: 0,
  timeoutTimestamp: 0,
  chapterRemainingSec: 12 * 60,
  bookRemainingSec: 5 * 3600 + 20 * 60,
  onTogglePlay: vi.fn(),
  onBackward: vi.fn(),
  onForward: vi.fn(),
  onSetRate: vi.fn(),
  onSetLangVolume: vi.fn(),
  onGetVoices: vi.fn(async () => [FISH]),
  onSetVoice: vi.fn(),
  onGetVoiceIdForLang: vi.fn(async (lang: string) => (lang === 'fr' ? 'claire' : 'sarah')),
  onSelectTimeout: vi.fn(),
  onToogleTTSBar: vi.fn(),
});

const renderPanel = async (p = props()) => {
  render(<TTSPanel {...p} />);
  // Voices are fetched after the first render.
  await act(async () => {});
  return p;
};

describe('TTSPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    viewSettings['ttsRate'] = 1;
  });
  afterEach(() => cleanup());

  // Reported 15 Oct 2026: 1.0 too slow, 1.1 too fast, nothing in between; and
  // 16 Oct: a sensitive wheel rather than pressing plus or minus.
  it('rolls the speed wheel to the hundredth', async () => {
    const p = await renderPanel();
    const wheel = screen.getByRole('slider', { name: 'Speed' });
    // 12 px per notch: 52 notches from 0.5 is 1.02.
    Object.defineProperty(wheel, 'scrollLeft', { value: 52 * 12, configurable: true });
    fireEvent.scroll(wheel);
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(p.onSetRate).toHaveBeenLastCalledWith(1.02);
    expect(screen.getAllByText('1.02×').length).toBeGreaterThan(0);
  });

  it('steps the wheel by a hundredth from the keyboard', async () => {
    const p = await renderPanel();
    const wheel = screen.getByRole('slider', { name: 'Speed' });
    fireEvent.keyDown(wheel, { key: 'ArrowRight' });
    expect(p.onSetRate).toHaveBeenLastCalledWith(1.01);
    fireEvent.keyDown(wheel, { key: 'PageUp' });
    expect(p.onSetRate).toHaveBeenLastCalledWith(1.05);
  });

  it('jumps to a preset speed', async () => {
    const p = await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '1.2×' }));
    expect(p.onSetRate).toHaveBeenLastCalledWith(1.2);
  });

  // Reported 15 Oct 2026: the French voice much louder, and no way to change it.
  it('sets each language’s volume on its own', async () => {
    const p = await renderPanel();
    fireEvent.change(screen.getByLabelText('Volume of Français'), { target: { value: '60' } });
    expect(p.onSetLangVolume).toHaveBeenLastCalledWith('fr', 0.6);
    expect(screen.getByText('60 %')).toBeTruthy();
  });

  it('shows the voice of each language and lets another be chosen', async () => {
    const p = await renderPanel();
    expect(screen.getByText('Sarah (Fish Audio)')).toBeTruthy();
    expect(screen.getByText('Claire (Fish Audio)')).toBeTruthy();

    fireEvent.click(screen.getByText('English'));
    const list = within(screen.getByRole('radiogroup', { name: 'English' }));
    expect(list.getAllByRole('radio').map((c) => c.textContent)).toEqual([
      'Sarah (Fish Audio)',
      'Selene (Fish Audio)',
    ]);
    fireEvent.click(list.getByRole('radio', { name: 'Selene (Fish Audio)' }));
    expect(p.onSetVoice).toHaveBeenCalledWith('selene', 'en-US');
  });

  it('says how long is left', async () => {
    await renderPanel();
    expect(screen.getByText('Chapter: 12 min')).toBeTruthy();
    expect(screen.getByText('Book: 5 h 20')).toBeTruthy();
  });

  it('starts a sleep timer', async () => {
    const p = await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '30 min' }));
    expect(p.onSelectTimeout).toHaveBeenCalledWith('book1-view1', 1800);
  });
});
