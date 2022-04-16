import {
  Group,
  Mesh,
  PlaneBufferGeometry,
  AxesHelper,
  BoxBufferGeometry,
  MeshBasicMaterial,
} from "three";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { Pane } from "tweakpane";

import { Client } from "..";
import { NameTag } from "../libs";
import { DOMUtils, MathUtils } from "../utils";

type FormatterType = (input: any) => string;

/**
 * Debugger for Voxelize, including the following features:
 * - Top-left panel for in-game object attribute inspection
 * - Bottom-left corner for detailed FPS data
 * - Top-right corner for interactive debugging pane
 *
 * @class Debug
 */
class Debug {
  /**
   * Top-right corner of debug, used for interactive debugging
   *
   * @type {Pane}
   * @memberof Debug
   */
  public gui: Pane;

  /**
   * Bottom-left panel for performance statistics
   *
   * @type {Stats}
   * @memberof Debug
   */
  public stats: Stats;

  public dataWrapper: HTMLDivElement;
  public dataEntries: {
    ele: HTMLParagraphElement;
    obj?: any;
    attribute?: string;
    title: string;
    formatter: FormatterType;
  }[] = [];

  private group = new Group();

  private atlasTest: Mesh;

  constructor(public client: Client) {
    this.gui = new Pane();

    // detach tweakpane from it's default parent
    const parentElement = this.gui.element;
    if (parentElement) {
      parentElement.parentNode?.removeChild(parentElement);
    }

    // wait till all client members are initialized
    client.on("initialized", () => {
      client.inputs.bind("j", this.toggle, "*");

      this.makeDOM();
      this.setupAll();
      this.setupInputs();
      this.mount();

      client.rendering.scene.add(this.group);
    });

    // wait till texture to be loaded
    client.on("texture-loaded", () => {
      this.makeAtlasTest();
    });
  }

  /**
   * Update for the debug of the game
   *
   * @memberof Debug
   */
  update = () => {
    // loop through all data entries, and get their latest updated values
    for (const { ele, title, attribute, obj, formatter } of this.dataEntries) {
      const newValue = obj && attribute ? obj[attribute] : "";
      ele.innerHTML = `${title ? `${title}: ` : ""}${formatter(newValue)}`;
    }

    // fps update
    this.stats.update();
  };

  /**
   * Toggle debug visually, both UI and in-game elements
   *
   * @memberof Debug
   */
  toggle = () => {
    const display = this.dataWrapper.style.display;
    const newDisplay = display === "none" ? "inline" : "none";

    this.dataWrapper.style.display = newDisplay;
    this.gui.element.style.display = newDisplay;
    this.stats.dom.style.display = newDisplay;

    this.group.visible = !this.group.visible;
  };

  /**
   * Register an entry for the debug info-panel, which gets appended
   * to the top left corner of the debug screen
   *
   * @param title - The title of the entry
   * @param object - The object to listen to changes on
   * @param [attribute] - The attribute in the object to listen on
   * @param [formatter] - A function passed on the new data before updating the entry
   *
   * @memberof Debug
   */
  registerDisplay = (
    title: string,
    object?: any,
    attribute?: string,
    formatter: FormatterType = (str) => str
  ) => {
    const wrapper = this.makeDataEntry();

    const newEntry = {
      ele: wrapper,
      obj: object,
      title,
      formatter,
      attribute,
    };

    this.dataEntries.push(newEntry);
    this.dataWrapper.insertBefore(wrapper, this.dataWrapper.firstChild);
  };

  /**
   * Display a static title in the debug info-panel
   *
   * @param title - Title content of display entry
   *
   * @memberof Debug
   */
  displayTitle = (title: string) => {
    const newline = this.makeDataEntry(true);
    newline.innerHTML = title;
    this.dataWrapper.insertBefore(newline, this.dataWrapper.firstChild);
  };

  /**
   * Add a new line at the bottom of current info-panel
   *
   * @memberof Debug
   */
  displayNewline = () => {
    const newline = this.makeDataEntry(true);
    this.dataWrapper.insertBefore(newline, this.dataWrapper.firstChild);
  };

  /**
   * FPS of the game
   *
   * @readonly
   * @memberof Debug
   */
  get fps() {
    return this.calculateFPS();
  }

  /**
   * Memory usage of current page
   *
   * @readonly
   * @memberof Debug
   */
  get memoryUsage() {
    // @ts-ignore
    const info = window.performance.memory;
    if (!info) return "unknown";
    const { usedJSHeapSize, jsHeapSizeLimit } = info;
    return `${MathUtils.round(usedJSHeapSize / jsHeapSizeLimit, 2)}%`;
  }

