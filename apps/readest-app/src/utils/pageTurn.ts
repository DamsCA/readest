import { ViewSettings } from '@/types/book';
import { FoliateView } from '@/types/view';

// Pages turned like a book's. Asked 16 Oct 2026: "un effet lorsque je tourne
// les pages, comme si je tournais une page d'un livre". The first turn
// (claire.57-58) swung the page whole, like a board; on 17 Oct: "on dirait que
// ta page a été congelée… moi je veux… une page molle qui se plie lorsqu'on
// tourne". The page now folds like paper: its corner is carried over towards
// the spine, the folded part shows the back of the sheet, rounded at the fold
// by its shading, and the next page appears under it, in its shadow. A finger
// drawn across the page carries it along, and the fold leans as the finger
// rises or falls; let go, the page finishes turning, or lies back down.
//
// A view transition does it: the browser photographs the reading area, the
// paginator jumps to the other page without its slide, the turning page's
// picture is cut along the fold, and an SVG over it draws the folded part and
// the shadows. foliate's paginator is left as it is: it is a submodule this
// fork does not carry.

const NAME = 'book-page';
const CURL = 'book-curl';
const ROOT_CLASS = 'book-turning';
// A tap's turn; a drag let go finishes the rest of its turn in less.
const TURN_MS = 620;
// The folded part shows narrower than the page it hides: the paper rounds over
// the fold instead of lying flat.
const SQUEEZE = 0.86;
// How far the carried corner rises halfway through a tap's turn (of the page's
// height), and a finger's (it may also lean the fold itself).
const TAP_LIFT = 0.12;
const DRAG_LIFT = 0.06;
// A drag left without news this long is let go: a touch end that never comes
// must not leave the page frozen as a picture. Long enough to hold a page
// half turned and look at the next one (3 s let it fall back under a still
// finger on the emulator, 17 Oct 2026).
const IDLE_RELEASE_MS = 10_000;
// The page jumps within the transition; past this, it is pictured as it is.
const MOVE_TIMEOUT_MS = 1500;

export type TurnDir = 1 | -1;

export interface Pt {
  x: number;
  y: number;
}

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

// The part of a polygon on the side where `side` is not negative.
const clip = (poly: Pt[], side: (v: Pt) => number): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const sa = side(a);
    const sb = side(b);
    if (sa >= 0) out.push(a);
    if (sa >= 0 !== sb >= 0) {
      const t = sa / (sa - sb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
};

export interface Fold {
  /** What still lies flat: the page's picture is cut to it. */
  front: Pt[];
  /** The folded part, back of the sheet up, over the front. */
  flap: Pt[];
  /** Where the next page shows, in the fold's shadow. */
  bare: Pt[];
  /** The fold: a point on it, and the way towards the spine. */
  at: Pt;
  towards: Pt;
  /** How far the folded part reaches from the fold. */
  reach: number;
}

/**
 * A `w` by `h` page folded so that its point `corner` is carried to `to`: the
 * fold is the line halfway between them, everything past it on the corner's
 * side turns over onto the front.
 */
export const foldPage = (w: number, h: number, corner: Pt, to: Pt): Fold => {
  const page = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const dx = to.x - corner.x;
  const dy = to.y - corner.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.5) {
    return { front: page, flap: [], bare: [], at: corner, towards: { x: -1, y: 0 }, reach: 0 };
  }
  const n = { x: dx / length, y: dy / length };
  const at = { x: (corner.x + to.x) / 2, y: (corner.y + to.y) / 2 };
  const side = (v: Pt) => (v.x - at.x) * n.x + (v.y - at.y) * n.y;
  const front = clip(page, side);
  const bare = clip(page, (v) => -side(v));
  const flap = bare.map((v) => {
    // Turned over across the fold, then rounded: drawn a little narrower.
    const s = -side(v);
    const k = s * (1 + SQUEEZE);
    return { x: v.x + k * n.x, y: v.y + k * n.y };
  });
  return { front, flap, bare, at, towards: n, reach: (length / 2) * SQUEEZE };
};

