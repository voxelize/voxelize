import { Span, SpanLike, toSpan } from "./math";

export class Rate {
  readonly count: Span;
  readonly interval: Span;

  constructor(count: SpanLike, interval: SpanLike) {
    this.count = toSpan(count);
    this.interval = toSpan(interval);
  }

  nextInterval(): number {
    return Math.max(this.interval.sample(), 0);
  }

  nextCount(): number {
    return Math.max(0, Math.round(this.count.sample()));
  }
}
