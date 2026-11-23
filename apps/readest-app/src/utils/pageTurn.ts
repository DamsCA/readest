import { ViewSettings } from '@/types/book';
import { FoliateView } from '@/types/view';
import {
  archAt,
  curlStage,
  EDGE_SHARE,
  pageShot,
  paperOf,
  preparePageShots,
  Pt,
  supportsPageCurl,
} from './pageCurl';

// Pages turned like a book's. Asked 16 Oct 2026: "un effet lorsque je tourne
// les pages, comme si je tournais une page d'un livre"; the first turn swung
// the page whole, like a board (« on dirait que ta page a été congelée »), the
// second folded a photograph of it flat along a straight line, with a blank
// flap (22 Nov 2026: « c'est bizarre… ça donne pas l'impression qu'on tourne
// vraiment une page »); the third rolled the corner round a cylinder.
// Now it turns as in Google Play Books (23 Nov 2026: « c'est tellement plus
// satisfaisant que le nôtre »): the whole sheet arches up between the spine and
// its free edge (utils/pageCurl.ts). A tap carries it over the spine; a finger
// holds its free edge, and lets it finish turning or lie back down. foliate's
// paginator is left as it is: it jumps to the other page under the sheet
// without its slide.

export type { Pt };
export type TurnDir = 1 | -1;

// A tap's turn; a drag let go finishes the rest of its turn in less.
const TURN_MS = 640;
// How far a finger drawn up or down leans the free edge (of a page width).
const MAX_TILT = 0.2;
// A drag left without news this long is let go: a touch end that never comes
// must not leave the sheet over the page.
const IDLE_RELEASE_MS = 10_000;
// The paginator jumps within this; past it, the turn goes on regardless.
const MOVE_TIMEOUT_MS = 1500;

export const supportsBookTurn = () => supportsPageCurl();

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

/** Photographs the pages a turn will need, while the page is read. */
export const preparePageTurn = (view: FoliateView) => {
  if (supportsBookTurn()) preparePageShots(view);
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
// The corner leaves at once and the page settles softly: a slow start read as a
// page that did not answer the tap (22 Nov 2026).
const easeTurn = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

const plainTurn = (view: FoliateView, dir: TurnDir) =>
  Promise.resolve(dir > 0 ? view.next() : view.prev());

const canTurn = (view: FoliateView, dir: TurnDir) =>
  dir > 0 ? !view.renderer.atEnd : !view.renderer.atStart;

// The paginator's turn without its slide: the sheet is what moves.
const jump = (view: FoliateView, dir: TurnDir) => {
  const { renderer } = view;
  const animated = renderer.hasAttribute('animated');
  if (animated) renderer.removeAttribute('animated');
  const moving = plainTurn(view, dir);
  if (animated) renderer.setAttribute('animated', '');
  return moving;
};

// Done once the paginator shows the other page (its relocate), at the latest
// when its turn settles.
const jumpAndWait = (view: FoliateView, dir: TurnDir) =>
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
    jump(view, dir).then(done, done);
  });

const pageRect = (view: FoliateView) => {
  const container = (view.renderer as unknown as HTMLElement).shadowRoot?.getElementById(
    'container',
  );
  return (container ?? (view as unknown as HTMLElement)).getBoundingClientRect();
};

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

// Runs `frame` with the time's share (0..1) every frame for `duration` ms.
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

interface Sheet {
  stage: NonNullable<ReturnType<typeof curlStage>>;
  w: number;
  h: number;
  /** Whether the page under the sheet is drawn too: then the paginator may move any time. */
  whole: boolean;
}

/**
 * Puts the sheet over the page. Going on, the sheet is the page shown, over
 * the next one (its photograph when taken, else the paginator's page once it
 * has moved); going back, the sheet is the page before, coming down over the
 * page shown (its photograph).
 */
const raiseSheet = (view: FoliateView, dir: TurnDir): Sheet | null => {
  const stage = curlStage();
  if (!stage) return null;
  const current = pageShot(view, 0);
  const sheet = dir > 0 ? current : pageShot(view, -1);
  if (!sheet || !current) {
    preparePageTurn(view);
    return null;
  }
  const under = dir > 0 ? pageShot(view, 1) : current;
  const rect = pageRect(view);
  stage.show(rect, sheet, under, paperOf(view), (view as unknown as HTMLElement).parentElement);
  return { stage, w: rect.width, h: rect.height, whole: !!under };
};

