// Translations are inserted as plain text (textContent), so an HTML entity a
// translator left in its output shows on the page as is: "l&#39;homme" on most
// apostrophes of a French translation (reported 12 Oct 2026). Any entity is
// turned back into its character before display and speech, cached
// translations included.

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  hellip: '…',
  mdash: '—',
  ndash: '–',
};

const ENTITY = /&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/gi;

const decodeNamed = (name: string): string | undefined => {
  const known = NAMED[name.toLowerCase()];
  if (known !== undefined) return known;
  // Any other named entity, decoded by the browser without running markup.
  if (typeof document === 'undefined') return undefined;
  const area = document.createElement('textarea');
  area.innerHTML = `&${name};`;
  return area.value === `&${name};` ? undefined : area.value;
};

const decodeOnce = (text: string): string =>
  text.replace(ENTITY, (match, body: string) => {
    if (body[0] !== '#') return decodeNamed(body) ?? match;
    const code =
      body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
    const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
    return valid ? String.fromCodePoint(code) : match;
  });

/** The text with its HTML entities as characters, escaped twice ("&amp;#39;") too. */
export const decodeHtmlEntities = (text: string): string => {
  if (!text || !text.includes('&')) return text;
  const once = decodeOnce(text);
  return once.includes('&') ? decodeOnce(once) : once;
};
