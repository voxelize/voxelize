import { Group, Mesh, PlaneBufferGeometry } from "three";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { Pane } from "tweakpane";

import { Client } from "..";
import { NameTag } from "../libs";
import { Coords3 } from "../types";
import { ChunkUtils, DOMUtils, MathUtils } from "../utils";

/**
 * Formats any values into a presentable string representation.
 */
type Formatter = (input: any) => string;

/**
 * Parameters to initialize the Voxelize {@link Debug} panel.
 */
type DebugParams = {
  /**
   * Whether should debug be on by default. Defaults to `true`.
   */
  onByDefault: boolean;
};

const defaultParams: DebugParams = {
  onByDefault: true,
};

/**
 * Debugger for Voxelize, including the following features:
 * - Top-left panel for in-game object attribute inspection and FPS data.
 * - Top-right corner for interactive debugging pane>
 */
class Debug {
  /**
   * Reference linking back to the Voxelize client instance.
   */
  public client: Client;

  /**
   * Top-right corner [pane](https://cocopon.github.io/tweakpane/) of debug,
   * used for interactive debugging.
   */
  public gui: Pane;

  /**
   * Panel for performance statistics. Check out [stats.js](https://github.com/mrdoob/stats.js/) for more.
   */
  public stats: Stats;

  /**
   * A DOM wrapper for the top-left panel.
   */
  public dataWrapper: HTMLDivElement;

  private dataEntries: {
    ele: HTMLParagraphElement;
    obj?: any;
    attribute?: string;
    title: string;
    formatter: Formatter;
  }[] = [];

  private group = new Group();

  private atlasTest: Mesh;

  /**
   * Construct a Voxelize debug instance.
   *
   * @hidden
   */
  constructor(
    client: Client,
    params: Partial<DebugParams> = { ...defaultParams }
  ) {
    this.client = client;
    this.gui = new Pane({ title: "Voxelize Debug Panel" });

    let setup = false;

    // wait till all client members are initialized
    client.on("ready", () => {
      if (setup) return;
      setup = true;

      client.inputs.bind("j", this.toggle, "*");

      // detach tweakpane from it's default parent
      const parentElement = this.gui.element;
      if (parentElement) {
        parentElement.parentNode?.removeChild(parentElement);
      }

      this.makeDOM();
      this.setupAll();
      this.setupInputs();
      this.mount();

      client.rendering.scene.add(this.group);

      if (!params.onByDefault) {
        this.toggle();
      }
    });

    // wait till texture to be loaded
    client.on("registry-loaded", () => {
      this.makeAtlasTest();
    });
  }

  /**
   * Update for the debug of the game.
   *
   * @hidden
   */
  update = () => {
    // loop through all data entries, and get their latest updated values
    for (const { ele, title, attribute, obj, formatter } of this.dataEntries) {
      const newValue = obj && attribute ? obj[attribute] : "";
      ele.textContent = `${title ? `${title}: ` : ""}${formatter(newValue)}`;
    }

    // fps update
    this.stats.update();
  };

