import type { StorageScope } from "./controllers";
import { createElement } from "./dom";
import type { LogEntry, LogLevel, Logger } from "./logger";

const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

type Filters = {
  levels: Record<LogLevel, boolean>;
  search: string;
};

const DEFAULT_FILTERS: Filters = {
  levels: { debug: true, info: true, warn: true, error: true },
  search: "",
};

export type LogPaneOptions = {
  logger: Logger;
  storage: StorageScope;
};

export class LogPane {
  readonly element: HTMLDivElement;

  private readonly logger: Logger;
  private readonly storage: StorageScope;
  private readonly bodyElement: HTMLDivElement;
  private readonly listElement: HTMLDivElement;
  private readonly searchInput: HTMLInputElement;
  private readonly levelButtons = new Map<LogLevel, HTMLButtonElement>();
  private readonly pauseButton: HTMLButtonElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly badgeElement: HTMLSpanElement;
  private readonly headerTitle: HTMLElement;
  private filters: Filters;
  private rows = new Map<number, HTMLElement>();
  private unsubscribe: (() => void) | null = null;
  private isCollapsed: boolean;
  private autoScroll = true;
  private unreadCount = 0;

  constructor(options: LogPaneOptions) {
    this.logger = options.logger;
    this.storage = options.storage;
    this.filters = this.loadFilters();

    this.element = createElement("div", {
      className: "vxd-logs",
    }) as HTMLDivElement;

    const header = createElement("div", {
      className: "vxd-logs-header",
      parent: this.element,
    });

    this.headerTitle = createElement("span", {
      className: "vxd-logs-title",
      text: "Logs",
      parent: header,
    });

    this.badgeElement = createElement("span", {
      className: "vxd-logs-badge",
      parent: header,
    });

    const collapseButton = createElement("button", {
      className: "vxd-logs-collapse",
      attrs: { type: "button" },
      text: "−",
      parent: header,
    });

    this.bodyElement = createElement("div", {
      className: "vxd-logs-body",
      parent: this.element,
    }) as HTMLDivElement;

    const toolbar = createElement("div", {
      className: "vxd-logs-toolbar",
      parent: this.bodyElement,
    });

    for (const level of LEVELS) {
      const button = createElement("button", {
        className: `vxd-logs-level vxd-logs-level-${level}`,
        attrs: { type: "button" },
        text: level,
        parent: toolbar,
      });
      button.addEventListener("click", () => {
        this.filters.levels[level] = !this.filters.levels[level];
        this.applyLevelButtonState(level);
        this.persistFilters();
        this.rerender();
      });
      this.levelButtons.set(level, button);
      this.applyLevelButtonState(level);
    }

    this.searchInput = createElement("input", {
      className: "vxd-logs-search",
      attrs: {
        type: "text",
        placeholder: "filter…",
        spellcheck: "false",
        autocomplete: "off",
      },
      parent: toolbar,
    });
    this.searchInput.value = this.filters.search;
    this.searchInput.addEventListener("input", () => {
      this.filters.search = this.searchInput.value;
      this.persistFilters();
      this.rerender();
    });

    this.pauseButton = createElement("button", {
      className: "vxd-logs-action",
      attrs: { type: "button", title: "Pause logging" },
      text: "pause",
      parent: toolbar,
    });
    this.pauseButton.addEventListener("click", () => {
      const next = !this.logger.isPaused();
      this.logger.setPaused(next);
      this.pauseButton.textContent = next ? "resume" : "pause";
      if (next) this.pauseButton.classList.add("vxd-logs-action-active");
      else this.pauseButton.classList.remove("vxd-logs-action-active");
    });

    this.clearButton = createElement("button", {
      className: "vxd-logs-action",
      attrs: { type: "button", title: "Clear log buffer" },
      text: "clear",
      parent: toolbar,
    });
    this.clearButton.addEventListener("click", () => {
      this.logger.clear();
      this.listElement.innerHTML = "";
      this.rows.clear();
    });

    this.listElement = createElement("div", {
      className: "vxd-logs-list",
      parent: this.bodyElement,
    }) as HTMLDivElement;

    this.listElement.addEventListener("scroll", () => {
      const distanceFromBottom =
        this.listElement.scrollHeight -
        this.listElement.scrollTop -
        this.listElement.clientHeight;
      this.autoScroll = distanceFromBottom < 24;
    });

    const stored = this.storage.storage.get("ui.logs.collapsed");
    this.isCollapsed = typeof stored === "boolean" ? stored : true;
    this.applyCollapsed();

    collapseButton.addEventListener("click", () => {
      this.setCollapsed(!this.isCollapsed);
    });

    header.addEventListener("click", (event) => {
      if (event.target === collapseButton) return;
      if ((event.target as HTMLElement).closest(".vxd-logs-collapse")) return;
      this.setCollapsed(!this.isCollapsed);
    });

    for (const entry of this.logger.snapshot()) this.appendRow(entry);
    this.scrollToBottom();

    this.unsubscribe = this.logger.subscribe((entry) => {
      if (entry.id === -1 && entry.message === "__cleared__") {
        this.listElement.innerHTML = "";
        this.rows.clear();
        return;
      }
      this.appendRow(entry);
      if (this.autoScroll && !this.isCollapsed) this.scrollToBottom();
      if (
        this.isCollapsed &&
        (entry.level === "warn" || entry.level === "error")
      ) {
        this.unreadCount += 1;
        this.refreshBadge();
      }
    });
  }

