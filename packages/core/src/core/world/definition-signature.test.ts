import { describe, expect, it } from "vitest";

import { worldDefinitionSignature } from "./definition-signature";

describe("world reconnect definitions", () => {
  const sand = { id: 50, faces: [{ name: "top", stageTintMask: 0 }] };
  const base = {
    blocks: { Sand: sand },
    options: { chunkSize: 16, maxHeight: 256, subChunks: 8 },
  };

  it("accepts reordered map keys and ignores the moving clock", () => {
    const first = {
      ...base,
      blocks: { Air: { id: 0 }, Sand: sand },
      stats: { time: 12 },
    };
    const next = {
      ...base,
      blocks: { Sand: { faces: sand.faces, id: 50 }, Air: { id: 0 } },
      stats: { time: 90 },
    };
    expect(worldDefinitionSignature(first)).toBe(
      worldDefinitionSignature(next),
    );
  });

  it("invalidates added blocks, changed existing geometry, and chunk dimensions", () => {
    const signature = worldDefinitionSignature(base);
    expect(
      worldDefinitionSignature({
        ...base,
        blocks: { ...base.blocks, Pebbles: { id: 34202 } },
      }),
    ).not.toBe(signature);
    expect(
      worldDefinitionSignature({
        ...base,
        blocks: {
          Sand: { ...sand, faces: [{ name: "top", stageTintMask: 12 }] },
        },
      }),
    ).not.toBe(signature);
    expect(
      worldDefinitionSignature({
        ...base,
        options: { ...base.options, maxHeight: 512 },
      }),
    ).not.toBe(signature);
  });

  it("lets the server's registry digest stand in for hashing every block", () => {
    const named = { ...base, registryDigest: "abc-10" };
    const signature = worldDefinitionSignature(named);
    // An INIT that left the blocks out (spliced back later, or not at all)
    // signs the same as the full one: the digest names the same registry.
    expect(
      worldDefinitionSignature({
        options: base.options,
        registryDigest: "abc-10",
      }),
    ).toBe(signature);
    expect(
      worldDefinitionSignature({ ...named, blocks: { Other: { id: 9 } } }),
    ).toBe(signature);
    expect(
      worldDefinitionSignature({ ...named, registryDigest: "abd-10" }),
    ).not.toBe(signature);
    expect(worldDefinitionSignature({ ...named, items: [{ id: 1 }] })).not.toBe(
      signature,
    );
    expect(
      worldDefinitionSignature({
        ...named,
        options: { ...base.options, subChunks: 4 },
      }),
    ).not.toBe(signature);
    // A server without digests keeps the block hash.
    expect(worldDefinitionSignature({ ...base, registryDigest: "" })).toBe(
      worldDefinitionSignature(base),
    );
  });

  /** What `World` does with each INIT after the first: sign it against the
   * signature it holds, and count any difference as a definition change. */
  const rejoin = (
    held: string,
    init: Parameters<typeof worldDefinitionSignature>[0],
  ) => {
    const next = worldDefinitionSignature(init, held);
    return { isChanged: next !== held, held: next };
  };

  it("compares by the blocks when a core starts naming its registry", () => {
    // Joined a core without the digest (the client deployed first).
    const held = worldDefinitionSignature(base);

    // The next core sends the digest with the same blocks: a rejoin, not a
    // change of definitions.
    const upgraded = rejoin(held, { ...base, registryDigest: "abc-10" });
    expect(upgraded.isChanged).toBe(false);
    // And stays comparable on the rejoins after it.
    expect(
      rejoin(upgraded.held, { ...base, registryDigest: "abc-10" }),
    ).toEqual({ isChanged: false, held });

    // A digest naming changed blocks is still a change.
    expect(
      rejoin(held, {
        ...base,
        blocks: { ...base.blocks, Pebbles: { id: 34202 } },
        registryDigest: "abd-11",
      }).isChanged,
    ).toBe(true);
  });

  it("compares by digest only when both sides carry one", () => {
    const held = worldDefinitionSignature({
      ...base,
      registryDigest: "abc-10",
    });
    // The blocks are not hashed against a digest-form signature.
    expect(
      rejoin(held, {
        ...base,
        blocks: { Other: { id: 9 } },
        registryDigest: "abc-10",
      }).isChanged,
    ).toBe(false);
    expect(rejoin(held, { ...base, registryDigest: "abd-10" }).isChanged).toBe(
      true,
    );
    // A core rolled back to before the digest: the earlier blocks were never
    // hashed, so there is nothing to compare, and it counts as a change.
    expect(rejoin(held, base).isChanged).toBe(true);
  });
});