  /**
   * Toggle debug visually, both UI and in-game elements.
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
   * to the top left corner of the debug screen.
   *
   * @param title - The title of the entry.
   * @param object - The object to listen to changes on.
   * @param attribute - The attribute in the object to listen on.
   * @param formatter - A function passed on the new data before updating the entry.
   */
  registerDisplay = (
    title: string,
    object?: any,
    attribute?: string,
    formatter: Formatter = (str) => str
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
   * Remove a display from the top left debug panel.
   *
   * @param title - The title of the display to remove from the debug.
   */
  removeDisplay = (title: string) => {
    const index = this.dataEntries.findIndex((entry) => entry.title === title);
    const entry = this.dataEntries.splice(index, 1)[0];

    if (entry) {
      this.dataWrapper.removeChild(entry.ele);
    }
  };

  /**
   * Display a static title in the debug info-panel.
   *
   * @param title - Title content of display entry.
   */
  displayTitle = (title: string) => {
    const newline = this.makeDataEntry(true);
    newline.textContent = title;
    this.dataWrapper.insertBefore(newline, this.dataWrapper.firstChild);
  };

  /**
   * Add a new line at the bottom of current info-panel.
   */
  displayNewline = () => {
    const newline = this.makeDataEntry(true);
    this.dataWrapper.insertBefore(newline, this.dataWrapper.firstChild);
  };

  /**
   * Memory usage of current page.
   */
  get memoryUsage() {
    // @ts-ignore
    const info = window.performance.memory;
    if (!info) return "unknown";
    const { usedJSHeapSize, jsHeapSizeLimit } = info;
    return `${MathUtils.round(usedJSHeapSize / jsHeapSizeLimit, 2)}%`;
  }

  /**
   * The light value at which the client is at.
   */
  get light() {
    const { voxel } = this.client.controls;
    return this.client.world.getSunlightByVoxel(...voxel);
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
    this.stats.dom.parentNode?.removeChild(this.stats.dom);

    DOMUtils.applyStyles(this.stats.dom, {
      position: "relative",
      top: "unset",
      bottom: "unset",
      left: "unset",
      zIndex: "1000000000000",
    });
  };

  private mount = () => {
    const { domElement } = this.client.container;
    domElement.appendChild(this.dataWrapper);
    domElement.appendChild(this.gui.element);
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
    const { network, controls, world, rendering, physics, settings } =
      this.client;

    const registryFolder = this.gui.addFolder({ title: "Registry" });
    registryFolder.addButton({ title: "atlas test" }).on("click", () => {
      if (!this.atlasTest) return;
      this.atlasTest.visible = !this.atlasTest.visible;
    });

    const worldFolder = this.gui.addFolder({ title: "World", expanded: false });
    worldFolder.addButton({ title: "remesh chunk" }).on("click", () => {
      const currChunk = ChunkUtils.mapVoxelPosToChunkPos(
        controls.voxel,
        world.params.chunkSize
      );
      network.send({
        type: "DEBUG",
        json: {
          method: "remesh",
          data: {
            cx: currChunk[0],
            cz: currChunk[1],
          },
        },
      });
    });

    const controlsFolder = this.gui.addFolder({
      title: "Controls",
      expanded: false,
    });
    controlsFolder.addInput(controls.params, "flyForce", {
      min: 10,
      max: 200,
      step: 10,
    });

    const settingsObj = {
      renderRadius: settings.getRenderRadius(),
    };

    const settingsFolder = this.gui.addFolder({
      title: "Settings",
      expanded: true,
    });
    settingsFolder
      .addInput(settingsObj, "renderRadius", {
        min: 2,
        max: 20,
        step: 1.0,
      })
      .on("change", ({ value }) => {
        settings.setRenderRadius(value);
      });

    this.displayTitle(`Voxelize ${"__buildVersion__"}`);
    this.displayNewline();
    this.registerDisplay("Mem", this, "memoryUsage");
    this.registerDisplay("Position", controls, "voxel");
    this.registerDisplay("Chunk", controls, "voxel", (voxel: Coords3) =>
      ChunkUtils.mapVoxelPosToChunkPos(voxel, world.params.chunkSize).toString()
    );
    this.registerDisplay("Light", this, "light");
    this.registerDisplay("Chunk to request", world.chunks.toRequest, "length");
    this.registerDisplay("Chunk requested", world.chunks.requested, "size");
    this.registerDisplay("Scene objects", rendering.scene.children, "length");
    this.registerDisplay(
      "Textures in memory",
      rendering.renderer.info.memory,
      "textures"
    );
    this.registerDisplay(
      "Geometries in memory",
      rendering.renderer.info.memory,
      "geometries"
    );
    this.registerDisplay("Rigid body count", physics.bodies, "length");
    this.registerDisplay(
      "Working network workers",
      network,
      "concurrentWorkers"
    );
    this.displayNewline();
    this.registerDisplay("Looking at", controls, "lookBlock", (voxel) => {
      if (voxel) {
        const block = world.getBlockByVoxel(voxel[0], voxel[1], voxel[2]);
        return `${block.name} (${block.id})`;
      }

      return null;
    });

    this.displayNewline();
    this.dataWrapper.insertBefore(this.stats.dom, this.dataWrapper.firstChild);
  };

  private setupInputs = () => {
    const { inputs, camera, world, registry, controls } = this.client;

    inputs.bind(
      "l",
      () => {
        world.reset();
      },
      "in-game"
    );

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

    inputs.bind(
      "x",
      () => {
        if (!controls.lookBlock) return;

        const radius = 3;

        const changes = [];
        const [vx, vy, vz] = controls.lookBlock;

        for (let x = -radius; x <= radius; x++) {
          for (let z = -radius; z <= radius; z++) {
            for (let y = -radius; y <= radius; y++) {
              if (x ** 2 + y ** 2 + z ** 2 > radius ** 2) continue;
              changes.push({ vx: vx + x, vy: vy + y, vz: vz + z, type: 0 });
            }
          }
        }

        world.setServerVoxels(changes);
      },
      "in-game"
    );

    inputs.bind(
      "z",
      () => {
        if (!controls.lookBlock) return;

        const radius = 3;

        const id = registry.getBlockByName("Dirt").id;
        const [vx, vy, vz] = controls.lookBlock;
        const changes = [];

        for (let x = -radius; x <= radius; x++) {
          for (let z = -radius; z <= radius; z++) {
            for (let y = -radius; y <= radius; y++) {
              if (x ** 2 + y ** 2 + z ** 2 > radius ** 2) continue;
              changes.push({ vx: vx + x, vy: vy + y, vz: vz + z, type: id });
            }
          }
        }

        world.setServerVoxels(changes);
      },
      "in-game"
    );

    inputs.bind(
      "m",
      () => {
        if (!controls.lookBlock) return;

        const height = 5;

        const id = registry.getBlockByName("Dirt").id;
        const [vx, vy, vz] = controls.lookBlock;
        const changes = [];

        for (let y = vy; y <= vy + height; y++) {
          changes.push({ vx, vy: y, vz, type: id });
        }

        changes.push({ vx: vx + 1, vy: vy + height, vz, type: id });
        changes.push({ vx: vx + 2, vy: vy + height, vz, type: id });
        changes.push({ vx: vx + 1, vy: vy + height, vz: vz + 1, type: id });
        changes.push({ vx: vx + 1, vy: vy + height - 1, vz: vz + 1, type: id });
        changes.push({ vx: vx + 1, vy: vy + height, vz: vz - 1, type: id });
        changes.push({ vx: vx + 1, vy: vy + height - 1, vz: vz - 1, type: id });

        world.setServerVoxels(changes);
      },
      "in-game"
    );
  };
}

export type { Formatter };

export { Debug };
