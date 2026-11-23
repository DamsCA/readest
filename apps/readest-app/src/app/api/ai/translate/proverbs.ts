// English sayings and their French equivalents, for the AI translation.
//
// The models on Workers AI translate a proverb's images instead of its lesson,
// even when told not to. Measured on 22 Nov 2026 with Mistral Small 3.1, Llama
// 3.3 70B and gpt-oss-120b: "the early bird catches the worm" and "every cloud
// has a silver lining" often came back word for word.
//
// "If wishes were horses, beggars would ride" (It Works, R. H. Jarrett) keeps
// its image: « Avec des si, on mettrait Paris en bouteille » mocks reasoning on
// what-ifs, whereas the English says that wishing alone gets you nothing, the
// very belief the book sets out to overturn (23 Nov 2026: « n'est pas du tout
// l'équivalent de cette phrase »). The saying is fixed so it reads the same in
// the app as in the French edition, with « souhaits », the book's own word. A reader who opens a book to read it
// in good French notices at once.
//
// Telling the model which French saying to use was not enough: online, the same
// day, it sometimes dropped the saying altogether or left « les gens
// monteraient à cheval » after it. So:
// - a whole saying is replaced in the text by its French saying before the
//   model sees it, and the model is told to keep the French as it is;
// - an idiom that bends with its sentence ("she killed two birds with one
//   stone") cannot be swapped like that: the model is told which French idiom
//   to use.
// Only what is found in the paragraph is added, so other paragraphs cost nothing.