  setCollapsed(collapsed: boolean): void {
    if (this.isCollapsed === collapsed) return;
    this.isCollapsed = collapsed;
    this.applyCollapsed();
    this.storage.storage.set("ui.logs.collapsed", collapsed);
    if (!collapsed) {
      this.unreadCount = 0;
      this.refreshBadge();
      this.scrollToBottom();
    }
  }

  setTitle(title: string): void {
    this.headerTitle.textContent = title;
  }

  dispose(): void {
    this.unsubscribe?.();
    this.element.remove();
    this.rows.clear();
  }

  private appendRow(entry: LogEntry): void {
    if (!this.matchesFilters(entry)) return;
    const row = this.renderRow(entry);
    this.listElement.appendChild(row);
    this.rows.set(entry.id, row);
    this.trim();
  }

  private renderRow(entry: LogEntry): HTMLElement {
    const row = createElement("div", {
      className: `vxd-log vxd-log-${entry.level}`,
      attrs: { "data-id": String(entry.id) },
    });
    createElement("span", {
      className: "vxd-log-time",
      text: formatTime(entry.at),
      parent: row,
    });
    createElement("span", {
      className: `vxd-log-level vxd-log-level-${entry.level}`,
      text: entry.level,
      parent: row,
    });
    if (entry.source) {
      createElement("span", {
        className: "vxd-log-source",
        text: entry.source,
        parent: row,
      });
    }
    createElement("span", {
      className: "vxd-log-message",
      text: entry.message,
      parent: row,
    });
    if (entry.data !== undefined) {
      const payload = formatPayload(entry.data);
      if (payload) {
        createElement("span", {
          className: "vxd-log-data",
          text: payload,
          parent: row,
        });
      }
    }
    return row;
  }

  private matchesFilters(entry: LogEntry): boolean {
    if (!this.filters.levels[entry.level]) return false;
    if (!this.filters.search) return true;
    const needle = this.filters.search.toLowerCase();
    return (
      entry.message.toLowerCase().includes(needle) ||
      entry.source.toLowerCase().includes(needle)
    );
  }

  private rerender(): void {
    this.listElement.innerHTML = "";
    this.rows.clear();
    for (const entry of this.logger.snapshot()) this.appendRow(entry);
    if (this.autoScroll) this.scrollToBottom();
  }

  private trim(): void {
    const max = 500;
    while (this.listElement.childNodes.length > max) {
      const first = this.listElement.firstChild;
      if (!first) break;
      this.listElement.removeChild(first);
    }
  }

  private scrollToBottom(): void {
    this.listElement.scrollTop = this.listElement.scrollHeight;
  }

  private applyLevelButtonState(level: LogLevel): void {
    const button = this.levelButtons.get(level);
    if (!button) return;
    if (this.filters.levels[level]) button.classList.add("vxd-logs-level-on");
    else button.classList.remove("vxd-logs-level-on");
  }

  private applyCollapsed(): void {
    if (this.isCollapsed) this.element.classList.add("vxd-logs-collapsed");
    else this.element.classList.remove("vxd-logs-collapsed");
  }

  private refreshBadge(): void {
    if (this.unreadCount > 0) {
      this.badgeElement.textContent = String(this.unreadCount);
      this.badgeElement.classList.add("vxd-logs-badge-visible");
    } else {
      this.badgeElement.textContent = "";
      this.badgeElement.classList.remove("vxd-logs-badge-visible");
    }
  }

  private loadFilters(): Filters {
    const stored = this.storage.storage.get("ui.logs.filters");
    if (
      stored &&
      typeof stored === "object" &&
      !Array.isArray(stored) &&
      "levels" in (stored as Record<string, unknown>)
    ) {
      const raw = stored as Record<string, unknown>;
      const levels: Record<LogLevel, boolean> = { ...DEFAULT_FILTERS.levels };
      if (
        raw.levels &&
        typeof raw.levels === "object" &&
        !Array.isArray(raw.levels)
      ) {
        for (const level of LEVELS) {
          const value = (raw.levels as Record<string, unknown>)[level];
          if (typeof value === "boolean") levels[level] = value;
        }
      }
      const search = typeof raw.search === "string" ? raw.search : "";
      return { levels, search };
    }
    return { levels: { ...DEFAULT_FILTERS.levels }, search: "" };
  }

  private persistFilters(): void {
    this.storage.storage.set("ui.logs.filters", {
      levels: this.filters.levels,
      search: this.filters.search,
    });
  }
}

const formatTime = (at: number): string => {
  const date = new Date(at);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const millis = String(date.getMilliseconds()).padStart(3, "0");
  return `${hours}:${minutes}:${seconds}.${millis}`;
};

const formatPayload = (data: unknown): string => {
  if (data === undefined || data === null) return "";
  if (typeof data === "string") return data;
  try {
    const text = JSON.stringify(data);
    if (!text || text === "{}") return "";
    if (text.length > 200) return `${text.slice(0, 197)}…`;
    return text;
  } catch {
    return "";
  }
};
