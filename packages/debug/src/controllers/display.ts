import { createElement } from "../dom";

export type DisplayOptions = {
  label: string;
  value: string | (() => string);
  description?: string;
};

export class DisplayController {
  readonly element: HTMLElement;

  private valueElement: HTMLElement;
  private readonly getter: (() => string) | null;
  private lastText = "";

  constructor(options: DisplayOptions) {
    this.element = createElement("div", {
      className: "vxd-row vxd-row-display",
      title: options.description,
    });

    createElement("div", {
      className: "vxd-row-label",
      text: options.label,
      parent: this.element,
    });

    this.valueElement = createElement("div", {
      className: "vxd-row-value",
      parent: this.element,
    });

    if (typeof options.value === "function") {
      this.getter = options.value;
      this.update();
    } else {
      this.getter = null;
      this.valueElement.textContent = options.value;
      this.lastText = options.value;
    }
  }

  update(): void {
    if (!this.getter) return;
    let text = "";
    try {
      text = this.getter();
    } catch (error) {
      text = `err: ${(error as Error).message}`;
    }
    if (text !== this.lastText) {
      this.valueElement.textContent = text;
      this.lastText = text;
    }
  }

  dispose(): void {
    this.element.remove();
  }
}
