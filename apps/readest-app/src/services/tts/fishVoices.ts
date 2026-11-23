import type { TTSVoice } from './types';

// Default reading voice: "Claire" — soft / deep / intimate / breathy / gentle.
// Chosen by the user as a warm, sensual, hypnotic French narration voice.
// English is read by a native English voice: Claire's French accent is a bad
// model for someone learning how English words sound (asked 15 Oct 2026). The
// most used female narration voices of the public Fish Audio library; the
// first one is the default for English, the TTS panel picks another.
export const FISH_AUDIO_VOICES: TTSVoice[] = [
  {
    id: 'da05ae30d8c0428eb47498df524e448c',
    name: 'Claire (voix premium)',
    lang: 'fr-FR',
  },
  // More French reading voices (asked 23 Nov 2026), among the most used of the
  // public Fish Audio library, generic voices only (no famous person, no
  // character): soft and calm woman (Fish "Clémence", 142,536 uses), deep
  // documentary man ("Voix de documentaire"), gentle storyteller ("Clyde").
  { id: 'a288bdc744da4ad194921adad6863175', name: 'Clémence (voix premium)', lang: 'fr-FR' },
  { id: 'b6efa2e7896645c28589046c576ddb2e', name: 'Mathieu (voix premium)', lang: 'fr-FR' },
  { id: 'e93fc926cdcb4b0e983509743e07c726', name: 'Louis (voix premium)', lang: 'fr-FR' },
  { id: '933563129e564b19a115bedd57b7406a', name: 'Sarah (voix premium)', lang: 'en-US' },
  { id: 'b347db033a6549378b48d00acb0d06cd', name: 'Selene (voix premium)', lang: 'en-US' },
  { id: 'e3cd384158934cc9a01029cd7d278634', name: 'Laura (voix premium)', lang: 'en-US' },
  { id: 'f6a19fe5ab494e1fa51bb1476d583a44', name: 'Abby (voix premium)', lang: 'en-US' },
  {
    id: '8906b5268cae414fb9b8d3da6e84413d',
    name: 'Measured Storyteller (voix premium)',
    lang: 'en-US',
  },
];

// The server only forwards these voices to Fish Audio (api/fishaudio/tts):
// any other id would let a reader use the account for any public voice.
export const FISH_AUDIO_VOICE_IDS: ReadonlySet<string> = new Set(
  FISH_AUDIO_VOICES.map((v) => v.id),
);
