import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Book } from '@/types/book';
import ContinueReadingCard from '@/app/library/components/ContinueReadingCard';
import LibraryFilterChips from '@/app/library/components/LibraryFilterChips';
import LibraryTabBar, { LIBRARY_TAB_BAR_HEIGHT } from '@/app/library/components/LibraryTabBar';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) => {
    if (!options) return key;
    return key.replace(/{{(\w+)}}/g, (_match, name) => String(options[name] ?? ''));
  },
}));

const themeState = { isDarkMode: false, safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 } };
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => themeState,
}));

vi.mock('@/components/BookCover', () => ({
  default: () => <div data-testid='cover' />,
}));
vi.mock('@/components/Dropdown', () => ({
  default: ({ label }: { label: string }) => <button aria-label={label} />,
}));
vi.mock('@/app/library/components/ViewMenu', () => ({ default: () => null }));

const alice = {
  hash: 'alice',
  format: 'EPUB',
  title: "Alice's Adventures in Wonderland",
  author: 'Lewis Carroll',
  progress: [42, 100],
  createdAt: 0,
  updatedAt: 1,
} as Book;

afterEach(() => {
  cleanup();
  themeState.isDarkMode = false;
  themeState.safeAreaInsets.bottom = 0;
});

describe('ContinueReadingCard', () => {
  it('shows the book, how far it was read, and opens it', () => {
    const onOpen = vi.fn();
    render(<ContinueReadingCard book={alice} onOpen={onOpen} onListen={vi.fn()} />);

    expect(screen.getByRole('heading', { name: alice.title })).toBeTruthy();
    expect(screen.getByText('Lewis Carroll')).toBeTruthy();
    expect(screen.getByText('42% read')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('42');

    fireEvent.click(screen.getByRole('button', { name: 'Read' }));
    expect(onOpen).toHaveBeenCalledWith(alice);
  });

  it('listens to the book in one tap', () => {
    const onListen = vi.fn();
    render(<ContinueReadingCard book={alice} onOpen={vi.fn()} onListen={onListen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    expect(onListen).toHaveBeenCalledWith(alice);
  });

  it('uses the deeper blue at night', () => {
    const props = { book: alice, onOpen: vi.fn(), onListen: vi.fn() };
    const { container, rerender } = render(<ContinueReadingCard {...props} />);
    expect(container.querySelector('section')!.className).toContain('bg-[#223B78]');

    themeState.isDarkMode = true;
    rerender(<ContinueReadingCard {...props} />);
    expect(container.querySelector('section')!.className).toContain('bg-[#061741]');
  });
});

describe('LibraryFilterChips', () => {
  it('marks the active filter and reports a new choice', () => {
    const onChange = vi.fn();
    render(<LibraryFilterChips filter='pdf' onChange={onChange} />);

    expect(screen.getByRole('button', { name: 'PDF' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Reading' }));
    expect(onChange).toHaveBeenCalledWith('reading');
  });

  it('keeps the sort and display menu next to the chips', () => {
    render(<LibraryFilterChips filter='all' onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'View Menu' })).toBeTruthy();
  });
});

describe('LibraryTabBar', () => {
  it('goes back to the book and opens the settings', () => {
    const onOpenReading = vi.fn();
    const onOpenSettings = vi.fn();
    render(<LibraryTabBar onOpenReading={onOpenReading} onOpenSettings={onOpenSettings} />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue Reading' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onOpenReading).toHaveBeenCalledOnce();
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it('disables the reading tab when no book is in progress', () => {
    render(<LibraryTabBar onOpenReading={null} onOpenSettings={vi.fn()} />);
    const reading = screen.getByRole('button', { name: 'Continue Reading' }) as HTMLButtonElement;
    expect(reading.disabled).toBe(true);
  });

  it('grows by the phone safe area at the bottom', () => {
    themeState.safeAreaInsets.bottom = 20;
    render(<LibraryTabBar onOpenReading={null} onOpenSettings={vi.fn()} />);
    const nav = screen.getByRole('navigation', { name: 'Main Navigation' });
    expect(nav.style.height).toBe(`${LIBRARY_TAB_BAR_HEIGHT + 20}px`);
    expect(nav.style.paddingBottom).toBe('20px');
  });
});
