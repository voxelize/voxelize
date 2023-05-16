import { ChunkUtils, Coords3, DOMUtils, World } from "@voxelize/core";
import p5 from "p5";
import { Vector3 } from "three";

// const COLOR_HINT = [
//   [1, 1, "to request, within delete radius"],
//   [1, 2, "to request, within render radius"],
//   [2, 1, "requested, within delete radius"],
//   [2, 2, "requested, within render radius"],
//   [3, 1, "processing, within delete radius"],
//   [3, 2, "processing, within render radius"],
//   [4, 1, "loaded, within delete radius"],
//   [4, 2, "loaded, within render radius"],
//   [0, 0, "out of reach"],
// ];

const MAP_DIMENSION = 220;
const MAP_GRADIENT_SCALE = 50;

export class Map {
  public wrapper: HTMLDivElement = document.createElement("div");

  public p5: p5;

  public grid: number[][] = [];

  constructor(
    public world: World,
    public parent = document.body,
    public dimension = 5
  ) {
    DOMUtils.applyStyles(this.wrapper, {
      display: "none",
      width: `${MAP_DIMENSION}px`,
      height: `${MAP_DIMENSION}px`,
      position: "absolute",
      bottom: "0",
      right: "100%",
      zIndex: "10000000",
    });

    // const colorHints = document.createElement("div");
    // DOMUtils.applyStyles(colorHints, {
    //   display: "flex",
    //   flexDirection: "column",
    //   width: "300px",
    //   fontSize: "0.8rem",
    //   gap: "5px",
    // });

    // const colorHintItem = document.createElement("div");
    // DOMUtils.applyStyles(colorHintItem, {
    //   display: "flex",
    //   alignItems: "center",
    //   justifyContent: "flex-start",
    // });

    // const colorHintColor = document.createElement("div");
    // DOMUtils.applyStyles(colorHintColor, {
    //   width: "20px",
    //   height: "20px",
    //   marginRight: "10px",
    //   border: "1px solid white",
    // });

    // COLOR_HINT.forEach(([shade1, shade2, hint]) => {
    //   const item = colorHintItem.cloneNode(true) as HTMLDivElement;
    //   const color = colorHintColor.cloneNode(true) as HTMLDivElement;

    //   DOMUtils.applyStyles(color, {
    //     background: `rgb(${(shade2 as number) * 50}, 0, ${
    //       (shade1 as number) * 50
    //     })`,
    //   });

    //   item.appendChild(color);
    //   const text = document.createElement("p");
    //   text.innerHTML = `${hint}`;
    //   text.style.color = "white";
    //   item.appendChild(text);

    //   colorHints.appendChild(item);
    // });

    // this.wrapper.appendChild(colorHints);

    this.p5 = new p5((p) => {
      p.setup = () => {
        p.createCanvas(MAP_DIMENSION, MAP_DIMENSION);
      };
      p.draw = () => {};
    }, this.wrapper);

    parent.appendChild(this.wrapper);
  }

  setVisible = (visible: boolean) => {
    if (visible) {
      this.wrapper.style.display = "block";
    } else {
      this.wrapper.style.display = "none";
    }
  };

  toggle = () => {
    this.setVisible(this.wrapper.style.display === "none");
  };

  update(center: Vector3 = new Vector3(), direction: Vector3 = new Vector3()) {
    // @ts-ignore
    if (!this.p5._setupDone) {
      return;
    }

    this.p5.background("#000000");

    const width = this.wrapper.offsetWidth;
    const height = this.wrapper.offsetHeight;
    const dimension =
      Math.floor(this.dimension) % 2 === 0
        ? this.dimension
        : this.dimension + 1;

    const horizontalCount = Math.ceil(width / this.dimension);
    const verticalCount = Math.ceil(height / this.dimension);

    const { renderRadius, deleteRadius } = this.world;

    const [cx, cz] = ChunkUtils.mapVoxelToChunk(
      center.toArray() as Coords3,
      this.world.options.chunkSize
    );

    for (
      let x = -Math.floor(horizontalCount / 2);
      x < Math.floor(horizontalCount / 2);
      x++
    ) {
      for (
        let z = -Math.floor(verticalCount / 2);
        z < Math.floor(verticalCount / 2);
        z++
      ) {
        const status = this.world.getChunkStatus(x + cx, z + cz);
        const shade =
          status === "to request"
            ? 1
            : status === "requested"
            ? 2
            : status === "processing"
            ? 3
            : status === "loaded"
            ? 4
            : 0;

        const shade2 =
          x ** 2 + z ** 2 <= renderRadius ** 2
            ? 2
            : x ** 2 + z ** 2 <= deleteRadius ** 2
            ? 1
            : 0;

        if (x === 0 && z === 0) {
          this.p5.fill("#4B56D2");
        } else {
          this.p5.fill(
            shade2 * MAP_GRADIENT_SCALE,
            0,
            shade * MAP_GRADIENT_SCALE
          );
        }

        this.p5.noStroke();

        this.p5.rect(
          x * dimension + MAP_DIMENSION / 2 - dimension / 2,
          z * dimension + MAP_DIMENSION / 2 - dimension / 2,
          dimension,
          dimension
        );

        this.p5.fill(255);

        // this.p5.text(
        //   status || "",
        //   x * this.dimension + window.innerWidth / 2,
        //   z * this.dimension + window.innerHeight / 2 + 10
        // );
      }
    }

    const vec = this.p5.createVector(
      direction.x * this.dimension,
      direction.z * this.dimension
    );

    this.p5.push();
    this.p5.translate(MAP_DIMENSION / 2, MAP_DIMENSION / 2);
    this.p5.rotate(vec.heading());
    this.p5.stroke("#E5E0FF");
    const arrowSize = this.dimension;
    this.p5.triangle(0, arrowSize / 2, 0, -arrowSize / 2, arrowSize, 0);
    this.p5.pop();
  }
}