/**
 * Where the carried corner is, `q` of the way through a turn (0: flat, 1:
 * folded onto the spine), for a corner at height `y`: it travels to the far
 * side of the spine, rising (`lift`, signed, of the height) as it goes.
 */
export const carried = (w: number, h: number, y: number, q: number, lift: number): Pt => ({
  x: w - 2 * w * q,
  y: y - lift * h * Math.sin(Math.PI * q),
});

const polygon = (points: Pt[]) =>
  points.length < 3
    ? 'polygon(0 0, 0 0, 0 0)'
    : `polygon(${points.map((p) => `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`).join(', ')})`;

const svgPoints = (points: Pt[]) =>
  points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

const SVG_NS = 'http://www.w3.org/2000/svg';
let overlayCount = 0;

// The paper's colour: the book's own background, as its pages are painted.
const paperColor = (view: FoliateView) => {
  for (const { doc } of view.renderer.getContents()) {
    const root = doc?.documentElement;
    const style = root && doc.defaultView?.getComputedStyle(root);
    const bg = style?.getPropertyValue('--theme-bg-color').trim() || style?.backgroundColor;
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') return bg;
  }
  return '#ffffff';
};

interface Overlay {
  svg: SVGSVGElement;
  bare: SVGPolygonElement;
  shadow: SVGPolygonElement;
  flap: SVGPolygonElement;
  shade: SVGPolygonElement;
  bareLight: SVGLinearGradientElement;
  flapLight: SVGLinearGradientElement;
}

// The folded part and the shadows, drawn over the page's picture. Named, so
// that the transition shows it above the picture; live, so that redrawing it
// moves it.
const makeOverlay = (view: FoliateView, paper: string): Overlay => {
  const rect = view.getBoundingClientRect();
  const id = `book-curl-${++overlayCount}`;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
  svg.setAttribute('aria-hidden', 'true');
  Object.assign(svg.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '2147483000',
  });
  svg.style.setProperty('view-transition-name', CURL);
  svg.innerHTML = `
    <defs>
      <linearGradient id="${id}-bare" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#000" stop-opacity="0.38"/>
        <stop offset="0.35" stop-color="#000" stop-opacity="0.14"/>
        <stop offset="1" stop-color="#000" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="${id}-flap" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#000" stop-opacity="0.30"/>
        <stop offset="0.05" stop-color="#000" stop-opacity="0.06"/>
        <stop offset="0.14" stop-color="#fff" stop-opacity="0.28"/>
        <stop offset="0.45" stop-color="#fff" stop-opacity="0.06"/>
        <stop offset="1" stop-color="#000" stop-opacity="0.16"/>
      </linearGradient>
      <filter id="${id}-blur" x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur stdDeviation="7"/>
      </filter>
    </defs>
    <polygon fill="url(#${id}-bare)"/>
    <polygon fill="#000" fill-opacity="0.22" filter="url(#${id}-blur)"/>
    <polygon fill="${paper}"/>
    <polygon fill="url(#${id}-flap)"/>`;
  document.body.appendChild(svg);
  const [bare, shadow, flap, shade] = Array.from(svg.querySelectorAll('polygon'));
  const [bareLight, flapLight] = Array.from(svg.querySelectorAll('linearGradient'));
  return {
    svg,
    bare: bare!,
    shadow: shadow!,
    flap: flap!,
    shade: shade!,
    bareLight: bareLight!,
    flapLight: flapLight!,
  };
};

const setLine = (gradient: SVGLinearGradientElement, from: Pt, to: Pt) => {
  gradient.setAttribute('x1', from.x.toFixed(1));
  gradient.setAttribute('y1', from.y.toFixed(1));
  gradient.setAttribute('x2', to.x.toFixed(1));
  gradient.setAttribute('y2', to.y.toFixed(1));
};

interface Turn {
  transition: ViewTransition;
  // Every animation made for the turn. The pictures are named, not owned: an
  // animation left running would move the next turn's pictures.
  animations: Animation[];
  overlay: Overlay | null;
  // The turning page's picture, cut along the fold.
  page: Animation | null;
}

let current: Turn | null = null;

const animate = (turn: Turn, frames: Keyframe[], options: KeyframeAnimationOptions) => {
  const animation = document.documentElement.animate(frames, options);
  turn.animations.push(animation);
  return animation;
};

