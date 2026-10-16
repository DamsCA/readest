import { ViewSettings } from '@/types/book';
import { FoliateView } from '@/types/view';

// Pages turned like a book's. Asked 16 Oct 2026: "un effet lorsque je tourne
// les pages, comme si je tournais une page d'un livre". The page rises on its
// spine and turns away over the next one, dimming as it tilts from the light;
// going back, the previous page comes down over the current one. A finger
// dragged across the page turns it along, its edge under the finger; let go,
// the page finishes turning, or lies back down.
//
// A view transition does it: the browser photographs the reading area, the
// paginator jumps to the other page without its slide, and the two pictures
// are turned in 3D. foliate's paginator is left as it is: it is a submodule
// this fork does not carry.

const NAME = 'book-page';
const ROOT_CLASS = 'book-turning';
// A tap's turn; a drag let go finishes the rest of its turn in less.
const TURN_MS = 480;
// Keyframes along a turn, so that the page's edge stays under the finger.
const STEPS = 24;
// A drag left without news this long is let go: a touch end that never comes
// must not leave the page frozen as a picture.
const IDLE_RELEASE_MS = 3000;
// The page jumps within the transition; past this, it is pictured as it is.
const MOVE_TIMEOUT_MS = 1500;

export type TurnDir = 1 | -1;

export const supportsBookTurn = () =>
  typeof document !== 'undefined' && typeof document.startViewTransition === 'function';

// Paging animation on, the book turn chosen, a reflowable book read across.
const bookTurnOn = (viewSettings: ViewSettings, isFixedLayout: boolean) =>
  viewSettings.animated &&
  viewSettings.bookPageTurn &&
  !viewSettings.isEink &&
  !viewSettings.vertical &&
  !isFixedLayout &&
  supportsBookTurn();

/** Whether this book's pages now turn like a book's. */
export const bookTurnActive = (
  viewSettings: ViewSettings | null | undefined,
  isFixedLayout: boolean,
) => !!viewSettings && !viewSettings.scrolled && bookTurnOn(viewSettings, isFixedLayout);

/**
 * The paginator's own swipe gives the finger to the book turn. Not tied to
 * scrolled mode, where the paginator never swipes, so that switching modes
 * needs no update.
 */
