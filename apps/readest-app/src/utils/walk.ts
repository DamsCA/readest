// Source text of a walked block, for translation.
//
// `el.textContent` concatenates child fragments with NO separator, so a heading
// built as `<h1><span>Chapter 15</span><span>You Are a Perfect...</span></h1>`
// (or split by a <br/>) collapsed into "Chapter 15You Are a Perfect...". That
// glued string went to the translator, came back glued ("Chapitre 15Vous êtes
// ..."), had no sentence boundary for the segmenter, and was narrated as one
// breathless utterance running the chapter number into its title.
//
// Insert a separator at element/<br> boundaries, then collapse runs. Callers on
// both the playback and the prefetch side MUST use this, otherwise they produce
// different source strings -> different translations -> every banked clip wasted.
export const blockSourceText = (el: HTMLElement): string => {
  let out = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? '';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as HTMLElement).tagName;
      // A line break inside a heading is a real pause: give the voice a period
      // so the segmenter splits there instead of running the parts together.
      out += tag === 'BR' ? '. ' : ` ${node.textContent ?? ''} `;
    }
  }
  return out
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
};

export const walkTextNodes = (root: HTMLElement, rejectTags: string[] = []): HTMLElement[] => {
  const elements: HTMLElement[] = [];
  const walk = (node: HTMLElement | Document | ShadowRoot, depth = 0) => {
    if (depth > 15) return;
    if (node instanceof HTMLElement && node.shadowRoot) {
      walk(node.shadowRoot, depth + 1);
    }
    const children = 'children' in node ? (Array.from(node.children) as HTMLElement[]) : [];
    for (const child of children) {
      if (
        child.tagName === 'STYLE' ||
        child.tagName === 'LINK' ||
        rejectTags.includes(child.tagName.toLowerCase())
      ) {
        continue;
      }
      if (child.shadowRoot) {
        walk(child.shadowRoot, depth + 1);
      }
      if (child.tagName === 'IFRAME') {
        const iframe = child as HTMLIFrameElement;
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc && iframeDoc.body) {
          walk(iframeDoc.body, depth + 1);
        }
      }
      const hasDirectText =
        child.childNodes &&
        Array.from(child.childNodes).some((node) => {
          if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
            return true;
          }
          if (
            node.nodeType === Node.ELEMENT_NODE &&
            (node as HTMLElement).tagName === 'SPAN' &&
            node.textContent?.trim()
          ) {
            return true;
          }
          return false;
        });
      if (child.children.length === 0 && child.textContent?.trim()) {
        elements.push(child);
      } else if (hasDirectText) {
        elements.push(child);
      } else if (child.children.length > 0) {
        walk(child, depth + 1);
      }
    }
  };

  walk(root);
  return elements;
};
