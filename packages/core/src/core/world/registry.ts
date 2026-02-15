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

    const blocksByName = new Array<
      [string, ReturnType<typeof serializeBlock>]
    >(this.blocksByName.size);
    let blocksByNameIndex = 0;
    let blocksByNameEntries = this.blocksByName.entries();
    let blocksByNameEntry = blocksByNameEntries.next();
    while (!blocksByNameEntry.done) {
      const [name, block] = blocksByNameEntry.value;
      blocksByName[blocksByNameIndex] = [name, serializeBlock(block)];
      blocksByNameIndex++;
      blocksByNameEntry = blocksByNameEntries.next();
    }

    const blocksById = new Array<
      [number, ReturnType<typeof serializeBlock>]
    >(this.blocksById.size);
    let blocksByIdIndex = 0;
    let blocksByIdEntries = this.blocksById.entries();
    let blocksByIdEntry = blocksByIdEntries.next();
    while (!blocksByIdEntry.done) {
      const [id, block] = blocksByIdEntry.value;
      blocksById[blocksByIdIndex] = [id, serializeBlock(block)];
      blocksByIdIndex++;
      blocksByIdEntry = blocksByIdEntries.next();
    }

    const nameMap = new Array<[string, number]>(this.nameMap.size);
    let nameMapIndex = 0;
    let nameMapEntries = this.nameMap.entries();
    let nameMapEntry = nameMapEntries.next();
    while (!nameMapEntry.done) {
      const [name, id] = nameMapEntry.value;
      nameMap[nameMapIndex] = [name, id];
      nameMapIndex++;
      nameMapEntry = nameMapEntries.next();
    }

    const idMap = new Array<[number, string]>(this.idMap.size);
    let idMapIndex = 0;
    let idMapEntries = this.idMap.entries();
    let idMapEntry = idMapEntries.next();
    while (!idMapEntry.done) {
      const [id, name] = idMapEntry.value;
      idMap[idMapIndex] = [id, name];
      idMapIndex++;
      idMapEntry = idMapEntries.next();
    }

    return {
      blocksByName,
      blocksById,
      nameMap,
      idMap,
    };
  }

  static deserialize(data: {
    blocksByName: [string, Block][];
    blocksById: [number, Block][];
    nameMap: [string, number][];
    idMap: [number, string][];
  }): Registry {
    const registry = new Registry();
    registry.blocksByName = new Map(data.blocksByName);
    registry.blocksById = new Map(data.blocksById);
    registry.nameMap = new Map(data.nameMap);
    registry.idMap = new Map(data.idMap);
    return registry;
  }
}
