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

  /**
   * Get the UV for the block type.
   *
   * @param id - The ID of the block type.
   *
   * @hidden
   * @internal
   */
  getUV = (id: number): { [key: string]: [any[][], number] } => {
    const getUVInner = (range: TextureRange, uv: number[]): number[] => {
      const { startU, endU, startV, endV } = range;
      return [
        uv[0] * (endU - startU) + startU,
        uv[1] * (endV - startV) + startV,
      ];
    };

    const { isBlock, isPlant } = this.getBlockById(id);
    const textures = this.getUVMap(this.getBlockById(id));

    if (isBlock) {
      // ny
      const bottomUVs = [
        [1, 0],
        [0, 0],
        [1, 1],
        [0, 1],
      ].map((uv) => getUVInner(textures["ny"], uv));

      // py
      const topUVs = [
        [1, 1],
        [0, 1],
        [1, 0],
        [0, 0],
      ].map((uv) => getUVInner(textures["py"], uv));

      // nx
      const side1UVs = [
        [0, 1],
        [0, 0],
        [1, 1],
        [1, 0],
      ].map((uv) => getUVInner(textures["nx"], uv));

      // px
      const side2UVs = [
        [0, 1],
        [0, 0],
        [1, 1],
        [1, 0],
      ].map((uv) => getUVInner(textures["px"], uv));

      // nz
      const side3UVs = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map((uv) => getUVInner(textures["nz"], uv));

      // pz
      const side4UVs = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map((uv) => getUVInner(textures["pz"], uv));

      return {
        px: [side2UVs, 1],
        py: [topUVs, 3],
        pz: [side4UVs, 0],
        nx: [side1UVs, 1],
        ny: [bottomUVs, 1],
        nz: [side3UVs, 0],
      };
    } else if (isPlant) {
      const oneUVs = [
        [0, 1],
        [0, 0],
        [1, 1],
        [1, 0],
      ].map((uv) => getUVInner(textures["one"], uv));
      return { one: [oneUVs, 1] };
    }
    return {};
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

  private getUVMap = (block: Block) => {
    const uvMap: { [key: string]: TextureRange } = {};

    block.faces.forEach((side) => {
      const sideName = this.makeSideName(block.name, side.name);
      const uv = this.ranges.get(sideName);
      if (!uv)
        throw new Error(`UV range not found: ${sideName} - ${block.name}`);
      uvMap[side.name] = uv;
    });

    return uvMap;
  };

  private makeSideName = (name: string, side: string) => {
    return `${name.toLowerCase().replace(/\s/g, "_")}__${side.toLowerCase()}`;
  };

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
