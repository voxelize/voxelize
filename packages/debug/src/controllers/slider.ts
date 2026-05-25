import { clamp, createElement, isInteractiveTarget, round } from "../dom";

import { Controller, type ControllerOptions } from "./base";

export type SliderControllerOptions = ControllerOptions<number> & {
  min: number;
  max: number;
  step?: number;
  formatValue?: (value: number) => string;
};

export class SliderController extends Controller<number> {
  private readonly min: number;
  private readonly max: number;
  private readonly step: number;
  private readonly formatValue: (value: number) => string;

  private track: HTMLElement;
  private fill: HTMLElement;
  private thumb: HTMLElement;
  private input: HTMLInputElement;
  private dragPointerId: number | null = null;

  constructor(options: SliderControllerOptions) {
    super(options);

    this.min = options.min;
    this.max = options.max;
    this.step = options.step ?? 1;
    this.formatValue = options.formatValue ?? ((v) => this.defaultFormat(v));

    const wrapper = createElement("div", {
      className: "vxd-slider",
      parent: this.fieldElement,
    });

    this.track = createElement("div", {
      className: "vxd-slider-track",
      parent: wrapper,
    });
    this.fill = createElement("div", {
      className: "vxd-slider-fill",
      parent: this.track,
    });
    this.thumb = createElement("div", {
      className: "vxd-slider-thumb",
      parent: this.track,
    });

    this.input = createElement("input", {
      className: "vxd-slider-input",
      attrs: {
        type: "text",
        inputmode: "decimal",
        spellcheck: "false",
        autocomplete: "off",
      },
      parent: wrapper,
    });

    this.track.addEventListener("pointerdown", this.onTrackPointerDown);
    this.track.addEventListener("pointermove", this.onTrackPointerMove);
    this.track.addEventListener("pointerup", this.onTrackPointerUp);
    this.track.addEventListener("pointercancel", this.onTrackPointerUp);
    this.input.addEventListener("change", this.onInputChange);
    this.input.addEventListener("keydown", this.onInputKeyDown);

    this.initialize();
  }

  protected equals(a: number, b: number): boolean {
    return Math.abs(a - b) < 1e-9;
  }

  protected applyToDom(): void {
    const ratio = (this.value - this.min) / (this.max - this.min);
    const clamped = clamp(ratio, 0, 1);
    this.fill.style.width = `${clamped * 100}%`;
    this.thumb.style.left = `${clamped * 100}%`;
    if (document.activeElement !== this.input) {
      this.input.value = this.formatValue(this.value);
    }
  }

  private onTrackPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    if (isInteractiveTarget(event.target)) return;
    this.dragPointerId = event.pointerId;
    this.track.setPointerCapture(event.pointerId);
    this.updateFromPointer(event);
    event.preventDefault();
  };

  private onTrackPointerMove = (event: PointerEvent): void => {
    if (this.dragPointerId !== event.pointerId) return;
    this.updateFromPointer(event);
  };

  private onTrackPointerUp = (event: PointerEvent): void => {
    if (this.dragPointerId !== event.pointerId) return;
    try {
      this.track.releasePointerCapture(event.pointerId);
    } catch {
      // ignore: capture may have been lost already
    }
    this.dragPointerId = null;
  };

  private onInputChange = (): void => {
    const parsed = Number(this.input.value);
    if (Number.isNaN(parsed)) {
      this.input.value = this.formatValue(this.value);
      return;
    }
    const next = clamp(round(parsed, this.step), this.min, this.max);
    this.setValue(next);
  };

  private onInputKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Enter") {
      this.onInputChange();
      this.input.blur();
    }
  };

  private updateFromPointer(event: PointerEvent): void {
    const rect = this.track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const raw = this.min + ratio * (this.max - this.min);
    this.setValue(clamp(round(raw, this.step), this.min, this.max));
  }

  private defaultFormat(value: number): string {
    if (this.step >= 1) return String(Math.round(value));
    const digits = Math.max(0, Math.min(4, Math.ceil(-Math.log10(this.step))));
    return value.toFixed(digits);
  }
}
