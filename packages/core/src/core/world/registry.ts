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

  serialize(): string {
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

    // Blocks are written once, by id; `blocksByName` is rebuilt on the other
    // side from `nameMap`. The object graph is the whole block registry
    // (megabytes of faces and dynamic patterns), and every worker in three
    // pools receives it at world init - so it travels as a single JSON
    // string, which structured clone copies as flat bytes, and each worker
    // parses it off the main thread. Cloning it as an object graph, twice
    // over (by name and by id), was the bulk of `world.initialize()`.
    return JSON.stringify({
      version: SERIALIZED_REGISTRY_VERSION,
      blocksById: Array.from(this.blocksById.entries()).map(([id, block]) => [
        id,
        serializeBlock(block),
      ]),
      nameMap: Array.from(this.nameMap.entries()),
      idMap: Array.from(this.idMap.entries()),
    });
  }

  /**
   * Decodes what {@link Registry.serialize} produced into plain block
   * entries, keyed both ways with shared block objects. Workers that keep
   * their own block tables (the wasm mesher) read this directly;
   * {@link Registry.deserialize} wraps it into a `Registry`.
   */
  static parseSerialized(data: SerializedRegistry): ParsedRegistry {
    const parsed: SerializedRegistryPayload =
      typeof data === "string" ? JSON.parse(data) : data;
    if (parsed.version !== SERIALIZED_REGISTRY_VERSION) {
      throw new Error(
        `registry payload version ${String(parsed.version)} does not match ` +
          `${SERIALIZED_REGISTRY_VERSION}; the worker bundle and the main ` +
          "bundle are out of step",
      );
    }
    const byId = new Map<number, any>(parsed.blocksById);
    const blocksByName: [string, any][] = [];
    for (const [name, id] of parsed.nameMap) {
      const block = byId.get(id);
      if (block === undefined) {
        throw new Error(
          `registry payload names block ${id} ("${name}") that it does not carry`,
        );
      }
      blocksByName.push([name, block]);
    }
    return {
      blocksById: parsed.blocksById,
      blocksByName,
      nameMap: parsed.nameMap,
      idMap: parsed.idMap,
    };
  }

  static deserialize(data: SerializedRegistry): Registry {
    const parsed = Registry.parseSerialized(data);
    const registry = new Registry();
    registry.blocksByName = new Map(parsed.blocksByName);
    registry.blocksById = new Map(parsed.blocksById);
    registry.nameMap = new Map(parsed.nameMap);
    registry.idMap = new Map(parsed.idMap);
    return registry;
  }
}

/**
 * Bumped whenever the shape `serialize` writes changes, so a worker built
 * from an older bundle fails loudly instead of meshing with half a registry.
 */
const SERIALIZED_REGISTRY_VERSION = 2;

/**
 * The wire form of a registry: a JSON string (what `serialize` returns) or,
 * for tests and in-process callers, the already-parsed payload.
 */
export type SerializedRegistry = string | SerializedRegistryPayload;

export type SerializedRegistryPayload = {
  version: number;
  blocksById: [number, any][];
  nameMap: [string, number][];
  idMap: [number, string][];
};

export type ParsedRegistry = {
  blocksById: [number, any][];
  blocksByName: [string, any][];
  nameMap: [string, number][];
  idMap: [number, string][];
};
