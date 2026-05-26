import { applyStyles, createElement, type StyleDecl } from "./dom";
import { FpsMeter } from "./fps-meter";

export type DebugOptions = {
  stats?: boolean;
  onByDefault?: boolean;
  containerId?: string;
  dataClass?: string;
  entriesClass?: string;
  lineClass?: string;
  dataStyles?: StyleDecl;
  entriesStyles?: StyleDecl;
  lineStyles?: StyleDecl;
  newLineStyles?: StyleDecl;
  statsStyles?: StyleDecl;
  showVoxelize?: boolean;
  asyncPeriod?: number;
};

type DataEntry = {
  element: HTMLParagraphElement;
  labelElement?: HTMLSpanElement;
  valueElement?: HTMLSpanElement;
  source?: () => unknown;
  formatter: (value: unknown) => string;
  title: string;
  lastText: string;
};

const defaultOptions: Required<
  Omit<
    DebugOptions,
    | "dataStyles"
    | "entriesStyles"
    | "lineStyles"
    | "newLineStyles"
    | "statsStyles"
  >
> & {
  dataStyles: StyleDecl;
  entriesStyles: StyleDecl;
  lineStyles: StyleDecl;
  newLineStyles: StyleDecl;
  statsStyles: StyleDecl;
} = {
  stats: true,
  onByDefault: true,
  containerId: "voxelize-debug",
  dataClass: "debug-data",
  entriesClass: "debug-entries",
  lineClass: "debug-line",
  dataStyles: {},
  entriesStyles: {},
  lineStyles: {},
  newLineStyles: {},
  statsStyles: {},
  showVoxelize: true,
  asyncPeriod: 1000,
};

const defaultFormatter = (value: unknown): string => {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(2);
  }
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
};

/**
 * Backward-compatible Debug class.
 *
 * @deprecated Prefer `DebugUI` from `@voxelize/debug`. This class is kept so
 * existing `@voxelize/core` consumers continue to work unchanged.
 */
export class LegacyDebug {
  visible = true;
  public options: typeof defaultOptions;
  public dataWrapper: HTMLDivElement;
  public entriesWrapper: HTMLDivElement;
  public domElement: HTMLElement;
  public stats?: FpsMeter;

  private entries: DataEntry[] = [];

  constructor(
    domElement: HTMLElement = document.body,
    options: DebugOptions = {},
  ) {
    this.options = {
      ...defaultOptions,
      ...options,
      dataStyles: { ...defaultOptions.dataStyles, ...options.dataStyles },
      entriesStyles: {
        ...defaultOptions.entriesStyles,
        ...options.entriesStyles,
      },
      lineStyles: { ...defaultOptions.lineStyles, ...options.lineStyles },
      newLineStyles: {
        ...defaultOptions.newLineStyles,
        ...options.newLineStyles,
      },
      statsStyles: { ...defaultOptions.statsStyles, ...options.statsStyles },
    };

    this.domElement = domElement;

    this.dataWrapper = createElement("div", {
      className: this.options.dataClass,
      id: this.options.containerId,
      styles: this.options.dataStyles,
    }) as HTMLDivElement;

    this.entriesWrapper = createElement("div", {
      className: this.options.entriesClass,
      styles: this.options.entriesStyles,
      parent: this.dataWrapper,
    }) as HTMLDivElement;

    if (this.options.stats) {
      this.stats = new FpsMeter();
      applyStyles(this.stats.element, {
        marginTop: "6px",
        ...(this.options.statsStyles ?? {}),
      });
      this.dataWrapper.appendChild(this.stats.element);
    }

    if (this.options.showVoxelize) {
      this.displayTitle("Voxelize __VOXELIZE_VERSION__");
      this.displayNewline();
    }

    this.domElement.appendChild(this.dataWrapper);
    this.toggle(this.options.onByDefault);
  }

  registerDisplay = <T = unknown>(
    title: string,
    object?: T | (() => unknown),
    attribute?: keyof T,
    formatter: (value: unknown) => string = defaultFormatter,
  ): this => {
    const entry = this.makeEntry(title);

    let getter: (() => unknown) | undefined;
    if (typeof object === "function") {
      getter = object as () => unknown;
    } else if (
      object !== undefined &&
      object !== null &&
      attribute !== undefined
    ) {
      const target = object as Record<string, unknown>;
      const key = attribute as string;
      getter = () => target[key];
    } else if (object !== undefined && object !== null) {
      getter = () => object as unknown;
    }

    entry.source = getter;
    entry.formatter = formatter;
    return this;
  };

  removeDisplay = (title: string): void => {
    const index = this.entries.findIndex((entry) => entry.title === title);
    if (index < 0) return;
    const [removed] = this.entries.splice(index, 1);
    removed.element.remove();
  };

  displayTitle = (title: string): this => {
    const line = this.makeLine(true);
    line.textContent = title;
    line.classList.add("debug-section-title");
    this.entriesWrapper.insertBefore(line, this.entriesWrapper.firstChild);
    return this;
  };

  displayNewline = (): this => {
    const line = this.makeLine(true);
    this.entriesWrapper.insertBefore(line, this.entriesWrapper.firstChild);
    return this;
  };

  toggle = (force: boolean | null = null): void => {
    this.visible = force !== null ? force : !this.visible;
    const visibility = this.visible ? "visible" : "hidden";
    this.dataWrapper.style.visibility = visibility;
  };

  update = (): void => {
    requestAnimationFrame(() => {
      for (const entry of this.entries) {
        if (!entry.source) continue;
        let value: unknown = "";
        try {
          value = entry.source();
        } catch (error) {
          value = `error: ${(error as Error).message}`;
        }
        const formatted = entry.formatter(value);
        if (entry.labelElement && entry.valueElement) {
          if (entry.valueElement.textContent !== formatted) {
            entry.valueElement.textContent = formatted;
          }
        } else {
          const wholeString = entry.title
            ? `${entry.title}: ${formatted}`
            : formatted;
          if (entry.element.textContent !== wholeString) {
            entry.element.textContent = wholeString;
          }
        }
        entry.lastText = formatted;
      }
    });
    this.stats?.update();
  };

  dispose = (): void => {
    this.dataWrapper.remove();
    this.entries = [];
  };

  remove = (): void => {
    this.dispose();
  };

  private makeEntry(title: string): DataEntry {
    const line = this.makeLine(false);
    const labelElement = createElement("span", {
      className: "debug-label",
      text: `${title}: `,
      parent: line,
    });
    const valueElement = createElement("span", {
      className: "debug-value",
      parent: line,
    });

    const entry: DataEntry = {
      element: line,
      labelElement,
      valueElement,
      title,
      formatter: defaultFormatter,
      lastText: "",
    };
    this.entries.push(entry);
    this.entriesWrapper.insertBefore(line, this.entriesWrapper.firstChild);
    return entry;
  }

  private makeLine(isNewline: boolean): HTMLParagraphElement {
    const line = createElement("p", {
      className: this.options.lineClass,
      styles: {
        ...(isNewline ? { height: "10px", ...this.options.newLineStyles } : {}),
        ...this.options.lineStyles,
      },
    });
    return line;
  }
}
