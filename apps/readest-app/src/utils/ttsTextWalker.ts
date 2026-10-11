// Text walker for foliate-js TTS that never lets a sentence straddle the
// boundary between a paragraph's source text and its injected translation.
//
// foliate's own textWalker joins every text node of a block into ONE string
// and splits that into sentences. In translation mode a block is
// "<p>English…<font class="translation-target">French…</font></p>", so the
// last English sentence and the first French one can come out as a single
// sentence whose mark starts in the English. Two things glue them:
//   - nothing separates the two texts (a <br> or an element boundary adds no
//     character), so "…day.Le jour…" has no sentence break at all;
//   - foliate's abbreviation rule rejoins any segment ending in a 1-3 letter
//     lowercase word plus a period ("day.", "him.", "fin."), even across a space.
// The reader turns the page to the START of the spoken mark's range, so the
// view stayed on the English page while the voice read the French on the next
// one. Segmenting each run of source / translation text on its own makes every
// French sentence's mark start in the French.
//
// Same walking rules as foliate-js/text-walker.js; only the segmentation is
// split per run. Mark names stay sequential integers across the whole block.

type Segmenter = (
  strs: string[],
  makeRange: (
    startIndex: number,
    startOffset: number,
    endIndex: number,
    endOffset: number,
  ) => Range,
) => Iterable<[string, Range]>;

// No DOM global may be touched at module load: TTSController imports this
// statically, and Next prerenders the reader page in Node, where NodeFilter
// does not exist ("ReferenceError: NodeFilter is not defined" failed the
// build). foliate's text-walker.js gets away with it only because it is
// loaded with a dynamic import, i.e. in the browser.
const whatToShow = () =>
  NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_CDATA_SECTION;

const defaultAcceptNode = (node: Node): number => {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const name = (node as Element).tagName.toLowerCase();
    if (name === 'script' || name === 'style') return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_SKIP;
  }
  return NodeFilter.FILTER_ACCEPT;
};

const walkRange = (range: Range, walker: TreeWalker): Node[] => {
  const nodes: Node[] = [];
  for (let node: Node | null = walker.currentNode; node; node = walker.nextNode()) {
    const compare = range.comparePoint(node, 0);
    if (compare === 0) nodes.push(node);
    else if (compare > 0) break;
  }
  return nodes;
};

const walkDocument = (walker: TreeWalker): Node[] => {
  const nodes: Node[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
  return nodes;
};

const inTranslation = (node: Node): boolean => {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return !!el?.closest?.('.translation-target');
};

export function* ttsTextWalker(
  x: Range | Document | DocumentFragment,
  segmenter: Segmenter,
  filterFunc?: (node: Node) => number,
): Generator<[string, Range]> {
  const isRange = 'commonAncestorContainer' in x;
  const root: Node = isRange
    ? (x as Range).commonAncestorContainer
    : ((x as Document).body ?? (x as DocumentFragment));
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, whatToShow(), {
    acceptNode: filterFunc ?? defaultAcceptNode,
  });
  const nodes = isRange ? walkRange(x as Range, walker) : walkDocument(walker);

  let named = 0;
  let start = 0;
  while (start < nodes.length) {
    const translated = inTranslation(nodes[start]!);
    let end = start + 1;
    while (end < nodes.length && inTranslation(nodes[end]!) === translated) end++;

    const run = nodes.slice(start, end);
    const strs = run.map((node) => node.nodeValue ?? '');
    const makeRange = (si: number, so: number, ei: number, eo: number) => {
      const range = doc.createRange();
      range.setStart(run[si]!, so);
      range.setEnd(run[ei]!, eo);
      return range;
    };
    let count = 0;
    for (const [name, range] of segmenter(strs, makeRange)) {
      yield [String(named + Number(name)), range];
      count++;
    }
    named += count;
    start = end;
  }
}
