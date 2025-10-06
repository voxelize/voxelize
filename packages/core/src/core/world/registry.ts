import { Block } from ".";

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
    const cleanBlock = (block: Block) => {
      const { dynamicFn, ...rest } = block;
      return rest;
    };

    return JSON.parse(
      JSON.stringify({
        blocksByName: Array.from(this.blocksByName.entries()).map(
          ([name, block]) => [name, cleanBlock(block)]
        ),
        blocksById: Array.from(this.blocksById.entries()).map(([id, block]) => [
          id,
          cleanBlock(block),
        ]),
        nameMap: Array.from(this.nameMap.entries()),
        idMap: Array.from(this.idMap.entries()),
      })
    );
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