  // create a data entry element
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
    this.dataWrapper.id = "data-wrapper";
    DOMUtils.applyStyles(this.dataWrapper, {
      position: "fixed",
      top: "10px",
      left: "10px",
      color: "#eee",
      background: "#00000022",
      padding: "4px",
      display: "flex",
      flexDirection: "column-reverse",
      alignItems: "flex-start",
      justifyContent: "flex-start",
      zIndex: "1000000000000",
    });

    DOMUtils.applyStyles(this.gui.element, {
      position: "fixed",
      top: "10px",
      right: "10px",
      zIndex: "1000000000000",
    });

    this.stats = Stats();
    DOMUtils.applyStyles(this.stats.dom, {
      position: "fixed",
      top: "unset",
      bottom: "10px",
      left: "10px",
      zIndex: "1000000000000",
    });
  };

  private mount = () => {
    const { domElement } = this.client.container;
    domElement.appendChild(this.dataWrapper);
    domElement.appendChild(this.gui.element);
    domElement.appendChild(this.stats.dom);
  };

  private makeAtlasTest = () => {
    const atlas = this.client.registry.atlas;
    const { countPerSide, dimension } = atlas.params;
    const width = countPerSide * dimension;
    const planeWidth = width * 0.1;

    // create a plane to view texture atlas
    this.atlasTest = new Mesh(
      new PlaneBufferGeometry(planeWidth, planeWidth),
      atlas.material
    );
    this.atlasTest.visible = false;
    this.atlasTest.renderOrder = 10000000000;
    this.atlasTest.position.y += planeWidth / 2;
    this.atlasTest.add(
      new NameTag(`${width}x${width}`, {
        fontSize: width * 0.01,
        yOffset: width * 0.06,
      })
    );

    this.client.registry.ranges.forEach(({ startU, endV }, name) => {
      const tag = new NameTag(name, { fontSize: planeWidth * 0.06 });
      tag.position.set(
        -planeWidth / 2 + (startU + 1 / 2 / countPerSide) * planeWidth,
        planeWidth - (1 - endV) * planeWidth - planeWidth / 2,
        0
      );
      this.atlasTest.add(tag);
    });

    this.group.add(this.atlasTest);
  };

  private setupAll = () => {
    const testFolder = this.gui.addFolder({ title: "Registry" });
    testFolder.addButton({ title: "atlas test" }).on("click", () => {
      this.client.network.send({ type: "CHUNK" });
      if (!this.atlasTest) return;
      this.atlasTest.visible = !this.atlasTest.visible;
    });

    this.displayTitle(`Voxelize ${"__buildVersion__"}`);
    this.registerDisplay("", this, "fps");
    this.displayNewline();
    this.registerDisplay("Mem", this, "memoryUsage");
    this.registerDisplay("Position", this.client, "voxel");
    this.registerDisplay("Max Height", this, "maxHeight");
    this.registerDisplay("Light", this, "light");

    this.group.add(
      new Mesh(
        new BoxBufferGeometry(1, 1, 1),
        new MeshBasicMaterial({ color: "White" })
      )
    );
  };

  private setupInputs = () => {
    const { inputs, camera } = this.client;

    inputs.bind(
      "v",
      () => {
        camera.setZoom(3);
      },
      "in-game",
      {
        occasion: "keydown",
      }
    );

    inputs.bind(
      "v",
      () => {
        camera.setZoom(1);
      },
      "in-game",
      {
        occasion: "keyup",
      }
    );
  };

  private calculateFPS = (function () {
    const sampleSize = 60;
    let value = 0;
    const sample: any[] = [];
    let index = 0;
    let lastTick = 0;
    let min: number;
    let max: number;

    return function () {
      // if is first tick, just set tick timestamp and return
      if (!lastTick) {
        lastTick = performance.now();
        return 0;
      }

      // calculate necessary values to obtain current tick FPS
      const now = performance.now();
      const delta = (now - lastTick) / 1000;
      const fps = 1 / delta;
      // add to fps samples, current tick fps value
      sample[index] = Math.round(fps);

      // iterate samples to obtain the average
      let average = 0;
      for (let i = 0; i < sample.length; i++) average += sample[i];

      average = Math.round(average / sample.length);

      // set new FPS
      value = average;
      // store current timestamp
      lastTick = now;
      // increase sample index counter, and reset it
      // to 0 if exceded maximum sampleSize limit
      index++;

      if (index === sampleSize) index = 0;

      if (!min || min > value) min = value;
      if (!max || max < value) max = value;

      return `${value} fps (${min}, ${max})`;
    };
  })();

  get light() {
    const { voxel } = this.client;
    return this.client.chunks.getSunlightByVoxel(...voxel);
  }

  get maxHeight() {
    const { voxel } = this.client;
    return this.client.chunks.getMaxHeight(voxel[0], voxel[2]);
  }
}

export { Debug };
