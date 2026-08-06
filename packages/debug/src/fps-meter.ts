import { createElement } from "./dom";
import {
  DEFAULT_FRAME_THRESHOLDS,
  drawFrameGraph,
  type FrameThresholds,
} from "./frame-graph";
import type { FrameSampler } from "./frame-sampler";

export type FpsMeterOptions = {
  sampler: FrameSampler;
  thresholds?: FrameThresholds;
};

export class FpsMeter {
  readonly element: HTMLElement;

  private readonly sampler: FrameSampler;
  private readonly thresholds: FrameThresholds;
  private readonly canvas: HTMLCanvasElement;
  private readonly fpsLabel: HTMLSpanElement;
  private readonly msLabel: HTMLSpanElement;
  private renderedRevision = -1;

  constructor(options: FpsMeterOptions) {
    this.sampler = options.sampler;
    this.thresholds = options.thresholds ?? DEFAULT_FRAME_THRESHOLDS;

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
      attrs: {
        width: String(this.sampler.historySize * 2),
        height: "24",
      },
      parent: this.element,
    });
  }

  update(): void {
    if (this.renderedRevision === this.sampler.revision) return;
    this.renderedRevision = this.sampler.revision;

    this.fpsLabel.textContent = `${this.sampler.fps} fps`;
    this.msLabel.textContent = `${this.sampler.frameMs.toFixed(1)} ms`;
    drawFrameGraph(
      this.canvas,
      this.sampler.frames,
      this.sampler.historySize,
      this.thresholds,
    );
  }

  dispose(): void {
    this.element.remove();
  }
}
