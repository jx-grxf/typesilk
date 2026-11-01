export type CardData = {
  wpm: number;
  accuracy: number;
  raw: number;
  consistency: number;
  seconds: number;
  series: number[];
  setup: string;
  date: Date;
};

const W = 1200;
const H = 630;
const PAD = 72;

function tokens(): Record<"bg" | "ink" | "muted" | "dim" | "rule" | "accent" | "face", string> {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string): string => style.getPropertyValue(name).trim();
  return { bg: read("--bg"), ink: read("--ink"), muted: read("--muted"), dim: read("--dim"), rule: read("--rule"), accent: read("--accent"), face: read("--face") };
}

/** A share image in the current theme and typeface, drawn locally so nothing leaves the browser. */
export async function renderCard(data: CardData): Promise<Blob> {
  const t = tokens();
  await Promise.all([document.fonts.load(`300 200px ${t.face}`), document.fonts.load(`italic 400 40px ${t.face}`)]);
  const canvas = document.createElement("canvas");
  canvas.width = W * 2;
  canvas.height = H * 2;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(2, 2);
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = t.ink;
  ctx.font = `italic 400 30px ${t.face}`;
  ctx.fillText("typesilk", PAD, PAD + 10);
  ctx.textAlign = "right";
  ctx.fillStyle = t.muted;
  ctx.font = `400 22px ${t.face}`;
  ctx.fillText(new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(data.date), W - PAD, PAD + 8);

  ctx.textAlign = "left";
  ctx.fillStyle = t.accent;
  ctx.font = `300 230px ${t.face}`;
  const number = String(Math.round(data.wpm));
  ctx.fillText(number, PAD - 8, 340);
  const numberWidth = ctx.measureText(number).width;
  ctx.fillStyle = t.muted;
  ctx.font = `italic 400 52px ${t.face}`;
  ctx.fillText("wpm", PAD + numberWidth + 6, 340);

  ctx.fillStyle = t.muted;
  ctx.font = `italic 400 26px ${t.face}`;
  ctx.fillText(data.setup, PAD, 400);

  const stats: [string, string][] = [
    ["accuracy", `${Math.round(data.accuracy)}%`],
    ["raw", String(Math.round(data.raw))],
    ["consistency", `${Math.round(data.consistency)}%`],
    ["time", `${Math.round(data.seconds)}s`],
  ];
  const columnW = (W - PAD * 2) / stats.length;
  stats.forEach(([label, value], i) => {
    const x = PAD + i * columnW;
    ctx.fillStyle = t.rule;
    ctx.fillRect(x, 452, columnW - 24, 1);
    ctx.fillStyle = t.muted;
    ctx.font = `400 20px ${t.face}`;
    ctx.fillText(label, x, 484);
    ctx.fillStyle = t.ink;
    ctx.font = `400 34px ${t.face}`;
    ctx.fillText(value, x, 524);
  });

  if (data.series.length >= 2) {
    const left = W * 0.52;
    const right = W - PAD;
    const top = 150;
    const bottom = 360;
    const max = Math.max(...data.series, 1) * 1.15;
    ctx.strokeStyle = t.accent;
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    data.series.forEach((value, i) => {
      const x = left + (i / (data.series.length - 1)) * (right - left);
      const y = bottom - (value / max) * (bottom - top);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = t.rule;
    ctx.fillRect(left, bottom + 8, right - left, 1);
  }

  ctx.fillStyle = t.dim;
  ctx.font = `400 20px ${t.face}`;
  ctx.fillText("typesilk.com", PAD, H - PAD + 20);

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no image"))), "image/png"));
}

export async function copyCard(data: CardData): Promise<void> {
  // Safari only accepts the write when the promise is handed over inside the click
  await navigator.clipboard.write([new ClipboardItem({ "image/png": renderCard(data) })]);
}

export async function saveCard(data: CardData): Promise<void> {
  const url = URL.createObjectURL(await renderCard(data));
  const link = document.createElement("a");
  link.href = url;
  link.download = `typesilk-${Math.round(data.wpm)}wpm.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
