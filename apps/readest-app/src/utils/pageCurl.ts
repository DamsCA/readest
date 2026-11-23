import { snapdom } from '@zumer/snapdom';
import { FoliateView } from '@/types/view';

// A page that turns like paper, its text on it (asked 22 Nov 2026: « il faudrait
// qu'on ait l'impression de vraiment tourner une page »). The first sheet rolled
// its corner round a cylinder and showed its back; on 23 Nov 2026, shown how
// Google Play Books turns a page: « c'est tellement plus satisfaisant que le
// nôtre ». The sheet now turns that way: whole, its text always showing, it
// arches up between the spine and its free edge, which the finger holds; the
// higher it rises the closer it comes (a little perspective), and at the end it
// slips away past the spine. The page underneath lies flat beside it, in the
// arch's soft shadow.
//
// The page is photographed ahead of time (snapdom: its chapter whole, the page
// cut out of it), and the sheet is drawn with WebGL. The paginator jumps to the
// other page underneath without its slide; the sheet is what moves.

export interface Pt {
  x: number;
  y: number;
}

/**
 * A turning sheet. Its free edge lies `top` (at the top of the page) to
 * `bottom` (at its foot) page widths from the spine: 1 flat, 0 at the spine.
 * The paper between arches up, its length unchanged. At the end of a turn the
 * sheet slips `shift` page widths past the spine. The spine is on the right in
 * a right-to-left book.
 */
export interface Arch {
  top: number;
  bottom: number;
  shift: number;
  rtl: boolean;
}

/** No turn: the sheet lies flat. */
export const FLAT: Arch = { top: 1, bottom: 1, shift: 0, rtl: false };

// The share of a turn in which the free edge goes from its place to the spine;
// in the rest, the sheet, arched up into a loop, slips this far past the spine.
export const EDGE_SHARE = 0.82;
export const SLIDE = 0.3;
// Where the eye is, above the page's middle, in page heights.
const CAMERA = 2.2;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * The arc's half angle when its ends are `e` page widths apart, for a sheet a
 * page width long: sin(a) / a = e (0: flat, π: closed into a loop).
 */
export const halfAngle = (e: number) => {
  const k = clamp01(e);
  let lo = 0;
  let hi = Math.PI;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if ((m < 1e-9 ? 1 : Math.sin(m) / m) > k) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
};

/**
 * Where the point `s` page widths from the spine goes when the free edge is
 * `e` page widths from it: x from the spine and z towards the reader, in page
 * widths, and whether the back of the sheet shows there.
 */
export const archPoint = (s: number, e: number, shift = 0) => {
  const a = halfAngle(e);
  if (a < 1e-6) return { x: s - shift, z: 0, back: false };
  const r = 0.5 / a;
  const g = 2 * a * s - a;
  return {
    x: e / 2 + r * Math.sin(g) - shift,
    z: r * (Math.cos(g) - Math.cos(a)),
    back: Math.cos(g) < 0,
  };
};

/** How high the arch rises, in page widths. */
export const archHeight = (e: number) => {
  const a = halfAngle(e);
  return a < 1e-6 ? 0 : (0.5 / a) * (1 - Math.cos(a));
};

/**
 * The sheet `q` of the way through a turn (0: flat, 1: gone past the spine).
 * `tilt` leans the free edge, its top ahead when positive, round the height
 * `pivot` (0: the top, 1: the foot) where the finger holds it.
 */
export const archAt = (q: number, rtl = false, tilt = 0, pivot = 0.5): Arch => {
  const t = clamp01(q);
  const e = t < EDGE_SHARE ? 1 - t / EDGE_SHARE : 0;
  const shift = t < EDGE_SHARE ? 0 : ((t - EDGE_SHARE) / (1 - EDGE_SHARE)) * SLIDE;
  const lean = tilt * e;
  return { top: e - lean * pivot, bottom: e + lean * (1 - pivot), shift, rtl };
};

/** How far the sheet has gone, in page widths: 1 flat, below 0 past the spine. */
export const edgeOf = (a: Arch) => (clamp01(a.top) + clamp01(a.bottom)) / 2 - a.shift;

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

// The arch's half angle for a free edge e page widths from the spine, as halfAngle.
const ARCH_GLSL = `
float halfAngle(float e) {
  float lo = 0.0;
  float hi = 3.14159265;
  for (int i = 0; i < 26; i++) {
    float m = 0.5 * (lo + hi);
    float v = m < 1e-5 ? 1.0 : sin(m) / m;
    if (v > e) lo = m; else hi = m;
  }
  return 0.5 * (lo + hi);
}`;

