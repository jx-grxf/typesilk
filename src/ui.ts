import { THEMES, type Settings } from "./settings";
import { SOUND_PACKS } from "./sound";

type Option<T> = { label: string; value: T };

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
    buttons.forEach((button, i) => button.classList.toggle("on", i === index));
    if (!active || active.offsetWidth === 0) return;
    thumb.style.transform = `translateX(${active.offsetLeft}px)`;
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

function row(label: string, note: string, control: HTMLElement): HTMLElement {
  const node = document.createElement("div");
  node.className = "row";
  node.innerHTML = `<div class="row-text"><span>${label}</span><small>${note}</small></div>`;
  node.append(control);
  return node;
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
  resetProfile: () => void,
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

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "danger";
  reset.textContent = "reset";
  reset.addEventListener("click", () => {
    if (reset.dataset.armed) {
      resetProfile();
      reset.textContent = "done";
      delete reset.dataset.armed;
    } else {
      reset.dataset.armed = "1";
      reset.textContent = "really?";
    }
  });

  root.append(
    group("Look"),
    row("Theme", "", seg(THEMES.map((value) => ({ label: value, value })), s.theme, (theme) => change({ theme }))),
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
    row("Progress", "clears level, streak and records", reset),
  );
  return segments;
}
