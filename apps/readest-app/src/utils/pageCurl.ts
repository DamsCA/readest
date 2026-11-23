import { snapdom } from '@zumer/snapdom';
import { FoliateView } from '@/types/view';

// A page that turns like paper, its text on it (asked 22 Nov 2026: « il faudrait
// qu'on ait l'impression de vraiment tourner une page »). On 23 Nov 2026, shown
// a recording of Google Play Books: « c'est tellement plus satisfaisant que le
// nôtre ». A sheet rolled round a cylinder, then an arch closing into a loop,
// both read as paper rolling up (« la façon dont ça s'enroule, c'est bizarre »).
//
// So the sheet now moves as measured, frame by frame, on that recording: it
// slides away whole towards the spine, its text never squeezed (the drawing on
// the page kept its width to within 4 %), lifting towards the reader as it goes,
// most on the spine's side (up to a fifth larger there, barely at the free
// edge), seen from an eye above the spine's side; it narrows to a strip at the
// spine and is gone. The finger first lifts it, then carries it, and at the end
// it goes faster than the finger. The page underneath lies flat beside it, in
// its soft shadow.
//
// The page is photographed ahead of time (snapdom: its chapter whole, the page
// cut out of it), and the sheet is drawn with WebGL. The paginator jumps to the
// other page underneath without its slide; the sheet is what moves.

export interface Pt {
  x: number;
  y: number;
}

/**
 * A turning sheet, `p` of the way through its turn: 0 lying flat, 1 gone past
 * the spine. The spine is on the right in a right-to-left book.
 */
export interface Sheet {
  p: number;
  rtl: boolean;
}

/** No turn: the sheet lies flat. */
export const FLAT: Sheet = { p: 0, rtl: false };

// Where the eye is, across the page from the spine (in page widths): measured
// on the recording, the sheet grows round a point near the spine.
export const EYE_X = 0.083;
// How much of that growth shows in height. The recorded page had dark margins
// round it to grow into; this one fills the screen, and its top lines, grown
// whole, ran into the chapter title above them.
export const GROWTH_IN_HEIGHT = 0.4;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * How far towards the eye the sheet has risen (0: on the page; 1: at the eye),
 * at `u` of the way from the spine to its free edge, `p` of the way through the
 * turn. Fitted to the recording: early on the sheet is held down at the spine
 * and bulges just past it; then it rises most at the spine, less and less
 * towards the free edge, which lifts too as the turn goes on.
 */
export const liftAt = (u: number, p: number) => {
  const q = clamp01(p);
  const atSpine = 0.168 * (1 - Math.exp(-q / 0.2));
  const atEdge = Math.min(0.85 * atSpine, 0.012 + 0.05 * q + 0.3 * q ** 4);
  const pinned = 1 - smooth(0.18, 0.33, q);
  const crest = 0.22 * (1 - smooth(0.15, 0.33, q));
  const sharp = 1 + 1.5 * (1 - smooth(0.18, 0.4, q));
  const uu = clamp01(u);
  const t = clamp01((uu - crest) / (1 - crest));
  const shape = atEdge + (atSpine - atEdge) * (0.5 * (1 + Math.cos(Math.PI * t))) ** sharp;
  return shape * (1 - pinned * Math.exp(-uu / 0.04));
};

/**
 * Where the point `s` page widths from the spine shows (x from the spine, in
 * page widths), how much larger it looks there, and how high it has risen.
 */
export const sheetPoint = (s: number, p: number) => {
  const q = clamp01(p);
  const x = s - q;
  const z = liftAt(x / Math.max(1 - q, 1e-4), q);
  const scale = 1 / (1 - z);
  return { x: EYE_X + (x - EYE_X) * scale, scale, z };
};

/** How dark the sheet's shadow is at its edge (0..1), gone as the sheet leaves. */
export const shadowAt = (p: number) => {
  const q = clamp01(p);
  return 0.36 * (1 - Math.exp(-q / 0.12)) * Math.min(1, (1 - q) / 0.12);
};

/** Where the free edge shows, in page widths from the spine (1 flat). */
export const edgeOf = (sheet: Sheet) => sheetPoint(1, sheet.p).x;

/** The sheet `p` of the way through a turn. */
export const sheetAt = (p: number, rtl = false): Sheet => ({ p: clamp01(p), rtl });

// ---------- The page's photograph ----------

