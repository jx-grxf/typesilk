export const MAX_EXTRA = 8;

export type KeyResult =
  | { kind: "ignored" }
  | { kind: "char"; wordIndex: number; charIndex: number; correct: boolean; extra: boolean }
  | { kind: "commit"; wordIndex: number; perfect: boolean; typedLength: number }
  | { kind: "delete"; wordIndex: number; charIndex: number; extra: boolean }
  | { kind: "clear"; wordIndex: number; previous: string }
  | { kind: "back"; wordIndex: number };

function positionalMatches(input: string, word: string): number {
  let count = 0;
  for (let i = 0; i < input.length && i < word.length; i++) {
    if (input[i] === word[i]) count++;
  }
  return count;
}

export class TypingEngine {
  readonly words: string[];
  readonly inputs: string[] = [""];
  wordIndex = 0;
  totalKeys = 0;
  correctKeys = 0;
  streak = 0;
  private committedChars = 0;

  /** In free mode there is no target text: whatever you type becomes the word. */
  constructor(words: string[], readonly free = false) {
    this.words = free ? [""] : [...words];
  }

  get word(): string {
    return this.words[this.wordIndex] ?? "";
  }

  get input(): string {
    return this.inputs[this.wordIndex] ?? "";
  }

  extend(words: string[]): void {
    this.words.push(...words);
  }

  /** Characters that count towards wpm: correct letters plus the spaces of perfect words. */
  get correctChars(): number {
    return this.committedChars + positionalMatches(this.input, this.word);
  }

  get accuracy(): number {
    return this.totalKeys === 0 ? 100 : (this.correctKeys / this.totalKeys) * 100;
  }

  get lastWordDone(): boolean {
    return this.wordIndex === this.words.length - 1 && this.input === this.word;
  }

  insert(ch: string): KeyResult {
    const { word, input, wordIndex } = this;
    if (wordIndex >= this.words.length) return { kind: "ignored" };
    const charIndex = input.length;
    if (this.free) {
      this.words[wordIndex] = input + ch;
      this.inputs[wordIndex] = input + ch;
      this.count(true);
      return { kind: "char", wordIndex, charIndex, correct: true, extra: false };
    }
    const extra = charIndex >= word.length;
    if (charIndex >= word.length + MAX_EXTRA) return { kind: "ignored" };
    const correct = !extra && word[charIndex] === ch;
    this.inputs[wordIndex] = input + ch;
    this.count(correct);
    return { kind: "char", wordIndex, charIndex, correct, extra };
  }

  space(): KeyResult {
    const { word, input, wordIndex } = this;
    if (input.length === 0 || wordIndex >= this.words.length) return { kind: "ignored" };
    const perfect = input === word;
    this.count(perfect);
    this.committedChars += positionalMatches(input, word) + (perfect ? 1 : 0);
    this.wordIndex++;
    this.inputs[this.wordIndex] = "";
    if (this.free) this.words.push("");
    return { kind: "commit", wordIndex, perfect, typedLength: input.length };
  }

  backspace(wholeWord = false): KeyResult {
    const { input, word, wordIndex } = this;
    if (input.length > 0) {
      if (wholeWord) {
        this.inputs[wordIndex] = "";
        if (this.free) this.words[wordIndex] = "";
        return { kind: "clear", wordIndex, previous: input };
      }
      const charIndex = input.length - 1;
      this.inputs[wordIndex] = input.slice(0, -1);
      if (this.free) {
        this.words[wordIndex] = input.slice(0, -1);
        return { kind: "delete", wordIndex, charIndex, extra: true };
      }
      return { kind: "delete", wordIndex, charIndex, extra: charIndex >= word.length };
    }
    const previous = wordIndex - 1;
    if (previous < 0) return { kind: "ignored" };
    const previousInput = this.inputs[previous] ?? "";
    const previousWord = this.words[previous] ?? "";
    if (previousInput === previousWord) return { kind: "ignored" };
    this.committedChars -= positionalMatches(previousInput, previousWord);
    this.inputs.length = wordIndex;
    this.wordIndex = previous;
    return { kind: "back", wordIndex: previous };
  }

  private count(correct: boolean): void {
    this.totalKeys++;
    if (correct) {
      this.correctKeys++;
      this.streak++;
    } else {
      this.streak = 0;
    }
  }
}

export function wpm(chars: number, ms: number): number {
  return ms <= 0 ? 0 : chars / 5 / (ms / 60000);
}

/** Speed per second, averaged over a short window so single pauses don't read as cliffs. */
export function rollingWpm(cumulativeChars: number[], window = 3): number[] {
  return cumulativeChars.map((chars, i) => {
    const previous = i - window >= 0 ? (cumulativeChars[i - window] ?? 0) : 0;
    return wpm(chars - previous, Math.min(i + 1, window) * 1000);
  });
}

export function consistency(series: number[]): number {
  if (series.length < 2) return 100;
  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  if (mean === 0) return 0;
  const variance = series.reduce((sum, x) => sum + (x - mean) ** 2, 0) / series.length;
  return Math.max(0, (1 - Math.sqrt(variance) / mean) * 100);
}
