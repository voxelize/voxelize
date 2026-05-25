import {
  ButtonController,
  type ButtonOptions,
  DisplayController,
  type DisplayOptions,
  SelectController,
  type SelectControllerOptions,
  SliderController,
  type SliderControllerOptions,
  type StorageScope,
  TextController,
  type TextControllerOptions,
  ToggleController,
  type ToggleControllerOptions,
} from "./controllers";
import { createElement } from "./dom";

type FolderChild = {
  element: HTMLElement;
  dispose: () => void;
  update?: () => void;
};

export type FolderOptions = {
  title: string;
  defaultOpen?: boolean;
  storage: StorageScope;
  parentPath?: string;
};

const FOLDER_STATE_PATH = "ui.folders";

export class Folder {
  readonly element: HTMLElement;
  readonly title: string;
  readonly path: string;
  private readonly storage: StorageScope;
  private readonly bodyElement: HTMLElement;
  private readonly toggleElement: HTMLElement;
  private readonly titleElement: HTMLElement;
  private readonly childrenStorage: StorageScope;
  private subFolders = new Map<string, Folder>();
  private children: FolderChild[] = [];
  private isOpen: boolean;

  constructor(options: FolderOptions) {
    this.title = options.title;
    this.path = options.parentPath
      ? `${options.parentPath}.${this.slugify(options.title)}`
      : this.slugify(options.title);
    this.storage = options.storage;
    this.childrenStorage = options.storage;

    this.element = createElement("div", {
      className: "vxd-folder",
      attrs: { "data-folder-path": this.path },
    });

    const header = createElement("div", {
      className: "vxd-folder-header",
      parent: this.element,
    });

    this.toggleElement = createElement("span", {
      className: "vxd-folder-chevron",
      parent: header,
    });

    this.titleElement = createElement("span", {
      className: "vxd-folder-title",
      text: options.title,
      parent: header,
    });

    this.bodyElement = createElement("div", {
      className: "vxd-folder-body",
      parent: this.element,
    });

    const storedState = this.storage.storage.get(
      `${FOLDER_STATE_PATH}.${this.path}`,
    );
    this.isOpen =
      typeof storedState === "boolean"
        ? storedState
        : options.defaultOpen ?? false;
    this.applyOpenState();

    header.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest(".vxd-row, input, button, select, textarea")) return;
      this.setOpen(!this.isOpen);
    });
  }

  setOpen(open: boolean): this {
    if (this.isOpen === open) return this;
    this.isOpen = open;
    this.applyOpenState();
    this.storage.storage.set(`${FOLDER_STATE_PATH}.${this.path}`, open);
    return this;
  }

  isExpanded(): boolean {
    return this.isOpen;
  }

  folder(title: string, defaultOpen = false): Folder {
    const existing = this.subFolders.get(title);
    if (existing) return existing;
    const sub = new Folder({
      title,
      defaultOpen,
      storage: this.childrenStorage,
      parentPath: this.path,
    });
    this.bodyElement.appendChild(sub.element);
    this.subFolders.set(title, sub);
    this.children.push({
      element: sub.element,
      dispose: () => sub.dispose(),
      update: () => sub.update(),
    });
    return sub;
  }

  toggle(options: Omit<ToggleControllerOptions, "storage">): ToggleController {
    const controller = new ToggleController({
      ...options,
      storage: this.controllerStorage(),
    });
    this.bodyElement.appendChild(controller.element);
    this.children.push({
      element: controller.element,
      dispose: () => controller.dispose(),
    });
    return controller;
  }

  slider(options: Omit<SliderControllerOptions, "storage">): SliderController {
    const controller = new SliderController({
      ...options,
      storage: this.controllerStorage(),
    });
    this.bodyElement.appendChild(controller.element);
    this.children.push({
      element: controller.element,
      dispose: () => controller.dispose(),
    });
    return controller;
  }

  select<T extends string>(
    options: Omit<SelectControllerOptions<T>, "storage">,
  ): SelectController<T> {
    const controller = new SelectController<T>({
      ...options,
      storage: this.controllerStorage(),
    });
    this.bodyElement.appendChild(controller.element);
    this.children.push({
      element: controller.element,
      dispose: () => controller.dispose(),
    });
    return controller;
  }

  text(options: Omit<TextControllerOptions, "storage">): TextController {
    const controller = new TextController({
      ...options,
      storage: this.controllerStorage(),
    });
    this.bodyElement.appendChild(controller.element);
    this.children.push({
      element: controller.element,
      dispose: () => controller.dispose(),
    });
    return controller;
  }

  button(options: ButtonOptions): ButtonController {
    const controller = new ButtonController(options);
    this.bodyElement.appendChild(controller.element);
    this.children.push({
      element: controller.element,
      dispose: () => controller.dispose(),
    });
    return controller;
  }

  display(options: DisplayOptions): DisplayController {
    const controller = new DisplayController(options);
    this.bodyElement.appendChild(controller.element);
    this.children.push({
      element: controller.element,
      dispose: () => controller.dispose(),
      update: () => controller.update(),
    });
    return controller;
  }

  divider(label?: string): HTMLElement {
    const divider = createElement("div", {
      className: label ? "vxd-divider vxd-divider-labeled" : "vxd-divider",
      parent: this.bodyElement,
    });
    if (label) {
      createElement("span", { text: label, parent: divider });
    }
    this.children.push({ element: divider, dispose: () => divider.remove() });
    return divider;
  }

  update(): void {
    if (!this.isOpen) return;
    for (const child of this.children) {
      child.update?.();
    }
  }

  dispose(): void {
    for (const child of this.children) child.dispose();
    this.children = [];
    this.subFolders.clear();
    this.element.remove();
  }

  private controllerStorage(): StorageScope {
    return {
      storage: this.storage.storage,
      basePath: `${this.storage.basePath}.${this.path}`,
    };
  }

  private applyOpenState(): void {
    if (this.isOpen) {
      this.element.classList.add("vxd-folder-open");
      this.toggleElement.textContent = "▾";
    } else {
      this.element.classList.remove("vxd-folder-open");
      this.toggleElement.textContent = "▸";
    }
  }

  private slugify(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }
}