interface Placed {
  doc: Document;
  /** The page's region in its document. */
  x: number;
  y: number;
  width: number;
  height: number;
}

const containerOf = (view: FoliateView) =>
  (view.renderer as unknown as HTMLElement).shadowRoot?.getElementById('container') ?? null;

/** Where page `k` (0: the one shown, -1: the one before) is, in which document. */
const place = (view: FoliateView, k: number): Placed | null => {
  const container = containerOf(view);
  if (!container) return null;
  const c = container.getBoundingClientRect();
  if (!c.width || !c.height) return null;
  const left = c.left + k * c.width;
  for (const iframe of Array.from(container.querySelectorAll('iframe'))) {
    const f = iframe.getBoundingClientRect();
    if (f.left <= left + 1 && f.right >= left + c.width - 1) {
      const doc = iframe.contentDocument;
      if (!doc?.documentElement) return null;
      return { doc, x: left - f.left, y: c.top - f.top, width: c.width, height: c.height };
    }
  }
  return null;
};

/** The paper's colour: the book's own background. */
export const paperOf = (view: FoliateView) => {
  const placed = place(view, 0);
  const root = placed?.doc.documentElement;
  const style = root && placed.doc.defaultView?.getComputedStyle(root);
  const bg = style?.getPropertyValue('--theme-bg-color').trim() || style?.backgroundColor;
  return bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#ffffff';
};

// What a photograph shows: the same page, laid out the same way.
const signature = (p: Placed, paper: string) =>
  [
    p.doc.URL,
    Math.round(p.x),
    Math.round(p.y),
    Math.round(p.width),
    Math.round(p.height),
    p.doc.documentElement.scrollWidth,
    p.doc.documentElement.scrollHeight,
    paper,
  ].join('|');

const shots = new Map<string, Promise<HTMLCanvasElement | null>>();
const ready = new Map<string, HTMLCanvasElement>();
const MAX_SHOTS = 8;

const remember = (key: string, canvas: HTMLCanvasElement) => {
  ready.set(key, canvas);
  while (ready.size > MAX_SHOTS) {
    const oldest = ready.keys().next().value as string;
    ready.delete(oldest);
    shots.delete(oldest);
  }
};

// The whole section, as a picture, once per layout: snapdom's `clip` drops what
// lies before the region, and the columns that remain flow back to the start, so
// a clipped picture of page 5 showed page 7 (22 Nov 2026). The pages are cut
// from the whole picture instead, which is vector: they stay sharp.
const sections = new Map<string, Promise<HTMLImageElement | null>>();
const MAX_SECTIONS = 3;

const sectionPicture = (doc: Document, paper: string) => {
  const root = doc.documentElement;
  const key = [doc.URL, root.scrollWidth, root.scrollHeight, paper].join('|');
  let picture = sections.get(key);
  if (!picture) {
    picture = snapdom(root, { embedFonts: true, fast: 'auto' })
      .then((result) => result.toImg())
      .then(async (img) => {
        if (!img.complete) await new Promise((resolve) => (img.onload = resolve));
        await img.decode?.().catch(() => {});
        return img;
      })
      .catch((error) => {
        console.warn('Page curl: the section could not be photographed', error);
        sections.delete(key);
        return null;
      });
    sections.set(key, picture);
    while (sections.size > MAX_SECTIONS) sections.delete(sections.keys().next().value as string);
  }
  return picture;
};

const cut = (img: HTMLImageElement, p: Placed, paper: string) => {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(p.width * dpr);
  canvas.height = Math.round(p.height * dpr);
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.fillStyle = paper;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(img, p.x, p.y, p.width, p.height, 0, 0, canvas.width, canvas.height);
  return canvas;
};

const photograph = (view: FoliateView, k: number) => {
  const placed = place(view, k);
  if (!placed) return null;
  const paper = paperOf(view);
  const key = signature(placed, paper);
  let shot = shots.get(key);
  if (!shot) {
    shot = sectionPicture(placed.doc, paper).then((img) => {
      const canvas = img ? cut(img, placed, paper) : null;
      if (canvas) remember(key, canvas);
      else shots.delete(key);
      return canvas;
    });
    shots.set(key, shot);
  }
  return { key, shot };
};

/** The photograph of page `k`, if it is already taken (a turn cannot wait for it). */
export const pageShot = (view: FoliateView, k: number) => {
  const taken = photograph(view, k);
  return taken ? (ready.get(taken.key) ?? null) : null;
};

