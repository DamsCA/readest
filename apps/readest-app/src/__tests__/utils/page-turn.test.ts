import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ViewSettings } from '@/types/book';
import { FoliateView } from '@/types/view';

// The book turn: the paper's geometry (utils/pageCurl.ts), then the turn
// (utils/pageTurn.ts) against a stand-in for the WebGL stage, the page
// photographs and foliate's paginator — what the paginator is asked to do,
// and what is drawn.

const log: string[] = [];
const stage = {
  show: vi.fn((..._args: unknown[]) => log.push('show')),
  draw: vi.fn((..._args: unknown[]) => log.push('draw')),
  hide: vi.fn(() => log.push('hide')),
  isLost: () => false,
};
const shots: Record<number, HTMLCanvasElement | null> = {};
const support = { webgl: true };

vi.mock('@/utils/pageCurl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/pageCurl')>();
  return {
    ...actual,
    supportsPageCurl: () => support.webgl,
    curlStage: () => (support.webgl ? stage : null),
    pageShot: (_view: unknown, k: number) => shots[k] ?? null,
    paperOf: () => '#faf8f2',
    preparePageShots: vi.fn(),
  };
});

const { edgeOf, liftAt, preparePageShots, sheetAt, sheetPoint } = await import('@/utils/pageCurl');
const { applyPaginatorSwipe, bookTurnActive, dragPageLikeABook, followFinger, turnPageLikeABook } =
  await import('@/utils/pageTurn');

// The sheet moves as Google Play Books' page does, measured on a recording
// (23 Nov 2026): it slides away whole towards the spine, lifting as it goes.
describe('the paper', () => {
  it('lies flat before the turn', () => {
    for (const s of [0, 0.3, 1]) expect(sheetPoint(s, 0)).toEqual({ x: s, scale: 1, z: 0 });
  });

  it('slides whole, its text never squeezed', () => {
    for (const p of [0.1, 0.3, 0.6, 0.8]) {
      // Two points a fifth of a page apart stay about that far apart (on the
      // recording, at most 3 % closer near the free edge).
      for (const s of [0.4, 0.6, 0.8]) {
        expect(sheetPoint(s, p).x - sheetPoint(s - 0.2, p).x).toBeGreaterThanOrEqual(0.19);
      }
    }
  });

  it('lifts most on the spine’s side, a little at the free edge', () => {
    for (const p of [0.35, 0.6, 0.8]) {
      expect(liftAt(0.05, p)).toBeGreaterThan(liftAt(0.5, p));
      expect(liftAt(0.5, p)).toBeGreaterThan(liftAt(1, p));
      expect(liftAt(1, p)).toBeGreaterThan(0);
    }
    // Up to a fifth larger, as measured.
    expect(sheetPoint(0.9, 0.8).scale).toBeGreaterThan(1.15);
    expect(sheetPoint(0.9, 0.8).scale).toBeLessThan(1.25);
  });

  it('holds the sheet down at the spine as it starts, bulging just past it', () => {
    expect(liftAt(0, 0.1)).toBeLessThan(0.01);
    expect(liftAt(0.25, 0.1)).toBeGreaterThan(liftAt(0, 0.1) + 0.03);
  });

  it('goes from flat to gone past the spine, without a jump', () => {
    let last = edgeOf(sheetAt(0));
    expect(last).toBe(1);
    for (let i = 1; i <= 100; i++) {
      const now = edgeOf(sheetAt(i / 100));
      expect(now).toBeLessThan(last);
      expect(last - now).toBeLessThan(0.05);
      last = now;
    }
    // At the end, nothing of the sheet is left on the page.
    for (const s of [0, 0.5, 1]) expect(sheetPoint(s, 1).x).toBeLessThanOrEqual(1e-9);
  });

  it('follows the finger as on the recording: lifted first, then carried, ahead at the end', () => {
    expect(followFinger(0)).toBeLessThan(0.02);
    expect(followFinger(0.1)).toBeLessThan(0.06);
    expect(followFinger(0.42)).toBeCloseTo(0.35, 1);
    expect(followFinger(0.64)).toBeCloseTo(0.65, 1);
    expect(followFinger(0.9)).toBe(1);
  });

  it('turns the other way for a right-to-left book', () => {
    expect(sheetAt(0.4, true)).toEqual({ p: 0.4, rtl: true });
  });
});

