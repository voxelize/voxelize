import type { StorageScope } from "./controllers";
import { createElement } from "./dom";
import { Folder } from "./folder";

export type PaneOptions = {
  title: string;
  storage: StorageScope;
};

export class Pane {
  readonly element: HTMLDivElement;
  readonly bodyElement: HTMLDivElement;
  private readonly storage: StorageScope;
  private readonly headerTitle: HTMLElement;
  private readonly folders = new Map<string, Folder>();
  private isCollapsed: boolean;

  constructor(options: PaneOptions) {
    this.storage = options.storage;

    this.element = createElement("div", {
      className: "vxd-pane",
    }) as HTMLDivElement;

    const header = createElement("div", {
      className: "vxd-pane-header",
      parent: this.element,
    });

    this.headerTitle = createElement("span", {
      className: "vxd-pane-title",
      text: options.title,
      parent: header,
    });

    const collapseButton = createElement("button", {
      className: "vxd-pane-collapse",
      attrs: { type: "button", "aria-label": "Toggle pane" },
      text: "−",
      parent: header,
    });

    this.bodyElement = createElement("div", {
      className: "vxd-pane-body",
      parent: this.element,
    }) as HTMLDivElement;

    const storedCollapsed = this.storage.storage.get("ui.pane.collapsed");
    this.isCollapsed =
      typeof storedCollapsed === "boolean" ? storedCollapsed : false;
    this.applyCollapsed();

    collapseButton.addEventListener("click", () => {
      this.setCollapsed(!this.isCollapsed);
    });
  }

  folder(title: string, defaultOpen = false): Folder {
    const existing = this.folders.get(title);
    if (existing) return existing;
    const folder = new Folder({
      title,
      defaultOpen,
      storage: this.storage,
    });
    this.bodyElement.appendChild(folder.element);
    this.folders.set(title, folder);
    return folder;
  }

  setTitle(title: string): void {
    this.headerTitle.textContent = title;
  }

  setCollapsed(collapsed: boolean): void {
    if (this.isCollapsed === collapsed) return;
    this.isCollapsed = collapsed;
    this.applyCollapsed();
    this.storage.storage.set("ui.pane.collapsed", collapsed);
  }

  update(): void {
    if (this.isCollapsed) return;
    for (const folder of this.folders.values()) folder.update();
  }

  dispose(): void {
    for (const folder of this.folders.values()) folder.dispose();
    this.folders.clear();
    this.element.remove();
  }

  private applyCollapsed(): void {
    if (this.isCollapsed) this.element.classList.add("vxd-pane-collapsed");
    else this.element.classList.remove("vxd-pane-collapsed");
  }
}
