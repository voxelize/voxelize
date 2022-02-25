import { Mesh, PlaneBufferGeometry } from "three";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { Pane } from "tweakpane";

import { Client } from "..";
import { NameTag } from "../libs";
import { Helper } from "../utils";

type FormatterType = (input: any) => string;

class Debug {
  public gui: Pane;
  public stats: Stats;
  public dataWrapper: HTMLDivElement;
  public dataEntries: {
    ele: HTMLParagraphElement;
    obj?: any;
    attribute?: string;
    name: string;
    formatter: FormatterType;
  }[] = [];

  private atlasTest: Mesh;

  constructor(public client: Client) {
    this.gui = new Pane();

    const parentElement = this.gui.element;
    if (parentElement) {
      parentElement.parentNode?.removeChild(parentElement);
    }

    client.on("initialized", () => {
      client.inputs.bind("j", this.toggle, "*");

      this.makeDOM();
      this.setupAll();
      this.setupInputs();
      this.mount();
    });

    client.on("texture-loaded", () => {
      const atlas = client.registry.atlas;
      const width = atlas.params.countPerSide * atlas.params.dimension;

      this.atlasTest = new Mesh(
        new PlaneBufferGeometry(width * 0.1, width * 0.1),
        atlas.material
      );
      this.atlasTest.visible = false;
      this.atlasTest.renderOrder = 10000000000;
      this.atlasTest.position.y += (width * 0.1) / 2;
      this.atlasTest.add(
        new NameTag(`${width}x${width}`, {
          fontSize: width * 0.01,
          yOffset: width * 0.06,
        })
      );

      client.rendering.scene.add(this.atlasTest);
    });
  }

  tick = () => {
    for (const { ele, name, attribute, obj, formatter } of this.dataEntries) {
      const newValue = obj && attribute ? obj[attribute] : "";
      ele.innerHTML = `${name ? `${name}: ` : ""}${formatter(newValue)}`;
    }

    this.stats.update();
  };

  makeDataEntry = (newline = false) => {
    const dataEntry = document.createElement("p");
    Helper.applyStyles(dataEntry, {
      fontSize: "13.3333px",
      margin: "0",
      ...(newline ? { height: "16px" } : {}),
    });
    return dataEntry;
  };

  makeDOM = () => {
    this.dataWrapper = document.createElement("div");
    this.dataWrapper.id = "data-wrapper";
    Helper.applyStyles(this.dataWrapper, {
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

    Helper.applyStyles(this.gui.element, {
      position: "fixed",
      top: "10px",
      right: "10px",
      zIndex: "1000000000000",
    });

    this.stats = Stats();
    Helper.applyStyles(this.stats.dom, {
      position: "fixed",
      top: "unset",
      bottom: "10px",
      left: "10px",
      zIndex: "1000000000000",
    });
  };

  mount = () => {
    const { domElement } = this.client.container;
    domElement.appendChild(this.dataWrapper);
    domElement.appendChild(this.gui.element);
    domElement.appendChild(this.stats.dom);
  };

  toggle = () => {
    const display = this.dataWrapper.style.display;
    const newDisplay = display === "none" ? "inline" : "none";

    this.dataWrapper.style.display = newDisplay;
    this.gui.element.style.display = newDisplay;
    this.stats.dom.style.display = newDisplay;
  };

  registerDisplay = (
    name: string,
    object?: any,
    attribute?: string,
    formatter: FormatterType = (str) => str
  ) => {
    const wrapper = this.makeDataEntry();

    const newEntry = {
      ele: wrapper,
      obj: object,
      name,
      formatter,
      attribute,
    };

    this.dataEntries.push(newEntry);
    this.dataWrapper.insertBefore(wrapper, this.dataWrapper.firstChild);
  };

  displayTitle = (title: string) => {
    const newline = this.makeDataEntry(true);
    newline.innerHTML = title;
    this.dataWrapper.insertBefore(newline, this.dataWrapper.firstChild);
  };

  displayNewline = () => {
    const newline = this.makeDataEntry(true);
    this.dataWrapper.insertBefore(newline, this.dataWrapper.firstChild);
  };

  setupAll = () => {
    const testFolder = this.gui.addFolder({ title: "Registry" });
    testFolder.addButton({ title: "atlas test" }).on("click", () => {
      if (!this.atlasTest) return;
      this.atlasTest.visible = !this.atlasTest.visible;
    });

    this.displayTitle(`Voxelize ${"__buildVersion__"}`);
    this.registerDisplay("", this, "fps");
    this.displayNewline();
    this.registerDisplay("Mem", this, "memoryUsage");
  };

  setupInputs = () => {
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

  calculateFPS = (function () {
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

  get fps() {
    return this.calculateFPS();
  }

  get memoryUsage() {
    // @ts-ignore
    const info = window.performance.memory;
    if (!info) return "unknown";
    const { usedJSHeapSize, jsHeapSizeLimit } = info;
    return `${Helper.round(usedJSHeapSize / jsHeapSizeLimit, 2)}%`;
  }
}

export { Debug };
