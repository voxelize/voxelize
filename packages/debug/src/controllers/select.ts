import { createElement } from "../dom";

import { Controller, type ControllerOptions } from "./base";

export type SelectOption<T extends string> = {
  value: T;
  label?: string;
};

export type SelectControllerOptions<T extends string> = ControllerOptions<T> & {
  options: readonly T[] | readonly SelectOption<T>[];
};

export class SelectController<T extends string> extends Controller<T> {
  private select: HTMLSelectElement;
  private options: SelectOption<T>[];

  constructor(options: SelectControllerOptions<T>) {
    super(options);

    this.options = options.options.map((entry) =>
      typeof entry === "string" ? { value: entry } : entry,
    );

    const wrapper = createElement("div", {
      className: "vxd-select",
      parent: this.fieldElement,
    });

    this.select = createElement("select", {
      className: "vxd-select-input",
      parent: wrapper,
    });

    for (const option of this.options) {
      const opt = createElement("option", {
        text: option.label ?? option.value,
        parent: this.select,
      });
      opt.value = option.value;
    }

    createElement("span", {
      className: "vxd-select-chevron",
      parent: wrapper,
    });

    this.select.addEventListener("change", () => {
      this.setValue(this.select.value as T);
    });

    this.initialize();
  }

  protected applyToDom(): void {
    if (this.select.value !== this.value) {
      this.select.value = this.value;
    }
  }
}
