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

const { archAt, archHeight, archPoint, edgeOf, EDGE_SHARE, halfAngle, preparePageShots } =
  await import('@/utils/pageCurl');
const { applyPaginatorSwipe, bookTurnActive, dragPageLikeABook, turnPageLikeABook } = await import(
  '@/utils/pageTurn'
);

// The sheet turns as in Google Play Books (23 Nov 2026): whole, arched between
// the spine and its free edge.
describe('the paper', () => {
  it('lies flat before the turn', () => {
    expect(halfAngle(1)).toBeCloseTo(0, 6);
    for (const s of [0, 0.3, 1]) expect(archPoint(s, 1)).toEqual({ x: s, z: 0, back: false });
    expect(archAt(0)).toMatchObject({ top: 1, bottom: 1, shift: 0 });
  });

  it('arches up between the spine and the free edge, its length unchanged', () => {
    const e = 0.6;
    expect(archPoint(0, e).x).toBeCloseTo(0, 9);
    expect(archPoint(0, e).z).toBeCloseTo(0, 9);
    // The free edge lies where it is held, on the page.
    expect(archPoint(1, e).x).toBeCloseTo(e, 9);
    expect(archPoint(1, e).z).toBeCloseTo(0, 9);
    // In between, the paper rises, highest halfway, its text still showing.
    const mid = archPoint(0.5, e);
    expect(mid.z).toBeCloseTo(archHeight(e), 9);
    expect(mid.z).toBeGreaterThan(0.2);
    expect(mid.back).toBe(false);
    // Measured along the arch, the sheet is still a page wide.
    let length = 0;
    let prev = archPoint(0, e);
    for (let i = 1; i <= 1000; i++) {
      const p = archPoint(i / 1000, e);
      length += Math.hypot(p.x - prev.x, p.z - prev.z);
      prev = p;
    }
    expect(length).toBeCloseTo(1, 3);
  });

  it('rises higher as the free edge nears the spine', () => {
    expect(archHeight(0.4)).toBeGreaterThan(archHeight(0.7));
    expect(archHeight(0.7)).toBeGreaterThan(archHeight(0.95));
  });

  it('has the whole sheet past the spine at the end of the turn', () => {
    const end = archAt(1);
    expect(end.top).toBe(0);
    for (let i = 0; i <= 20; i++) {
      expect(archPoint(i / 20, end.top, end.shift).x).toBeLessThan(0);
    }
    expect(edgeOf(end)).toBeLessThan(0);
  });

  it('goes on without a jump, flat to gone', () => {
    let last = edgeOf(archAt(0));
    expect(last).toBe(1);
    for (let i = 1; i <= 100; i++) {
      const now = edgeOf(archAt(i / 100));
      expect(now).toBeLessThanOrEqual(last + 1e-12);
      expect(last - now).toBeLessThan(0.05);
      last = now;
    }
    expect(edgeOf(archAt(EDGE_SHARE))).toBeCloseTo(0, 9);
  });

  it('leans the free edge round the finger, and not at all at the spine', () => {
    const leaning = archAt(0.3, false, 0.2, 0.5);
    expect(leaning.top).toBeLessThan(leaning.bottom);
    expect((leaning.top + leaning.bottom) / 2).toBeCloseTo(edgeOf(archAt(0.3)), 9);
    const atSpine = archAt(EDGE_SHARE, false, 0.2, 0.5);
    expect(atSpine.top).toBeCloseTo(atSpine.bottom, 9);
  });

  it('turns the other way for a right-to-left book', () => {
    expect(archAt(0.4, true)).toEqual({ ...archAt(0.4), rtl: true });
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
    expect(xs.at(-1)).toBeLessThan(0);
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
    expect(xs[0]).toBeLessThan(0);
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
  it('holds the free edge, and the page turns when let go far enough', async () => {
    const { view, turns } = makeView();
    const drag = dragPageLikeABook(view, 1, { x: 900, y: 1000 })!;
    drag.move({ x: 450, y: 1000 });
    // Halfway to the spine, the free edge is halfway too.
    expect(folds().at(-1)).toBeCloseTo(0.5, 6);
    expect(drag.progress()).toBeCloseTo(EDGE_SHARE * 0.5, 6);
    drag.release(true);
    await vi.waitFor(() => expect(stage.hide).toHaveBeenCalled(), { timeout: 3000 });
    expect(turns).toEqual(['next:jump']);
    expect(folds().at(-1)).toBeLessThan(0);
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
