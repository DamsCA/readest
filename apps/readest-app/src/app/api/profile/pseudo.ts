// What a pseudo may be: 3 to 20 letters (accents included), digits, spaces,
// "_", "." or "-", no leading, trailing or double space, and not a name that
// would pass for the app or its team.
const PSEUDO_PATTERN = /^[\p{L}\p{N}_.\- ]{3,20}$/u;
const RESERVED = [
  'admin',
  'administrateur',
  'moderateur',
  'modérateur',
  'support',
  'lisetlead',
  'lis et lead',
  'lis-et-lead',
  'equipe',
  'équipe',
];

export type PseudoCheck = { ok: true; pseudo: string } | { ok: false; error: string };

export const checkPseudo = (value: unknown): PseudoCheck => {
  if (typeof value !== 'string') return { ok: false, error: 'PSEUDO_INVALID' };
  const pseudo = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!PSEUDO_PATTERN.test(pseudo)) return { ok: false, error: 'PSEUDO_INVALID' };
  if (RESERVED.includes(pseudo.toLowerCase())) return { ok: false, error: 'PSEUDO_RESERVED' };
  return { ok: true, pseudo };
};