export const applyPaginatorSwipe = (
  renderer: Element,
  viewSettings: ViewSettings,
  isFixedLayout: boolean,
) => {
  if (viewSettings.disableSwipe || bookTurnOn(viewSettings, isFixedLayout)) {
    renderer.setAttribute('no-swipe', '');
  } else {
    renderer.removeAttribute('no-swipe');
  }
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * How far the turning page has rotated, in degrees, once it has risen `p`
 * (0: lying flat, 1: on edge at the spine). Seen straight on, its free edge
 * then stands at 1 - p of the width: a finger moved p of the way across
 * keeps the edge under it.
 */
export const turnAngle = (p: number) => (Math.acos(1 - clamp01(p)) * 180) / Math.PI;

// The rising page comes towards the reader, and perspective pushes its edge
// out ahead of the finger. At 2.4 widths (claire.57), a third of the way into
// a drag, the edge was still at the screen's right side (emulator, 16 Oct
// 2026); halfway it led the finger by 0.28 of the width. At 4.5 widths it
// leads by 0.12 halfway, and the page still visibly rises.
const PERSPECTIVE_WIDTHS = 4.5;

/** The turning page's keyframes from `q0` to `q1` of the turn (0: before, 1: done). */
export const turningFrames = (
  dir: TurnDir,
  rtl: boolean,
  width: number,
  q0: number,
  q1: number,
): Keyframe[] => {
  const perspective = Math.round(Math.max(width, 320) * PERSPECTIVE_WIDTHS);
  // A left-to-right book's pages rise from the right and turn to the left.
  const side = rtl ? 1 : -1;
  return Array.from({ length: STEPS + 1 }, (_, i) => {
    const q = q0 + ((q1 - q0) * i) / STEPS;
    // Going on, the current page rises; going back, the previous one comes down.
    const p = dir > 0 ? q : 1 - q;
    return {
      offset: i / STEPS,
      zIndex: '1',
      transformOrigin: rtl ? 'right center' : 'left center',
      transform: `perspective(${perspective}px) rotateY(${(side * turnAngle(p)).toFixed(2)}deg)`,
      filter: `brightness(${(1 - 0.4 * p).toFixed(3)})`,
    };
  });
};

// The page underneath lies in the turning page's shadow: the next one comes
// out of it; the current one, going back, goes into it.
const underFrames = (dir: TurnDir, q0: number, q1: number): Keyframe[] => {
  const light = (q: number) => (dir > 0 ? 0.72 + 0.28 * q : 1 - 0.2 * q);
  return [
    { offset: 0, filter: `brightness(${light(q0).toFixed(3)})` },
    { offset: 1, filter: `brightness(${light(q1).toFixed(3)})` },
  ];
};

interface Turn {
  transition: ViewTransition;
  // Every animation made for the turn. The pictures are named, not owned: an
  // animation left running would move the next turn's pictures.
  animations: Animation[];
}

let current: Turn | null = null;

const animate = (turn: Turn, frames: Keyframe[], options: KeyframeAnimationOptions) => {
  const animation = document.documentElement.animate(frames, options);
  turn.animations.push(animation);
  return animation;
};

const animateTurn = (
  turn: Turn,
  dir: TurnDir,
  rtl: boolean,
  width: number,
  q0: number,
  q1: number,
  duration: number,
  easing: string,
) => {
  const old = `::view-transition-old(${NAME})`;
  const fresh = `::view-transition-new(${NAME})`;
  const timing = { duration, easing, fill: 'both' as const };
  return [
    animate(turn, turningFrames(dir, rtl, width, q0, q1), {
      ...timing,
      pseudoElement: dir > 0 ? old : fresh,
    }),
    animate(turn, underFrames(dir, q0, q1), { ...timing, pseudoElement: dir > 0 ? fresh : old }),
  ];
};

// Holds the transition open while its pictures stand still: it ends on
// skipTransition(), once the page is where it is to stay.
const holdOpen = (turn: Turn) =>
  animate(turn, [{ opacity: 1 }, { opacity: 1 }], {
    duration: 600_000,
    pseudoElement: `::view-transition-group(${NAME})`,
  });

const finished = (animations: Animation[]) =>
  Promise.all(animations.map((a) => a.finished)).then(
    () => {},
    () => {},
  );

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

const plainTurn = (view: FoliateView, dir: TurnDir) =>
  Promise.resolve(dir > 0 ? view.next() : view.prev());

const canTurn = (view: FoliateView, dir: TurnDir) =>
  dir > 0 ? !view.renderer.atEnd : !view.renderer.atStart;

// The paginator's turn without its slide: the picture is what moves.
const jump = (view: FoliateView, dir: TurnDir) => {
  const { renderer } = view;
  const animated = renderer.hasAttribute('animated');
  if (animated) renderer.removeAttribute('animated');
  // The paginator decides to slide or not as the call starts.
  const moving = plainTurn(view, dir);
  if (animated) renderer.setAttribute('animated', '');
  return moving;
};

// The transition's update: done once the paginator shows the other page (its
// relocate), at the latest when its turn settles.
const moveAndWait = (view: FoliateView, dir: TurnDir, started: (p: Promise<void>) => void) =>
  new Promise<void>((resolve) => {
    const { renderer } = view;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      renderer.removeEventListener('relocate', done);
      clearTimeout(timer);
      resolve();
    };
    renderer.addEventListener('relocate', done);
    timer = setTimeout(done, MOVE_TIMEOUT_MS);
    const moving = jump(view, dir);
    started(moving);
    moving.then(done, done);
  });

const startTurn = (view: FoliateView, dir: TurnDir) => {
  if (current) {
    // Its page has moved (turns wait for that); its pictures go to their end.
    for (const a of current.animations) a.cancel();
    current.transition.skipTransition();
  }
  const root = document.documentElement;
  view.style.setProperty('view-transition-name', NAME);
  root.classList.add(ROOT_CLASS);
  let moving: Promise<void> = Promise.resolve();
  const transition = document.startViewTransition(() =>
    moveAndWait(view, dir, (p) => {
      moving = p;
    }),
  );
  const turn: Turn = { transition, animations: [] };
  current = turn;
  void transition.finished.finally(() => {
    if (current !== turn) return;
    current = null;
    view.style.removeProperty('view-transition-name');
    root.classList.remove(ROOT_CLASS);
  });
  // The paginator's own turn, once the transition has started it.
  const moved = () => transition.updateCallbackDone.then(() => moving);
  return { turn, moved };
};

