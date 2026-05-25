import { createElement } from "./dom";
import { FpsMeter } from "./fps-meter";

type RowGetter = () => unknown;

type RowFormatter = (value: unknown) => string;

type Row = {
  element: HTMLElement;
  valueElement: HTMLElement;
  get: RowGetter;
  formatter: RowFormatter;
  lastText: string;
};

type Section = {
  element: HTMLElement;
  titleElement: HTMLElement | null;
  rowsElement: HTMLElement;
  rows: Map<string, Row>;
};

const defaultFormatter: RowFormatter = (value) => {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(2);
  }
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

export class StatsPanel {
  readonly element: HTMLDivElement;

  private sections = new Map<string, Section>();
  private fpsMeter: FpsMeter;
  private fpsMounted = false;
  private currentSection: Section;

  constructor() {
    this.element = createElement("div", {
      className: "vxd-stats",
    });

    this.fpsMeter = new FpsMeter();

    this.currentSection = this.createSection("__default__", null);
  }

  section(title: string): this {
    const id = title.toLowerCase().replace(/\s+/g, "-");
    let section = this.sections.get(id);
    if (!section) section = this.createSection(id, title);
    this.currentSection = section;
    return this;
  }

  row(label: string, getter?: RowGetter, formatter?: RowFormatter): this {
    if (label === "FPS" && !getter) {
      this.mountFps();
      return this;
    }

    const section = this.currentSection;
    const existing = section.rows.get(label);
    if (existing) return this;

    const rowEl = createElement("div", {
      className: "vxd-stats-row",
      parent: section.rowsElement,
    });
    createElement("span", {
      className: "vxd-stats-label",
      text: label,
      parent: rowEl,
    });
    const valueEl = createElement("span", {
      className: "vxd-stats-value",
      text: "-",
      parent: rowEl,
    });

    section.rows.set(label, {
      element: rowEl,
      valueElement: valueEl,
      get: getter ?? (() => ""),
      formatter: formatter ?? defaultFormatter,
      lastText: "-",
    });
    return this;
  }

  remove(label: string): this {
    for (const section of this.sections.values()) {
      const row = section.rows.get(label);
      if (row) {
        row.element.remove();
        section.rows.delete(label);
      }
    }
    return this;
  }

  update(): void {
    if (this.fpsMounted) this.fpsMeter.update();

    if (!this.element.isConnected || this.element.style.display === "none")
      return;

    for (const section of this.sections.values()) {
      for (const row of section.rows.values()) {
        let value: unknown;
        try {
          value = row.get();
        } catch (error) {
          value = `error: ${(error as Error).message}`;
        }
        const text = row.formatter(value);
        if (text !== row.lastText) {
          row.valueElement.textContent = text;
          row.lastText = text;
        }
      }
    }
  }

  dispose(): void {
    this.fpsMeter.dispose();
    this.element.remove();
  }

  private createSection(id: string, title: string | null): Section {
    const sectionEl = createElement("div", {
      className: "vxd-stats-section",
      parent: this.element,
    });
    let titleEl: HTMLElement | null = null;
    if (title) {
      titleEl = createElement("div", {
        className: "vxd-stats-section-title",
        text: title,
        parent: sectionEl,
      });
    }
    const rowsEl = createElement("div", {
      className: "vxd-stats-rows",
      parent: sectionEl,
    });
    const section: Section = {
      element: sectionEl,
      titleElement: titleEl,
      rowsElement: rowsEl,
      rows: new Map(),
    };
    this.sections.set(id, section);
    return section;
  }

  private mountFps(): void {
    if (this.fpsMounted) return;
    this.currentSection.rowsElement.appendChild(this.fpsMeter.element);
    this.fpsMounted = true;
  }
}