// Whole sayings, as they are usually written. The first letter may be missing
// (a drop cap turned into an image: "F wishes were horses").
const WHOLE: Array<[string, string]> = [
  [
    'if wishes were horses, beggars would ride',
    'Si les souhaits étaient des chevaux, les mendiants monteraient à cheval',
  ],
  [
    "don't count your chickens before they hatch",
    "Il ne faut pas vendre la peau de l'ours avant de l'avoir tué",
  ],
  [
    "don't count your chickens before they're hatched",
    "Il ne faut pas vendre la peau de l'ours avant de l'avoir tué",
  ],
  ['the early bird catches the worm', "L'avenir appartient à ceux qui se lèvent tôt"],
  ['the early bird gets the worm', "L'avenir appartient à ceux qui se lèvent tôt"],
  ['every cloud has a silver lining', 'À quelque chose malheur est bon'],
  ['actions speak louder than words', 'Les actes valent mieux que les paroles'],
  ['a bird in the hand is worth two in the bush', "Un tiens vaut mieux que deux tu l'auras"],
  ["don't judge a book by its cover", "L'habit ne fait pas le moine"],
  ["you can't judge a book by its cover", "L'habit ne fait pas le moine"],
  ["where there's smoke, there's fire", "Il n'y a pas de fumée sans feu"],
  ["rome wasn't built in a day", "Paris ne s'est pas fait en un jour"],
  ['rome was not built in a day', "Paris ne s'est pas fait en un jour"],
  ['when in rome, do as the romans do', 'À Rome, fais comme les Romains'],
  ['practice makes perfect', "C'est en forgeant qu'on devient forgeron"],
  ["where there's a will, there's a way", 'Quand on veut, on peut'],
  ['where there is a will, there is a way', 'Quand on veut, on peut'],
  ['the grass is always greener on the other side', "L'herbe est toujours plus verte ailleurs"],
  ['better late than never', 'Mieux vaut tard que jamais'],
  ['birds of a feather flock together', "Qui se ressemble s'assemble"],
  ['time is money', "Le temps, c'est de l'argent"],
  ['no pain, no gain', "On n'a rien sans rien"],
  ['nothing ventured, nothing gained', "Qui ne tente rien n'a rien"],
  ['the pen is mightier than the sword', "La plume est plus forte que l'épée"],
  ['a rolling stone gathers no moss', "Pierre qui roule n'amasse pas mousse"],
  ['still waters run deep', "Il n'est pire eau que l'eau qui dort"],
  ['two heads are better than one', "Deux avis valent mieux qu'un"],
  ['all that glitters is not gold', "Tout ce qui brille n'est pas or"],
  ['out of sight, out of mind', 'Loin des yeux, loin du cœur'],
  ['god helps those who help themselves', "Aide-toi, le ciel t'aidera"],
  ['heaven helps those who help themselves', "Aide-toi, le ciel t'aidera"],
  ['you reap what you sow', "On récolte ce que l'on sème"],
  ['as you sow, so shall you reap', "On récolte ce que l'on sème"],
  ['the proof of the pudding is in the eating', "C'est à l'usage qu'on juge"],
  ['curiosity killed the cat', 'La curiosité est un vilain défaut'],
  ["don't look a gift horse in the mouth", 'À cheval donné, on ne regarde pas les dents'],
  ['never look a gift horse in the mouth', 'À cheval donné, on ne regarde pas les dents'],
  [
    "you can lead a horse to water, but you can't make it drink",
    "On ne fait pas boire un âne qui n'a pas soif",
  ],
  ['a stitch in time saves nine', 'Mieux vaut prévenir que guérir'],
  ['an ounce of prevention is worth a pound of cure', 'Mieux vaut prévenir que guérir'],
  ['strike while the iron is hot', "Il faut battre le fer tant qu'il est chaud"],
  ['make hay while the sun shines', "Il faut battre le fer tant qu'il est chaud"],
  ['easy come, easy go', 'Vite gagné, vite dépensé'],
  ['slow and steady wins the race', 'Rien ne sert de courir, il faut partir à point'],
  ['seeing is believing', 'Je ne crois que ce que je vois'],
  ["money doesn't grow on trees", "L'argent ne tombe pas du ciel"],
  ['money does not grow on trees', "L'argent ne tombe pas du ciel"],
  ['like father, like son', 'Tel père, tel fils'],
  ["the apple doesn't fall far from the tree", 'Tel père, tel fils'],
  ['the apple never falls far from the tree', 'Tel père, tel fils'],
  ['it never rains but it pours', "Un malheur n'arrive jamais seul"],
  ['the devil is in the details', 'Le diable se cache dans les détails'],
  ["a leopard can't change its spots", 'Chassez le naturel, il revient au galop'],
  ['a leopard cannot change its spots', 'Chassez le naturel, il revient au galop'],
  [
    "you can't teach an old dog new tricks",
    "On n'apprend pas à un vieux singe à faire des grimaces",
  ],
  ['an apple a day keeps the doctor away', 'Une pomme par jour éloigne le médecin'],
  ['a penny saved is a penny earned', "Il n'y a pas de petites économies"],
  ['look before you leap', "Il faut réfléchir avant d'agir"],
  ['necessity is the mother of invention', "La nécessité est mère de l'industrie"],
  ['the more, the merrier', 'Plus on est de fous, plus on rit'],
  ['every dog has its day', 'À chacun son heure de gloire'],
  ['knowledge is power', "Savoir, c'est pouvoir"],
  ["beggars can't be choosers", 'Faute de grives, on mange des merles'],
  ['beggars cannot be choosers', 'Faute de grives, on mange des merles'],
];

