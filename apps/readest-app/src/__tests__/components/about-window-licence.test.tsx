import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AboutWindow, setAboutDialogVisible } from '@/components/AboutWindow';
import { APP_DISPLAY_NAME, SOURCE_CODE_REPO_URL } from '@/services/constants';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) => {
    if (!options) return key;
    return key.replace(/{{(\w+)}}/g, (_match, name) => String(options[name] ?? ''));
  },
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasUpdater: false } }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { updateChannel: 'stable' } }),
}));
vi.mock('@/utils/ua', () => ({ parseWebViewInfo: () => 'test' }));
vi.mock('next/image', () => ({
  // biome-ignore lint/a11y/useAltText: the test stub passes alt through
  default: (props: Record<string, unknown>) => <img {...props} />,
}));

afterEach(cleanup);

const openAbout = () => {
  render(<AboutWindow />);
  act(() => setAboutDialogVisible(true));
};

describe('AboutWindow licence notices (AGPL-3.0)', () => {
  it('says the app is a modified version of Readest, with a date', () => {
    openAbout();
    expect(
      screen.getByText(
        new RegExp(`${APP_DISPLAY_NAME} is a modified version of Readest, modified on`),
      ),
    ).toBeTruthy();
  });

  it('keeps the original copyright notice', () => {
    openAbout();
    expect(screen.getByText(/Bilingify LLC/)).toBeTruthy();
  });

  it('links to the complete source code of this version and to Readest', () => {
    openAbout();
    const source = screen.getByRole('link', { name: 'Source code' });
    expect(source.getAttribute('href')).toContain(SOURCE_CODE_REPO_URL);
    expect(screen.getByRole('link', { name: 'Readest' }).getAttribute('href')).toBe(
      'https://github.com/readest/readest',
    );
  });

  it('offers no update check of its own in a store build', () => {
    openAbout();
    expect(screen.queryByRole('button', { name: 'Check Update' })).toBeNull();
  });
});
