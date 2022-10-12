import { AABB } from "@voxelize/aabb";
import { Color } from "three";

import { Block } from "./block";

export type TextureRange = {
  startU: number;
  endU: number;
  startV: number;
  endV: number;
};

/**
 * Data passed to {@link applyTextureByName} or {@link applyTexturesByNames} to load a block texture.
 */
type TextureData = {
  /**
   * The name of the block to load. E.g. "Dirt".
   */
  name: string;

  /**
   * The sides that this data loads onto.
   */
  sides: string[];

  /**
   * Either the URL to the source image, or a ThreeJS color instance.
   */
  data: string | Color;
};

/**
 * Parameters to initialize the registry.
 */
type RegistryParams = {
  /**
   * The dimension of each registered block texture. Defaults to `8`.
   */
  dimension: number;
};

export const ALL_FACES = ["px", "nx", "py", "ny", "pz", "nz"];
export const SIDE_FACES = ["px", "nx", "pz", "nz"];
export const DIAGONAL_FACES = ["one", "two"];

/**
 * A **built-in** block registry for Voxelize.
 *
 * @category Core
 */
class Registry {
  /**
   * A map of UV ranges for all registered blocks.
   */
  public ranges: Map<string, TextureRange> = new Map();

  /**
   * A map of blocks by their names.
   */
  public blocksByName: Map<string, Block> = new Map();

  /**
   * A map of blocks by their IDs.
   */
  public blocksById: Map<number, Block> = new Map();

  public sources: Map<string, string | Color> = new Map();

  public textures: Set<string> = new Set();
  private nameMap: Map<number, string> = new Map();
  private typeMap: Map<string, number> = new Map();

  /**
   * Load blocks from the server and generate atlas. Emits "registry-loaded" event on client once done.
   *
   * @hidden
   * @internal
   */
  load = (blocks: Block[], ranges: { [key: string]: TextureRange }) => {
    Object.values(blocks).forEach((block) => {
      this.recordBlock(block);
    });

    Object.keys(ranges).forEach((r) => {
      this.ranges.set(r, ranges[r]);
    });
  };

  /**
   * Apply a list of textures to a list of blocks' faces. The textures are loaded in before the game starts.
   *
   * @param textures - List of data to load into the game before the game starts.
   */
  applyTexturesByNames = (textures: TextureData[]) => {
    textures.forEach((texture) => {
      this.applyTextureByName(texture);
    });
  };

  /**
   * Apply a texture onto a face/side of a block.
   *
   * @param texture - The data of the texture and where the texture is applying to.
   */
  applyTextureByName = (texture: TextureData) => {
    const { name, sides, data } = texture;

    sides.forEach((side) => {
      this.sources.set(this.makeSideName(name, side), data);
    });
  };

  /**
   * Get the block information by its name.
   *
   * @param name - The name of the block to get.
   */
  getBlockByName = (name: string) => {
    return this.blocksByName.get(name.toLowerCase());
  };

  /**
   * Get the block information by its ID.
   *
   * @param id - The ID of the block to get.
   */
  getBlockById = (id: number) => {
    return this.blocksById.get(id);
  };

  /**
   * Reverse engineer to get the block information from a texture name.
   *
   * @param textureName - The texture name that the block has.
   */
  getBlockByTextureName = (textureName: string) => {
    for (const [name, block] of this.blocksByName) {
      for (const face of block.faces) {
        if (textureName === this.makeSideName(name, face.name)) {
          return block;
        }
      }
    }

    return null;
  };

  makeSideName = (name: string, side: string) => {
    return `${name.toLowerCase().replace(/\s/g, "_")}__${side.toLowerCase()}`;
  };

  checkHeight = (id: number) => {
    return id !== 0;
  };

  /**
   * On the texture atlas, how many textures are on each side.
   */
  get perSide() {
    let i = 1;
    const sqrt = Math.ceil(Math.sqrt(this.textures.size));
    while (i < sqrt) {
      i *= 2;
    }
    return i;
  }

  private recordBlock = (block: Block) => {
    const { name, id, faces, aabbs } = block;

    const lowerName = name.toLowerCase();
    block.aabbs = aabbs.map(
      ({ minX, minY, minZ, maxX, maxY, maxZ }) =>
        new AABB(minX, minY, minZ, maxX, maxY, maxZ)
    );

    this.blocksByName.set(lowerName, block);
    this.blocksById.set(id, block);
    this.nameMap.set(id, lowerName);
    this.typeMap.set(lowerName, id);

    for (const side of faces) {
      const sideName = this.makeSideName(name, side.name);
      this.textures.add(sideName);
    }
  };
}

export type { RegistryParams, TextureData };

export { Registry };