describe('when the book turn applies', () => {
  const settings = (changed: Partial<ViewSettings> = {}) =>
    ({
      animated: true,
      bookPageTurn: true,
      isEink: false,
      vertical: false,
      scrolled: false,
      disableSwipe: false,
      ...changed,
    }) as ViewSettings;

  afterEach(() => {
    support.webgl = true;
  });

  it('takes a paginated reflowable book read across, with paging animation', () => {
    expect(bookTurnActive(settings(), false)).toBe(true);
    expect(bookTurnActive(settings({ scrolled: true }), false)).toBe(false);
    expect(bookTurnActive(settings({ animated: false }), false)).toBe(false);
    expect(bookTurnActive(settings({ bookPageTurn: false }), false)).toBe(false);
    expect(bookTurnActive(settings({ isEink: true }), false)).toBe(false);
    expect(bookTurnActive(settings({ vertical: true }), false)).toBe(false);
    expect(bookTurnActive(settings(), true)).toBe(false);
    expect(bookTurnActive(null, false)).toBe(false);
    support.webgl = false;
    expect(bookTurnActive(settings(), false)).toBe(false);
  });

  it('takes the swipe from the paginator, scrolled mode or not', () => {
    const renderer = document.createElement('div');
    applyPaginatorSwipe(renderer, settings(), false);
    expect(renderer.hasAttribute('no-swipe')).toBe(true);
    applyPaginatorSwipe(renderer, settings({ scrolled: true }), false);
    expect(renderer.hasAttribute('no-swipe')).toBe(true);
    applyPaginatorSwipe(renderer, settings({ bookPageTurn: false }), false);
    expect(renderer.hasAttribute('no-swipe')).toBe(false);
    applyPaginatorSwipe(renderer, settings({ bookPageTurn: false, disableSwipe: true }), false);
    expect(renderer.hasAttribute('no-swipe')).toBe(true);
  });
});

// A paginator that records each turn, and whether it slid or jumped.
const makeView = ({ atEnd = false } = {}) => {
  const renderer = document.createElement('div');
  renderer.setAttribute('animated', '');
  Object.assign(renderer, { atStart: false, atEnd });
  const turns: string[] = [];
  const turn = (name: string) =>
    vi.fn(async () => {
      turns.push(`${name}:${renderer.hasAttribute('animated') ? 'slide' : 'jump'}`);
      log.push(name);
      renderer.dispatchEvent(new CustomEvent('relocate'));
    });
  const host = document.createElement('div');
  const view = document.createElement('div');
  host.appendChild(view);
  Object.assign(view, {
    renderer,
    next: turn('next'),
    prev: turn('prev'),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1600 }),
  });
  return { view: view as unknown as FoliateView, renderer, turns };
};

const picture = (name: string) => Object.assign(document.createElement('canvas'), { id: name });

// The sheets drawn, as how far the page has gone (1 flat, below 0 gone past
// the spine).
const folds = () => stage.draw.mock.calls.map(([a]) => edgeOf(a as Parameters<typeof edgeOf>[0]));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  log.length = 0;
  stage.show.mockClear();
  stage.draw.mockClear();
  stage.hide.mockClear();
  vi.mocked(preparePageShots).mockClear();
  shots[-1] = picture('before');
  shots[0] = picture('shown');
  shots[1] = picture('after');
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 16),
  );
});
afterEach(async () => {
  // Whatever a test left turning finishes before the next one starts.
  await vi.waitFor(() => expect(stage.hide.mock.calls.length).toBe(stage.show.mock.calls.length), {
    timeout: 3000,
  });
  vi.unstubAllGlobals();
});

