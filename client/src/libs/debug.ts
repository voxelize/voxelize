import { Group } from "three";
import Stats from "three/examples/jsm/libs/stats.module.js";

import { DOMUtils } from "../utils";

/**
 * Parameters to create a {@link Debug} instance.
 */
export type DebugParams = {
  /**
   * Whether or not should [stats.js](https://github.com/mrdoob/stats.js/) be enabled. Defaults to `true`.
   */
  stats: boolean;

  /**
   * Whether or not should the debug panel be displayed by default when the page loads. Defaults to `true`.
   * You can toggle the debug panel by calling {@link Debug.toggle}.
   */
  onByDefault: boolean;

  /**
   * Styles to apply to the wrapper of all debug entries.
   */
  entryStyles: Partial<CSSStyleDeclaration>;

  /**
   * A class to add to the wrapper of all debug entries.
   */
  entryClass: string;

  /**
   * Styles to apply to each of the debug entry line (top left).
   */
  lineStyles: Partial<CSSStyleDeclaration>;

  /**
   * A class to add to each of the debug entry line (top left).
   */
  lineClass: string;

  /**
   * Styles to apply to the wrapper of the top-left debug panel.
   */
  dataStyles: Partial<CSSStyleDeclaration>;

  /**
   * A class to add to the wrapper of the top-left debug panel.
   */
  dataClass: string;

  /**
   * Whether or not should `Voxelize x.x.x` be displayed in the top-left debug panel. Defaults to `true`.
   */
  showVoxelize: boolean;
};

const defaultParams: DebugParams = {
  stats: true,
  onByDefault: true,
  entryStyles: {},
  entryClass: "",
  lineStyles: {},
  lineClass: "",
  dataStyles: {},
  dataClass: "",
  showVoxelize: true,
};

/**
 * A class for general debugging purposes in Voxelize, including FPS, value tracking, and real-time value testing.
 *
 * # Example
 * ```ts
 * const debug = new VOXELIZE.Debug();
 *
 * // Track the voxel property of `controls`.
 * debug.registerDisplay("Position", controls, "voxel");
 *
 * // Add a function to track sunlight dynamically.
 * debug.registerDisplay("Sunlight", () => {
 *   return world.getSunlightByVoxel(...controls.voxel);
 * });
 *
 * // In the game loop, trigger debug updates.
 * debug.update();
 * ```
 *
 * ![Debug](/img/docs/debug.png)
 *
 * @noInheritDoc
 */
export class Debug extends Group {
  /**
   * Parameters to create a {@link Debug} instance.
   */
  public params: DebugParams;

  /**
   * The stats.js instance, situated in the top-left corner after the data entries.
   */
  public stats?: Stats;

  /**
   * The HTML element that wraps all the debug entries and stats.js instance, located
   * on the top-left by default.
   */
  public dataWrapper: HTMLDivElement;

  /**
   * A HTML element wrapping all registered debug entries.
   */
  public entryWrapper: HTMLDivElement;

  /**
   * The DOM element to append the debug panel to. Defaults to `document.body`.
   */
  public domElement: HTMLElement;

  /**
   * Data entries to track individual values.
   */
  private dataEntries: {
    element: HTMLParagraphElement;
    object?: any;
    attribute?: string;
    title: string;
    formatter: (value: any) => string;
  }[] = [];

  /**
   * Create a new {@link Debug} instance.
   *
   * @param domElement The DOM element to append the debug panel to.
   * @param params Parameters to create a {@link Debug} instance.
   */
  constructor(
    domElement: HTMLElement = document.body,
    params: Partial<DebugParams> = {}
  ) {
    super();

    this.domElement = domElement;

    const { onByDefault } = (this.params = { ...defaultParams, ...params });

    this.makeDOM();
    this.setup();
    this.mount();

    this.toggle(onByDefault);
  }

  /**
   * Register a new object attribute to track. Needs to call {@link Debug.update} in the game loop
   * to update the value.
   *
   * @param title The title of the debug entry.
   * @param object The object to track.
   * @param attribute The attribute of the object to track.
   * @param formatter A function to format the value of the attribute.
   * @returns The debug instance for chaining.
   */
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

    return this;
  };

  /**
   * Remove a registered object attribute from tracking.
   *
   * @param title The title of the debug entry.
   */
  removeDisplay = (title: string) => {
    const index = this.dataEntries.findIndex((entry) => entry.title === title);
    const entry = this.dataEntries.splice(index, 1)[0];

    if (entry) {
      this.entryWrapper.removeChild(entry.element);
    }
  };

  /**
   * Add a static title to the debug entries for grouping.
   *
   * @param title A title to display.
   * @returns The debug instance for chaining.
   */
  displayTitle = (title: string) => {
    const newline = this.makeDataEntry(true);

    newline.textContent = title;
    this.entryWrapper.insertBefore(newline, this.entryWrapper.firstChild);

    return this;
  };

  /**
   * Add an empty line to the debug entries for spacing.
   *
   * @returns The debug instance for chaining.
   */
  displayNewline = () => {
    const newline = this.makeDataEntry(true);
    this.entryWrapper.insertBefore(newline, this.entryWrapper.firstChild);
    return this;
  };

  /**
   * Toggle the debug instance on/off.
   *
   * @param force Whether or not to force the debug panel to be shown/hidden.
   */
  toggle = (force = null) => {
    this.visible = force !== null ? force : !this.visible;

    const visibility = this.entryWrapper.style.visibility;
    const newVisibility = force
      ? "visible"
      : visibility === "visible"
      ? "hidden"
      : "visible";

    this.entryWrapper.style.visibility = newVisibility;
    this.dataWrapper.style.visibility = newVisibility;

    if (this.stats) {
      this.stats.dom.style.visibility = newVisibility;
    }
  };

  /**
   * Update the debug entries with the latest values. This should be called in the game loop.
   */
  update = () => {
    // loop through all data entries, and get their latest updated values
    for (const { element, title, attribute, object, formatter } of this
      .dataEntries) {
      const newValue = object
        ? typeof object === "function"
          ? object()
          : attribute
          ? object[attribute]
          : ""
        : "";
      element.textContent = `${title ? `${title}: ` : ""}${formatter(
        newValue
      )}`;
    }

    // fps update
    this.stats?.update();
  };

  /**
   * Make a new data entry element.
   */
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

  /**
   * Prepare the debug panel to be mounted.
   */
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

  /**
   * Final setup of the debug panel.
   */
  private setup = () => {
    if (this.params.showVoxelize) {
      this.displayTitle(`Voxelize ${"__buildVersion__"}`);
      this.displayNewline();
    }
  };

  /**
   * Mount the debug panel to the DOM.
   */
  private mount = () => {
    this.dataWrapper.appendChild(this.entryWrapper);

    if (this.stats) {
      this.dataWrapper.appendChild(this.stats?.dom);
    }

    this.domElement.appendChild(this.dataWrapper);
  };
}
