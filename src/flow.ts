/** Rewards steady rhythm and clean typing. A mistake costs flow but doesn't wipe it. */
export class FlowMeter {
  value = 0;
  private target = 0;
  private lastKey = 0;
  private pace = 0;

  reset(): void {
    this.value = this.target = this.lastKey = this.pace = 0;
  }

  key(time: number, correct: boolean, streak: number): void {
    if (!correct) this.target *= 0.45;
    if (this.lastKey > 0) {
      const gap = Math.min(time - this.lastKey, 1500);
      this.pace = this.pace === 0 ? gap : this.pace + (gap - this.pace) * 0.18;
      if (correct) {
        const steadiness = 1 - Math.min(Math.abs(gap - this.pace) / this.pace, 1);
        const earned = 0.55 * steadiness + 0.45 * Math.min(streak / 60, 1);
        this.target += (earned - this.target) * 0.1;
      }
    }
    this.lastKey = time;
  }

  update(dt: number): void {
    this.value += (this.target - this.value) * Math.min(dt * 5, 1);
  }

  get settled(): boolean {
    return Math.abs(this.target - this.value) < 0.002;
  }
}
