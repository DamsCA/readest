// Word timings from Fish Audio's /v1/tts/stream/with-timestamp.
//
// The plain /v1/tts endpoint returns audio only, so the reader could only move
// at mark (sentence-group) granularity: when a group of sentences straddled a
// page break, the view stayed on the old page while the voice read the next
// one. The timestamp endpoint returns the same audio plus the start/end time
// of every word, which lets the page turn on the exact word that crosses it.
//
// Measured on 12 Oct 2026 with the free model (s2.1-pro-free): HTTP 200, API
// credit still 0.000000 afterwards, ~1.2x the time of the plain endpoint.
//
// Wire format (Server-Sent Events), one JSON object per `data:` event:
//   - audio_base64: one audio chunk, base64-encoded ON ITS OWN (chunks carry
//     their own `=` padding, so they must be decoded one by one — joining the
//     strings first corrupts the audio);
//   - chunk_seq / chunk_audio_offset_sec: long input is split into text chunks;
//     segment times are RELATIVE to their chunk, which starts at that offset in
//     the full audio (measured: chunk 1 started at 9.71 s, its first word at 0.40);
//   - alignment: the latest CUMULATIVE snapshot for that chunk — it replaces
//     the previous snapshot of the same chunk_seq, it is not appended.
// Segment text drops punctuation and folds ’ to ' ("s'assit", "peut", "être",
// "M" for "M.") — computeWordOffsets matches it back onto the book text.

export interface FishWordTiming {
  text: string;
  /** Seconds from the start of the whole clip. */
  start: number;
  end: number;
}

interface TimestampSegment {
  text?: unknown;
  start?: unknown;
  end?: unknown;
}

interface TimestampEvent {
  audio_base64?: unknown;
  chunk_seq?: unknown;
  chunk_audio_offset_sec?: unknown;
  alignment?: { segments?: unknown } | null;
}

const decodeBase64 = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export const parseFishTimestampStream = (
  body: string,
): { audio: Uint8Array; words: FishWordTiming[] } => {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const snapshots = new Map<number, { offset: number; segments: TimestampSegment[] }>();

  for (const block of body.replace(/\r\n?/g, '\n').split('\n\n')) {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) continue;
    let event: TimestampEvent;
    try {
      event = JSON.parse(data) as TimestampEvent;
    } catch {
      continue;
    }
    if (typeof event.audio_base64 === 'string' && event.audio_base64) {
      const bytes = decodeBase64(event.audio_base64);
      chunks.push(bytes);
      size += bytes.length;
    }
    const segments = event.alignment?.segments;
    if (Array.isArray(segments)) {
      const seq = typeof event.chunk_seq === 'number' ? event.chunk_seq : 0;
      const offset =
        typeof event.chunk_audio_offset_sec === 'number' ? event.chunk_audio_offset_sec : 0;
      snapshots.set(seq, { offset, segments: segments as TimestampSegment[] });
    }
  }

  const audio = new Uint8Array(size);
  let pos = 0;
  for (const chunk of chunks) {
    audio.set(chunk, pos);
    pos += chunk.length;
  }

  const words: FishWordTiming[] = [];
  for (const seq of [...snapshots.keys()].sort((a, b) => a - b)) {
    const { offset, segments } = snapshots.get(seq)!;
    for (const segment of segments) {
      const { text, start, end } = segment;
      if (typeof text !== 'string' || !text.trim() || typeof start !== 'number') continue;
      words.push({
        text,
        start: offset + start,
        end: offset + (typeof end === 'number' ? end : start),
      });
    }
  }
  return { audio, words };
};

// Timings are persisted in a header of the cached audio Response, so a partial
// write can never pair a clip with another clip's timings. Header values must
// be ASCII and the words are French ("été", "là"), hence the URI encoding.
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export const encodeWordTimings = (words: FishWordTiming[]): string =>
  encodeURIComponent(JSON.stringify(words.map((w) => [w.text, round3(w.start), round3(w.end)])));

export const decodeWordTimings = (value: string | null): FishWordTiming[] | null => {
  if (!value) return null;
  try {
    const raw: unknown = JSON.parse(decodeURIComponent(value));
    if (!Array.isArray(raw)) return null;
    const words: FishWordTiming[] = [];
    for (const item of raw) {
      if (!Array.isArray(item)) continue;
      const [text, start, end] = item as unknown[];
      if (typeof text === 'string' && typeof start === 'number' && typeof end === 'number') {
        words.push({ text, start, end });
      }
    }
    return words;
  } catch {
    return null;
  }
};
