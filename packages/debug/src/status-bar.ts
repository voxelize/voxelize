import { createElement } from "./dom";
import {
  DEFAULT_FRAME_THRESHOLDS,
  drawFrameGraph,
  type FrameThresholds,
} from "./frame-graph";
import type { FrameSampler } from "./frame-sampler";
import type { Tone } from "./tone";

export type StatusSide = "left" | "right";

export type StatusAdornment =
  | { kind: "spark" }
  | { kind: "dot"; tone: () => Tone }
  | { kind: "glyph"; glyph: string };

export type StatusItemOptions = {
  id: string;
  side?: StatusSide;
  label?: string;
  adornment?: StatusAdornment;
  get: () => string;
  tone?: () => Tone;
  title?: () => string;
  onClick?: () => void;
  /** Characters to hold open for the value. Without it a metric resizes its
   * own segment as its digit count changes, and since each side packs against
   * an edge, that shoves every neighbour along with it. Size it to the widest
   * reading the metric can plausibly produce. */
  valueWidthCh?: number;
};

export type StatusBarOptions = {
  sampler: FrameSampler;
  heightPx?: number;
  refreshIntervalMs?: number;
  frameThresholds?: FrameThresholds;
};

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "vxd-tone-neutral",
  ok: "vxd-tone-ok",
  warn: "vxd-tone-warn",
  error: "vxd-tone-error",
};

type StatusItem = {
  options: StatusItemOptions;
  element: HTMLElement;
  valueElement: HTMLElement;
  dotElement: HTMLElement | null;
  sparkCanvas: HTMLCanvasElement | null;
  lastText: string | null;
  lastTone: Tone | null;
  lastDotTone: Tone | null;
  lastTitle: string;
  lastSparkRevision: number;
};

export const STATUS_BAR_HEIGHT_VARIABLE = "--vxd-statusbar-height";

export class StatusBar {
  readonly element: HTMLDivElement;
  readonly heightPx: number;

  private readonly sampler: FrameSampler;
  private readonly frameThresholds: FrameThresholds;
  private readonly refreshIntervalMs: number;
  private readonly leftElement: HTMLDivElement;
  private readonly rightElement: HTMLDivElement;
  private readonly items = new Map<string, StatusItem>();
  private lastRefreshAt = 0;

  constructor(options: StatusBarOptions) {
    this.sampler = options.sampler;
    this.heightPx = options.heightPx ?? 22;
    this.refreshIntervalMs = options.refreshIntervalMs ?? 200;
    this.frameThresholds = options.frameThresholds ?? DEFAULT_FRAME_THRESHOLDS;

    this.element = createElement("div", {
      className: "vxd-statusbar",
    }) as HTMLDivElement;

    this.leftElement = createElement("div", {
      className: "vxd-statusbar-side vxd-statusbar-side-left",
      parent: this.element,
    }) as HTMLDivElement;

    this.rightElement = createElement("div", {
      className: "vxd-statusbar-side vxd-statusbar-side-right",
      parent: this.element,
    }) as HTMLDivElement;

    document.documentElement.style.setProperty(
      STATUS_BAR_HEIGHT_VARIABLE,
      `${this.heightPx}px`,
    );
  }

