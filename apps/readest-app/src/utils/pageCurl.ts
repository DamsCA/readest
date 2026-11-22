import { snapdom } from '@zumer/snapdom';
import { FoliateView } from '@/types/view';

// A page that turns like paper, its text on it (asked 22 Nov 2026: « il faudrait
// qu'on ait l'impression de vraiment tourner une page »). The earlier effect cut a
// photograph of the page along a straight fold and drew a flat, blank flap over
// it: « c'est bizarre… ça donne pas l'impression qu'on tourne vraiment une page ».
//
// Here the page is photographed ahead of time (snapdom: its chapter whole, the
// page cut out of it), and the turning sheet is drawn with WebGL: past the fold the paper rolls round
// a cylinder, the rising part darkens, the back of the sheet shows, lit, with the
// text faintly through it the wrong way round, and the roll casts its shadow on
// the page underneath. The paginator jumps to the other page underneath without
// its slide; the sheet is what moves.

export interface Pt {
  x: number;
  y: number;
}

/** A curl: a point on the fold line, the way towards the spine, the roll's radius. */
export interface Curl {
  at: Pt;
  n: Pt;
  r: number;
}

/** No curl: everything lies flat. */
export const FLAT: Curl = { at: { x: 1e6, y: 0 }, n: { x: -1, y: 0 }, r: 1 };

/**
 * Where a point of the flat page goes once it curls: x, y on the screen, z
 * towards the reader, and whether the back of the sheet shows there.
 */
export const curlPoint = (p: Pt, c: Curl) => {
  // How far past the fold the point lies, on the side away from the spine.
  const s = -((p.x - c.at.x) * c.n.x + (p.y - c.at.y) * c.n.y);
  if (s <= 0) return { x: p.x, y: p.y, z: 0, back: false };
  const phi = s / c.r;
  let u: number;
  let z: number;
  if (phi < Math.PI) {
    u = c.r * Math.sin(phi);
    z = c.r * (1 - Math.cos(phi));
  } else {
    u = -(s - Math.PI * c.r);
    z = 2 * c.r;
  }
  return {
    x: p.x + c.n.x * (s - u),
    y: p.y + c.n.y * (s - u),
    z,
    back: phi > Math.PI / 2,
  };
};

/**
 * The curl `q` of the way through a turn (0: flat, 1: gone past the spine), for
 * a page `w` by `h` lifted by its corner at height `y`. The corner is carried
 * over towards the spine, rising (`lift`, signed, of the height) on the way; the
 * fold is halfway between where it was and where it goes, and the roll is wider
 * mid-turn, as paper is when it is lifted. Mirrored for a right-to-left book.
 */
export const curlAt = (w: number, h: number, y: number, q: number, lift: number, rtl = false) => {
  const r = w * (0.06 + 0.06 * Math.sin(Math.PI * Math.min(1, Math.max(0, q))));
  if (q <= 0) return { ...FLAT, at: { x: rtl ? -1e6 : 1e6, y }, n: { x: rtl ? 1 : -1, y: 0 } };
  const travel = 2 * w + 2 * Math.PI * r;
  const cx = rtl ? 0 : w;
  const tx = rtl ? travel * q : w - travel * q;
  const ty = y - lift * h * Math.sin(Math.PI * q);
  const dx = tx - cx;
  const dy = ty - y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    at: { x: cx + dx / 2, y: y + dy / 2 },
    n: { x: dx / len, y: dy / len },
    r,
  } satisfies Curl;
};

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

const SHEET_VS = `
attribute vec2 aUV;
uniform vec2 uSize;
uniform vec2 uAt;
uniform vec2 uN;
uniform float uR;
varying vec2 vUV;
varying float vS;
varying float vR;
void main() {
  vec2 p = aUV * uSize;
  float s = -dot(p - uAt, uN);
  vec3 pos = vec3(p, 0.0);
  if (s > 0.0) {
    float phi = s / uR;
    float u;
    float z;
    if (phi < 3.14159265) { u = uR * sin(phi); z = uR * (1.0 - cos(phi)); }
    else { u = -(s - 3.14159265 * uR); z = 2.0 * uR; }
    pos.xy = p + uN * (s - u);
    pos.z = z;
    // A little perspective: what rises towards the reader looks a little larger.
    pos.xy = uSize * 0.5 + (pos.xy - uSize * 0.5) * (1.0 + pos.z * 0.0006);
  }
  vUV = aUV;
  vS = s;
  vR = uR;
  gl_Position = vec4(pos.x / uSize.x * 2.0 - 1.0, 1.0 - pos.y / uSize.y * 2.0, -pos.z / (4.0 * uR + 1.0), 1.0);
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
varying float vS;
varying float vR;
void main() {
  float uR = vR;
  vec4 t = texture2D(uTex, vUV);
  if (vS <= 0.0) {
    // Flat: the page as it is, a soft shade where the roll rises next to it.
    float d = -vS / (0.9 * uR);
    float k = d < 1.0 ? 1.0 - 0.10 * (1.0 - d) * (1.0 - d) : 1.0;
    gl_FragColor = vec4(t.rgb * k, 1.0);
    return;
  }
  float phi = vS / uR;
  if (phi < 1.5707963) {
    // Rising towards the reader: turned away from the light.
    float k = 1.0 - 0.38 * pow(sin(phi), 1.6);
    gl_FragColor = vec4(t.rgb * k, 1.0);
  } else {
    // The back of the sheet: paper, the text faintly through it.
    vec3 c = mix(uPaper, t.rgb, 0.13);
    float k;
    if (phi < 3.14159265) {
      float a = (phi - 1.5707963) / 1.5707963;
      k = 0.80 + 0.30 * sin(a * 3.14159265 * 0.85) - 0.06 * a;
    } else {
      k = 0.97;
    }
    gl_FragColor = vec4(min(c * k, vec3(1.0)), 1.0);
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

// The roll's shadow on the page underneath, past its edge.
const SHADOW_FS = `${PRECISION}
uniform vec2 uSize;
uniform vec2 uAt;
uniform vec2 uN;
uniform float uR;
varying vec2 vUV;
void main() {
  vec2 p = vUV * uSize;
  float e = -dot(p - uAt, uN) - uR;
  float reach = 1.4 * uR + 8.0;
  float a = e > 0.0 && e < reach ? 0.30 * pow(1.0 - e / reach, 2.0) : 0.0;
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

  draw(c: Curl) {
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
    gl.uniform2f(gl.getUniformLocation(this.shadow, 'uSize'), this.w, this.h);
    gl.uniform2f(gl.getUniformLocation(this.shadow, 'uAt'), c.at.x, c.at.y);
    gl.uniform2f(gl.getUniformLocation(this.shadow, 'uN'), c.n.x, c.n.y);
    gl.uniform1f(gl.getUniformLocation(this.shadow, 'uR'), c.r);
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
    gl.uniform2f(gl.getUniformLocation(this.sheet, 'uSize'), this.w, this.h);
    gl.uniform2f(gl.getUniformLocation(this.sheet, 'uAt'), c.at.x, c.at.y);
    gl.uniform2f(gl.getUniformLocation(this.sheet, 'uN'), c.n.x, c.n.y);
    gl.uniform1f(gl.getUniformLocation(this.sheet, 'uR'), c.r);
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
