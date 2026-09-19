import { resolveToneColors, type Tone } from "./tone";

export type TrendGraphOptions = {
  /** Points the series holds when full. Bars are spaced for a full window so
   * a young series grows in from the left instead of stretching to fit. */
  capacity: number;
  /**
   * Smallest value span the height is scaled over, as a fraction of the
   * largest value. Without a floor a series that is flat to within a few
   * megabytes fills the whole graph with its own noise and every flat heap
   * reads as a mountain range; with 0.1, a rise has to be a tenth of the
   * value to reach the top, and the noise stays a ripple along the bottom.
   */
  minSpanRatio?: number;
  tone?: Tone;
  /**
   * A value still being measured, drawn dimmer in the slot after the series.
   * The bucket in progress: it shows the graph is alive from its first
   * sample, minutes before the first completed point lands.
   */
  pending?: number | null;
};

const DIM_VARIABLE = "--vxd-fg-dim";
const DIM_FALLBACK = "rgba(255, 255, 255, 0.4)";
const PENDING_ALPHA = 0.45;

/**
 * A series drawn as bars scaled between its lowest and highest value, oldest
 * on the left. The one shape it exists to show is a floor that climbs from
 * left to right: bars stepping up across the window.
 *
 * Every slot the window will hold gets a faint stub along the baseline,
 * so an empty or half-full graph reads as a graph with empty slots and not
 * as a gap in the bar.
 */
export const drawTrendGraph = (
  canvas: HTMLCanvasElement,
  series: readonly number[],
  options: TrendGraphOptions,
): void => {
  const context = canvas.getContext("2d");
  if (!context) return;

  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);

  const capacity = Math.max(options.capacity, series.length, 1);
  const barWidth = width / capacity;
  const slotWidth = Math.max(1, Math.ceil(barWidth) - 1);

  const dim =
    getComputedStyle(canvas).getPropertyValue(DIM_VARIABLE).trim() ||
    DIM_FALLBACK;
  context.fillStyle = dim;
  for (let i = 0; i < capacity; i++) {
    context.fillRect(Math.floor(i * barWidth), height - 1, slotWidth, 1);
  }

  const pending =
    options.pending !== undefined &&
    options.pending !== null &&
    Number.isFinite(options.pending)
      ? options.pending
      : null;
  if (series.length === 0 && pending === null) return;

  let low = Infinity;
  let high = -Infinity;
  for (const value of series) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  if (pending !== null) {
    if (pending < low) low = pending;
    if (pending > high) high = pending;
  }
  const minSpan = high * (options.minSpanRatio ?? 0);
  const span = Math.max(high - low, minSpan, Number.EPSILON);
  // Centre the series in its own span when the noise floor is wider than
  // the range, so a flat line sits mid-height rather than along the bottom.
  const base = high - low < minSpan ? (low + high) / 2 - minSpan / 2 : low;

  const colors = resolveToneColors(canvas);
  const color = colors[options.tone ?? "neutral"];
  const drawBar = (index: number, value: number) => {
    const normalized = Math.min(Math.max((value - base) / span, 0), 1);
    // Never zero: the lowest bar is still a reading, and a graph whose first
    // bars are missing reads as a series that started later than it did.
    const barHeight = Math.max(2, Math.round(normalized * (height - 1)) + 1);
    context.fillRect(
      Math.floor(index * barWidth),
      height - barHeight,
      slotWidth,
      barHeight,
    );
  };

  context.fillStyle = color;
  for (let i = 0; i < series.length; i++) drawBar(i, series[i]);

  if (pending !== null && series.length < capacity) {
    context.globalAlpha = PENDING_ALPHA;
    drawBar(series.length, pending);
    context.globalAlpha = 1;
  }
};
