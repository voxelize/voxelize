import { createElement } from "../dom";

export type ButtonOptions = {
  label: string;
  onClick: () => void;
  description?: string;
  variant?: "default" | "danger" | "success";
};

export class ButtonController {
  readonly element: HTMLElement;

  private button: HTMLButtonElement;

  constructor(options: ButtonOptions) {
    this.element = createElement("div", {
      className: "vxd-row vxd-row-action",
    });

    this.button = createElement("button", {
      className: `vxd-button vxd-button-${options.variant ?? "default"}`,
      text: options.label,
      title: options.description,
      attrs: { type: "button" },
      parent: this.element,
    });

    this.button.addEventListener("click", (event) => {
      event.preventDefault();
      options.onClick();
    });
  }

  setDisabled(disabled: boolean): void {
    this.button.disabled = disabled;
    if (disabled) this.element.classList.add("vxd-disabled");
    else this.element.classList.remove("vxd-disabled");
  }

  dispose(): void {
    this.element.remove();
  }
}
