import { createElement } from "./dom";

const HISTORY = 80;

export class FpsMeter {
  readonly element: HTMLElement;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private fpsLabel: HTMLSpanElement;
  private msLabel: HTMLSpanElement;
  private samples: number[] = [];
  private lastFrame = performance.now();
  private lastUpdate = 0;
  private currentFps = 0;
  private currentMs = 0;

  constructor() {
    this.element = createElement("div", { className: "vxd-fps" });

    const header = createElement("div", {
      className: "vxd-fps-header",
      parent: this.element,
    });
    this.fpsLabel = createElement("span", {
      className: "vxd-fps-value",
      text: "-- fps",
      parent: header,
    });
    this.msLabel = createElement("span", {
      className: "vxd-fps-ms",
      text: "-- ms",
      parent: header,
    });

    this.canvas = createElement("canvas", {
      className: "vxd-fps-graph",
      attrs: { width: String(HISTORY * 2), height: "24" },
      parent: this.element,
    });

    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("FpsMeter: 2D canvas context unavailable");
    this.ctx = ctx;
  }

  update(): void {
    const now = performance.now();
    const frameMs = now - this.lastFrame;
    this.lastFrame = now;

    if (frameMs <= 0 || frameMs > 1000) return;

    this.samples.push(frameMs);
    if (this.samples.length > HISTORY) this.samples.shift();

    if (now - this.lastUpdate >= 200) {
      this.lastUpdate = now;
      const sum = this.samples.reduce((acc, v) => acc + v, 0);
      const avg = sum / this.samples.length;
      this.currentFps = Math.round(1000 / avg);
      this.currentMs = Math.round(avg * 10) / 10;
      this.fpsLabel.textContent = `${this.currentFps} fps`;
      this.msLabel.textContent = `${this.currentMs.toFixed(1)} ms`;
      this.drawGraph();
    }
  }

  dispose(): void {
    this.element.remove();
  }

  private drawGraph(): void {
    const { ctx, canvas, samples } = this;
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    if (samples.length === 0) return;

    const cap = 33;
    const barWidth = width / HISTORY;

    for (let i = 0; i < samples.length; i++) {
      const ms = samples[i];
      const normalized = Math.min(ms / cap, 1);
      const barHeight = Math.max(1, Math.round(normalized * height));
      const x = Math.floor(i * barWidth);

      ctx.fillStyle = ms <= 17 ? "#5fb86b" : ms <= 25 ? "#d6a44e" : "#d04a4a";
      ctx.fillRect(x, height - barHeight, Math.ceil(barWidth) - 1, barHeight);
    }
  }
}
