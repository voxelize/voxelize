import { createElement } from "../dom";

import { Controller, type ControllerOptions } from "./base";

export type TextControllerOptions = ControllerOptions<string> & {
  placeholder?: string;
  multiline?: boolean;
};

export class TextController extends Controller<string> {
  private input: HTMLInputElement | HTMLTextAreaElement;

  constructor(options: TextControllerOptions) {
    super(options);

    const wrapper = createElement("div", {
      className: "vxd-text",
      parent: this.fieldElement,
    });

    if (options.multiline) {
      const textarea = createElement("textarea", {
        className: "vxd-text-input",
        parent: wrapper,
      });
      if (options.placeholder) textarea.placeholder = options.placeholder;
      this.input = textarea;
    } else {
      const input = createElement("input", {
        className: "vxd-text-input",
        attrs: { type: "text", spellcheck: "false", autocomplete: "off" },
        parent: wrapper,
      });
      if (options.placeholder) input.placeholder = options.placeholder;
      this.input = input;
    }

    this.input.addEventListener("change", () => {
      this.setValue(this.input.value);
    });

    this.initialize();
  }

  protected applyToDom(): void {
    if (this.input.value !== this.value) this.input.value = this.value;
  }
}
