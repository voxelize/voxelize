export class Span {
  readonly min: number;
  readonly max: number;

  constructor(a: number, b?: number) {
    if (b === undefined) {
      this.min = a;
      this.max = a;
    } else {
      this.min = Math.min(a, b);
      this.max = Math.max(a, b);
    }
  }

  sample(): number {
    if (this.min === this.max) return this.min;
    return this.min + Math.random() * (this.max - this.min);
  }

  sampleInt(): number {
    return Math.floor(this.sample() + Math.random());
  }
}

export type SpanLike = Span | number | [number, number];

export function toSpan(value: SpanLike): Span {
  if (value instanceof Span) return value;
  if (typeof value === "number") return new Span(value);
  return new Span(value[0], value[1]);
}

export function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}
