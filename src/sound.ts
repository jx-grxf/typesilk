const SAMPLE_COUNT = 32;
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

const keyPan = new Map<string, number>();
for (const row of KEY_ROWS) {
  const keys = row.split(" ");
  keys.forEach((code, i) => keyPan.set(code, ((i / (keys.length - 1)) * 2 - 1) * STEREO_WIDTH));
}

type Sample = { buffer: AudioBuffer; onset: number; gain: number };

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

/** Real recorded keystrokes, varied only slightly so they keep sounding like a real keyboard. */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private samples: Sample[] = [];
  private lastIndex = -1;
  private volumeValue = 0.5;

  enabled = true;

  async load(): Promise<void> {
    const decoder = new OfflineAudioContext(1, 1, 44100);
    const files = Array.from({ length: SAMPLE_COUNT }, (_, i) => `sounds/keypress-${String(i + 1).padStart(3, "0")}.wav`);
    const decoded = await Promise.all(
      files.map(async (file) => {
        const response = await fetch(file);
        return decoder.decodeAudioData(await response.arrayBuffer());
      }),
    );
    // the quietest takes are mostly room noise once normalised
    this.samples = decoded.map(analyse).filter((sample) => sample.gain < TARGET_PEAK / MIN_PEAK);
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
    if (!this.enabled || this.samples.length === 0) return;
    const ctx = this.ensure();
    if (!this.master) return;
    let index = Math.floor(Math.random() * this.samples.length);
    if (index === this.lastIndex) index = (index + 1) % this.samples.length;
    this.lastIndex = index;
    const sample = this.samples[index]!;

    const source = ctx.createBufferSource();
    source.buffer = sample.buffer;
    const isSpace = code === "Space";
    source.playbackRate.value = (isSpace ? 0.86 : 1) * (0.985 + Math.random() * 0.03);
    const pan = ctx.createStereoPanner();
    pan.pan.value = keyPan.get(code) ?? 0;
    const gain = ctx.createGain();
    gain.gain.value = sample.gain * (0.85 + Math.random() * 0.15) * (isSpace ? 1.1 : 1);
    source.connect(pan).connect(gain).connect(this.master);
    source.start(0, sample.onset);
  }
}
