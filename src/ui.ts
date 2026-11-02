import { GOALS, THEME_LEVELS, themeLevel, THEMES, type Settings } from "./settings";
import { SOUND_PACKS } from "./sound";
import { WORD_LIST_SIZES } from "./words";

/** `locked` returns why the option can't be picked yet, or null once it can. */
type Option<T> = { label: string; value: T; locked?: () => string | null };

export type Segment = { root: HTMLElement; set(value: unknown): void; sync(): void };

/** A row of words whose underline slides across on a spring instead of jumping. */
export function segment<T>(options: Option<T>[], value: T, onSelect: (value: T) => void): Segment {
  const root = document.createElement("div");
  root.className = "seg";
  const thumb = document.createElement("span");
  thumb.className = "seg-thumb";
  root.append(thumb);
  const buttons = options.map((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = option.label;
    button.addEventListener("click", () => {
      set(option.value);
      button.blur();
      onSelect(option.value);
    });
    root.append(button);
    return button;
  });
  let current = value;
  function sync(): void {
    const index = options.findIndex((option) => option.value === current);
    const active = buttons[index];
    buttons.forEach((button, i) => {
      button.classList.toggle("on", i === index);
      const locked = options[i]?.locked?.() ?? null;
      button.disabled = locked !== null;
      button.title = locked ?? "";
    });
    if (!active || active.offsetWidth === 0) return;
    // a segment that wraps puts its line under the active word, not under the last row
    const y = active.offsetTop + active.offsetHeight + 5 - root.offsetHeight;
    thumb.style.transform = `translate(${active.offsetLeft}px, ${y}px)`;
    thumb.style.width = `${active.offsetWidth}px`;
  }
  function set(next: unknown): void {
    current = next as T;
    sync();
  }
  return { root, set, sync };
}

export function toggleWord(label: string, value: boolean, onChange: (value: boolean) => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "toggle-word";
  button.textContent = label;
  button.setAttribute("aria-pressed", String(value));
  button.addEventListener("click", () => {
    const next = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(next));
    button.blur();
    onChange(next);
  });
  return button;
}

/** Label above the control, for a control too wide to share the line. */
function stacked(node: HTMLElement): HTMLElement {
  node.classList.add("stacked");
  return node;
}

function row(label: string, note: string, control: HTMLElement): HTMLElement {
  const node = document.createElement("div");
  node.className = "row";
  node.innerHTML = `<div class="row-text"><span>${label}</span><small>${note}</small></div>`;
  node.append(control);
  return node;
}

function publicSlot(): HTMLElement {
  const slot = document.createElement("span");
  slot.id = "public-profile-slot";
  slot.className = "public-slot";
  return slot;
}

function group(title: string): HTMLElement {
  const node = document.createElement("h3");
  node.textContent = title;
  return node;
}

export function buildPanel(
  root: HTMLElement,
  s: Settings,
  change: (patch: Partial<Settings>) => void,
  reset: { prompt(): string; run(): Promise<boolean> },
  level: () => number,
): Segment[] {
  const segments: Segment[] = [];
  const seg = <T,>(options: Option<T>[], value: T, on: (v: T) => void): HTMLElement => {
    const control = segment(options, value, on);
    segments.push(control);
    return control.root;
  };
  const onOff = (label: string, note: string, key: keyof Settings): HTMLElement =>
    row(label, note, seg(
      [{ label: "on", value: true }, { label: "off", value: false }],
      s[key] as boolean,
      (value) => change({ [key]: value }),
    ));

  const volume = document.createElement("input");
  volume.type = "range";
  volume.min = "0";
  volume.max = "1";
  volume.step = "0.05";
  volume.value = String(s.volume);
  volume.setAttribute("aria-label", "volume");
  volume.addEventListener("input", () => change({ volume: Number(volume.value) }));

  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "danger";
  resetButton.textContent = "reset";
  resetButton.addEventListener("click", () => {
    if (!resetButton.dataset.armed) {
      resetButton.dataset.armed = "1";
      resetButton.textContent = reset.prompt();
      return;
    }
    delete resetButton.dataset.armed;
    void reset.run().then((done) => {
      resetButton.textContent = done ? "done" : "failed, try again";
    });
  });

  root.append(
    group("Look"),
    stacked(row("Theme", `more open up at level ${Object.values(THEME_LEVELS).join(", ").replace(/, (\d+)$/, " and $1")}`, seg(
      THEMES.map((value) => ({ label: value, value, locked: () => (themeLevel(value) > level() ? `from level ${themeLevel(value)}` : null) })),
      s.theme,
      (theme) => change({ theme }),
    ))),
    row("Layout", "tape glides, lines read ahead, classic keeps the setup on top", seg(
      [
        { label: "tape", value: "tape" as const },
        { label: "lines", value: "lines" as const },
        { label: "classic", value: "classic" as const },
      ],
      s.layout,
      (layout) => change({ layout }),
    )),
    row("Font", "", seg(
      [{ label: "serif", value: "serif" as const }, { label: "mono", value: "mono" as const }],
      s.font,
      (font) => change({ font }),
    )),
    row("Text size", "", seg(
      [{ label: "small", value: "s" as const }, { label: "medium", value: "m" as const }, { label: "large", value: "l" as const }],
      s.textSize,
      (textSize) => change({ textSize }),
    )),
    group("Words"),
    row("Word list", "most common words; English goes to 20k, German to 10k, Spanish and French to 1k", seg(
      WORD_LIST_SIZES.map((value) => ({ label: value, value })),
      s.wordList,
      (wordList) => change({ wordList }),
    )),
    group("Caret"),
    row("Shape", "", seg(
      [
        { label: "line", value: "line" as const },
        { label: "block", value: "block" as const },
        { label: "underline", value: "underline" as const },
      ],
      s.caret,
      (caret) => change({ caret }),
    )),
    row("Movement", "off jumps, snappy follows, smooth glides", seg(
      [
        { label: "off", value: "off" as const },
        { label: "snappy", value: "snappy" as const },
        { label: "smooth", value: "smooth" as const },
      ],
      s.caretMotion,
      (caretMotion) => change({ caretMotion }),
    )),
    group("Every day"),
    row("Daily goal", "words per day, shown next to your streak", seg(
      GOALS.map((value) => ({ label: value === 0 ? "off" : String(value), value: value as number })),
      s.dailyGoal,
      (dailyGoal) => change({ dailyGoal }),
    )),
    group("While typing"),
    onOff("Focus", "everything but the text fades out", "focusMode"),
    onOff("Live stats", "speed and accuracy above the text", "liveStats"),
    group("Motion"),
    onOff("Letter motion", "letters press in, mistakes shake", "letterFx"),
    onOff("Flow line", "grows while your rhythm holds", "flowLine"),
    onOff("Ghost", "race the caret of your best run", "ghost"),
    group("Sound"),
    onOff("Keyboard sound", "recorded keystrokes", "sound"),
    row("Pack", "recorded on three keyboards and a typewriter", seg(
      SOUND_PACKS.map((value) => ({ label: value, value })),
      s.soundPack,
      (soundPack) => change({ soundPack }),
    )),
    row("Volume", "", volume),
    group("Data"),
    row("Public profile", "off until you turn it on; no per-letter stats, not indexed", publicSlot()),
    row("Progress", "clears level, streak and records", resetButton),
  );
  return segments;
}
