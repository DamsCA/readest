import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ViewSettings } from '@/types/book';
import { FoliateView } from '@/types/view';
import {
  applyPaginatorSwipe,
  bookTurnActive,
  dragPageLikeABook,
  turnAngle,
  turningFrames,
  turnPageLikeABook,
} from '@/utils/pageTurn';

// The book turn (utils/pageTurn.ts) against a stand-in for the browser's view
// transitions and for foliate's paginator: what the paginator is asked to do,
// and what is animated.

interface FakeAnimation {
  options: KeyframeAnimationOptions;
  finished: Promise<void>;
  currentTime: number;
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
    animate: vi.fn((_frames: Keyframe[], options: KeyframeAnimationOptions) => {
      const animation: FakeAnimation = {
        options,
        finished: Promise.resolve(),
        currentTime: 0,
        pause: vi.fn(),
        cancel: vi.fn(),
      };
      animations.push(animation);
      return animation;
    }),
  });
};

const uninstall = () => {
  delete (document as { startViewTransition?: unknown }).startViewTransition;
  delete (document.documentElement as { animate?: unknown }).animate;
};

// A paginator that records each turn, and whether it slid or jumped.
const makeView = ({ atEnd = false } = {}) => {
  const renderer = document.createElement('div');
  renderer.setAttribute('animated', '');
  Object.assign(renderer, { atStart: false, atEnd });
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

const pictures = () => animations.map((a) => a.options.pseudoElement);

describe('the turning page', () => {
  it('keeps its edge under the finger', () => {
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      expect(Math.cos((turnAngle(p) * Math.PI) / 180)).toBeCloseTo(1 - p, 6);
    }
  });

  it('rises from flat to on edge going on, and comes back down going back', () => {
    const on = turningFrames(1, false, 400, 0, 1);
    expect(on[0]!.transform).toContain('rotateY(0.00deg)');
    expect(on.at(-1)!.transform).toContain('rotateY(-90.00deg)');
    expect(on[0]!.transformOrigin).toBe('left center');
    const back = turningFrames(-1, false, 400, 0, 1);
    expect(back[0]!.transform).toContain('rotateY(-90.00deg)');
    expect(back.at(-1)!.transform).toContain('rotateY(0.00deg)');
    // A right-to-left book turns on its right edge.
    const rtl = turningFrames(1, true, 400, 0, 1);
    expect(rtl[0]!.transformOrigin).toBe('right center');
    expect(rtl.at(-1)!.transform).toContain('rotateY(90.00deg)');
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

  beforeEach(install);
  afterEach(uninstall);

  it('takes a paginated reflowable book read across, with paging animation', () => {
    expect(bookTurnActive(settings(), false)).toBe(true);
    expect(bookTurnActive(settings({ scrolled: true }), false)).toBe(false);
    expect(bookTurnActive(settings({ animated: false }), false)).toBe(false);
    expect(bookTurnActive(settings({ bookPageTurn: false }), false)).toBe(false);
    expect(bookTurnActive(settings({ isEink: true }), false)).toBe(false);
    expect(bookTurnActive(settings({ vertical: true }), false)).toBe(false);
    expect(bookTurnActive(settings(), true)).toBe(false);
    uninstall();
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

describe('a tap', () => {
  beforeEach(install);
  afterEach(async () => {
    await settle();
    uninstall();
  });

  it('turns the page under its picture without the slide, and turns the picture', async () => {
    const { view, renderer, turns } = makeView();
    await turnPageLikeABook(view, 1);
    await settle();
    expect(turns).toEqual(['next:jump']);
    expect(renderer.hasAttribute('animated')).toBe(true);
    expect(pictures()).toContain('::view-transition-old(book-page)');
    expect(pictures()).toContain('::view-transition-new(book-page)');
    // Once turned, only the live page is left.
    expect(view.style.getPropertyValue('view-transition-name')).toBe('');
    expect(document.documentElement.classList.contains('book-turning')).toBe(false);
  });

  it('going back, brings the previous page down over the current one', async () => {
    const { view, turns } = makeView();
    await turnPageLikeABook(view, -1);
    await settle();
    expect(turns).toEqual(['prev:jump']);
    const turning = animations.find((a) => a.options.easing?.startsWith('cubic-bezier'));
    expect(turning?.options.pseudoElement).toBe('::view-transition-new(book-page)');
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

  it('turns the page along, and the page turns when let go far enough', async () => {
    const { view, turns } = makeView();
    const drag = dragPageLikeABook(view, 1)!;
    await settle();
    drag.move(0.5);
    const still = animations.filter((a) => a.options.easing === 'linear');
    expect(still).toHaveLength(2);
    for (const a of still) {
      expect(a.pause).toHaveBeenCalled();
      expect(a.currentTime).toBe(240);
    }
    drag.release(true);
    await settle();
    expect(turns).toEqual(['next:jump']);
  });

  it('lets the page lie back down, the paginator back on its page', async () => {
    const { view, turns } = makeView();
    const drag = dragPageLikeABook(view, 1)!;
    drag.move(0.1);
    drag.release(false);
    await settle();
    expect(turns).toEqual(['next:jump', 'prev:jump']);
  });

  it('waits for a page still turning: the swipe turns plainly', async () => {
    const { view } = makeView();
    void turnPageLikeABook(view, 1);
    expect(dragPageLikeABook(view, 1)).toBeNull();
    await settle();
    const drag = dragPageLikeABook(view, 1);
    expect(drag).not.toBeNull();
    drag!.release(true);
  });
});
