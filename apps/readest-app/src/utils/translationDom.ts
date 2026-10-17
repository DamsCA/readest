// Set on a paragraph whose translation is the paragraph itself (a name, a
// number…): nothing is appended, and the voice reads it as it is.
export const SAME_IN_TRANSLATION = 'data-same-in-translation';

// The element appended to a paragraph to show its translation. Lives outside
// useTextTranslation so the TTS tests can build exactly the DOM the reader
// produces without pulling in the hook's dependency chain.
export const createTranslationWrapper = (
  doc: Document,
  translatedText: string,
  opts: { lang: string; hidden: boolean; lineBreak: boolean; blockClassName: string },
): HTMLElement => {
  const wrapper = doc.createElement('font');
  wrapper.className = `translation-target ${opts.hidden ? 'hidden' : ''}`;
  wrapper.setAttribute('translation-element-mark', '1');
  wrapper.setAttribute('lang', opts.lang);
  if (opts.lineBreak) {
    wrapper.appendChild(doc.createElement('br'));
  }

  const blockWrapper = doc.createElement('font');
  blockWrapper.className = `translation-target ${opts.blockClassName}`;

  const inner = doc.createElement('font');
  inner.className = 'translation-target target-inner target-inner-theme-none';
  inner.textContent = translatedText;

  blockWrapper.appendChild(inner);
  wrapper.appendChild(blockWrapper);
  return wrapper;
};
