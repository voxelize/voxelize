// Graphics quality: how much lighting the GPU shades per pixel and at what
// resolution the world is drawn. "auto" watches the frame rate and steps
// down when frames get slow (a big lit build, a weak GPU), and back up once
// there has been headroom for a while.

export type Quality = "high" | "medium" | "low";
export type QualityChoice = "auto" | Quality;

export const QUALITY_CHOICES: { kind: QualityChoice; label: string }[] = [
  { kind: "auto", label: "Auto (adapts to this device)" },
  { kind: "high", label: "High" },
  { kind: "medium", label: "Medium" },
  { kind: "low", label: "Low" },
];

/** What each level means for the renderer. */
export const QUALITY: Record<Quality, { lights: "high" | "medium" | "low"; pixelRatio: number }> = {
  high: { lights: "high", pixelRatio: 1 },
  medium: { lights: "medium", pixelRatio: 1 },
  low: { lights: "low", pixelRatio: 0.75 },
};

const ORDER: Quality[] = ["high", "medium", "low"];

/** Frames slower than this on average (ms) step quality down… */
export const SLOW_MS = 1000 / 40;
/** …and faster than this for long enough step it back up. */
export const FAST_MS = 1000 / 57;
/** Seconds of slow frames before stepping down, of fast ones before up. */
export const DOWN_AFTER = 3;
export const UP_AFTER = 20;

/**
 * The automatic choice: fed every frame's duration, it answers the level
 * to use. Hidden tabs and hitches (single frames over 250 ms: loading,
 * a shader compile) are ignored so they never cost quality.
 */
export class AutoQuality {
  level: Quality = "high";
  private slow = 0;
  private fast = 0;
  private window: number[] = [];

  frame(ms: number): Quality {
    if (ms > 250 || ms <= 0) return this.level;
    this.window.push(ms);
    if (this.window.length > 30) this.window.shift();
    const average = this.window.reduce((a, b) => a + b, 0) / this.window.length;
    const seconds = ms / 1000;
    if (average > SLOW_MS) {
      this.slow += seconds;
      this.fast = 0;
    } else if (average < FAST_MS) {
      this.fast += seconds;
      this.slow = 0;
    } else {
      this.slow = 0;
      this.fast = 0;
    }
    const at = ORDER.indexOf(this.level);
    if (this.slow >= DOWN_AFTER && at < ORDER.length - 1) this.step(ORDER[at + 1]);
    else if (this.fast >= UP_AFTER && at > 0) this.step(ORDER[at - 1]);
    return this.level;
  }

  private step(to: Quality) {
    this.level = to;
    this.slow = 0;
    this.fast = 0;
    this.window = [];
  }
}