const SHEET_VS = `
attribute vec2 aUV;
uniform vec2 uSize;
uniform float uTop;
uniform float uBottom;
uniform float uShift;
uniform float uRtl;
uniform float uCamera;
varying vec2 vUV;
varying vec2 vN;
${ARCH_GLSL}
void main() {
  float e = clamp(mix(uTop, uBottom, aUV.y), 0.0, 1.0);
  float s = uRtl > 0.5 ? 1.0 - aUV.x : aUV.x;
  float xb = s;
  float z = 0.0;
  vec2 n = vec2(0.0, 1.0);
  if (e < 0.99999) {
    float a = halfAngle(e);
    float r = 0.5 / a;
    float g = 2.0 * a * s - a;
    xb = 0.5 * e + r * sin(g);
    z = r * (cos(g) - cos(a));
    n = vec2(sin(g), cos(g));
  }
  xb -= uShift;
  float x = (uRtl > 0.5 ? 1.0 - xb : xb) * uSize.x;
  float zp = z * uSize.x;
  // Seen from above the page's middle: what rises comes closer, and grows.
  vec2 c = 0.5 * uSize;
  vec2 p = c + (vec2(x, aUV.y * uSize.y) - c) * (uCamera / max(uCamera - zp, 1.0));
  vUV = aUV;
  vN = n;
  gl_Position = vec4(p.x / uSize.x * 2.0 - 1.0, 1.0 - p.y / uSize.y * 2.0, -zp / (2.0 * uSize.x + 1.0), 1.0);
}`;

const PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif`;

const SHEET_FS = `${PRECISION}
uniform sampler2D uTex;
uniform vec3 uPaper;
varying vec2 vUV;
varying vec2 vN;
void main() {
  vec4 t = texture2D(uTex, vUV);
  if (vN.y >= 0.0) {
    // The printed side, a little darker where it turns from the light, most on
    // the slope that falls towards the free edge.
    float k = 0.86 + 0.14 * vN.y - 0.07 * max(vN.x, 0.0);
    gl_FragColor = vec4(t.rgb * k, 1.0);
  } else {
    // The back of the sheet: paper, the text faintly through it.
    vec3 c = mix(uPaper, t.rgb, 0.12);
    gl_FragColor = vec4(c * (0.88 - 0.08 * vN.y), 1.0);
  }
}`;

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

// The arch's shadow on the page underneath, past the free edge: wider and
// darker the higher it rises, gone as the sheet slips away.
const SHADOW_FS = `${PRECISION}
uniform vec2 uSize;
uniform float uTop;
uniform float uBottom;
uniform float uShift;
uniform float uRtl;
uniform float uLift;
varying vec2 vUV;
void main() {
  float xb = uRtl > 0.5 ? 1.0 - vUV.x : vUV.x;
  float edge = clamp(mix(uTop, uBottom, vUV.y), 0.0, 1.0) - uShift;
  float d = (xb - edge) * uSize.x;
  float reach = (0.02 + 0.45 * uLift) * uSize.x + 6.0;
  float strength = 0.30 * clamp(uLift / 0.2, 0.0, 1.0) * (1.0 - clamp(uShift / ${SLIDE.toFixed(2)}, 0.0, 1.0));
  float a = d > 0.0 && d < reach ? strength * pow(1.0 - d / reach, 2.0) : 0.0;
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

const toRGB = (color: string): [number, number, number] => {
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) return [1, 1, 1];
  probe.fillStyle = '#ffffff';
  probe.fillStyle = color;
  const hex = probe.fillStyle as string;
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (m) return [1, 2, 3].map((i) => parseInt(m[i]!, 16) / 255) as [number, number, number];
  const rgb = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(hex);
  return rgb ? [+rgb[1]! / 255, +rgb[2]! / 255, +rgb[3]! / 255] : [1, 1, 1];
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
  private paper: [number, number, number] = [1, 1, 1];
  private w = 1;
  private h = 1;

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
    paper: string,
    host: Element | null = null,
  ) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const parent = host ?? document.body;
    if (this.canvas.parentElement !== parent) parent.appendChild(this.canvas);
    this.w = rect.width;
    this.h = rect.height;
    Object.assign(this.canvas.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      display: 'block',
    });
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.paper = toRGB(paper);
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

  draw(a: Arch) {
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
    const arch = (program: WebGLProgram) => {
      gl.uniform2f(gl.getUniformLocation(program, 'uSize'), this.w, this.h);
      gl.uniform1f(gl.getUniformLocation(program, 'uTop'), a.top);
      gl.uniform1f(gl.getUniformLocation(program, 'uBottom'), a.bottom);
      gl.uniform1f(gl.getUniformLocation(program, 'uShift'), a.shift);
      gl.uniform1f(gl.getUniformLocation(program, 'uRtl'), a.rtl ? 1 : 0);
    };

    if (this.hasUnder) {
      this.select(this.quad);
      quadAttrib(this.quad);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.underTex);
      gl.uniform1i(gl.getUniformLocation(this.quad, 'uTex'), 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    this.select(this.shadow);
    quadAttrib(this.shadow);
    arch(this.shadow);
    const e = (clamp01(a.top) + clamp01(a.bottom)) / 2;
    gl.uniform1f(gl.getUniformLocation(this.shadow, 'uLift'), archHeight(e));
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
    arch(this.sheet);
    gl.uniform1f(gl.getUniformLocation(this.sheet, 'uCamera'), CAMERA * this.h);
    gl.uniform3f(gl.getUniformLocation(this.sheet, 'uPaper'), ...this.paper);
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
