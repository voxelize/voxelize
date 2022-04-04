import {
  Block,
  defaultBlock,
  BaseRegistry,
  TextureRange,
} from "@voxelize/common";

import { World } from "./world";

/**
 * A worker-transferable struct for sending registry data.
 */
type RegistryTransferableData = {
  ranges: { [key: string]: TextureRange };
  blocksByName: { [key: string]: Block };
  blocksById: { [key: number]: Block };
  textures: string[];
  nameMap: { [key: number]: string };
  typeMap: { [key: string]: number };
};

/**
 * A registry for @voxelize/server, used to store block information. By default, the "Air"
 * block is registered with an index of 0.
 *
 * @param [world] - World that the registry exists in
 * @extends {BaseRegistry}
 */
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

  /**
   * Exports registry into a worker-transferable object.
   *
   * @returns An object containing transferable data of the registry
   */
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

  /**
   * Construct a new registry instance with the data provided.
   *
   * @param data - `RegistryTransferableData`, holding registry information
   * @returns A registry instance
   */
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

  /**
   * Generate a UV map for a texture atlas on the server side. All UVs
   * lie between 0-1, and have a slight offset to account for texture bleeding.
   */
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

  /**
   * Register for a new block type. Fields of a block are as described:
   * - name: the name/type of the block
   * - redLightLevel: 1-maxLightLevel, representing red light
   * - greenLightLevel: 1-maxLightLevel, representing green light
   * - blueLightLevel: 1-maxLightLevel, representing blue light
   * - rotatable: indicates if the block can be rotated
   * - yRotatable: indicates if the block can be rotated on the y-axis
   * - isBlock: if the block is shaped a block, e.g. air wouldn't be a block
   * - isEmpty: if the block is empty in space
   * - isFluid: if the block is a fluid type
   * - isLight: if the block has rgb lights
   * - isPlant: if the block is a plant type
   * - isPlantable: if the plants can be planted on this block
   * - isSolid: if the block is a solid
   * - isTransparent: if the block is see-through
   * - transparentStandalone: used for meshing, if transparent faces should be meshed.
   * - faces: Array of `BlockFace`s, indicating what textures to use for the six sides.
   *
   * @param name - Name/type of the new block
   * @param block - Properties of the block
   * @returns a new block
   */
  registerBlock = (name: string, block: Omit<Partial<Block>, "id">) => {
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

  /**
   * Get the UV ranges.
   *
   * @returns all UV ranges
   */
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
