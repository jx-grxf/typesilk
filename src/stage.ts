import { Spring, springEasing } from "./spring";
import type { CaretMotion, CaretStyle, Layout } from "./settings";

const PRESS = springEasing(620, 24);
const SHAKE = springEasing(1000, 18);
const ACTIVE_LINE = 1; // in the line layouts the active line stays second, so one finished line remains visible

type Tuning = { caret: [number, number]; wrap: [number, number]; scrollX: [number, number]; scrollY: [number, number] };

// near critical damping (2·√k) everywhere, so nothing overshoots past a letter
const MOTION: Record<Exclude<CaretMotion, "off">, Tuning> = {
  snappy: { caret: [1100, 60], wrap: [3200, 105], scrollX: [620, 46], scrollY: [420, 38] },
  smooth: { caret: [420, 40], wrap: [1400, 75], scrollX: [300, 34], scrollY: [260, 32] },
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/**
 * Everything that moves here moves through transforms, and letter positions are
 * measured once when a word is created. A normal keypress never reads layout.
 */
export class Stage {
  private wordEls: HTMLElement[] = [];
  private wordPos: { left: number; top: number }[] = [];
  private letterLefts: number[][] = [];
  private prefix: number[] = [0];
  private lengths: number[] = [];
  private lineH = 40;
  private firstTop = 0;
  private activeWord = 0;
  private lastLine = 0;

  private scrollX = new Spring(0, 620, 46);
  private scrollY = new Spring(0, 420, 38);
  private caretX = new Spring(0, 1100, 60);
  private caretY = new Spring(0, 1100, 60);
  private caretW = new Spring(20, 1100, 60);
  private tuning: Tuning = MOTION.snappy;
  private instant = false;
  private ghostX = new Spring(0, 260, 32);
  private ghostY = new Spring(0, 260, 32);
  private pulse = new Spring(1, 900, 26);
  private nudge = new Spring(0, 900, 22);
  private flowLevel = 0;
  private written: Record<string, string> = {};

  layout: Layout = "tape";
  caretStyle: CaretStyle = "line";
  letterFx = true;
  ghostVisible = false;

  constructor(
    private scroller: HTMLElement,
    private wordsEl: HTMLElement,
    private caretEl: HTMLElement,
    private ghostEl: HTMLElement,
    private flowEl: HTMLElement,
  ) {}

  setMotion(motion: CaretMotion): void {
    this.instant = motion === "off";
    this.tuning = MOTION[motion === "off" ? "snappy" : motion];
    const { caret, scrollX, scrollY } = this.tuning;
    [this.caretX.stiffness, this.caretX.damping] = caret;
    [this.caretY.stiffness, this.caretY.damping] = caret;
    [this.caretW.stiffness, this.caretW.damping] = caret;
    [this.scrollX.stiffness, this.scrollX.damping] = scrollX;
    [this.scrollY.stiffness, this.scrollY.damping] = scrollY;
  }

  reset(words: string[]): void {
    this.wordsEl.replaceChildren();
    this.wordEls = [];
    this.wordPos = [];
    this.letterLefts = [];
    this.prefix = [0];
    this.lengths = [];
    this.activeWord = 0;
    this.lastLine = 0;
    this.readLineHeight();
    this.append(words);
    this.setActive(0);
    this.firstTop = this.wordPos[0]?.top ?? 0;
    this.snapAll(0);
    this.caretEl.classList.add("idle");
    this.ghostEl.classList.remove("on");
    this.render();
  }

  private readLineHeight(): void {
    this.lineH = parseFloat(getComputedStyle(this.wordsEl).lineHeight) || 40;
  }

  private snapAll(wordIndex: number): void {
    const pos = this.wordPos[wordIndex] ?? { left: 0, top: 0 };
    this.scrollX.snap(this.layout === "tape" ? pos.left : 0);
    this.scrollY.snap(0);
    for (const spring of [this.caretX, this.ghostX]) spring.snap(pos.left);
    for (const spring of [this.caretY, this.ghostY]) spring.snap(pos.top);
    this.caretW.snap(this.letterWidth(wordIndex, 0));
  }

  /** Width of the letter under the caret, or of an average letter past the word's end. */
  private letterWidth(wordIndex: number, charIndex: number): number {
    const lefts = this.letterLefts[wordIndex] ?? [0];
    const here = lefts[charIndex];
    const next = lefts[charIndex + 1];
    if (here !== undefined && next !== undefined) return next - here;
    const end = lefts[lefts.length - 1] ?? 0;
    return lefts.length > 1 ? end / (lefts.length - 1) : this.lineH * 0.35;
  }

  append(words: string[]): void {
    const start = this.wordEls.length;
    const fragment = document.createDocumentFragment();
    for (const word of words) {
      const wordEl = el("span", "word");
      for (const ch of word) {
        const letter = el("span", "l");
        letter.textContent = ch;
        wordEl.append(letter);
      }
      this.wordEls.push(wordEl);
      fragment.append(wordEl);
      this.lengths.push(word.length);
      this.prefix.push((this.prefix[this.prefix.length - 1] ?? 0) + word.length + 1);
    }
    this.wordsEl.append(fragment);
    this.measureWords(start);
    for (let i = start; i < this.wordEls.length; i++) this.measureLetters(i);
  }

  /** Only words can move in the layout; animated letters inside them don't affect these rects. */
  private measureWords(from: number): void {
    const base = this.scroller.getBoundingClientRect();
    for (let i = from; i < this.wordEls.length; i++) {
      const rect = this.wordEls[i]!.getBoundingClientRect();
      this.wordPos[i] = { left: rect.left - base.left, top: rect.top - base.top };
    }
  }

  /** Proportional type, so every letter gets its own measured x. The last entry is the word's end. */
  private measureLetters(wordIndex: number): void {
    const word = this.wordEls[wordIndex]!;
    const left = word.getBoundingClientRect().left;
    const lefts: number[] = [];
    let end = 0;
    for (const letter of word.children) {
      for (const animation of letter.getAnimations()) animation.finish();
      const rect = letter.getBoundingClientRect();
      lefts.push(rect.left - left);
      end = rect.right - left;
    }
    lefts.push(end);
    this.letterLefts[wordIndex] = lefts;
  }

  remeasureAll(wordIndex: number, charIndex: number): void {
    this.readLineHeight();
    this.measureWords(0);
    for (let i = 0; i < this.wordEls.length; i++) this.measureLetters(i);
    this.firstTop = this.wordPos[0]?.top ?? 0;
    this.caretTo(wordIndex, charIndex);
    for (const spring of [this.scrollX, this.scrollY, this.caretX, this.caretY, this.caretW]) spring.snap(spring.target);
    this.render();
  }

  setActive(index: number): void {
    this.wordEls[this.activeWord]?.classList.remove("active");
    this.wordEls[index]?.classList.add("active");
    this.activeWord = index;
  }

  caretTo(wordIndex: number, charIndex: number): void {
    const pos = this.wordPos[wordIndex];
    if (!pos) return;
    this.caretEl.classList.remove("idle");
    const lefts = this.letterLefts[wordIndex] ?? [0];
    const index = Math.min(charIndex, lefts.length - 1);
    const x = pos.left + (lefts[index] ?? 0);
    this.caretW.target = this.letterWidth(wordIndex, index);
    if (this.layout === "tape") {
      this.scrollX.target = x;
    } else {
      const line = Math.round((pos.top - this.firstTop) / this.lineH);
      // a line wrap travels far, so it gets a stiffer spring to arrive just as fast
      const wrapped = line !== this.lastLine;
      [this.caretX.stiffness, this.caretX.damping] = wrapped ? this.tuning.wrap : this.tuning.caret;
      this.lastLine = line;
      this.caretX.target = x;
      this.caretY.target = pos.top;
      this.scrollY.target = Math.max(0, (line - ACTIVE_LINE) * this.lineH);
    }
    if (this.instant) {
      for (const spring of [this.scrollX, this.scrollY, this.caretX, this.caretY, this.caretW]) spring.snap(spring.target);
    }
  }

  /** The caret reacts physically to every press, even though the text does the travelling. */
  press(wrong: boolean): void {
    this.pulse.v -= wrong ? 2 : 3.2;
    if (wrong) this.nudge.v += 170;
  }

  private letter(wordIndex: number, charIndex: number): HTMLElement | undefined {
    return this.wordEls[wordIndex]?.children[charIndex] as HTMLElement | undefined;
  }

  markCorrect(wordIndex: number, charIndex: number): void {
    const letter = this.letter(wordIndex, charIndex);
    if (!letter) return;
    letter.classList.add("ok");
    if (this.letterFx) {
      letter.animate([{ transform: "translateY(0.055em)" }, { transform: "none" }], PRESS);
    }
  }

  markWrong(wordIndex: number, charIndex: number): void {
    const letter = this.letter(wordIndex, charIndex);
    if (!letter) return;
    letter.classList.add("bad");
    if (this.letterFx) {
      letter.animate([{ transform: "translateX(0.07em)" }, { transform: "none" }], SHAKE);
    }
  }

  addExtra(wordIndex: number, ch: string): void {
    const word = this.wordEls[wordIndex];
    if (!word) return;
    const letter = el("span", "l bad x");
    letter.textContent = ch;
    word.append(letter);
    // an extra letter is the one case that shifts everything after it
    this.measureWords(wordIndex);
    this.measureLetters(wordIndex);
    if (this.letterFx) {
      letter.animate([{ transform: "translateY(0.1em)", opacity: 0 }, { transform: "none", opacity: 1 }], PRESS);
    }
  }

  /** Zen mode: a typed letter that is its own target. */
  addTyped(wordIndex: number, ch: string): void {
    const word = this.wordEls[wordIndex];
    if (!word) return;
    const letter = el("span", "l ok");
    letter.textContent = ch;
    word.append(letter);
    this.measureWords(wordIndex);
    this.measureLetters(wordIndex);
    if (this.letterFx) {
      letter.animate([{ transform: "translateY(0.1em)", opacity: 0 }, { transform: "none", opacity: 1 }], PRESS);
    }
  }

  removeExtra(wordIndex: number): void {
    const word = this.wordEls[wordIndex];
    word?.lastElementChild?.remove();
    this.measureWords(wordIndex);
    this.measureLetters(wordIndex);
  }

  clearLetter(wordIndex: number, charIndex: number): void {
    const letter = this.letter(wordIndex, charIndex);
    if (!letter) return;
    for (const animation of letter.getAnimations()) animation.cancel();
    letter.classList.remove("ok", "bad");
  }

  wordDone(wordIndex: number, perfect: boolean, typedLength: number): void {
    const word = this.wordEls[wordIndex];
    if (!word || perfect) return;
    word.classList.add("flawed");
    const total = this.lengths[wordIndex] ?? 0;
    for (let i = typedLength; i < total; i++) this.letter(wordIndex, i)?.classList.add("missed");
  }

  wordBack(wordIndex: number): void {
    const word = this.wordEls[wordIndex];
    word?.classList.remove("flawed");
    word?.querySelectorAll(".missed").forEach((letter) => letter.classList.remove("missed"));
  }

  /** The ghost replays a past run's character count on top of the current text. */
  setGhost(chars: number): void {
    if (!this.ghostVisible) return;
    let low = 0;
    let high = this.prefix.length - 2;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((this.prefix[mid] ?? 0) <= chars) low = mid;
      else high = mid - 1;
    }
    const pos = this.wordPos[low];
    const lefts = this.letterLefts[low];
    if (!pos || !lefts) return;
    const inWord = Math.min(Math.floor(chars - (this.prefix[low] ?? 0)), lefts.length - 1);
    this.ghostX.target = pos.left + (lefts[Math.max(inWord, 0)] ?? 0);
    this.ghostY.target = pos.top;
    this.ghostEl.classList.add("on");
  }

  hideGhost(): void {
    this.ghostEl.classList.remove("on");
  }

  update(dt: number, flow: number): boolean {
    const springs = [this.scrollX, this.scrollY, this.caretX, this.caretY, this.caretW, this.ghostX, this.ghostY, this.pulse, this.nudge];
    for (const spring of springs) spring.step(dt);
    this.flowLevel = flow;
    this.render();
    return !springs.every((spring) => spring.settled);
  }

  private write(key: "caret" | "ghost" | "scroller" | "flow", node: HTMLElement, value: string): void {
    if (this.written[key] === value) return;
    this.written[key] = value;
    node.style.transform = value;
  }

  private render(): void {
    const tape = this.layout === "tape";
    const caretX = tape ? this.scrollX.x : this.caretX.x;
    const caretY = tape ? 0 : this.caretY.x;
    // line carets stretch with speed; block and underline carets take the width of the letter
    const scaleX = this.caretStyle === "line"
      ? (tape ? 1 : 1 + Math.min(Math.abs(this.caretX.v) / 1100, 2))
      : Math.max(this.caretW.x, 2);
    this.write("caret", this.caretEl, `translate3d(${(caretX + this.nudge.x).toFixed(2)}px,${caretY.toFixed(2)}px,0) scale(${scaleX.toFixed(3)},${this.pulse.x.toFixed(3)})`);
    if (this.ghostVisible) {
      this.write("ghost", this.ghostEl, `translate3d(${this.ghostX.x.toFixed(2)}px,${this.ghostY.x.toFixed(2)}px,0)`);
    }
    this.write("scroller", this.scroller, `translate3d(${(-this.scrollX.x).toFixed(2)}px,${(-this.scrollY.x).toFixed(2)}px,0)`);
    this.write("flow", this.flowEl, `scaleX(${Math.max(this.flowLevel, 0).toFixed(3)})`);
  }
}
