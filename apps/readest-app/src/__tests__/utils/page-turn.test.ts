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

const { curlAt, curlPoint, preparePageShots } = await import('@/utils/pageCurl');
const { applyPaginatorSwipe, bookTurnActive, dragPageLikeABook, turnPageLikeABook } = await import(
  '@/utils/pageTurn'
);

describe('the paper', () => {
  const w = 400;
  const h = 800;
  const fold = { at: { x: 200, y: 0 }, n: { x: -1, y: 0 }, r: 10 };

  it('lies flat on the spine’s side of the fold', () => {
    expect(curlPoint({ x: 150, y: 300 }, fold)).toEqual({ x: 150, y: 300, z: 0, back: false });
  });

  it('rises round the roll just past the fold, its front still showing', () => {
    const p = curlPoint({ x: 205, y: 300 }, fold);
    expect(p.z).toBeGreaterThan(0);
    expect(p.z).toBeLessThan(fold.r);
    expect(p.back).toBe(false);
    // Rolled, it covers less of the page than it did flat.
    expect(p.x).toBeLessThan(205);
  });

  it('comes back over, its back showing, once round the roll', () => {
    const p = curlPoint({ x: 300, y: 300 }, fold);
    expect(p.back).toBe(true);
    expect(p.z).toBeCloseTo(2 * fold.r, 6);
    // What is past the half turn of the roll lies back towards the spine.
    expect(p.x).toBeCloseTo(200 - (100 - Math.PI * fold.r), 6);
  });

  it('leaves the page flat before the turn', () => {
    const c = curlAt(w, h, h, 0, 0.1);
    expect(curlPoint({ x: w, y: h }, c)).toMatchObject({ x: w, y: h, z: 0 });
    expect(curlPoint({ x: 0, y: 0 }, c)).toMatchObject({ x: 0, y: 0, z: 0 });
  });

  it('has the whole page past the spine at the end of the turn', () => {
    const c = curlAt(w, h, h, 1, 0.1);
    for (const corner of [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: 0, y: h },
      { x: w, y: h },
    ]) {
      expect(curlPoint(corner, c).x).toBeLessThanOrEqual(1e-6);
    }
  });

  it('lifts the corner on the way, the roll wider mid-turn', () => {
    const mid = curlAt(w, h, h, 0.5, 0.1);
    // Raised, the corner leads: the fold leans upwards.
    expect(mid.n.y).toBeLessThan(0);
    expect(mid.r).toBeGreaterThan(curlAt(w, h, h, 0.1, 0.1).r);
  });

  it('turns the other way for a right-to-left book', () => {
    const ltr = curlAt(w, h, h, 0.4, 0.1);
    const rtl = curlAt(w, h, h, 0.4, 0.1, true);
    expect(rtl.at.x).toBeCloseTo(w - ltr.at.x, 6);
    expect(rtl.n.x).toBeCloseTo(-ltr.n.x, 6);
    expect(rtl.n.y).toBeCloseTo(ltr.n.y, 6);
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

// The curls drawn, as how far the page has gone (the fold's x: 1000 flat,
// below 0 gone over).
const folds = () => stage.draw.mock.calls.map(([c]) => (c as { at: { x: number } }).at.x);

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
  it('rolls the page over the next one while the paginator jumps underneath', async () => {
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
    expect(xs[0]).toBeGreaterThan(1000);
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
    expect(xs.at(-1)).toBeGreaterThan(1000);
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
    expect(drag.progress()).toBeCloseTo(0.5, 6);
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
    expect(folds().at(-1)).toBeGreaterThan(1000);
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