// Idioms that bend with their sentence, and leftovers of the sayings above
// written another way: lower-case fragments, and the French to use.
const IDIOMS: Array<[string, string]> = [
  ['wishes were horses', 'Si les souhaits étaient des chevaux, les mendiants monteraient à cheval'],
  ['count your chickens', "vendre la peau de l'ours avant de l'avoir tué"],
  ["count one's chickens", "vendre la peau de l'ours avant de l'avoir tué"],
  ['early bird', "l'avenir appartient à ceux qui se lèvent tôt"],
  ['silver lining', 'à quelque chose malheur est bon'],
  ['two birds with one stone', "faire d'une pierre deux coups"],
  ['the last straw', "la goutte d'eau qui fait déborder le vase"],
  ["straw that broke the camel's back", "la goutte d'eau qui fait déborder le vase"],
  ['raining cats and dogs', 'il pleut des cordes'],
  ['rains cats and dogs', 'il pleut des cordes'],
  ['all your eggs in one basket', 'mettre tous ses œufs dans le même panier'],
  ['all of your eggs in one basket', 'mettre tous ses œufs dans le même panier'],
  ['the ball is in your court', 'la balle est dans votre camp'],
  ['spill the beans', 'vendre la mèche'],
  ['spilled the beans', 'vendre la mèche'],
  ['let the cat out of the bag', 'vendre la mèche'],
  ['hit the nail on the head', 'mettre le doigt dessus'],
  ['blessing in disguise', 'un mal pour un bien'],
  ['once in a blue moon', 'tous les trente-six du mois'],
  ['an arm and a leg', 'coûter les yeux de la tête'],
  ['under the weather', 'ne pas être dans son assiette'],
  ['beat around the bush', 'tourner autour du pot'],
  ['beating around the bush', 'tourner autour du pot'],
  ['bite the bullet', 'serrer les dents'],
  ['over spilt milk', 'Ce qui est fait est fait'],
  ['over spilled milk', 'Ce qui est fait est fait'],
  ['have your cake and eat it', "vouloir le beurre et l'argent du beurre"],
  ['bite the hand that feeds', 'cracher dans la soupe'],
  ['speak of the devil', 'quand on parle du loup, on en voit la queue'],
  ['cart before the horse', 'mettre la charrue avant les bœufs'],
  ['throw in the towel', "jeter l'éponge"],
  ['threw in the towel', "jeter l'éponge"],
  ['on cloud nine', 'être aux anges'],
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (w: string) => escapeRe(w).replace(/'/g, "['’]");
const wholePattern = (saying: string) => {
  const words = saying
    .replace(/[,.;:!?]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const first = words[0]!;
  const head = `(?:${escapeRe(first[0]!)})?${word(first.slice(1))}`;
  const rest = words.slice(1).map(word);
  return new RegExp(`(?<![\\p{L}])${[head, ...rest].join('[\\s,;:—–-]+')}(?![\\p{L}])`, 'giu');
};
const WHOLE_PATTERNS = WHOLE.map(([saying, french]) => ({ re: wholePattern(saying), french }));

const normalise = (text: string) =>
  text.toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ');

export interface PreparedPassage {
  /** The text to translate, whole sayings already in French. */
  text: string;
  /** Extra instruction for the model, empty when nothing was found. */
  instruction: string;
  /** The French sayings put in, and the idioms pointed out (for tests and logs). */
  replaced: string[];
  idioms: Array<[string, string]>;
}

/** Prepares an English passage for translation into French. Other pairs pass through. */
export const preparePassage = (text: string, target: string): PreparedPassage => {
  const none = { text, instruction: '', replaced: [], idioms: [] };
  if (target !== 'French') return none;

  const replaced: string[] = [];
  let out = text;
  for (const { re, french } of WHOLE_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(out)) {
      re.lastIndex = 0;
      out = out.replace(re, french);
      if (!replaced.includes(french)) replaced.push(french);
    }
  }

  const haystack = normalise(out);
  const idioms: Array<[string, string]> = [];
  for (const [key, french] of IDIOMS) {
    if (haystack.includes(key) && !idioms.some(([, f]) => f === french)) {
      idioms.push([key, french]);
    }
  }

  let instruction = '';
  if (replaced.length) {
    instruction +=
      ` The passage already contains French sayings (${replaced.map((f) => `« ${f} »`).join(', ')}): ` +
      `keep each one word for word, in « » if it is quoted, and translate the rest around it.`;
  }
  if (idioms.length) {
    instruction +=
      ` It also contains English idioms: render each one with the French idiom given here, ` +
      `adapted to the sentence, keeping none of the English images: ` +
      `${idioms.map(([key, french]) => `"${key}" → « ${french} »`).join(' ; ')}.`;
  }
  return { text: out, instruction, replaced, idioms };
};