// Holds the transition open while it is drawn by hand: it ends on
// skipTransition(), once the page is where it is to stay.
const holdOpen = (turn: Turn) =>
  animate(turn, [{ opacity: 1 }, { opacity: 1 }], {
    duration: 600_000,
    pseudoElement: `::view-transition-group(${NAME})`,
  });

// The turning page: going on, the current one (over the next); going back,
// the previous one (over the current).
const cutPage = (turn: Turn, dir: TurnDir) => {
  const frame = { clipPath: polygon([]), zIndex: '1' };
  const page = animate(turn, [frame, frame], {
    duration: 600_000,
    fill: 'both',
    pseudoElement: `::view-transition-${dir > 0 ? 'old' : 'new'}(${NAME})`,
  });
  page.pause();
  return page;
};

// Draws the page with its corner (at height `y`) carried to `to`; mirrored for
// a right-to-left book, whose spine is on the right.
const draw = (turn: Turn, w: number, h: number, y: number, to: Pt, rtl: boolean) => {
  const fold = foldPage(w, h, { x: w, y }, to);
  const flip = (points: Pt[]) => (rtl ? points.map((p) => ({ x: w - p.x, y: p.y })) : points);
  const front = flip(fold.front);
  (turn.page?.effect as KeyframeEffect | null)?.setKeyframes([
    { clipPath: polygon(front), zIndex: '1' },
    { clipPath: polygon(front), zIndex: '1' },
  ]);
  const overlay = turn.overlay;
  if (!overlay) return;
  const flap = flip(fold.flap);
  overlay.bare.setAttribute('points', svgPoints(flip(fold.bare)));
  overlay.flap.setAttribute('points', svgPoints(flap));
  overlay.shade.setAttribute('points', svgPoints(flap));
  // The folded part's shadow on the front, a little past its edges.
  const n = fold.towards;
  overlay.shadow.setAttribute(
    'points',
    svgPoints(flip(fold.flap.map((p) => ({ x: p.x + n.x * 5, y: p.y + n.y * 5 })))),
  );
  const [at] = flip([fold.at]);
  const [past] = flip([{ x: fold.at.x + n.x * fold.reach, y: fold.at.y + n.y * fold.reach }]);
  const shadowReach = Math.min(90, Math.max(20, fold.reach * 0.5));
  const [behind] = flip([{ x: fold.at.x - n.x * shadowReach, y: fold.at.y - n.y * shadowReach }]);
  setLine(overlay.flapLight, at!, past!);
  setLine(overlay.bareLight, at!, behind!);
};

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
  const paper = paperColor(view);
  view.style.setProperty('view-transition-name', NAME);
  root.classList.add(ROOT_CLASS);
  let moving: Promise<void> = Promise.resolve();
  const turn = { animations: [], overlay: null, page: null } as unknown as Turn;
  turn.transition = document.startViewTransition(() => {
    // Drawn only in the new state: nothing to fade in or out.
    turn.overlay = makeOverlay(view, paper);
    return moveAndWait(view, dir, (p) => {
      moving = p;
    });
  });
  current = turn;
  void turn.transition.finished.finally(() => {
    // Its animations name the pictures, they do not own them: left alive, the
    // last cut (an empty one, once a page has turned) hid the next turn's
    // page, and after a few turns both pages showed blank (emulator, 17 Oct
    // 2026).
    for (const a of turn.animations) a.cancel();
    turn.overlay?.svg.remove();
    if (current !== turn) return;
    current = null;
    view.style.removeProperty('view-transition-name');
    root.classList.remove(ROOT_CLASS);
  });
  // The paginator's own turn, once the transition has started it.
  const moved = () => turn.transition.updateCallbackDone.then(() => moving);
  return { turn, moved };
};

const size = (view: FoliateView) => {
  const rect = view.getBoundingClientRect();
  return { w: rect.width || window.innerWidth, h: rect.height || window.innerHeight };
};

const ease = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

