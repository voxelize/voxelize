// The content pack as served by the game server (`/platform/content`), and
// the client's copy of the mining rule. The server enforces the rule; the
// client only uses it to show progress and to know when to ask.

export type ToolKind = "pickaxe" | "axe" | "shovel" | "hoe" | "sword" | "shears";

export type BlockDef = {
  id: number;
  key: string;
  name: string;
  hardness: number;
  texture: { all: string; top?: string | null; bottom?: string | null; side?: string | null };
  tool?: { kind: ToolKind; minTier?: number; required?: boolean } | null;
  fluid?: "water" | "lava" | null;
};

export type ItemDef = {
  id: number;
  key: string;
  name: string;
  type: string;
  stackSize: number;
  durability?: number | null;
  tool?: { kind: ToolKind; tier: number; speed: number } | null;
  placesBlock?: string | null;
};

export type RecipeDef =
  | {
      type: "shaped";
      key: string;
      pattern: string[];
      symbols: Record<string, string>;
      result: { item: string; count?: number };
    }
  | { type: "shapeless"; key: string; ingredients: string[]; result: { item: string; count?: number } };

export type ContentPack = { blocks: BlockDef[]; items: ItemDef[]; recipes: RecipeDef[] };

/** Mirrors `crates/content/src/mining.rs`; parity is pinned by mining.test.ts. */
export const HARVEST_FACTOR = 1.5;
export const WRONG_TOOL_PENALTY = 5.0;

export function canHarvest(block: BlockDef, held: ItemDef | undefined): boolean {
  const req = block.tool;
  if (!req || req.required === false) return true;
  const tool = held?.tool;
  return !!tool && tool.kind === req.kind && tool.tier >= (req.minTier ?? 0);
}

/** Milliseconds a break takes, or `null` for unbreakable blocks. */
export function miningMillis(block: BlockDef, held: ItemDef | undefined): number | null {
  if (block.hardness < 0) return null;
  if (block.hardness === 0) return 0;
  const tool = held?.tool;
  const speed = tool && block.tool && tool.kind === block.tool.kind ? tool.speed : 1;
  const factor = canHarvest(block, held) ? HARVEST_FACTOR : WRONG_TOOL_PENALTY;
  return Math.round(((block.hardness * factor) / speed) * 1000);
}

export class Content {
  readonly blocksById = new Map<number, BlockDef>();
  readonly itemsById = new Map<number, ItemDef>();
  readonly itemsByKey = new Map<string, ItemDef>();

  constructor(readonly pack: ContentPack) {
    pack.blocks.forEach((b) => this.blocksById.set(b.id, b));
    pack.items.forEach((i) => {
      this.itemsById.set(i.id, i);
      this.itemsByKey.set(i.key, i);
    });
  }

  static async fetch(): Promise<Content> {
    const response = await fetch("/platform/content");
    if (!response.ok) throw new Error(`content: HTTP ${response.status}`);
    return new Content(await response.json());
  }

  /** The grid a recipe needs, as item keys, for `platform.craft`. */
  recipeGrid(recipe: RecipeDef): (string | null)[][] {
    if (recipe.type === "shapeless") {
      const size = recipe.ingredients.length > 4 ? 3 : 2;
      const grid: (string | null)[][] = Array.from({ length: size }, () => Array(size).fill(null));
      recipe.ingredients.forEach((item, i) => (grid[Math.floor(i / size)][i % size] = item));
      return grid;
    }
    const height = recipe.pattern.length;
    const width = recipe.pattern[0].length;
    const size = height > 2 || width > 2 ? 3 : 2;
    const grid: (string | null)[][] = Array.from({ length: size }, () => Array(size).fill(null));
    recipe.pattern.forEach((row, y) =>
      [...row].forEach((symbol, x) => {
        grid[y][x] = symbol === " " ? null : recipe.symbols[symbol];
      }),
    );
    return grid;
  }

  /** Item key -> count a recipe consumes. */
  recipeNeeds(recipe: RecipeDef): Map<string, number> {
    const needs = new Map<string, number>();
    this.recipeGrid(recipe)
      .flat()
      .forEach((key) => key && needs.set(key, (needs.get(key) ?? 0) + 1));
    return needs;
  }
}