// One turn at a time: a tap's turn lets the next one start once its page has
// moved (its pictures, still turning, are then cut short); a drag's, once it
// has settled.
let queue: Promise<unknown> = Promise.resolve();
let pending = 0;

const occupy = (until: Promise<unknown>) => {
  pending++;
  queue = until.then(
    () => {},
    () => {},
  );
  void queue.then(() => pending--);
};

/** Turns a page with the book effect; a plain turn where it cannot be done. */
export const turnPageLikeABook = (view: FoliateView, dir: TurnDir, rtl = false) => {
  const run = async () => {
    if (!supportsBookTurn() || !canTurn(view, dir)) {
      await plainTurn(view, dir);
      return;
    }
    const width = view.getBoundingClientRect().width || window.innerWidth;
    const { turn, moved } = startTurn(view, dir);
    turn.transition.ready.then(
      async () => {
        if (current !== turn) return;
        const hold = holdOpen(turn);
        await finished(
          animateTurn(turn, dir, rtl, width, 0, 1, TURN_MS, 'cubic-bezier(0.4, 0, 0.25, 1)'),
        );
        if (current !== turn) return;
        hold.cancel();
        turn.transition.skipTransition();
      },
      () => {}, // skipped: the page turned all the same, without the effect
    );
    await moved().catch(() => {});
  };
  const turned = queue.then(run, run);
  occupy(turned);
  return turned;
};

/** A page turned by a finger: `move` as it drags (0..1 of the turn), `release` as it lifts. */
export interface PageDrag {
  move(progress: number): void;
  release(commit: boolean): void;
}

/**
 * Starts turning a page under a finger; null where the book effect cannot be
 * done, or while a page is still turning (the gesture is then a plain swipe).
 */
export const dragPageLikeABook = (
  view: FoliateView,
  dir: TurnDir,
  rtl = false,
): PageDrag | null => {
  if (!supportsBookTurn() || !canTurn(view, dir) || pending > 0) return null;
  const width = view.getBoundingClientRect().width || window.innerWidth;
  const { turn, moved } = startTurn(view, dir);
  let markSettled = () => {};
  occupy(new Promise<void>((resolve) => (markSettled = resolve)));
  let progress = 0;
  let released: boolean | null = null;
  let pictured = false;
  let broken = false;
  let still: Animation[] = [];
  let hold: Animation | null = null;
  let idle: ReturnType<typeof setTimeout> | undefined;

  const goBack = async () => {
    // Laid back down: the paginator returns to its page under the picture.
    await moved().catch(() => {});
    await jump(view, -dir as TurnDir);
  };

  const settle = async (commit: boolean) => {
    if (broken) {
      // No pictures: the page has moved; put it back if it is not to turn.
      if (!commit) await goBack();
      markSettled();
      return;
    }
    if (!pictured) return; // settled once pictured
    for (const a of still) a.cancel();
    const target = commit ? 1 : 0;
    const duration = Math.max(140, TURN_MS * 0.85 * Math.abs(target - progress));
    await finished(
      animateTurn(
        turn,
        dir,
        rtl,
        width,
        progress,
        target,
        duration,
        'cubic-bezier(0.2, 0.6, 0.3, 1)',
      ),
    );
    if (!commit) {
      await goBack();
      await nextFrame();
    }
    hold?.cancel();
    if (current === turn) turn.transition.skipTransition();
    markSettled();
  };

  const drag: PageDrag = {
    move(p) {
      if (released !== null) return;
      progress = clamp01(p);
      if (pictured) for (const a of still) a.currentTime = progress * TURN_MS;
      clearTimeout(idle);
      idle = setTimeout(() => drag.release(progress > 0.5), IDLE_RELEASE_MS);
    },
    release(commit) {
      if (released !== null) return;
      released = commit;
      clearTimeout(idle);
      void settle(commit);
    },
  };

  turn.transition.ready.then(
    () => {
      if (current !== turn) {
        broken = true;
        if (released !== null) void settle(released);
        return;
      }
      pictured = true;
      hold = holdOpen(turn);
      still = animateTurn(turn, dir, rtl, width, 0, 1, TURN_MS, 'linear');
      for (const a of still) {
        a.pause();
        a.currentTime = progress * TURN_MS;
      }
      if (released !== null) void settle(released);
    },
    () => {
      broken = true;
      if (released !== null) void settle(released);
    },
  );
  idle = setTimeout(() => drag.release(progress > 0.5), IDLE_RELEASE_MS);
  return drag;
};
