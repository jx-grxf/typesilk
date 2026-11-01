import { EXTENDED } from "./wordlists";
export const LANGUAGES = {
  english: "the of and to in is you that it he was for on are as with his they at be this have from or one had by word but not what all were we when your can said there use each which she do how their if will up other about out many then them these so some her would make like him into time has look two more write go see number no way could people my than first water been call who oil its now find long down day did get come made may part over new sound take only little work know place year live me back give most very after thing our just name good sentence man think say great where help through much before line right too mean old any same tell boy follow came want show also around form three small set put end does another well large must big even such because turn here why ask went men read need land different home us move try kind hand picture again change off play spell air away animal house point page letter mother answer found study still learn should world",
  german: "der die und in den von zu das mit sich des auf für ist im dem nicht ein eine als auch es an werden aus er hat dass sie nach wird bei einer um am sind noch wie einem über einen so zum war haben nur oder aber vor zur bis mehr durch man sein wurde sei Jahr Zeit Tag Mensch Hand Welt Haus Leben Kind Stadt Weg Frau Mann Teil Land Arbeit Wasser Licht Musik Freund Nacht Morgen Abend Frage Antwort Schule Wort Sprache Straße Bild Geschichte Woche Familie Gruppe gut neu groß klein lang kurz hoch alt jung schön schnell leicht schwer früh spät weit nah immer wieder schon sehr hier dort dann heute gestern morgen jetzt können müssen sollen wollen machen gehen kommen sehen sagen geben nehmen wissen finden denken bleiben stehen liegen spielen lernen arbeiten leben zeigen fragen laufen schreiben lesen hören fühlen möchte natürlich vielleicht zusammen zwischen während gegen ohne unter wenig viele alle andere keine dieser diese unser euer müde glücklich wichtig möglich richtig ähnlich",
  spanish: "de la que el en y a los del se las por un para con no una su al lo como más pero sus le ya o este sí porque esta entre cuando muy sin sobre también me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mí antes algunos qué unos yo otro otras otra él tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros tiempo año día vida casa mundo mano parte persona trabajo ciudad país agua noche camino palabra amigo familia hombre mujer niño historia lugar momento forma ser tener hacer poder decir ir ver dar saber querer llegar pasar deber poner parecer quedar creer hablar llevar dejar seguir encontrar llamar venir pensar salir volver tomar conocer vivir sentir bueno grande nuevo primero mejor mismo largo pequeño claro siempre ahora después aquí nunca",
  french: "le de un être et à il avoir ne je son que se qui ce dans en du elle au pour pas vous par sur faire plus dire me on mon lui nous comme mais pouvoir avec tout y aller voir bien où sans tu ou leur homme si deux mari moi vouloir te femme venir quand grand celui notre devoir là jour prendre même votre rien petit encore aussi quelque dont tous mer trouver donner temps ça peu falloir sous parler alors main chose mettre savoir passer regarder vie monde nouveau autre après enfant premier non croire aimer rester maison ville eau nuit pays histoire ami tête année mot chemin question moment travail toujours jamais ici très beau fois porte place vers depuis contre pendant déjà sentir suivre comprendre attendre sortir vivre écrire lire entendre école français lumière musique",
} as const;

export type Language = keyof typeof LANGUAGES;

export const WORD_LIST_SIZES = ["200", "1k"] as const;
export type WordListSize = (typeof WORD_LIST_SIZES)[number];

const unique = (text: string): string[] => [...new Set(text.split(" "))];
const lists = {
  "200": Object.fromEntries(Object.entries(LANGUAGES).map(([name, text]) => [name, unique(text)])),
  "1k": Object.fromEntries(
    Object.entries(LANGUAGES).map(([name, text]) => [name, unique(`${text} ${EXTENDED[name as Language]}`)]),
  ),
} as Record<WordListSize, Record<Language, string[]>>;

export function wordList(language: Language, size: WordListSize = "200"): string[] {
  return lists[size][language];
}

const RECENT_LIMIT = 12;
const TRAINING_FOCUS = 0.8;
const PUNCTUATION_CHANCE = 0.16;
const NUMBER_CHANCE = 0.12;

export type WordOptions = { punctuation: boolean; numbers: boolean; size?: WordListSize };

/** Most words contain one of the weak letters, the rest keep the text feeling natural. */
export function createTrainingSource(
  language: Language,
  weak: string[],
  random: () => number = Math.random,
  size: WordListSize = "200",
): (count: number) => string[] {
  const list = wordList(language, size);
  const focused = list.filter((word) => weak.some((key) => word.toLowerCase().includes(key)));
  const recent: string[] = [];
  const recentLimit = Math.min(RECENT_LIMIT, Math.floor(focused.length / 2));
  return (count) => {
    const out: string[] = [];
    while (out.length < count) {
      const useFocus = focused.length > 1 && random() < TRAINING_FOCUS;
      const pool = useFocus ? focused : list;
      const word = pool[Math.floor(random() * pool.length)]!;
      if (recent.includes(word)) continue;
      recent.push(word);
      if (recent.length > recentLimit) recent.shift();
      out.push(word);
    }
    return out;
  };
}

/** Random words without near repeats. The recent list survives across chunks. */
export function createWordSource(
  language: Language,
  options: WordOptions = { punctuation: false, numbers: false },
  random: () => number = Math.random,
): (count: number) => string[] {
  const list = wordList(language, options.size);
  const recent: string[] = [];
  let capitalizeNext = options.punctuation;
  return (count) => {
    const out: string[] = [];
    while (out.length < count) {
      if (options.numbers && random() < NUMBER_CHANCE) {
        out.push(String(Math.floor(random() * 10 ** (1 + Math.floor(random() * 4)))));
        continue;
      }
      const word = list[Math.floor(random() * list.length)]!;
      if (recent.includes(word)) continue;
      recent.push(word);
      if (recent.length > RECENT_LIMIT) recent.shift();
      let text: string = word;
      if (capitalizeNext) {
        text = text.charAt(0).toUpperCase() + text.slice(1);
        capitalizeNext = false;
      }
      if (options.punctuation && random() < PUNCTUATION_CHANCE) {
        const mark = random() < 0.5 ? "," : ".";
        text += mark;
        capitalizeNext = mark === ".";
      }
      out.push(text);
    }
    return out;
  };
}
