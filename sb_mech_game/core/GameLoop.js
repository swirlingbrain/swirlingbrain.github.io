export function computeDeltaSeconds(previousTimeMs, currentTimeMs) {
  return Math.max(0, (currentTimeMs - previousTimeMs) / 1000);
}

export class GameLoop {
  constructor(onTick) {
    this.onTick = onTick;
    this.previousTime = null;
    this.running = false;
    this.rafId = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const step = (currentTime) => {
      if (!this.running) return;
      if (this.previousTime !== null) {
        this.onTick(computeDeltaSeconds(this.previousTime, currentTime));
      }
      this.previousTime = currentTime;
      this.rafId = requestAnimationFrame(step);
    };
    this.rafId = requestAnimationFrame(step);
  }

  stop() {
    this.running = false;
    this.previousTime = null;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
  }
}
