import { Block } from ".";

type PlainAABB = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

export class Registry {
  public blocksByName: Map<string, Block> = new Map();

  public blocksById: Map<number, Block> = new Map();

  public nameMap: Map<string, number> = new Map();

  public idMap: Map<number, string> = new Map();

  /**
   * @hidden
   */
  constructor() {
    // DO NOTHING
  }

  serialize(): object {
    const serializeAabb = (aabb: Block["aabbs"][number]): PlainAABB => ({
      minX: aabb.minX,
      minY: aabb.minY,
      minZ: aabb.minZ,
      maxX: aabb.maxX,
      maxY: aabb.maxY,
      maxZ: aabb.maxZ,
    });

    const serializeBlock = (block: Block) => {
      /* eslint-disable @typescript-eslint/no-unused-vars */
      const {
        dynamicFn,
        aabbs,
        dynamicPatterns,
        independentFaces,
        isolatedFaces,
        ...rest
      } = block;
      /* eslint-enable @typescript-eslint/no-unused-vars */
      return {
        ...rest,
        aabbs: aabbs.map(serializeAabb),
        dynamicPatterns: dynamicPatterns?.map((pattern) => ({
          parts: pattern.parts.map((part) => ({
            ...part,
            aabbs: part.aabbs.map(serializeAabb),
          })),
        })),
      };
    };

    return {
      blocksByName: Array.from(this.blocksByName.entries()).map(
        ([name, block]) => [name, serializeBlock(block)]
      ),
      blocksById: Array.from(this.blocksById.entries()).map(([id, block]) => [
        id,
        serializeBlock(block),
      ]),
      nameMap: Array.from(this.nameMap.entries()),
      idMap: Array.from(this.idMap.entries()),
    };
  }

  static deserialize(data: any): Registry {
    const registry = new Registry();
    registry.blocksByName = new Map(data.blocksByName);
    registry.blocksById = new Map(data.blocksById);
    registry.nameMap = new Map(data.nameMap);
    registry.idMap = new Map(data.idMap);
    return registry;
  }
}
