import { describe, it, expect } from 'vitest';
import {
  decodeWordTimings,
  encodeWordTimings,
  parseFishTimestampStream,
} from '@/services/tts/fishTimestamps';
import { computeWordOffsets, findWordIndexAtSeconds } from '@/services/tts/wordHighlight';

const b64 = (bytes: number[]) => Buffer.from(bytes).toString('base64');
const sse = (events: object[], eol = '\n') =>
  events.map((e) => `data: ${JSON.stringify(e)}${eol}${eol}`).join('');

describe('parseFishTimestampStream', () => {
  it('decodes each base64 chunk on its own and concatenates the bytes in order', () => {
    // Each chunk carries its own "=" padding, as Fish sends them: joining the
    // strings before decoding would corrupt the audio.
    const body = sse([
      { audio_base64: b64([1, 2]), chunk_seq: 0, chunk_audio_offset_sec: 0, alignment: null },
      { audio_base64: b64([3]), chunk_seq: 0, chunk_audio_offset_sec: 0, alignment: null },
      { audio_base64: b64([4, 5, 6, 7]), chunk_seq: 0, chunk_audio_offset_sec: 0 },
    ]);
    expect(b64([1, 2]).endsWith('=')).toBe(true);
    const { audio } = parseFishTimestampStream(body);
    expect(Array.from(audio)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('shifts segment times by their chunk offset (times are chunk-relative)', () => {
    // Shape measured on the real API: chunk 1 starts at 9.71 s and its first
    // word is reported at 0.40 s.
    const body = sse([
      {
        audio_base64: b64([1]),
        chunk_seq: 0,
        chunk_audio_offset_sec: 0,
        alignment: {
          audio_duration: 9.71,
          segments: [
            { text: 'Le', start: 0, end: 0.16 },
            { text: 'collines', start: 9.2, end: 9.6 },
          ],
        },
      },
      {
        audio_base64: b64([2]),
        chunk_seq: 1,
        chunk_audio_offset_sec: 9.71,
        alignment: { audio_duration: 8.91, segments: [{ text: 'Le', start: 0.4, end: 0.56 }] },
      },
    ]);
    const { words } = parseFishTimestampStream(body);
    expect(words.map((w) => w.text)).toEqual(['Le', 'collines', 'Le']);
    expect(words[2]!.start).toBeCloseTo(10.11, 5);
    expect(words[2]!.end).toBeCloseTo(10.27, 5);
  });

  it('keeps only the latest alignment snapshot of a chunk (snapshots are cumulative)', () => {
    const body = sse([
      {
        chunk_seq: 0,
        chunk_audio_offset_sec: 0,
        alignment: { segments: [{ text: 'Le', start: 0, end: 0.16 }] },
      },
      {
        chunk_seq: 0,
        chunk_audio_offset_sec: 0,
        alignment: {
          segments: [
            { text: 'Le', start: 0, end: 0.16 },
            { text: 'jour', start: 0.16, end: 0.48 },
          ],
        },
      },
    ]);
    expect(parseFishTimestampStream(body).words.map((w) => w.text)).toEqual(['Le', 'jour']);
  });

  it('orders chunks by chunk_seq and tolerates CRLF, comments and broken events', () => {
    const body =
      ': keep-alive\r\n\r\n' +
      sse(
        [
          {
            chunk_seq: 1,
            chunk_audio_offset_sec: 2,
            alignment: { segments: [{ text: 'lui', start: 0.1, end: 0.3 }] },
          },
        ],
        '\r\n',
      ) +
      'data: {not json\r\n\r\n' +
      sse(
        [
          {
            chunk_seq: 0,
            chunk_audio_offset_sec: 0,
            alignment: { segments: [{ text: 'Il', start: 0, end: 0.2 }] },
          },
        ],
        '\r\n',
      );
    const { words } = parseFishTimestampStream(body);
    expect(words.map((w) => w.text)).toEqual(['Il', 'lui']);
    expect(words[1]!.start).toBeCloseTo(2.1, 5);
  });

  it('skips empty or malformed segments', () => {
    const body = sse([
      {
        chunk_seq: 0,
        alignment: {
          segments: [
            { text: ' ', start: 0, end: 0.1 },
            { text: 'ok', start: 0.1, end: 0.2 },
            { text: 'sans-debut' },
            { start: 0.3, end: 0.4 },
          ],
        },
      },
    ]);
    expect(parseFishTimestampStream(body).words).toEqual([{ text: 'ok', start: 0.1, end: 0.2 }]);
  });

  it('returns no words and no audio for a body without events', () => {
    const { audio, words } = parseFishTimestampStream('');
    expect(audio.byteLength).toBe(0);
    expect(words).toEqual([]);
  });
});

describe('word timings persisted in a header', () => {
  it('round-trips French words through an ASCII-only header value', () => {
    const words = [
      { text: "C'était", start: 0.123456, end: 0.5 },
      { text: 'là', start: 10.56, end: 10.64 },
    ];
    const header = encodeWordTimings(words);
    expect(/^[\x20-\x7e]*$/.test(header)).toBe(true);
    expect(decodeWordTimings(header)).toEqual([
      { text: "C'était", start: 0.123, end: 0.5 },
      { text: 'là', start: 10.56, end: 10.64 },
    ]);
  });

  it('treats a missing or corrupt header as "no timings"', () => {
    expect(decodeWordTimings(null)).toBeNull();
    expect(decodeWordTimings('%E0%A4%A')).toBeNull();
    expect(decodeWordTimings(encodeURIComponent('{"a":1}'))).toBeNull();
  });
});

describe('Fish word segments map back onto French book text', () => {
  // Real request of 12 Oct 2026 (s2.1-pro-free, voice Claire): the segment
  // texts Fish returned for this sentence, typographic characters included.
  const TEXT =
    'Il s’assit — peut-être fatigué — et dit : « Aujourd’hui, ' +
    'au XIXe siècle, M. Dupont gagnait 3,5 % de plus ! » C’était en 1999.';
  const SEGMENTS = [
    'Il',
    "s'assit",
    'peut',
    'être',
    'fatigué',
    'et',
    'dit',
    "Aujourd'hui",
    'au',
    'XIXe',
    'siècle',
    'M',
    'Dupont',
    'gagnait',
    '3',
    '5',
    'de',
    'plus',
    "C'était",
    'en',
    '1999',
  ];

  it('matches every segment, folding the typographic apostrophe', () => {
    const offsets = computeWordOffsets(TEXT, SEGMENTS);
    expect(offsets.every((o) => o !== null)).toBe(true);
    const spans = offsets.map((o) => TEXT.slice(o!.start, o!.end));
    expect(spans[1]).toBe('s’assit');
    expect(spans[7]).toBe('Aujourd’hui');
    expect(spans[18]).toBe('C’était');
    expect(spans[20]).toBe('1999');
  });

  it('finds the word being spoken at a given media time', () => {
    const words = [
      { start: 0, text: 'Le' },
      { start: 0.16, text: 'jour' },
      { start: 2.16, text: 'Il' },
    ];
    expect(findWordIndexAtSeconds(words, -0.1)).toBe(-1);
    expect(findWordIndexAtSeconds(words, 0)).toBe(0);
    expect(findWordIndexAtSeconds(words, 1.5)).toBe(1); // inside the pause after "jour"
    expect(findWordIndexAtSeconds(words, 2.16)).toBe(2);
    expect(findWordIndexAtSeconds([], 1)).toBe(-1);
  });
});
