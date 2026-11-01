/** Holds keys back until the keyboard has been quiet for a moment. Every held key restarts the wait. */
export class QuietGate {
  private opensAt = 0;

  constructor(private readonly quietMs: number) {}

  close(now: number): void {
    this.opensAt = now + this.quietMs;
  }

  pass(now: number): boolean {
    if (now >= this.opensAt) return true;
    this.close(now);
    return false;
  }
}