// Runs `frame` with the time's share (0..1) every frame for `duration` ms,
// timed by the frames themselves (their clock need not be performance.now's).
const play = (duration: number, frame: (t: number) => void) =>
  new Promise<void>((resolve) => {
    let start: number | undefined;
    const step = (now: number) => {
      start ??= now;
      const t = clamp01((now - start) / duration);
      frame(t);
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

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
    const { w, h } = size(view);
    const { turn, moved } = startTurn(view, dir);
    turn.transition.ready.then(
      async () => {
        if (current !== turn) return;
        const hold = holdOpen(turn);
        turn.page = cutPage(turn, dir);
        // Drawn before the first frame: the cut picture starts empty.
        draw(turn, w, h, h, carried(w, h, h, dir > 0 ? 0 : 1, TAP_LIFT), rtl);
        // A tap lifts the bottom corner and carries it over to the spine;
        // going back, the previous page comes down the same way.
        await play(TURN_MS, (t) => {
          if (current !== turn) return;
          const q = dir > 0 ? ease(t) : 1 - ease(t);
          draw(turn, w, h, h, carried(w, h, h, q, TAP_LIFT), rtl);
        });
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

/** A page turned by a finger: `move` as it drags, `release` as it lifts. */
export interface PageDrag {
  /** Where the finger is, in the reading area. */
  move(finger: Pt): void;
  /** How far the page has turned (0..1). */
  progress(): number;
  release(commit: boolean): void;
}

/**
 * Starts turning a page under a finger put down at `start` (in the reading
 * area); null where the book effect cannot be done, or while a page is still
 * turning (the gesture is then a plain swipe).
 */
export const dragPageLikeABook = (
  view: FoliateView,
  dir: TurnDir,
  start: Pt,
  rtl = false,
): PageDrag | null => {
  if (!supportsBookTurn() || !canTurn(view, dir) || pending > 0) return null;
  const { w, h } = size(view);
  const { turn, moved } = startTurn(view, dir);
  let markSettled = () => {};
  occupy(new Promise<void>((resolve) => (markSettled = resolve)));

  // In the book's own direction: x grows away from the spine.
  const along = (p: Pt) => (rtl ? w - p.x : p.x);
  const startX = along(start);
  // The page is held at the finger's height; the far half leans the fold the
  // other way.
  const y = Math.min(0.9 * h, Math.max(0.1 * h, start.y));
  const lift = y > h / 2 ? DRAG_LIFT : -DRAG_LIFT;
  let progress = 0;
  let rise = 0;
  let released: boolean | null = null;
  let pictured = false;
  let broken = false;
  let hold: Animation | null = null;
  let idle: ReturnType<typeof setTimeout> | undefined;

  // `q` of the way through the turn (0: flat, 1: on the spine).
  const show = (q: number, dy: number) => {
    if (!pictured) return;
    const to = carried(w, h, y, q, lift);
    draw(turn, w, h, y, { x: to.x, y: to.y + dy }, rtl);
  };
  // Going on, the finger draws the page from its side towards the spine;
  // going back, it draws the previous page from the spine over.
  const turned = (p: number) => (dir > 0 ? p : 1 - p);

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
    const from = progress;
    const to = commit ? 1 : 0;
    const dy = rise;
    await play(Math.max(160, 520 * Math.abs(to - from)), (t) => {
      const k = easeOut(t);
      show(turned(from + (to - from) * k), dy * (1 - k));
    });
    if (!commit) {
      await goBack();
      await nextFrame();
    }
    hold?.cancel();
    if (current === turn) turn.transition.skipTransition();
    markSettled();
  };

  const drag: PageDrag = {
    move(finger) {
      if (released !== null) return;
      const x = along(finger);
      progress =
        dir > 0
          ? clamp01((startX - x) / Math.max(startX, 0.5 * w))
          : clamp01((x - startX) / Math.max(w - startX, 0.5 * w));
      rise = (finger.y - start.y) * 0.6;
      show(turned(progress), rise);
      clearTimeout(idle);
      idle = setTimeout(() => drag.release(progress > 0.5), IDLE_RELEASE_MS);
    },
    progress: () => progress,
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
      turn.page = cutPage(turn, dir);
      show(turned(progress), rise);
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
