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
      const serializedAabbs = new Array<PlainAABB>(aabbs.length);
      for (let aabbIndex = 0; aabbIndex < aabbs.length; aabbIndex++) {
        serializedAabbs[aabbIndex] = serializeAabb(aabbs[aabbIndex]);
      }

      let serializedDynamicPatterns:
        | Array<{
            parts: Array<{
              aabbs: PlainAABB[];
            } & Omit<(typeof dynamicPatterns)[number]["parts"][number], "aabbs">>;
          }>
        | undefined;
      if (dynamicPatterns) {
        serializedDynamicPatterns = new Array(dynamicPatterns.length);
        for (
          let patternIndex = 0;
          patternIndex < dynamicPatterns.length;
          patternIndex++
        ) {
          const pattern = dynamicPatterns[patternIndex];
          const parts = pattern.parts;
          const serializedParts = new Array<{
            aabbs: PlainAABB[];
          } & Omit<(typeof parts)[number], "aabbs">>(parts.length);

          for (let partIndex = 0; partIndex < parts.length; partIndex++) {
            const part = parts[partIndex];
            const partAabbs = new Array<PlainAABB>(part.aabbs.length);
            for (let aabbIndex = 0; aabbIndex < part.aabbs.length; aabbIndex++) {
              partAabbs[aabbIndex] = serializeAabb(part.aabbs[aabbIndex]);
            }

            serializedParts[partIndex] = {
              ...part,
              aabbs: partAabbs,
            };
          }

          serializedDynamicPatterns[patternIndex] = {
            parts: serializedParts,
          };
        }
      }

      return {
        ...rest,
        aabbs: serializedAabbs,
        dynamicPatterns: serializedDynamicPatterns,
      };
    };

    const blocksByName: [string, ReturnType<typeof serializeBlock>][] = [];
    for (const [name, block] of this.blocksByName) {
      blocksByName.push([name, serializeBlock(block)]);
    }

    const blocksById: [number, ReturnType<typeof serializeBlock>][] = [];
    for (const [id, block] of this.blocksById) {
      blocksById.push([id, serializeBlock(block)]);
    }

    const nameMap: [string, number][] = [];
    for (const [name, id] of this.nameMap) {
      nameMap.push([name, id]);
    }

    const idMap: [number, string][] = [];
    for (const [id, name] of this.idMap) {
      idMap.push([id, name]);
    }

    return {
      blocksByName,
      blocksById,
      nameMap,
      idMap,
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
