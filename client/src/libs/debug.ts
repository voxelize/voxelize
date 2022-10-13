import { Group } from "three";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { Pane } from "tweakpane";

import { DOMUtils } from "../utils";

export type DebugParams = {
  stats: boolean;
  tweakpane: boolean;
  onByDefault: boolean;
  entryStyles: Partial<CSSStyleDeclaration>;
  entryClass: string;
  lineStyles: Partial<CSSStyleDeclaration>;
  lineClass: string;
  dataStyles: Partial<CSSStyleDeclaration>;
  dataClass: string;
  showTitle: boolean;
};

const defaultParams: DebugParams = {
  stats: true,
  tweakpane: true,
  onByDefault: true,
  entryStyles: {},
  entryClass: "",
  lineStyles: {},
  lineClass: "",
  dataStyles: {},
  dataClass: "",
  showTitle: true,
};

export class Debug extends Group {
  public params: DebugParams;

  public gui?: Pane;
  public stats?: Stats;

  public dataWrapper: HTMLDivElement;
  public entryWrapper: HTMLDivElement;

  private dataEntries: {
    element: HTMLParagraphElement;
    object?: any;
    attribute?: string;
    title: string;
    formatter: (value: any) => string;
  }[] = [];

  constructor(
    public domElement: HTMLElement = document.body,
    params: Partial<DebugParams> = {}
  ) {
    super();

    const { onByDefault } = (this.params = { ...defaultParams, ...params });

    this.makeDOM();
    this.setup();
    this.mount();

    this.toggle(onByDefault);
  }

  registerDisplay = (
    title: string,
    object?: any,
    attribute?: string,
    formatter = (str: string) => str
  ) => {
    const wrapper = this.makeDataEntry();

    const newEntry = {
      title,
      element: wrapper,
      object: object,
      formatter,
      attribute,
    };

    this.dataEntries.push(newEntry);
    this.entryWrapper.insertBefore(wrapper, this.entryWrapper.firstChild);
  };

  removeDisplay = (title: string) => {
    const index = this.dataEntries.findIndex((entry) => entry.title === title);
    const entry = this.dataEntries.splice(index, 1)[0];

    if (entry) {
      this.entryWrapper.removeChild(entry.element);
    }
  };

  displayTitle = (title: string) => {
    const newline = this.makeDataEntry(true);
    newline.textContent = title;
    this.entryWrapper.insertBefore(newline, this.entryWrapper.firstChild);
  };

  displayNewline = () => {
    const newline = this.makeDataEntry(true);
    this.entryWrapper.insertBefore(newline, this.entryWrapper.firstChild);
  };

  toggle = (force = false) => {
    this.visible = force ? true : !this.visible;

    const visibility = this.entryWrapper.style.visibility;
    const newVisibility = force
      ? "visible"
      : visibility === "visible"
      ? "hidden"
      : "visible";

    this.entryWrapper.style.visibility = newVisibility;

    if (this.stats) {
      this.stats.dom.style.visibility = newVisibility;
    }

    if (this.gui?.element) {
      this.gui.element.style.visibility = newVisibility;
    }
  };

  update = () => {
    // loop through all data entries, and get their latest updated values
    for (const { element, title, attribute, object, formatter } of this
      .dataEntries) {
      const newValue = object && attribute ? object[attribute] : "";
      element.textContent = `${title ? `${title}: ` : ""}${formatter(
        newValue
      )}`;
    }

    // fps update
    this.stats?.update();
  };

  private makeDataEntry = (newline = false) => {
    const dataEntry = document.createElement("p");
    if (this.params.lineClass) {
      dataEntry.classList.add(this.params.lineClass);
    }
    DOMUtils.applyStyles(dataEntry, {
      fontSize: "13.3333px",
      margin: "0",
      ...(newline ? { height: "16px" } : {}),
      ...(this.params.lineStyles || {}),
    });
    return dataEntry;
  };

  private makeDOM = () => {
    this.dataWrapper = document.createElement("div");

    if (this.params.dataClass) {
      this.dataWrapper.classList.add(this.params.dataClass);
    }

    this.entryWrapper = document.createElement("div");
    this.entryWrapper.id = "data-wrapper";

    if (this.params.entryClass) {
      this.entryWrapper.classList.add(this.params.entryClass);
    }

    DOMUtils.applyStyles(this.dataWrapper, {
      position: "fixed",
      top: "10px",
      left: "10px",
      color: "#eee",
      background: "#00000022",
      padding: "4px",
      zIndex: "1000000000000",
      display: "flex",
      flexDirection: "column",
      borderRadius: "4px",
      overflow: "hidden",
      gap: "8px",
      ...(this.params.dataStyles || {}),
    });

    DOMUtils.applyStyles(this.entryWrapper, {
      display: "flex",
      flexDirection: "column-reverse",
      alignItems: "flex-start",
      justifyContent: "flex-start",
      ...(this.params.entryStyles || {}),
    });

    if (this.params.stats) {
      this.stats = Stats();
      this.stats.dom.parentNode?.removeChild(this.stats.dom);

      DOMUtils.applyStyles(this.stats.dom, {
        position: "relative",
        top: "unset",
        bottom: "unset",
        left: "unset",
        zIndex: "1000000000000",
      });
    }
  };

  private setup = () => {
    if (this.params.tweakpane) {
      this.gui = new Pane({
        title: "Voxelize Debug Panel",
        expanded: false,
      });

      DOMUtils.applyStyles(this.gui.element, {
        position: "fixed",
        top: "10px",
        right: "10px",
        zIndex: "1000000000000",
      });

      // detach tweakpane from it's default parent
      const parentElement = this.gui.element;
      if (parentElement) {
        parentElement.parentNode?.removeChild(parentElement);
      }
    }

    if (this.params.showTitle) {
      this.displayTitle(`Voxelize ${"__buildVersion__"}`);
    }
  };

  private mount = () => {
    this.dataWrapper.appendChild(this.entryWrapper);
    this.dataWrapper.appendChild(this.stats?.dom);
    this.domElement.appendChild(this.dataWrapper);

    if (this.gui?.element) {
      this.domElement.appendChild(this.gui.element);
    }
  };
}
