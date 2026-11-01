const SIZE = 5;
const MIN_KEYS = 7;
const SVG = "http://www.w3.org/2000/svg";

function hash(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
  return h >>> 0;
}

/**
 * A mirrored grid of keys drawn from a name, so everyone has a mark of their own without
 * uploading a picture or loading one from somewhere else. The same name always gives the same grid.
 */
export function keyprint(seed: string): boolean[][] {
  for (let salt = 0; ; salt++) {
    let bits = hash(`${salt}:${seed}`);
    const half = Math.ceil(SIZE / 2);
    const grid = Array.from({ length: SIZE }, () => Array<boolean>(SIZE).fill(false));
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < half; x++) {
        const on = (bits & 1) === 1;
        bits = (bits >>> 1) | ((bits & 1) << 31);
        grid[y]![x] = on;
        grid[y]![SIZE - 1 - x] = on;
      }
    }
    // a nearly empty grid reads as a mistake, and salting keeps the result stable per name
    if (grid.flat().filter(Boolean).length >= MIN_KEYS) return grid;
  }
}

export function avatarNode(seed: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 40 40");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("keyprint");
  keyprint(seed).forEach((row, y) => {
    row.forEach((on, x) => {
      if (!on) return;
      const key = document.createElementNS(SVG, "rect");
      key.setAttribute("x", String(6.5 + x * 5.6));
      key.setAttribute("y", String(6.5 + y * 5.6));
      key.setAttribute("width", "4.6");
      key.setAttribute("height", "4.6");
      key.setAttribute("rx", "1");
      svg.append(key);
    });
  });
  return svg;
}
