import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ViewSettings } from '@/types/book';
import { FoliateView } from '@/types/view';
import {
  applyPaginatorSwipe,
  bookTurnActive,
  carried,
  dragPageLikeABook,
  foldPage,
  Pt,
  turnPageLikeABook,
} from '@/utils/pageTurn';

// The book turn (utils/pageTurn.ts): the fold's geometry, then the turn
// against a stand-in for the browser's view transitions and for foliate's
// paginator — what the paginator is asked to do, and what is drawn.

const area = (poly: Pt[]) =>
  Math.abs(
    poly.reduce((sum, p, i) => {
      const q = poly[(i + 1) % poly.length]!;
      return sum + p.x * q.y - q.x * p.y;
    }, 0) / 2,
  );
const xs = (poly: Pt[]) => poly.map((p) => p.x);

describe('the fold', () => {
  const w = 400;
  const h = 800;

  it('leaves the page flat until its corner moves', () => {
    const fold = foldPage(w, h, { x: w, y: h }, { x: w, y: h });
    expect(area(fold.front)).toBe(w * h);
    expect(fold.flap).toHaveLength(0);
  });

  it('turns over what is past the fold, drawn narrower than it is', () => {
    // The corner carried to the spine: the fold halfway, straight down.
    const fold = foldPage(w, h, { x: w, y: 400 }, { x: 0, y: 400 });
    expect(Math.max(...xs(fold.front))).toBeCloseTo(w / 2, 6);
    expect(area(fold.front)).toBeCloseTo((w * h) / 2, 6);
    expect(Math.min(...xs(fold.bare))).toBeCloseTo(w / 2, 6);
    // The folded half lies over the front, from the fold towards the spine,
    // rounded: 0.86 of its width.
    expect(Math.max(...xs(fold.flap))).toBeCloseTo(w / 2, 6);
    expect(Math.min(...xs(fold.flap))).toBeCloseTo(w / 2 - 0.86 * (w / 2), 6);
  });

  it('is gone once the corner is past the spine', () => {
    const fold = foldPage(w, h, { x: w, y: 400 }, { x: -w, y: 400 });
    expect(area(fold.front)).toBeCloseTo(0, 6);
    expect(Math.max(...xs(fold.flap))).toBeLessThanOrEqual(1e-6);
  });

  it('leans when the corner rises', () => {
    const fold = foldPage(w, h, { x: w, y: h }, carried(w, h, h, 0.5, 0.12));
    const bottom = fold.front.filter((p) => Math.abs(p.y - h) < 1e-6).map((p) => p.x);
    const top = fold.front.filter((p) => Math.abs(p.y) < 1e-6).map((p) => p.x);
    // The lifted corner leads: the fold reaches further at the bottom.
    expect(Math.max(...bottom)).toBeLessThan(Math.max(...top));
  });

  it('carries the corner over the spine and back down', () => {
    expect(carried(w, h, h, 0, 0.12)).toEqual({ x: w, y: h });
    const half = carried(w, h, h, 0.5, 0.12);
    expect(half.x).toBeCloseTo(0, 6);
    expect(half.y).toBeCloseTo(h - 0.12 * h, 6);
    const end = carried(w, h, h, 1, 0.12);
    expect(end.x).toBeCloseTo(-w, 6);
    expect(end.y).toBeCloseTo(h, 6);
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

  beforeEach(() => {
    Object.assign(document, { startViewTransition: vi.fn() });
  });
  afterEach(() => {
    delete (document as { startViewTransition?: unknown }).startViewTransition;
  });

  it('takes a paginated reflowable book read across, with paging animation', () => {
    expect(bookTurnActive(settings(), false)).toBe(true);
    expect(bookTurnActive(settings({ scrolled: true }), false)).toBe(false);
    expect(bookTurnActive(settings({ animated: false }), false)).toBe(false);
    expect(bookTurnActive(settings({ bookPageTurn: false }), false)).toBe(false);
    expect(bookTurnActive(settings({ isEink: true }), false)).toBe(false);
    expect(bookTurnActive(settings({ vertical: true }), false)).toBe(false);
    expect(bookTurnActive(settings(), true)).toBe(false);
    delete (document as { startViewTransition?: unknown }).startViewTransition;
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

interface FakeAnimation {
  options: KeyframeAnimationOptions;
  finished: Promise<void>;
  currentTime: number;
  frames: Keyframe[][];
  pause: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
}

let animations: FakeAnimation[] = [];
let transitions = 0;

const install = () => {
  animations = [];
  transitions = 0;
  Object.assign(document, {
    startViewTransition: (update: () => Promise<void>) => {
      transitions++;
      let finish = () => {};
      const finished = new Promise<void>((resolve) => (finish = resolve));
      const updateCallbackDone = Promise.resolve().then(update);
      return {
        updateCallbackDone,
        ready: updateCallbackDone.then(() => {}),
        finished,
        skipTransition: vi.fn(() => finish()),
      };
    },
  });
  Object.assign(document.documentElement, {
    animate: vi.fn((frames: Keyframe[], options: KeyframeAnimationOptions) => {
      const animation: FakeAnimation = {
        options,
        finished: Promise.resolve(),
        currentTime: 0,
        frames: [frames],
        pause: vi.fn(),
        cancel: vi.fn(),
      };
      Object.assign(animation, {
        effect: { setKeyframes: (next: Keyframe[]) => animation.frames.push(next) },
      });
      animations.push(animation);
      return animation;
    }),
  });
};

const uninstall = () => {
  delete (document as { startViewTransition?: unknown }).startViewTransition;
  delete (document.documentElement as { animate?: unknown }).animate;
  document.querySelectorAll('svg').forEach((svg) => svg.remove());
};

// A paginator that records each turn, and whether it slid or jumped.
const makeView = ({ atEnd = false } = {}) => {
  const renderer = document.createElement('div');
  renderer.setAttribute('animated', '');
  Object.assign(renderer, { atStart: false, atEnd, getContents: () => [] });
  const turns: string[] = [];
  const turn = (name: string) =>
    vi.fn(async () => {
      turns.push(`${name}:${renderer.hasAttribute('animated') ? 'slide' : 'jump'}`);
      renderer.dispatchEvent(new CustomEvent('relocate'));
    });
  const view = document.createElement('div');
  Object.assign(view, { renderer, next: turn('next'), prev: turn('prev') });
  return { view: view as unknown as FoliateView, renderer, turns };
};

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

// The turning page's picture: its last cut.
const cutPicture = () => animations.find((a) => a.frames.length > 1);
const lastCut = () => String(cutPicture()?.frames.at(-1)?.[0]?.['clipPath'] ?? '');

describe('a tap', () => {
  beforeEach(install);
  afterEach(async () => {
    await settle();
    uninstall();
  });

  it('turns the page under its picture without the slide, and folds the picture', async () => {
    const { view, renderer, turns } = makeView();
    await turnPageLikeABook(view, 1);
    expect(turns).toEqual(['next:jump']);
    expect(renderer.hasAttribute('animated')).toBe(true);
    // The current page's picture is cut along the fold, frame after frame.
    await vi.waitFor(() => expect(cutPicture()?.frames.length).toBeGreaterThan(3), {
      timeout: 2000,
    });
    expect(cutPicture()?.options.pseudoElement).toBe('::view-transition-old(book-page)');
    // Once turned, only the live page is left.
    await vi.waitFor(() => expect(view.style.getPropertyValue('view-transition-name')).toBe(''), {
      timeout: 2000,
    });
    expect(document.documentElement.classList.contains('book-turning')).toBe(false);
    expect(document.querySelector('svg')).toBeNull();
  });

  // The animations name the pictures; left alive, a turn's last cut (empty
  // once the page has turned) hid the next turn's page: after a few turns both
  // pages showed blank (emulator, claire.59, 17 Oct 2026).
  it('stops every animation it made once the page has turned', async () => {
    const { view } = makeView();
    await turnPageLikeABook(view, 1);
    await vi.waitFor(() => expect(document.querySelector('svg')).toBeNull(), { timeout: 2000 });
    expect(animations.length).toBeGreaterThan(1);
    for (const a of animations) expect(a.cancel).toHaveBeenCalled();
  });

  it('going back, cuts the previous page’s picture as it comes down', async () => {
    const { view, turns } = makeView();
    await turnPageLikeABook(view, -1);
    expect(turns).toEqual(['prev:jump']);
    await vi.waitFor(() => expect(cutPicture()).toBeDefined(), { timeout: 2000 });
    expect(cutPicture()?.options.pseudoElement).toBe('::view-transition-new(book-page)');
  });

  it('turns plainly where there is no page to turn to, or no view transitions', async () => {
    const end = makeView({ atEnd: true });
    await turnPageLikeABook(end.view, 1);
    expect(end.turns).toEqual(['next:slide']);
    expect(transitions).toBe(0);
    uninstall();
    const old = makeView();
    await turnPageLikeABook(old.view, 1);
    expect(old.turns).toEqual(['next:slide']);
  });
});

describe('a finger', () => {
  beforeEach(install);
  afterEach(async () => {
    await settle();
    uninstall();
  });

  it('folds the page along, and the page turns when let go far enough', async () => {
    const { view, turns } = makeView();
    const drag = dragPageLikeABook(view, 1, { x: 900, y: 1000 })!;
    await settle();
    drag.move({ x: 450, y: 1000 });
    expect(drag.progress()).toBeCloseTo(0.5, 6);
    expect(lastCut()).toMatch(/^polygon\(/);
    drag.release(true);
    // Settled: the fold is gone, and the page stays turned.
    await vi.waitFor(() => expect(document.querySelector('svg')).toBeNull(), { timeout: 2000 });
    expect(turns).toEqual(['next:jump']);
  });

  it('lets the page lie back down, the paginator back on its page', async () => {
    const { view, turns } = makeView();
    const drag = dragPageLikeABook(view, 1, { x: 900, y: 1000 })!;
    drag.move({ x: 850, y: 1000 });
    drag.release(false);
    await vi.waitFor(() => expect(turns).toEqual(['next:jump', 'prev:jump']), { timeout: 2000 });
    await vi.waitFor(() => expect(document.querySelector('svg')).toBeNull(), { timeout: 2000 });
  });

  it('waits for a page still turning: the swipe turns plainly', async () => {
    const { view } = makeView();
    void turnPageLikeABook(view, 1);
    expect(dragPageLikeABook(view, 1, { x: 900, y: 1000 })).toBeNull();
    await settle();
    const drag = dragPageLikeABook(view, 1, { x: 900, y: 1000 });
    expect(drag).not.toBeNull();
    drag!.release(true);
    await vi.waitFor(() => expect(document.querySelector('svg')).toBeNull(), { timeout: 2000 });
  });
});