/** Takes the photographs a turn will need, while the reader reads. */
export const preparePageShots = (view: FoliateView) => {
  const run = () => {
    photograph(view, 0);
    photograph(view, -1);
    photograph(view, 1);
  };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number })
    .requestIdleCallback;
  if (idle) idle(run);
  else setTimeout(run, 50);
};

// ---------- The sheet, drawn ----------

// liftAt, for the GPU.
const LIFT_GLSL = `
float liftAt(float u, float p) {
  float atSpine = 0.168 * (1.0 - exp(-p / 0.2));
  float atEdge = min(0.85 * atSpine, 0.012 + 0.05 * p + 0.3 * p * p * p * p);
  float pinned = 1.0 - smoothstep(0.18, 0.33, p);
  float crest = 0.22 * (1.0 - smoothstep(0.15, 0.33, p));
  float sharp = 1.0 + 1.5 * (1.0 - smoothstep(0.18, 0.4, p));
  float uu = clamp(u, 0.0, 1.0);
  float t = clamp((uu - crest) / (1.0 - crest), 0.0, 1.0);
  float shape = atEdge + (atSpine - atEdge) * pow(max(0.5 * (1.0 + cos(3.14159265 * t)), 0.0), sharp);
  return shape * (1.0 - pinned * exp(-uu / 0.04));
}`;

const SHEET_VS = `
attribute vec2 aUV;
uniform float uP;
uniform float uRtl;
uniform float uEyeX;
uniform float uGrowthY;
varying vec2 vUV;
${LIFT_GLSL}
void main() {
  // Book coordinates: from the spine across, in page widths; down, in heights.
  float s = uRtl > 0.5 ? 1.0 - aUV.x : aUV.x;
  float x = s - uP;
  float span = max(1.0 - uP, 1e-4);
  float u = x / span;
  float z = liftAt(u, uP);
  float scale = 1.0 / (1.0 - z);
  float xb = uEyeX + (x - uEyeX) * scale;
  float y = 0.5 + (aUV.y - 0.5) * (1.0 + uGrowthY * (scale - 1.0));
  vUV = aUV;
  float sx = uRtl > 0.5 ? 1.0 - xb : xb;
  gl_Position = vec4(sx * 2.0 - 1.0, 1.0 - y * 2.0, -z, 1.0);
}`;

const PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif`;

// The sheet as it is: measured on the recording, it keeps its brightness right
// up to its edge (shading it read as paper rolling up).
const SHEET_FS = `${PRECISION}
uniform sampler2D uTex;
varying vec2 vUV;
void main() { gl_FragColor = vec4(texture2D(uTex, vUV).rgb, 1.0); }`;

const QUAD_VS = `
attribute vec2 aUV;
varying vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = vec4(aUV.x * 2.0 - 1.0, 1.0 - aUV.y * 2.0, 0.999, 1.0);
}`;

const UNDER_FS = `${PRECISION}
uniform sampler2D uTex;
varying vec2 vUV;
void main() { gl_FragColor = vec4(texture2D(uTex, vUV).rgb, 1.0); }`;

// The sheet's shadow on the page underneath, as measured on the recording: from
// the free edge, up to a third darker, fading evenly over a tenth of the page.
const SHADOW_FS = `${PRECISION}
uniform float uRtl;
uniform float uEdge;
uniform float uStrength;
varying vec2 vUV;
void main() {
  float xb = uRtl > 0.5 ? 1.0 - vUV.x : vUV.x;
  float d = (xb - uEdge) / 0.095;
  float a = d > 0.0 && d < 1.0 ? uStrength * (1.0 - d) : 0.0;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}`;

const COLS = 48;
const ROWS = 72;

const compile = (gl: WebGLRenderingContext, vs: string, fs: string) => {
  const program = gl.createProgram()!;
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || 'shader');
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || 'program');
  }
  return program;
};

/** The canvas over the reading area where the turning sheet is drawn. */
export class CurlStage {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private sheet: WebGLProgram;
  private quad: WebGLProgram;
  private shadow: WebGLProgram;
  private grid: WebGLBuffer;
  private indices: WebGLBuffer;
  private count: number;
  private quadBuffer: WebGLBuffer;
  private sheetTex: WebGLTexture;
  private underTex: WebGLTexture;
  private hasUnder = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    Object.assign(this.canvas.style, {
      position: 'fixed',
      pointerEvents: 'none',
      display: 'none',
    });
    const gl = this.canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      depth: true,
    });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    this.sheet = compile(gl, SHEET_VS, SHEET_FS);
    this.quad = compile(gl, QUAD_VS, UNDER_FS);
    this.shadow = compile(gl, QUAD_VS, SHADOW_FS);

    const uv: number[] = [];
    for (let j = 0; j <= ROWS; j++) for (let i = 0; i <= COLS; i++) uv.push(i / COLS, j / ROWS);
    const idx: number[] = [];
    for (let j = 0; j < ROWS; j++) {
      for (let i = 0; i < COLS; i++) {
        const a = j * (COLS + 1) + i;
        const b = a + 1;
        const c = a + COLS + 1;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    this.count = idx.length;
    this.grid = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.grid);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.STATIC_DRAW);
    this.indices = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    this.quadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.sheetTex = this.makeTexture();
    this.underTex = this.makeTexture();
  }

  private makeTexture() {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private select(program: WebGLProgram) {
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook.
    this.gl.useProgram(program);
  }

  private upload(tex: WebGLTexture, image: HTMLCanvasElement) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  }

  /**
   * Places the stage over `rect`, with the turning sheet and, if given, the page
   * under it. Put in `host` (the reading area's own box) with no z-index of its
   * own, it is painted after the page and before the running title and the page
   * number, which come later in the grid: they go on showing during the turn
   * (with a z-index of 1, the sheet hid them, 22 Nov 2026).
   */
  show(
    rect: DOMRect,
    sheet: HTMLCanvasElement,
    under: HTMLCanvasElement | null,
    _paper: string,
    host: Element | null = null,
  ) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const parent = host ?? document.body;
    if (this.canvas.parentElement !== parent) parent.appendChild(this.canvas);
    Object.assign(this.canvas.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      display: 'block',
    });
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.upload(this.sheetTex, sheet);
    this.hasUnder = !!under;
    if (under) this.upload(this.underTex, under);
  }

  hide() {
    this.canvas.style.display = 'none';
  }

  isLost() {
    return this.gl.isContextLost();
  }

  draw(sheet: Sheet) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const quadAttrib = (program: WebGLProgram) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      const loc = gl.getAttribLocation(program, 'aUV');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    };
    const uniform = (program: WebGLProgram, name: string, value: number) =>
      gl.uniform1f(gl.getUniformLocation(program, name), value);

    if (this.hasUnder) {
      this.select(this.quad);
      quadAttrib(this.quad);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.underTex);
      gl.uniform1i(gl.getUniformLocation(this.quad, 'uTex'), 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    const edge = sheetPoint(1, sheet.p);
    this.select(this.shadow);
    quadAttrib(this.shadow);
    uniform(this.shadow, 'uRtl', sheet.rtl ? 1 : 0);
    uniform(this.shadow, 'uEdge', edge.x);
    uniform(this.shadow, 'uStrength', shadowAt(sheet.p));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    this.select(this.sheet);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.grid);
    const loc = gl.getAttribLocation(this.sheet, 'aUV');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indices);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sheetTex);
    gl.uniform1i(gl.getUniformLocation(this.sheet, 'uTex'), 0);
    uniform(this.sheet, 'uP', sheet.p);
    uniform(this.sheet, 'uRtl', sheet.rtl ? 1 : 0);
    uniform(this.sheet, 'uEyeX', EYE_X);
    uniform(this.sheet, 'uGrowthY', GROWTH_IN_HEIGHT);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
  }
}

let stage: CurlStage | null | undefined;

/** The one stage, made on first use; null where WebGL cannot be had. */
export const curlStage = (): CurlStage | null => {
  if (stage !== undefined && !(stage && stage.isLost())) return stage;
  stage?.canvas.remove();
  try {
    stage = new CurlStage();
    document.body.appendChild(stage.canvas);
  } catch (error) {
    console.warn('Page curl: no WebGL', error);
    stage = null;
  }
  return stage;
};

let webgl: boolean | undefined;
/** Whether this browser can draw the sheet. */
export const supportsPageCurl = () => {
  if (webgl !== undefined) return webgl;
  if (typeof document === 'undefined') return false;
  try {
    webgl = !!document.createElement('canvas').getContext('webgl');
  } catch {
    webgl = false;
  }
  return webgl;
};
