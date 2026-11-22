// English sayings and their French equivalents, for the AI translation.
//
// The models on Workers AI translate a proverb's images instead of its lesson,
// even when told not to. Measured on 22 Nov 2026 with Mistral Small 3.1, Llama
// 3.3 70B and gpt-oss-120b: "If wishes were horses, beggars would ride" (It
// Works, R. H. Jarrett) always came back as « Si les vœux étaient des chevaux,
// les mendiants monteraient à cheval », never « Avec des si, on mettrait Paris
// en bouteille »; "the early bird catches the worm" and "every cloud has a
// silver lining" often word for word too. A reader who opens a book to read it
// in good French notices at once.
//
// So when a paragraph contains one of these sayings, the server tells the model
// which French saying to use (only those found, so other paragraphs cost
// nothing more). Keys are lower-case fragments that survive a lost drop cap and
// changes of tense; the French side is what a French writer would put.

const SAYINGS: Array<[string, string]> = [
  ['wishes were horses', 'Avec des si, on mettrait Paris en bouteille'],
  ['count your chickens', "Il ne faut pas vendre la peau de l'ours avant de l'avoir tué"],
  ["count one's chickens", "Il ne faut pas vendre la peau de l'ours avant de l'avoir tué"],
  ['early bird', "L'avenir appartient à ceux qui se lèvent tôt"],
  ['two birds with one stone', "faire d'une pierre deux coups"],
  ['the last straw', "la goutte d'eau qui fait déborder le vase"],
  ["straw that broke the camel's back", "la goutte d'eau qui fait déborder le vase"],
  ['silver lining', 'À quelque chose malheur est bon'],
  ['actions speak louder than words', 'Les actes valent mieux que les paroles'],
  ['raining cats and dogs', 'il pleut des cordes'],
  ['rains cats and dogs', 'il pleut des cordes'],
  ['bird in the hand', "Un tiens vaut mieux que deux tu l'auras"],
  ['book by its cover', "L'habit ne fait pas le moine"],
  ["where there's smoke", "Il n'y a pas de fumée sans feu"],
  ['where there is smoke', "Il n'y a pas de fumée sans feu"],
  ['no smoke without fire', "Il n'y a pas de fumée sans feu"],
  ["rome wasn't built in a day", "Paris ne s'est pas fait en un jour"],
  ['rome was not built in a day', "Paris ne s'est pas fait en un jour"],
  ['when in rome', 'À Rome, fais comme les Romains'],
  ['practice makes perfect', "C'est en forgeant qu'on devient forgeron"],
  ["where there's a will", 'Quand on veut, on peut'],
  ['where there is a will', 'Quand on veut, on peut'],
  ['grass is always greener', "L'herbe est toujours plus verte ailleurs"],
  ['all your eggs in one basket', 'mettre tous ses œufs dans le même panier'],
  ['all of your eggs in one basket', 'mettre tous ses œufs dans le même panier'],
  ['better late than never', 'Mieux vaut tard que jamais'],
  ['birds of a feather', "Qui se ressemble s'assemble"],
  ['time is money', "Le temps, c'est de l'argent"],
  ['no pain, no gain', "On n'a rien sans rien"],
  ['nothing ventured', "Qui ne tente rien n'a rien"],
  ['pen is mightier than the sword', "La plume est plus forte que l'épée"],
  ['rolling stone gathers no moss', "Pierre qui roule n'amasse pas mousse"],
  ['still waters run deep', "Il n'est pire eau que l'eau qui dort"],
  ['two heads are better than one', "Deux avis valent mieux qu'un"],
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
  ['all that glitters', "Tout ce qui brille n'est pas or"],
  ['out of sight, out of mind', 'Loin des yeux, loin du cœur'],
  ['god helps those who help themselves', "Aide-toi, le ciel t'aidera"],
  ['heaven helps those who help themselves', "Aide-toi, le ciel t'aidera"],
  ['reap what you sow', "On récolte ce que l'on sème"],
  ['as you sow, so shall you reap', "On récolte ce que l'on sème"],
  ['proof of the pudding', "C'est à l'usage qu'on juge"],
  ['curiosity killed the cat', 'La curiosité est un vilain défaut'],
  ['gift horse in the mouth', 'À cheval donné, on ne regarde pas les dents'],
  ['lead a horse to water', "On ne fait pas boire un âne qui n'a pas soif"],
  ['a stitch in time', 'Mieux vaut prévenir que guérir'],
  ['an ounce of prevention', 'Mieux vaut prévenir que guérir'],
  ['strike while the iron is hot', "Il faut battre le fer tant qu'il est chaud"],
  ['make hay while the sun shines', "Il faut battre le fer tant qu'il est chaud"],
  ['easy come, easy go', 'Vite gagné, vite dépensé'],
  ['slow and steady wins the race', 'Rien ne sert de courir, il faut partir à point'],
  ['seeing is believing', 'Je ne crois que ce que je vois'],
  ["money doesn't grow on trees", "L'argent ne tombe pas du ciel"],
  ['money does not grow on trees', "L'argent ne tombe pas du ciel"],
  ['like father, like son', 'Tel père, tel fils'],
  ["apple doesn't fall far from the tree", 'Tel père, tel fils'],
  ['apple never falls far from the tree', 'Tel père, tel fils'],
  ['never rains but it pours', "Un malheur n'arrive jamais seul"],
  ['bite the hand that feeds', 'cracher dans la soupe'],
  ['devil is in the details', 'Le diable se cache dans les détails'],
  ["leopard can't change its spots", 'Chassez le naturel, il revient au galop'],
  ['leopard cannot change its spots', 'Chassez le naturel, il revient au galop'],
  ['old dog new tricks', "On n'apprend pas à un vieux singe à faire des grimaces"],
  ['speak of the devil', 'Quand on parle du loup, on en voit la queue'],
  ['cart before the horse', 'mettre la charrue avant les bœufs'],
  ['throw in the towel', "jeter l'éponge"],
  ['threw in the towel', "jeter l'éponge"],
  ['on cloud nine', 'être aux anges'],
  ['an apple a day', 'Une pomme par jour éloigne le médecin'],
  ['a penny saved', "Il n'y a pas de petites économies"],
  ['take care of the pence', "Il n'y a pas de petites économies"],
  ['look before you leap', "Il faut réfléchir avant d'agir"],
  ['necessity is the mother of invention', "La nécessité est mère de l'industrie"],
  ['the more, the merrier', 'Plus on est de fous, plus on rit'],
  ['the more the merrier', 'Plus on est de fous, plus on rit'],
  ['every dog has its day', 'À chacun son heure de gloire'],
  ['knowledge is power', "Savoir, c'est pouvoir"],
  ["beggars can't be choosers", 'Faute de grives, on mange des merles'],
  ['beggars cannot be choosers', 'Faute de grives, on mange des merles'],
];

const normalise = (text: string) =>
  text.toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ');

/** The French sayings to use for the English sayings found in this passage. */
export const findSayings = (text: string): Array<[string, string]> => {
  const haystack = normalise(text);
  const seen = new Set<string>();
  const found: Array<[string, string]> = [];
  for (const [key, french] of SAYINGS) {
    if (haystack.includes(key) && !seen.has(french)) {
      seen.add(french);
      found.push([key, french]);
    }
  }
  return found;
};

/** Extra instruction for the model, empty when the passage has no known saying. */
export const sayingsInstruction = (text: string, target: string): string => {
  if (target !== 'French') return '';
  const found = findSayings(text);
  if (!found.length) return '';
  const list = found.map(([key, french]) => `"${key}" → « ${french} »`).join(' ; ');
  return (
    ` This passage contains English sayings. Each French saying given here replaces the whole ` +
    `English saying: keep none of the English saying's words or images, and adapt only the ` +
    `grammar to the sentence: ${list}.`
  );
};
