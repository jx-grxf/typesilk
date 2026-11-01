const MAX_STEP = 1 / 240;

export class Spring {
  x: number;
  v = 0;
  target: number;

  constructor(
    value: number,
    public stiffness: number,
    public damping: number,
  ) {
    this.x = value;
    this.target = value;
  }

  snap(value: number): void {
    this.x = value;
    this.target = value;
    this.v = 0;
  }

  step(dt: number): void {
    let left = dt;
    while (left > 0) {
      const h = Math.min(left, MAX_STEP);
      this.v += (this.stiffness * (this.target - this.x) - this.damping * this.v) * h;
      this.x += this.v * h;
      left -= h;
    }
  }

  get settled(): boolean {
    return Math.abs(this.target - this.x) < 0.01 && Math.abs(this.v) < 0.05;
  }
}

export const SPRINGS = { soft: [170, 22], snappy: [300, 26] } as const;

/** Publishes both springs as CSS tokens (--spring, --spring-snappy and their -ms durations). */
export function applySpringTokens(root: HTMLElement): { soft: ReturnType<typeof springEasing>; snappy: ReturnType<typeof springEasing> } {
  const soft = springEasing(...SPRINGS.soft);
  const snappy = springEasing(...SPRINGS.snappy);
  root.style.setProperty("--spring", soft.easing);
  root.style.setProperty("--spring-ms", `${soft.duration}ms`);
  root.style.setProperty("--spring-snappy", snappy.easing);
  root.style.setProperty("--spring-snappy-ms", `${snappy.duration}ms`);
  return { soft, snappy };
}

/** Bakes a spring into a CSS linear() easing so WAAPI and CSS can run it off the main thread. */
export function springEasing(
  stiffness: number,
  damping: number,
): { easing: string; duration: number } {
  const spring = new Spring(0, stiffness, damping);
  spring.target = 1;
  const dt = 1 / 60;
  const points: number[] = [0];
  let time = 0;
  while (time < 3 && !(spring.settled && time > 0.05)) {
    spring.step(dt);
    time += dt;
    points.push(spring.x);
  }
  points[points.length - 1] = 1;
  return {
    easing: `linear(${points.map((p) => Number(p.toFixed(3))).join(",")})`,
    duration: Math.round(time * 1000),
  };
}
