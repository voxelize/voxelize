import { Vector3 } from "@babylonjs/core";
import { ChunkUtils, Coords3, DOMUtils, World } from "@voxelize/client";
import p5 from "p5";

export class Map {
  public wrapper: HTMLDivElement = document.createElement("div");

  public p5: p5;

  public grid: number[][] = [];

  constructor(public world: World, public dimension = 30) {
    DOMUtils.applyStyles(this.wrapper, {
      position: "absolute",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      display: "none",
      zIndex: "10000000",
    });

    this.p5 = new p5((p) => {
      p.setup = () => {
        p.createCanvas(window.innerWidth, window.innerHeight);
      };
      p.draw = () => {};
    }, this.wrapper);

    const resize = () => {
      this.p5.resizeCanvas(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", resize);
    resize();

    document.body.appendChild(this.wrapper);
  }

  setVisible = (visible: boolean) => {
    if (visible) {
      this.wrapper.style.display = "block";
    } else {
      this.wrapper.style.display = "none";
    }
  };

  update(center: Vector3) {
    this.p5.background("#000000");

    const width = this.wrapper.offsetWidth;
    const height = this.wrapper.offsetHeight;

    const horizontalCount = Math.ceil(width / this.dimension);
    const verticalCount = Math.ceil(height / this.dimension);

    const [cx, cz] = ChunkUtils.mapVoxelToChunk(
      center.asArray() as Coords3,
      this.world.params.chunkSize
    );

    for (
      let x = cx - Math.floor(horizontalCount / 2);
      x < cx + Math.floor(horizontalCount / 2);
      x++
    ) {
      for (
        let z = cz - Math.floor(verticalCount / 2);
        z < cz + Math.floor(verticalCount / 2);
        z++
      ) {
        const status = this.world.getChunkStatus(x, z);
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

        if (x === cx && z === cz) {
          this.p5.fill("#4B56D2");
        } else {
          this.p5.fill(shade * 50, 0, 0);
        }

        this.p5.rect(
          (x - cx + Math.floor(horizontalCount / 2)) * this.dimension,
          (z - cz + Math.floor(verticalCount / 2)) * this.dimension,
          this.dimension,
          this.dimension
        );

        this.p5.fill(255);

        this.p5.text(
          status || "",
          (x - cx + Math.floor(horizontalCount / 2)) * this.dimension,
          (z - cz + Math.floor(verticalCount / 2)) * this.dimension + 10
        );
      }
    }
  }
}