  item(options: StatusItemOptions): this {
    if (this.items.has(options.id)) return this;

    const element = createElement("div", {
      className: "vxd-statusbar-item",
      parent: options.side === "right" ? this.rightElement : this.leftElement,
    });

    let dotElement: HTMLElement | null = null;
    let sparkCanvas: HTMLCanvasElement | null = null;

    if (options.adornment?.kind === "dot") {
      dotElement = createElement("span", {
        className: "vxd-statusbar-dot",
        parent: element,
      });
    } else if (options.adornment?.kind === "spark") {
      sparkCanvas = createElement("canvas", {
        className: "vxd-statusbar-spark",
        attrs: { width: "68", height: "22" },
        parent: element,
      });
    } else if (options.adornment?.kind === "glyph") {
      createElement("span", {
        className: "vxd-statusbar-glyph",
        text: options.adornment.glyph,
        parent: element,
      });
    }

    if (options.label) {
      createElement("span", {
        className: "vxd-statusbar-label",
        text: options.label,
        parent: element,
      });
    }

    const valueElement = createElement("span", {
      className: "vxd-statusbar-value",
      parent: element,
    });

    if (options.valueWidthCh !== undefined) {
      valueElement.style.minWidth = `${options.valueWidthCh}ch`;
    }

    if (options.onClick) {
      element.classList.add("vxd-statusbar-item-clickable");
      element.addEventListener("click", options.onClick);
    }

    this.items.set(options.id, {
      options,
      element,
      valueElement,
      dotElement,
      sparkCanvas,
      lastText: null,
      lastTone: null,
      lastDotTone: null,
      lastTitle: "",
      lastSparkRevision: -1,
    });

    return this;
  }

  remove(id: string): this {
    const item = this.items.get(id);
    if (!item) return this;
    item.element.remove();
    this.items.delete(id);
    return this;
  }

  update(): void {
    const now = performance.now();
    if (now - this.lastRefreshAt < this.refreshIntervalMs) return;
    this.lastRefreshAt = now;

    for (const item of this.items.values()) this.refreshItem(item);
  }

  dispose(): void {
    for (const item of this.items.values()) item.element.remove();
    this.items.clear();
    document.documentElement.style.removeProperty(STATUS_BAR_HEIGHT_VARIABLE);
    this.element.remove();
  }

  private refreshItem(item: StatusItem): void {
    const read = this.readItem(item);

    // An adornment is content in its own right, so an icon-only segment stays
    // put while its value is empty; a bare value segment collapses away.
    const isVisible = Boolean(read.text) || Boolean(item.options.adornment);

    if (read.text !== item.lastText) {
      item.lastText = read.text;
      item.valueElement.textContent = read.text;
      item.element.style.display = isVisible ? "" : "none";
    }

    if (!isVisible) return;

    if (read.tone !== item.lastTone) {
      if (item.lastTone)
        item.element.classList.remove(TONE_CLASSES[item.lastTone]);
      item.element.classList.add(TONE_CLASSES[read.tone]);
      item.lastTone = read.tone;
    }

    if (read.title !== item.lastTitle) {
      item.lastTitle = read.title;
      if (read.title) item.element.title = read.title;
      else item.element.removeAttribute("title");
    }

    if (item.dotElement) this.refreshDot(item);
    if (item.sparkCanvas) this.refreshSpark(item);
  }

  private readItem(item: StatusItem): {
    text: string;
    tone: Tone;
    title: string;
  } {
    try {
      return {
        text: item.options.get(),
        tone: item.options.tone?.() ?? "neutral",
        title: item.options.title?.() ?? "",
      };
    } catch (error) {
      // A thrown getter must stay visible rather than blanking the segment,
      // which would read as "nothing to report".
      return { text: "!", tone: "error", title: (error as Error).message };
    }
  }

  private refreshDot(item: StatusItem): void {
    const adornment = item.options.adornment;
    if (!item.dotElement || adornment?.kind !== "dot") return;
    const tone = adornment.tone();
    if (tone === item.lastDotTone) return;
    if (item.lastDotTone) {
      item.dotElement.classList.remove(TONE_CLASSES[item.lastDotTone]);
    }
    item.dotElement.classList.add(TONE_CLASSES[tone]);
    item.lastDotTone = tone;
  }

  private refreshSpark(item: StatusItem): void {
    if (!item.sparkCanvas) return;
    if (item.lastSparkRevision === this.sampler.revision) return;
    item.lastSparkRevision = this.sampler.revision;
    drawFrameGraph(
      item.sparkCanvas,
      this.sampler.frames,
      this.sampler.historySize,
      this.frameThresholds,
    );
  }
}
