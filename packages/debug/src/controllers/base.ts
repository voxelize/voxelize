import { createElement } from "../dom";
import type { DebugStorage } from "../storage";

export type StorageScope = {
  storage: DebugStorage;
  basePath: string;
};

export type ControllerOptions<T> = {
  key?: string;
  label: string;
  default: T;
  onChange?: (value: T) => void;
  storage?: StorageScope;
  description?: string;
};

export abstract class Controller<T> {
  readonly element: HTMLElement;

  protected labelElement: HTMLElement;
  protected fieldElement: HTMLElement;
  protected value: T;

  private readonly options: ControllerOptions<T>;

  constructor(options: ControllerOptions<T>) {
    this.options = options;

    this.element = createElement("div", {
      className: "vxd-row",
    });

    this.labelElement = createElement("div", {
      className: "vxd-row-label",
      text: options.label,
      title: options.description,
      parent: this.element,
    });

    this.fieldElement = createElement("div", {
      className: "vxd-row-field",
      parent: this.element,
    });

    this.value = this.loadInitial();
  }

  getValue(): T {
    return this.value;
  }

  setValue(
    next: T,
    options: { silent?: boolean; persist?: boolean } = {},
  ): void {
    if (this.equals(next, this.value)) return;
    this.value = next;
    this.applyToDom();
    if (options.persist !== false) this.persist();
    if (!options.silent) this.options.onChange?.(next);
  }

  setDisabled(disabled: boolean): void {
    if (disabled) this.element.classList.add("vxd-disabled");
    else this.element.classList.remove("vxd-disabled");
  }

  dispose(): void {
    this.element.remove();
  }

  protected fire(value: T): void {
    this.options.onChange?.(value);
  }

  protected persist(): void {
    if (!this.options.key || !this.options.storage) return;
    const path = `${this.options.storage.basePath}.${this.options.key}`;
    this.options.storage.storage.set(path, this.value as never);
  }

  protected initialize(): void {
    this.applyToDom();
    this.fire(this.value);
  }

  protected equals(a: T, b: T): boolean {
    return a === b;
  }

  protected abstract applyToDom(): void;

  private loadInitial(): T {
    if (!this.options.key || !this.options.storage) return this.options.default;
    const path = `${this.options.storage.basePath}.${this.options.key}`;
    const stored = this.options.storage.storage.get(path);
    if (stored === undefined) return this.options.default;
    return stored as unknown as T;
  }
}
