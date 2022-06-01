import { Group, Mesh, PlaneBufferGeometry } from "three";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { Pane } from "tweakpane";

import { Client } from "..";
import { NameTag } from "../libs";
import { Coords3 } from "../types";
import { ChunkUtils, DOMUtils, MathUtils } from "../utils";

type FormatterType = (input: any) => string;

type DebugParams = {
  onByDefault: boolean;
};

const defaultParams: DebugParams = {
  onByDefault: true,
};

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

  constructor(
    public client: Client,
    params: Partial<DebugParams> = { ...defaultParams }
  ) {
    this.gui = new Pane();

    // wait till all client members are initialized
    client.on("ready", () => {
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
      ele.textContent = `${title ? `${title}: ` : ""}${formatter(newValue)}`;
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
    newline.textContent = title;
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
    const testFolder = this.gui.addFolder({ title: "Registry" });
    testFolder.addButton({ title: "atlas test" }).on("click", () => {
      if (!this.atlasTest) return;
      this.atlasTest.visible = !this.atlasTest.visible;
    });
    testFolder.addButton({ title: "remesh chunk" }).on("click", () => {
      const currChunk = ChunkUtils.mapVoxelPosToChunkPos(
        this.client.controls.voxel,
        this.client.world.params.chunkSize
      );
      this.client.network.send({
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
    testFolder.addInput(this.client.registry.minLightUniform, "value", {
      min: 0.02,
      max: 1,
    });

    this.displayTitle(`Voxelize ${"__buildVersion__"}`);
    this.displayNewline();
    this.registerDisplay("Mem", this, "memoryUsage");
    this.registerDisplay("Position", this.client.controls, "voxel");
    this.registerDisplay(
      "Chunk",
      this.client.controls,
      "voxel",
      (voxel: Coords3) =>
        ChunkUtils.mapVoxelPosToChunkPos(
          voxel,
          this.client.world.params.chunkSize
        ).toString()
    );
    this.registerDisplay("Max Height", this, "maxHeight");
    this.registerDisplay("Light", this, "light");
    this.registerDisplay(
      "Chunk to request",
      this.client.chunks.toRequest,
      "length"
    );
    this.registerDisplay(
      "Chunk requested",
      this.client.chunks.requested,
      "size"
    );
    // this.registerDisplay(
    //   "Packets received",
    //   this.client.network.receivedPackets,
    //   "length"
    // );
    // this.registerDisplay(
    //   "Packets to process",
    //   this.client.network.decodedPackets,
    //   "length"
    // );
    this.registerDisplay(
      "Scene objects",
      this.client.rendering.scene.children,
      "length"
    );
    // this.registerDisplay(
    //   "Scene polycount",
    //   this.client.rendering.renderer.info.render,
    //   "triangles"
    // );
    // this.registerDisplay(
    //   "Active drawcalls",
    //   this.client.rendering.renderer.info.render,
    //   "calls"
    // );
    this.registerDisplay(
      "Textures in memory",
      this.client.rendering.renderer.info.memory,
      "textures"
    );
    this.registerDisplay(
      "Geometries in memory",
      this.client.rendering.renderer.info.memory,
      "geometries"
    );
    this.registerDisplay(
      "Rigid body count",
      this.client.physics.core.bodies,
      "length"
    );
    this.registerDisplay(
      "Working network workers",
      this.client.network,
      "concurrentWorkers"
    );

    this.displayNewline();
    this.dataWrapper.insertBefore(this.stats.dom, this.dataWrapper.firstChild);
  };

  private setupInputs = () => {
    const { inputs, camera, chunks, registry, controls } = this.client;

    inputs.bind(
      "l",
      () => {
        chunks.reset();
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

        chunks.setVoxelsByVoxel(changes);
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

        chunks.setVoxelsByVoxel(changes);
      },
      "in-game"
    );
  };

  get light() {
    const { voxel } = this.client.controls;
    return this.client.chunks.getSunlightByVoxel(...voxel);
  }

  get maxHeight() {
    const { voxel } = this.client.controls;
    return this.client.chunks.getMaxHeight(voxel[0], voxel[2]);
  }
}

export { Debug };
