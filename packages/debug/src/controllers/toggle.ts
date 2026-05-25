import { createElement } from "../dom";

import { Controller, type ControllerOptions } from "./base";

export type ToggleControllerOptions = ControllerOptions<boolean>;

export class ToggleController extends Controller<boolean> {
  private input: HTMLInputElement;
  private track: HTMLElement;

  constructor(options: ToggleControllerOptions) {
    super(options);

    const wrapper = createElement("label", {
      className: "vxd-toggle",
      parent: this.fieldElement,
    });

    this.input = createElement("input", {
      className: "vxd-toggle-input",
      attrs: { type: "checkbox" },
      parent: wrapper,
    });

    this.track = createElement("span", {
      className: "vxd-toggle-track",
      parent: wrapper,
    });
    createElement("span", {
      className: "vxd-toggle-thumb",
      parent: this.track,
    });

    this.input.addEventListener("change", () => {
      this.setValue(this.input.checked);
    });

    this.initialize();
  }

  protected applyToDom(): void {
    this.input.checked = this.value;
    if (this.value) this.track.classList.add("vxd-toggle-on");
    else this.track.classList.remove("vxd-toggle-on");
  }
}
