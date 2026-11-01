const ONSET_THRESHOLD = 0.1;
const TARGET_PEAK = 0.8;
const MIN_PEAK = 0.2;
const STEREO_WIDTH = 0.35;
const KEY_ROWS = [
  "Backquote Digit1 Digit2 Digit3 Digit4 Digit5 Digit6 Digit7 Digit8 Digit9 Digit0 Minus Equal",
  "KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI KeyO KeyP BracketLeft BracketRight",
  "KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK KeyL Semicolon Quote",
  "KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma Period Slash",
];

export const SOUND_PACKS = ["crisp", "laptop", "office", "typewriter"] as const;
export type SoundPack = (typeof SOUND_PACKS)[number];

/** Number of keystrokes per pack and whether it has its own space bar. */
const PACKS: Record<SoundPack, { keys: number; space: boolean }> = {
  crisp: { keys: 32, space: false },
  laptop: { keys: 23, space: false },
  office: { keys: 22, space: false },
  typewriter: { keys: 24, space: true },
};

const keyPan = new Map<string, number>();
for (const row of KEY_ROWS) {
  const keys = row.split(" ");
  keys.forEach((code, i) => keyPan.set(code, ((i / (keys.length - 1)) * 2 - 1) * STEREO_WIDTH));
}

type Sample = { buffer: AudioBuffer; onset: number; gain: number };
type Loaded = { keys: Sample[]; space: Sample | null };

function analyse(buffer: AudioBuffer): Sample {
  const data = buffer.getChannelData(0);
  let peak = 0;
  for (const value of data) peak = Math.max(peak, Math.abs(value));
  const first = data.findIndex((value) => Math.abs(value) > peak * ONSET_THRESHOLD);
  return {
    buffer,
    // starting at the transient rather than the file start removes the recording's lead-in from the latency
    onset: Math.max(first, 0) / buffer.sampleRate,
    gain: peak > 0 ? TARGET_PEAK / peak : 1,
  };
}

async function decode(decoder: BaseAudioContext, file: string): Promise<Sample> {
  const response = await fetch(file);
  return analyse(await decoder.decodeAudioData(await response.arrayBuffer()));
}

/** Real recorded keystrokes, varied only slightly so they keep sounding like a real keyboard. */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private loaded = new Map<SoundPack, Promise<Loaded>>();
  private current: Loaded | null = null;
  private pack: SoundPack = "crisp";
  private lastIndex = -1;
  private volumeValue = 0.5;

  enabled = true;

  /** Only the chosen pack is fetched; switching back later reuses what was decoded. */
  async use(pack: SoundPack): Promise<void> {
    this.pack = pack;
    let loading = this.loaded.get(pack);
    if (!loading) {
      loading = this.fetchPack(pack);
      this.loaded.set(pack, loading);
    }
    const result = await loading;
    if (this.pack === pack) this.current = result;
  }

  private async fetchPack(pack: SoundPack): Promise<Loaded> {
    const decoder = new OfflineAudioContext(1, 1, 44100);
    const { keys, space } = PACKS[pack];
    const files = Array.from({ length: keys }, (_, i) => `sounds/${pack}/key-${String(i + 1).padStart(3, "0")}.wav`);
    const [decoded, spaceSample] = await Promise.all([
      Promise.all(files.map((file) => decode(decoder, file))),
      space ? decode(decoder, `sounds/${pack}/space.wav`) : Promise.resolve(null),
    ]);
    // the quietest takes are mostly room noise once normalised
    return { keys: decoded.filter((sample) => sample.gain < TARGET_PEAK / MIN_PEAK), space: spaceSample };
  }

  /** Browsers only allow audio after a gesture, so this runs on the first keypress. */
  private ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: "interactive" });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volumeValue;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  setVolume(volume: number): void {
    this.volumeValue = volume;
    if (this.master) this.master.gain.value = volume;
  }

  key(code: string): void {
    const pack = this.current;
    if (!this.enabled || !pack || pack.keys.length === 0) return;
    const ctx = this.ensure();
    if (!this.master) return;
    const isSpace = code === "Space";
    let sample: Sample;
    if (isSpace && pack.space) {
      sample = pack.space;
    } else {
      let index = Math.floor(Math.random() * pack.keys.length);
      if (index === this.lastIndex) index = (index + 1) % pack.keys.length;
      this.lastIndex = index;
      sample = pack.keys[index]!;
    }
    // without a recorded space bar, a slower take of a normal key stands in for the bigger key
    const spaceShift = isSpace && !pack.space;

    const source = ctx.createBufferSource();
    source.buffer = sample.buffer;
    source.playbackRate.value = (spaceShift ? 0.86 : 1) * (0.985 + Math.random() * 0.03);
    const pan = ctx.createStereoPanner();
    pan.pan.value = keyPan.get(code) ?? 0;
    const gain = ctx.createGain();
    gain.gain.value = sample.gain * (0.85 + Math.random() * 0.15) * (spaceShift ? 1.1 : 1);
    source.connect(pan).connect(gain).connect(this.master);
    source.start(0, sample.onset);
  }

  /** A single keystroke to audition a pack right after choosing it. */
  preview(): void {
    if (this.current) this.key("KeyG");
  }
}
