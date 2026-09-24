import { describe, expect, it } from "vitest";

import { worldDefinitionSignature } from "./definition-signature";

describe("world reconnect definitions", () => {
  const sand = { id: 50, faces: [{ name: "top", stageTintMask: 0 }] };
  const base = { blocks: { Sand: sand }, options: { chunkSize: 16, maxHeight: 256, subChunks: 8 } };

  it("accepts reordered map keys and ignores the moving clock", () => {
    const first = { ...base, blocks: { Air: { id: 0 }, Sand: sand }, stats: { time: 12 } };
    const next = { ...base, blocks: { Sand: { faces: sand.faces, id: 50 }, Air: { id: 0 } }, stats: { time: 90 } };
    expect(worldDefinitionSignature(first)).toBe(worldDefinitionSignature(next));
  });

  it("invalidates added blocks, changed existing geometry, and chunk dimensions", () => {
    const signature = worldDefinitionSignature(base);
    expect(worldDefinitionSignature({ ...base, blocks: { ...base.blocks, Pebbles: { id: 34202 } } })).not.toBe(signature);
    expect(worldDefinitionSignature({ ...base, blocks: { Sand: { ...sand, faces: [{ name: "top", stageTintMask: 12 }] } } })).not.toBe(signature);
    expect(worldDefinitionSignature({ ...base, options: { ...base.options, maxHeight: 512 } })).not.toBe(signature);
  });
});
