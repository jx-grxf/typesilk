import type { Language } from "./words";

export type Quote = { text: string; author: string; work: string };
export const QUOTE_LENGTHS = ["all", "short", "medium", "long"] as const;
export type QuoteLength = (typeof QUOTE_LENGTHS)[number];

// Only public-domain works. Straight apostrophes and quotes, so every letter can be typed.
export const QUOTES: Record<Language, Quote[]> = {
  english: [
    { text: "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.", author: "Jane Austen", work: "Pride and Prejudice" },
    { text: "Emma Woodhouse, handsome, clever, and rich, with a comfortable home and happy disposition, seemed to unite some of the best blessings of existence; and had lived nearly twenty-one years in the world with very little to distress or vex her.", author: "Jane Austen", work: "Emma" },
    { text: "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity, it was the season of Light, it was the season of Darkness, it was the spring of hope, it was the winter of despair.", author: "Charles Dickens", work: "A Tale of Two Cities" },
    { text: "Marley was dead: to begin with. There is no doubt whatever about that.", author: "Charles Dickens", work: "A Christmas Carol" },
    { text: "Happy families are all alike; every unhappy family is unhappy in its own way.", author: "Leo Tolstoy", work: "Anna Karenina, tr. Constance Garnett" },
    { text: "In my younger and more vulnerable years my father gave me some advice that I've been turning over in my mind ever since.", author: "F. Scott Fitzgerald", work: "The Great Gatsby" },
    { text: "So we beat on, boats against the current, borne back ceaselessly into the past.", author: "F. Scott Fitzgerald", work: "The Great Gatsby" },
    { text: "The only way to get rid of a temptation is to yield to it.", author: "Oscar Wilde", work: "The Picture of Dorian Gray" },
    { text: "There is only one thing in the world worse than being talked about, and that is not being talked about.", author: "Oscar Wilde", work: "The Picture of Dorian Gray" },
    { text: "You don't know about me without you have read a book by the name of The Adventures of Tom Sawyer; but that ain't no matter.", author: "Mark Twain", work: "Adventures of Huckleberry Finn" },
    { text: "I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived.", author: "Henry David Thoreau", work: "Walden" },
    { text: "Beware; for I am fearless, and therefore powerful.", author: "Mary Shelley", work: "Frankenstein" },
    { text: "I am no bird; and no net ensnares me: I am a free human being with an independent will, which I now exert to leave you.", author: "Charlotte Bronte", work: "Jane Eyre" },
    { text: "Once upon a midnight dreary, while I pondered, weak and weary, over many a quaint and curious volume of forgotten lore.", author: "Edgar Allan Poe", work: "The Raven" },
    { text: "Four score and seven years ago our fathers brought forth on this continent, a new nation, conceived in Liberty, and dedicated to the proposition that all men are created equal.", author: "Abraham Lincoln", work: "Gettysburg Address" },
    { text: "You see, but you do not observe.", author: "Arthur Conan Doyle", work: "A Scandal in Bohemia" },
    { text: "How often have I said to you that when you have eliminated the impossible, whatever remains, however improbable, must be the truth?", author: "Arthur Conan Doyle", work: "The Sign of the Four" },
    { text: "Mrs. Dalloway said she would buy the flowers herself.", author: "Virginia Woolf", work: "Mrs Dalloway" },
    { text: "Stately, plump Buck Mulligan came from the stairhead, bearing a bowl of lather on which a mirror and a razor lay crossed.", author: "James Joyce", work: "Ulysses" },
    { text: "To be, or not to be, that is the question: whether 'tis nobler in the mind to suffer the slings and arrows of outrageous fortune, or to take arms against a sea of troubles and by opposing end them.", author: "William Shakespeare", work: "Hamlet" },
  ],
  german: [
    { text: "Als Gregor Samsa eines Morgens aus unruhigen Träumen erwachte, fand er sich in seinem Bett zu einem ungeheueren Ungeziefer verwandelt.", author: "Franz Kafka", work: "Die Verwandlung" },
    { text: "Jemand mußte Josef K. verleumdet haben, denn ohne daß er etwas Böses getan hätte, wurde er eines Morgens verhaftet.", author: "Franz Kafka", work: "Der Proceß" },
    { text: "Vor dem Gesetz steht ein Türhüter. Zu diesem Türhüter kommt ein Mann vom Lande und bittet um Eintritt in das Gesetz.", author: "Franz Kafka", work: "Vor dem Gesetz" },
    { text: "Daß ich erkenne, was die Welt im Innersten zusammenhält.", author: "Johann Wolfgang von Goethe", work: "Faust" },
    { text: "Grau, teurer Freund, ist alle Theorie, und grün des Lebens goldner Baum.", author: "Johann Wolfgang von Goethe", work: "Faust" },
    { text: "Zwei Seelen wohnen, ach! in meiner Brust.", author: "Johann Wolfgang von Goethe", work: "Faust" },
    { text: "Wer reitet so spät durch Nacht und Wind? Es ist der Vater mit seinem Kind; er hat den Knaben wohl in dem Arm, er faßt ihn sicher, er hält ihn warm.", author: "Johann Wolfgang von Goethe", work: "Erlkönig" },
    { text: "Die Axt im Haus erspart den Zimmermann.", author: "Friedrich Schiller", work: "Wilhelm Tell" },
    { text: "Freude, schöner Götterfunken, Tochter aus Elysium, wir betreten feuertrunken, Himmlische, dein Heiligtum!", author: "Friedrich Schiller", work: "An die Freude" },
    { text: "Was mich nicht umbringt, macht mich stärker.", author: "Friedrich Nietzsche", work: "Götzen-Dämmerung" },
    { text: "Man muß noch Chaos in sich haben, um einen tanzenden Stern gebären zu können.", author: "Friedrich Nietzsche", work: "Also sprach Zarathustra" },
    { text: "Ich weiß nicht, was soll es bedeuten, daß ich so traurig bin; ein Märchen aus alten Zeiten, das kommt mir nicht aus dem Sinn.", author: "Heinrich Heine", work: "Die Lorelei" },
    { text: "Sein Blick ist vom Vorübergehn der Stäbe so müd geworden, daß er nichts mehr hält. Ihm ist, als ob es tausend Stäbe gäbe und hinter tausend Stäben keine Welt.", author: "Rainer Maria Rilke", work: "Der Panther" },
    { text: "Es war, als hätt der Himmel die Erde still geküßt, daß sie im Blütenschimmer von ihm nun träumen müßt.", author: "Joseph von Eichendorff", work: "Mondnacht" },
    { text: "Aufklärung ist der Ausgang des Menschen aus seiner selbstverschuldeten Unmündigkeit.", author: "Immanuel Kant", work: "Was ist Aufklärung?" },
    { text: "Es war einmal eine kleine süße Dirne, die hatte jedermann lieb, der sie nur ansah, am allerliebsten aber ihre Großmutter, die wußte gar nicht, was sie alles dem Kinde geben sollte.", author: "Brüder Grimm", work: "Rotkäppchen" },
    { text: "In den alten Zeiten, wo das Wünschen noch geholfen hat, lebte ein König, dessen Töchter waren alle schön, aber die jüngste war so schön, daß die Sonne selber, die doch so vieles gesehen hat, sich verwunderte, sooft sie ihr ins Gesicht schien.", author: "Brüder Grimm", work: "Der Froschkönig" },
  ],
  spanish: [
    { text: "En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de lanza en astillero, adarga antigua, rocín flaco y galgo corredor.", author: "Miguel de Cervantes", work: "Don Quijote de la Mancha" },
    { text: "La libertad, Sancho, es uno de los más preciosos dones que a los hombres dieron los cielos.", author: "Miguel de Cervantes", work: "Don Quijote de la Mancha" },
    { text: "El que lee mucho y anda mucho, ve mucho y sabe mucho.", author: "Miguel de Cervantes", work: "Don Quijote de la Mancha" },
    { text: "¿Qué es la vida? Un frenesí. ¿Qué es la vida? Una ilusión, una sombra, una ficción, y el mayor bien es pequeño; que toda la vida es sueño, y los sueños, sueños son.", author: "Pedro Calderón de la Barca", work: "La vida es sueño" },
    { text: "Caminante, no hay camino, se hace camino al andar.", author: "Antonio Machado", work: "Campos de Castilla" },
    { text: "Todo pasa y todo queda, pero lo nuestro es pasar, pasar haciendo caminos, caminos sobre la mar.", author: "Antonio Machado", work: "Campos de Castilla" },
    { text: "¿Qué es poesía?, dices mientras clavas en mi pupila tu pupila azul. ¿Qué es poesía? ¿Y tú me lo preguntas? Poesía... eres tú.", author: "Gustavo Adolfo Bécquer", work: "Rima XXI" },
    { text: "Volverán las oscuras golondrinas en tu balcón sus nidos a colgar, y otra vez con el ala a sus cristales jugando llamarán.", author: "Gustavo Adolfo Bécquer", work: "Rima LIII" },
    { text: "Verde que te quiero verde. Verde viento. Verdes ramas.", author: "Federico García Lorca", work: "Romance sonámbulo" },
    { text: "Juventud, divino tesoro, ¡ya te vas para no volver! Cuando quiero llorar, no lloro... y a veces lloro sin querer.", author: "Rubén Darío", work: "Canción de otoño en primavera" },
    { text: "Con diez cañones por banda, viento en popa a toda vela, no corta el mar, sino vuela un velero bergantín.", author: "José de Espronceda", work: "Canción del pirata" },
    { text: "Nuestras vidas son los ríos que van a dar en la mar, que es el morir.", author: "Jorge Manrique", work: "Coplas por la muerte de su padre" },
    { text: "Polvo serán, mas polvo enamorado.", author: "Francisco de Quevedo", work: "Amor constante más allá de la muerte" },
  ],
  french: [
    { text: "Longtemps, je me suis couché de bonne heure.", author: "Marcel Proust", work: "Du côté de chez Swann" },
    { text: "Nous étions à l'Étude, quand le Proviseur entra, suivi d'un nouveau habillé en bourgeois et d'un garçon de classe qui portait un grand pupitre.", author: "Gustave Flaubert", work: "Madame Bovary" },
    { text: "Je pense, donc je suis.", author: "René Descartes", work: "Discours de la méthode" },
    { text: "Le cœur a ses raisons que la raison ne connaît point.", author: "Blaise Pascal", work: "Pensées" },
    { text: "Rien ne sert de courir; il faut partir à point.", author: "Jean de La Fontaine", work: "Le Lièvre et la Tortue" },
    { text: "Maître Corbeau, sur un arbre perché, tenait en son bec un fromage. Maître Renard, par l'odeur alléché, lui tint à peu près ce langage.", author: "Jean de La Fontaine", work: "Le Corbeau et le Renard" },
    { text: "Il faut cultiver notre jardin.", author: "Voltaire", work: "Candide" },
    { text: "Là, tout n'est qu'ordre et beauté, luxe, calme et volupté.", author: "Charles Baudelaire", work: "L'Invitation au voyage" },
    { text: "Les sanglots longs des violons de l'automne blessent mon cœur d'une langueur monotone.", author: "Paul Verlaine", work: "Chanson d'automne" },
    { text: "Demain, dès l'aube, à l'heure où blanchit la campagne, je partirai. Vois-tu, je sais que tu m'attends. J'irai par la forêt, j'irai par la montagne. Je ne puis demeurer loin de toi plus longtemps.", author: "Victor Hugo", work: "Demain, dès l'aube" },
    { text: "Il faut manger pour vivre, et non pas vivre pour manger.", author: "Molière", work: "L'Avare" },
    { text: "À vaincre sans péril, on triomphe sans gloire.", author: "Pierre Corneille", work: "Le Cid" },
    { text: "Parce que c'était lui, parce que c'était moi.", author: "Michel de Montaigne", work: "Essais" },
    { text: "L'homme est né libre, et partout il est dans les fers.", author: "Jean-Jacques Rousseau", work: "Du contrat social" },
  ],
};

export function quoteLength(quote: Quote): Exclude<QuoteLength, "all"> {
  const n = quote.text.length;
  return n < 80 ? "short" : n <= 200 ? "medium" : "long";
}

/** A random quote of the wanted length, never the one just typed when there is another. */
export function pickQuote(language: Language, length: QuoteLength, previous: Quote | null, random: () => number = Math.random): Quote {
  const all = QUOTES[language];
  const fitting = length === "all" ? all : all.filter((quote) => quoteLength(quote) === length);
  const pool = fitting.length > 0 ? fitting : all;
  const fresh = pool.length > 1 ? pool.filter((quote) => quote !== previous) : pool;
  return fresh[Math.floor(random() * fresh.length)]!;
}

/** Words of a pasted text, with typographic marks turned into ones a keyboard has. */
export function customWords(text: string, shuffle: boolean, random: () => number = Math.random): string[] {
  const words = text
    .replace(/[‘’]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .split(/\s+/)
    .filter(Boolean);
  if (!shuffle) return words;
  for (let i = words.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [words[i], words[j]] = [words[j]!, words[i]!];
  }
  return words;
}
