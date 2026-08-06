import { createElement, isInteractiveTarget } from "./dom";
import { FrameSampler } from "./frame-sampler";
import { LogPane } from "./log-pane";
import { Logger } from "./logger";
import { StatusBar } from "./status-bar";
import { DebugStorage, type StorageScope } from "./storage";

export const STATUS_BAR_INSET_VARIABLE = "--vxd-statusbar-inset";

export type DebugUIOptions = {
  parent?: HTMLElement;
  namespace?: string;
  hotkey?: string;
  showLogs?: boolean;
  showStatusBar?: boolean;
  visibleByDefault?: boolean;
  legacyStorageKeys?: string[];
  logger?: Logger;
  statusBarHeightPx?: number;
};

export class DebugUI {
  readonly storage: DebugStorage;
  readonly logger: Logger;
  readonly sampler: FrameSampler;
  readonly logs: LogPane;
  readonly statusBar: StatusBar;

  readonly element: HTMLDivElement;

  private readonly storageScope: StorageScope;
  private readonly parent: HTMLElement;
  private readonly visiblePath = "ui.visible";
  private readonly isStatusBarMounted: boolean;
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
    this.sampler = new FrameSampler();

    this.parent = options.parent ?? document.body;

    const existing = document.getElementById(`${namespace}-debug-root`);
    if (existing) existing.remove();

    this.element = createElement("div", {
      className: "vxd-root",
      id: `${namespace}-debug-root`,
    }) as HTMLDivElement;

    const rightColumn = createElement("div", {
      className: "vxd-column vxd-column-right",
      parent: this.element,
    });

    this.logs = new LogPane({
      logger: this.logger,
      storage: this.storageScope,
    });
    if (options.showLogs !== false) rightColumn.appendChild(this.logs.element);

    this.statusBar = new StatusBar({
      sampler: this.sampler,
      heightPx: options.statusBarHeightPx,
    });
    this.isStatusBarMounted = options.showStatusBar !== false;
    if (this.isStatusBarMounted) {
      this.element.appendChild(this.statusBar.element);
    }

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
    this.sampler.update();
    if (!this.isVisible) return;
    this.statusBar.update();
  }

  dispose(): void {
    if (this.hotkeyHandler) {
      window.removeEventListener("keydown", this.hotkeyHandler);
      this.hotkeyHandler = null;
    }
    this.publishStatusBarInset(false);
    this.logs.dispose();
    this.statusBar.dispose();
    this.storage.flush();
    this.element.remove();
  }

  private applyVisibility(): void {
    if (this.isVisible) this.element.classList.add("vxd-visible");
    else this.element.classList.remove("vxd-visible");
    this.publishStatusBarInset(this.isVisible);
  }

  private publishStatusBarInset(visible: boolean): void {
    // Host HUDs anchor to this so nothing sits underneath the bar. Published
    // during construction too, from the persisted visibility, so a reload with
    // the bar already on lays out right on the first paint instead of jumping.
    const inset =
      visible && this.isStatusBarMounted
        ? `${this.statusBar.heightPx}px`
        : "0px";
    document.documentElement.style.setProperty(
      STATUS_BAR_INSET_VARIABLE,
      inset,
    );
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
