import { describe, expect, it } from "vitest";
import { BlockDef, ItemDef, secondaryAction } from "./content";

const block = (key: string): BlockDef => ({ key } as unknown as BlockDef);
const item = (key: string, extra: Partial<ItemDef> = {}): ItemDef => ({ id: 1, key, name: key, type: "material", stackSize: 64, ...extra });

describe("right click on a block", () => {
  it("opens windows unless sneaking", () => {
    expect(secondaryAction(block("chest"), undefined, false)).toBe("open");
    expect(secondaryAction(block("chest"), item("planks", { placesBlock: "planks" }), true)).toBe("place");
  });
  it("uses fertiliser, hoes and strikers on blocks", () => {
    expect(secondaryAction(block("wheat_crop"), item("fertiliser", { fertiliser: true }), false)).toBe("use");
    expect(secondaryAction(block("turf"), item("hoe", { tool: { kind: "hoe", tier: 0, speed: 1 } }), false)).toBe("use");
  });
  it("plants food crops on farmland and eats them elsewhere", () => {
    const carrot = item("carrot", { type: "seed", placesBlock: "carrot_crop", food: 3 });
    expect(secondaryAction(block("farmland"), carrot, false)).toBe("place");
    expect(secondaryAction(block("stone"), carrot, false)).toBe("eat");
    expect(secondaryAction(block("stone"), item("glass_bottle"), false)).toBe("fill");
  });
});
