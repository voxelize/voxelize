import { Block, defaultBlock, SharedRegistry } from "@voxelize/common";

import { World } from "./world";

class Registry extends SharedRegistry {
  constructor(public world: World) {
    super();

    this.registerBlock("Air", {
      isSolid: false,
      isBlock: false,
    });
  }

  generate = () => {
    const countPerSide = this.perSide();

    let row = 0;
    let col = 0;

    this.textures.forEach((textureName) => {
      if (col >= countPerSide) {
        col = 0;
        row++;
      }

      const startX = col;
      const startY = row;

      let startU = startX / countPerSide;
      let endU = (startX + 1) / countPerSide;
      let startV = 1 - startY / countPerSide;
      let endV = 1 - (startY + 1) / countPerSide;

      [startU, startV, endU, endV] = Registry.fixTextureBleeding(
        startU,
        startV,
        endU,
        endV
      );

      this.ranges.set(textureName, {
        startU,
        endU,
        startV,
        endV,
      });

      col++;
    });
  };

  registerBlock = (name: string, block: Partial<Block>) => {
    if (this.world.room.started) {
      throw new Error("Error registering block after room started.");
    }

    const complete: Block = {
      ...defaultBlock,
      ...block,
      id: this.blocks.size,
      name,
    };

    this.recordBlock(complete);

    return complete;
  };

  getRanges = () => {
    const ranges = {};
    this.ranges.forEach((value, key) => {
      ranges[key] = value;
    });
    return ranges;
  };
}

export { Registry };