// One turn at a time.
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

const finish = (view: FoliateView, sheet: Sheet) => {
  sheet.stage.hide();
  preparePageTurn(view);
};

/** Turns a page with the book effect; a plain turn where it cannot be done. */
export const turnPageLikeABook = (view: FoliateView, dir: TurnDir, rtl = false) => {
  const run = async () => {
    if (!canTurn(view, dir)) {
      await plainTurn(view, dir);
      return;
    }
    const sheet = raiseSheet(view, dir);
    if (!sheet) {
      await plainTurn(view, dir);
      preparePageTurn(view);
      return;
    }
    const { stage, whole } = sheet;
    const at = (q: number) => archAt(q, rtl);
    try {
      // The sheet lies exactly over the page before the paginator moves.
      stage.draw(at(dir > 0 ? 0 : 1));
      const moving = nextFrame()
        .then(nextFrame)
        .then(() => jumpAndWait(view, dir));
      // Both pages drawn: the sheet moves at once, the paginator turns under
      // it. Otherwise the page under the sheet must be there first.
      if (!whole) await moving;
      await play(TURN_MS, (t) => {
        const k = easeTurn(t);
        stage.draw(at(dir > 0 ? k : 1 - k));
      });
      await moving;
    } finally {
      finish(view, sheet);
    }
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
  if (!canTurn(view, dir) || pending > 0) return null;
  const sheet = raiseSheet(view, dir);
  if (!sheet) return null;
  // The finger is the sheet's: the paginator, which reads this as the finger
  // lifts, must not snap to a page of its own as well (it turned two pages
  // at once on 22 Nov 2026 when the flag had not been put).
  view.renderer.setAttribute('no-swipe', '');
  const { stage, w, h } = sheet;
  let markSettled = () => {};
  occupy(new Promise<void>((resolve) => (markSettled = resolve)));

  // In the book's own direction: x grows away from the spine.
  const along = (p: Pt) => (rtl ? w - p.x : p.x);
  const startX = along(start);
  // How far the turn has gone (archAt's q), and how the finger leans the edge.
  let q = dir > 0 ? 0 : 1;
  let tilt = 0;
  let pivot = Math.min(1, Math.max(0, start.y / h));
  let released: boolean | null = null;
  let idle: ReturnType<typeof setTimeout> | undefined;

  const show = (turn: number, lean: number) => stage.draw(archAt(turn, rtl, lean, pivot));

  show(q, 0);
  // The paginator goes to the other page under the sheet once the sheet shows.
  const moved = nextFrame()
    .then(nextFrame)
    .then(() => jumpAndWait(view, dir));

  const settle = async (commit: boolean) => {
    await moved.catch(() => {});
    const from = q;
    const to = commit === dir > 0 ? 1 : 0;
    const lean = tilt;
    await play(Math.max(180, 560 * Math.abs(to - from)), (t) => {
      const k = easeOut(t);
      show(from + (to - from) * k, lean * (1 - k));
    });
    // Laid back down: the paginator returns to its page under the sheet.
    if (!commit) {
      await jumpAndWait(view, -dir as TurnDir);
      await nextFrame();
    }
    finish(view, sheet);
    markSettled();
  };

  const drag: PageDrag = {
    move(finger) {
      if (released !== null) return;
      const x = along(finger);
      if (dir > 0) {
        // The free edge goes where the finger draws it, and reaches the spine
        // with it, as in Google Play Books.
        const edge = clamp01(x / Math.max(startX, 0.35 * w));
        q = EDGE_SHARE * (1 - edge);
      } else {
        // The page before comes in from past the spine and lies down under
        // the finger.
        q = 1 - clamp01((x - startX) / Math.max(w - startX, 0.35 * w));
      }
      // Drawn upwards, the top of the edge leads.
      pivot = clamp01(finger.y / h);
      tilt = Math.max(-MAX_TILT, Math.min(MAX_TILT, ((start.y - finger.y) / h) * 0.9));
      show(q, tilt);
      clearTimeout(idle);
      idle = setTimeout(() => drag.release(drag.progress() > 0.5), IDLE_RELEASE_MS);
    },
    progress: () => (dir > 0 ? q : 1 - q),
    release(commit) {
      if (released !== null) return;
      released = commit;
      clearTimeout(idle);
      void settle(commit);
    },
  };
  idle = setTimeout(() => drag.release(drag.progress() > 0.5), IDLE_RELEASE_MS);
  return drag;
};
