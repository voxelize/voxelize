import { Vector3 } from "@babylonjs/core";
import { ChunkUtils, Coords3, DOMUtils, World } from "@voxelize/client";
import p5 from "p5";

const COLOR_HINT = [
  [1, 1, "to request, within delete radius"],
  [1, 2, "to request, within render radius"],
  [2, 1, "requested, within delete radius"],
  [2, 2, "requested, within render radius"],
  [3, 1, "processing, within delete radius"],
  [3, 2, "processing, within render radius"],
  [4, 1, "loaded, within delete radius"],
  [4, 2, "loaded, within render radius"],
  [0, 0, "out of reach"],
];

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

    const colorHints = document.createElement("div");
    DOMUtils.applyStyles(colorHints, {
      position: "absolute",
      bottom: "10px",
      left: "10px",
      display: "flex",
      flexDirection: "column",
      width: "300px",
      fontSize: "0.8rem",
      gap: "5px",
    });

    const colorHintItem = document.createElement("div");
    DOMUtils.applyStyles(colorHintItem, {
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-start",
    });

    const colorHintColor = document.createElement("div");
    DOMUtils.applyStyles(colorHintColor, {
      width: "20px",
      height: "20px",
      marginRight: "10px",
      border: "1px solid white",
    });

    COLOR_HINT.forEach(([shade1, shade2, hint]) => {
      const item = colorHintItem.cloneNode(true) as HTMLDivElement;
      const color = colorHintColor.cloneNode(true) as HTMLDivElement;

      DOMUtils.applyStyles(color, {
        background: `rgb(${(shade2 as number) * 50}, 0, ${
          (shade1 as number) * 50
        })`,
      });

      item.appendChild(color);
      const text = document.createElement("p");
      text.innerHTML = `${hint}`;
      text.style.color = "white";
      item.appendChild(text);

      colorHints.appendChild(item);
    });

    this.wrapper.appendChild(colorHints);

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

  toggle = () => {
    this.setVisible(this.wrapper.style.display === "none");
  };

  update(center: Vector3) {
    this.p5.background("#000000");

    const width = this.wrapper.offsetWidth;
    const height = this.wrapper.offsetHeight;

    const horizontalCount = Math.ceil(width / this.dimension);
    const verticalCount = Math.ceil(height / this.dimension);

    const { renderRadius, deleteRadius } = this.world;

    const [cx, cz] = ChunkUtils.mapVoxelToChunk(
      center.asArray() as Coords3,
      this.world.params.chunkSize
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
          this.p5.fill(shade2 * 50, 0, shade * 50);
        }

        this.p5.noStroke();

        this.p5.rect(
          x * this.dimension + window.innerWidth / 2,
          z * this.dimension + window.innerHeight / 2,
          this.dimension,
          this.dimension
        );

        this.p5.fill(255);

        // this.p5.text(
        //   status || "",
        //   x * this.dimension + window.innerWidth / 2,
        //   z * this.dimension + window.innerHeight / 2 + 10
        // );
      }
    }
  }
}
