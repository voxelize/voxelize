import type { StorageScope } from "./controllers";
import { createElement, isInteractiveTarget } from "./dom";
import { LogPane } from "./log-pane";
import { Logger } from "./logger";
import { Pane } from "./pane";
import { StatsPanel } from "./stats-panel";
import { DebugStorage } from "./storage";

export type DebugUIOptions = {
  parent?: HTMLElement;
  namespace?: string;
  hotkey?: string;
  showStats?: boolean;
  showPane?: boolean;
  showLogs?: boolean;
  visibleByDefault?: boolean;
  legacyStorageKeys?: string[];
  paneTitle?: string;
  logger?: Logger;
};

export class DebugUI {
  readonly storage: DebugStorage;
  readonly logger: Logger;
  readonly stats: StatsPanel;
  readonly pane: Pane;
  readonly logs: LogPane;

  readonly element: HTMLDivElement;

  private readonly storageScope: StorageScope;
  private readonly parent: HTMLElement;
  private readonly visiblePath = "ui.visible";
  private isVisible: boolean;
  private hotkeyHandler: ((event: KeyboardEvent) => void) | null = null;

  constructor(options: DebugUIOptions = {}) {
    const namespace = options.namespace ?? "voxelize";
    const storageKey = `${namespace}.debug.v1`;

    this.storage = new DebugStorage({
      key: storageKey,
      legacyKeys: options.legacyStorageKeys ?? [],
    });

    this.storageScope = { storage: this.storage, basePath: "settings" };
    this.logger = options.logger ?? new Logger({ maxEntries: 500 });

    this.parent = options.parent ?? document.body;

    const existing = document.getElementById(`${namespace}-debug-root`);
    if (existing) existing.remove();

    this.element = createElement("div", {
      className: "vxd-root",
      id: `${namespace}-debug-root`,
    }) as HTMLDivElement;

    const leftColumn = createElement("div", {
      className: "vxd-column vxd-column-left",
      parent: this.element,
    });

    const rightColumn = createElement("div", {
      className: "vxd-column vxd-column-right",
      parent: this.element,
    });

    this.stats = new StatsPanel();
    if (options.showStats !== false) leftColumn.appendChild(this.stats.element);

    this.logs = new LogPane({
      logger: this.logger,
      storage: { storage: this.storage, basePath: "settings" },
    });
    if (options.showLogs !== false) rightColumn.appendChild(this.logs.element);

    this.pane = new Pane({
      title: options.paneTitle ?? "Debug",
      storage: this.storageScope,
    });
    if (options.showPane !== false) rightColumn.appendChild(this.pane.element);

    const storedVisible = this.storage.get(this.visiblePath);
    this.isVisible =
      typeof storedVisible === "boolean"
        ? storedVisible
        : options.visibleByDefault ?? false;
    this.applyVisibility();

    this.parent.appendChild(this.element);

    if (options.hotkey) this.bindHotkey(options.hotkey);
  }

  setVisible(visible: boolean): void {
    if (this.isVisible === visible) return;
    this.isVisible = visible;
    this.applyVisibility();
    this.storage.set(this.visiblePath, visible);
  }

  toggleVisibility(): void {
    this.setVisible(!this.isVisible);
  }

  isShown(): boolean {
    return this.isVisible;
  }

  update(): void {
    if (!this.isVisible) {
      this.stats.update();
      return;
    }
    this.stats.update();
    this.pane.update();
  }

  dispose(): void {
    if (this.hotkeyHandler) {
      window.removeEventListener("keydown", this.hotkeyHandler);
      this.hotkeyHandler = null;
    }
    this.stats.dispose();
    this.pane.dispose();
    this.logs.dispose();
    this.storage.flush();
    this.element.remove();
  }

  private applyVisibility(): void {
    if (this.isVisible) this.element.classList.add("vxd-visible");
    else this.element.classList.remove("vxd-visible");
  }

  private bindHotkey(hotkey: string): void {
    this.hotkeyHandler = (event: KeyboardEvent) => {
      if (event.code !== hotkey) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isInteractiveTarget(event.target)) return;
      this.toggleVisibility();
    };
    window.addEventListener("keydown", this.hotkeyHandler);
  }
}
