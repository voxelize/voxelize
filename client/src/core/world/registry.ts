import { AABB } from "@voxelize/aabb";
import { Color, Texture } from "three";

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
export type TextureData = {
  /**
   * The name of the block to load. E.g. "Dirt".
   */
  name: string;

  /**
   * The side(s) that this data loads onto.
   */
  sides: string[] | string;

  /**
   * Either the URL to the source image, or a ThreeJS color instance. If a color is provided, the
   * texture will be a solid color.
   */
  data: string | Color;
};

/**
 * The default symbols for 6-faced block face data.
 */
export const ALL_FACES = ["px", "nx", "py", "ny", "pz", "nz"];

/**
 * The default symbols for the 4 sides excluding the top and bottom.
 */
export const SIDE_FACES = ["px", "nx", "pz", "nz"];

/**
 * The default symbols for two diagonal sides.
 */
export const DIAGONAL_FACES = ["one", "two"];

/**
 * A client-side manager for blocks. This class will receive block data on connecting to a server, and will
 * be responsible for loading the block textures and creating the block instances that can be queried.
 *
 * Registry is by default created by the world and is available as {@link World.registry}.
 *
 * # Example
 * ```ts
 * // Register a new texture to all faces of type "Test".
 * world.registry.applyTextureByName(
 *   name: "Test",
 *   sides: VOXELIZE.ALL_FACES,
 *   data: "https://example.com/test.png"
 * });
 * ```
 *
 * @category Core
 */
export class Registry {
  /**
   * A map of UV ranges for all registered blocks. This is generated and loaded from the server, then passed into creating the texture atlas.
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

  /**
   * A map of side names to their corresponding texture sources.
   */
  public sources: Map<string, string | Color> = new Map();

  /**
   * A map of side names to their corresponding keyframe sources.
   */
  public keyframes: Map<
    string,
    { data: [number, string | Color | Texture][]; fadeFrames: number }
  > = new Map();

  /**
   * A set of side names that are currently registered.
   */
  public textures: Set<string> = new Set();

  /**
   * A map of block ID to block name.
   */
  public nameMap: Map<number, string> = new Map();

  /**
   * A map of block name to block ID.
   */
  public typeMap: Map<string, number> = new Map();

  /**
   * Load blocks from the server and generate atlas. This is called automatically by the world.
   *
   * @param blocks A list of blocks received from the server.
   * @param ranges A map of UV ranges for all registered blocks. This is generated and loaded from the server, then passed into creating the texture atlas.
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
   * Apply a texture onto a face/side of a block.
   *
   * @param texture The data of the texture and where the texture is applying to.
   */
  applyTextureByName = (texture: TextureData) => {
    const { name, sides, data } = texture;

    if (!name || !sides || !data) {
      throw new Error("Invalid texture data provided.");
    }

    (Array.isArray(sides) ? sides : [sides]).forEach((side) => {
      const sideName = Registry.makeSideName(name, side);
      this.sources.set(sideName, data);
    });
  };

  /**
   * Get the block information by its name. Call this after connecting to the server, or else
   * no blocks will be loaded yet.
   *
   * @param name The name of the block to get.
   */
  getBlockByName = (name: string) => {
    return this.blocksByName.get(name.toLowerCase());
  };

  /**
   * Get the block information by its ID. Call this after connecting to the server, or else
   * no blocks will be loaded yet.
   *
   * @param id The ID of the block to get.
   */
  getBlockById = (id: number) => {
    return this.blocksById.get(id);
  };

  /**
   * Reverse engineer to get the block information from a texture name. Call this after connecting to the server, or else
   * no blocks will be loaded yet.
   *
   * @param textureName The texture name that the block has.
   */
  getBlockByTextureName = (textureName: string) => {
    for (const [name, block] of this.blocksByName) {
      for (const face of block.faces) {
        if (textureName === Registry.makeSideName(name, face.name)) {
          return { block, side: face.name };
        }
      }
    }

    return {
      block: null,
      side: null,
    };
  };

  /**
   * Check if a block ID should be counted as a potential max height block.
   *
   * @param id The ID of the block.
   * @returns Whether or not should this block be counted as a potential max height at the voxel column.
   */
  checkHeight = (id: number) => {
    return id !== 0;
  };

  /**
   * Generate a key for the block's side.
   *
   * @param name The name of the block.
   * @param side The side of the block.
   * @returns A string representing the side's texture key.
   */
  static makeSideName = (name: string, side: string) => {
    return `${name.toLowerCase().replace(/\s/g, "_")}__${side.toLowerCase()}`;
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

  /**
   * Record a block into the registry.
   */
  private recordBlock = (block: Block) => {
    const { name, id, faces, aabbs, isDynamic } = block;

    const lowerName = name.toLowerCase();

    block.independentFaces = new Set();

    for (const face of faces) {
      if (face.highRes || face.animated) {
        block.independentFaces.add(face.name);
        face.independent = true;
      }
    }

    block.aabbs = aabbs.map(
      ({ minX, minY, minZ, maxX, maxY, maxZ }) =>
        new AABB(minX, minY, minZ, maxX, maxY, maxZ)
    );

    if (isDynamic) {
      block.dynamicFn = () => {
        return {
          aabbs: block.aabbs,
          faces: block.faces,
          isTransparent: block.isTransparent,
        };
      };
    }

    this.blocksByName.set(lowerName, block);
    this.blocksById.set(id, block);
    this.nameMap.set(id, lowerName);
    this.typeMap.set(lowerName, id);

    for (const side of faces) {
      const sideName = Registry.makeSideName(name, side.name);
      this.textures.add(sideName);
    }
  };

  /**
   * @hidden
   */
  constructor() {
    // DO NOTHING
  }
}
