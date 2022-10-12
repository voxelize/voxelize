import { Group } from "three";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { Pane } from "tweakpane";

import { DOMUtils } from "../utils";

export class Debug extends Group {
  public gui: Pane;

  public stats: Stats;

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
    onByDefault = false
  ) {
    super();

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
    this.stats.dom.style.visibility = newVisibility;

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
    this.stats.update();
  };

  private makeDataEntry = (newline = false) => {
    const dataEntry = document.createElement("p");
    DOMUtils.applyStyles(dataEntry, {
      fontSize: "13.3333px",
      margin: "0",
      ...(newline ? { height: "16px" } : {}),
    });
    return dataEntry;
  };

  private makeDOM = () => {
    this.dataWrapper = document.createElement("div");

    this.entryWrapper = document.createElement("div");
    this.entryWrapper.id = "data-wrapper";

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
    });

    DOMUtils.applyStyles(this.entryWrapper, {
      display: "flex",
      flexDirection: "column-reverse",
      alignItems: "flex-start",
      justifyContent: "flex-start",
    });

    this.stats = Stats();
    this.stats.dom.parentNode?.removeChild(this.stats.dom);

    DOMUtils.applyStyles(this.stats.dom, {
      position: "relative",
      top: "unset",
      bottom: "unset",
      left: "unset",
      zIndex: "1000000000000",
    });
  };

  private setup = () => {
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

    this.displayTitle(`Voxelize ${"__buildVersion__"}`);
  };

  private mount = () => {
    this.dataWrapper.appendChild(this.entryWrapper);
    this.dataWrapper.appendChild(this.stats.dom);
    this.domElement.appendChild(this.dataWrapper);

    if (this.gui?.element) {
      this.domElement.appendChild(this.gui.element);
    }
  };
}