describe('a tap', () => {
  it('carries the page over the next one while the paginator jumps underneath', async () => {
    const { view, renderer, turns } = makeView();
    await turnPageLikeABook(view, 1);
    expect(turns).toEqual(['next:jump']);
    expect(renderer.hasAttribute('animated')).toBe(true);
    const [, sheet, under] = stage.show.mock.calls[0]!;
    expect((sheet as HTMLCanvasElement).id).toBe('shown');
    expect((under as HTMLCanvasElement).id).toBe('after');
    // From flat to gone past the spine, frame after frame.
    const xs = folds();
    expect(xs.length).toBeGreaterThan(10);
    expect(xs[0]).toBe(1);
    expect(xs.at(-1)).toBeLessThanOrEqual(0);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeLessThanOrEqual(xs[i - 1]!);
    expect(log.at(-1)).toBe('hide');
    // The next turn's photographs are taken once this one is done.
    expect(preparePageShots).toHaveBeenCalled();
  });

  it('going back, brings the page before down over the page shown', async () => {
    const { view, turns } = makeView();
    await turnPageLikeABook(view, -1);
    expect(turns).toEqual(['prev:jump']);
    const [, sheet, under] = stage.show.mock.calls[0]!;
    expect((sheet as HTMLCanvasElement).id).toBe('before');
    expect((under as HTMLCanvasElement).id).toBe('shown');
    const xs = folds();
    expect(xs[0]).toBeLessThanOrEqual(0);
    expect(xs.at(-1)).toBe(1);
  });

  it('waits for the paginator when the page underneath is not photographed yet', async () => {
    shots[1] = null;
    const { view, turns } = makeView();
    await turnPageLikeABook(view, 1);
    expect(turns).toEqual(['next:jump']);
    expect(stage.show.mock.calls[0]![2]).toBeNull();
    // The sheet lies still over the page until the paginator has moved.
    expect(log.indexOf('next')).toBeLessThan(log.indexOf('draw', log.indexOf('draw') + 1));
  });

  it('turns plainly where the page is not photographed yet, or there is no page to turn to', async () => {
    shots[0] = null;
    const first = makeView();
    await turnPageLikeABook(first.view, 1);
    expect(first.turns).toEqual(['next:slide']);
    expect(preparePageShots).toHaveBeenCalled();
    shots[0] = picture('shown');
    const end = makeView({ atEnd: true });
    await turnPageLikeABook(end.view, 1);
    expect(end.turns).toEqual(['next:slide']);
    expect(stage.show).not.toHaveBeenCalled();
  });
});

describe('a finger', () => {
  it('carries the page along, and the page turns when let go far enough', async () => {
    const { view, turns } = makeView();
    const drag = dragPageLikeABook(view, 1, { x: 900, y: 1000 })!;
    drag.move({ x: 450, y: 1000 });
    // Halfway to the spine, the sheet has gone as far as on the recording.
    expect(drag.progress()).toBeCloseTo(followFinger(0.5), 6);
    expect(folds().at(-1)).toBeLessThan(0.75);
    drag.release(true);
    await vi.waitFor(() => expect(stage.hide).toHaveBeenCalled(), { timeout: 3000 });
    expect(turns).toEqual(['next:jump']);
    expect(folds().at(-1)).toBeLessThanOrEqual(0);
  });

  // The paginator's own swipe, still on, turned a second page as the finger
  // lifted (22 Nov 2026).
  it('keeps the paginator from turning a page of its own', () => {
    const { view, renderer } = makeView();
    const drag = dragPageLikeABook(view, 1, { x: 900, y: 1000 })!;
    expect(renderer.hasAttribute('no-swipe')).toBe(true);
    drag.release(false);
  });

  it('lets the page lie back down, the paginator back on its page', async () => {
    const { view, turns } = makeView();
    const drag = dragPageLikeABook(view, 1, { x: 900, y: 1000 })!;
    drag.move({ x: 850, y: 1000 });
    drag.release(false);
    await vi.waitFor(() => expect(stage.hide).toHaveBeenCalled(), { timeout: 3000 });
    expect(turns).toEqual(['next:jump', 'prev:jump']);
    expect(folds().at(-1)).toBe(1);
  });

  it('waits for a page still turning: the swipe is then a plain one', async () => {
    const { view } = makeView();
    const turning = turnPageLikeABook(view, 1);
    expect(dragPageLikeABook(view, 1, { x: 900, y: 1000 })).toBeNull();
    await turning;
    await settle();
    const drag = dragPageLikeABook(view, 1, { x: 900, y: 1000 });
    expect(drag).not.toBeNull();
    drag!.release(true);
  });
});
