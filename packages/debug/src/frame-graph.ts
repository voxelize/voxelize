import { resolveToneColors, type Tone } from "./tone";

export type FrameThresholds = {
  goodMs: number;
  fairMs: number;
  ceilingMs: number;
};

export const DEFAULT_FRAME_THRESHOLDS: FrameThresholds = {
  goodMs: 17,
  fairMs: 25,
  ceilingMs: 33,
};

export const frameTone = (ms: number, thresholds: FrameThresholds): Tone => {
  if (ms <= thresholds.goodMs) return "ok";
  if (ms <= thresholds.fairMs) return "warn";
  return "error";
};

export const drawFrameGraph = (
  canvas: HTMLCanvasElement,
  frames: readonly number[],
  historySize: number,
  thresholds: FrameThresholds,
): void => {
  const context = canvas.getContext("2d");
  if (!context) return;

  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  if (frames.length === 0) return;

  const colors = resolveToneColors(canvas);
  const barWidth = width / historySize;

  for (let i = 0; i < frames.length; i++) {
    const ms = frames[i];
    const normalized = Math.min(ms / thresholds.ceilingMs, 1);
    const barHeight = Math.max(1, Math.round(normalized * height));
    context.fillStyle = colors[frameTone(ms, thresholds)];
    context.fillRect(
      Math.floor(i * barWidth),
      height - barHeight,
      Math.max(1, Math.ceil(barWidth) - 1),
      barHeight,
    );
  }
};
