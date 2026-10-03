import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { hasRecipe, SIZE, texturePixels } from "./textures";

const blocksDir = join(__dirname, "../../../game/blocks");

function textureNames(): string[] {
  const names = new Set<string>();
  for (const file of readdirSync(blocksDir).filter((f) => f.endsWith(".json"))) {
    for (const block of JSON.parse(readFileSync(join(blocksDir, file), "utf8"))) {
      const t = block.texture;
      [t.all, t.top, t.bottom, t.side].filter(Boolean).forEach((n: string) => names.add(n));
    }
  }
  return [...names];
}

describe("procedural textures", () => {
  it("are deterministic", () => {
    expect(texturePixels("stone")).toEqual(texturePixels("stone"));
  });

  it("differ between blocks", () => {
    expect(texturePixels("stone")).not.toEqual(texturePixels("dirt"));
  });

  it("cover every texture the content pack names", () => {
    const missing = textureNames().filter((n) => !hasRecipe(n));
    expect(missing).toEqual([]);
  });

  it("produce full 16x16 RGBA buffers, opaque for solid terrain", () => {
    const stone = texturePixels("stone");
    expect(stone.length).toBe(SIZE * SIZE * 4);
    for (let i = 3; i < stone.length; i += 4) expect(stone[i]).toBe(255);
  });
});
