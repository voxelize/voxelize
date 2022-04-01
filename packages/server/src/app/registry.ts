import {
  Block,
  defaultBlock,
  BaseRegistry,
  TextureRange,
} from "@voxelize/common";

import { World } from "./world";

type RegistryTransferableData = {
  ranges: { [key: string]: TextureRange };
  blocksByName: { [key: string]: Block };
  blocksById: { [key: number]: Block };
  textures: string[];
  nameMap: { [key: number]: string };
  typeMap: { [key: string]: number };
};

class Registry extends BaseRegistry {
  constructor(public world?: World) {
    super();

    if (!world) {
      return;
    }

    this.registerBlock("Air", {
      isSolid: false,
      isBlock: false,
      isEmpty: true,
      isTransparent: true,
    });
  }

  export = () => {
    const ranges: { [key: string]: TextureRange } = {};
    this.ranges.forEach((t, k) => (ranges[k] = t));

    const blocksByName: { [key: string]: Block } = {};
    this.blocksByName.forEach((b, k) => (blocksByName[k] = b));

    const blocksById: { [key: string]: Block } = {};
    this.blocksById.forEach((b, k) => (blocksById[k] = b));

    const textures = Array.from(this.textures);

    const nameMap: { [key: number]: string } = {};
    this.nameMap.forEach((s, n) => (nameMap[n.toString(10)] = s));

    const typeMap: { [key: string]: number } = {};
    this.typeMap.forEach((n, s) => (typeMap[s] = n));

    return {
      ranges,
      blocksById,
      blocksByName,
      textures,
      nameMap,
      typeMap,
    } as RegistryTransferableData;
  };

  static import = ({
    ranges,
    blocksById,
    blocksByName,
    textures,
    nameMap,
    typeMap,
  }: RegistryTransferableData) => {
    const registry = new Registry();

    registry.ranges = new Map();
    Object.keys(ranges).forEach((key) => registry.ranges.set(key, ranges[key]));

    registry.blocksByName = new Map();
    Object.keys(blocksByName).forEach((key) =>
      registry.blocksByName.set(key, blocksByName[key])
    );

    registry.blocksById = new Map();
    Object.keys(blocksById).forEach((key) =>
      registry.blocksById.set(parseInt(key, 10), blocksById[key])
    );

    registry.textures = new Set(textures);

    registry.nameMap = new Map();
    Object.keys(nameMap).forEach((key) =>
      registry.nameMap.set(parseInt(key, 10), nameMap[key])
    );

    registry.typeMap = new Map();
    Object.keys(typeMap).forEach((key) =>
      registry.typeMap.set(key, typeMap[key])
    );

    return registry;
  };

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
      id: this.blocksByName.size,
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

export type { RegistryTransferableData };

export { Registry };
