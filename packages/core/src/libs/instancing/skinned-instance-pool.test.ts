import assert from "node:assert/strict";

import * as THREE from "three";
import { describe, it } from "vitest";

import { defineSkinnedFamily } from "./define-skinned-family";
import {
  ownedTextureSource,
  SkinnedFamilyConfig,
  SkinnedInstancePool,
} from "./skinned-instance-pool";
import { buildSkinnedPartsGeometry, SkinnedPart } from "./skinned-parts";

const PARTS: SkinnedPart[] = [
  { bone: 0, size: [0.6, 0.4, 0.8], at: [0, 0.5, 0] },
  { bone: 1, size: [0.3, 0.3, 0.3], at: [0, 0.8, 0.5], pivot: [0, 0.7, 0.35] },
  { bone: 2, size: [0.1, 0.3, 0.1], at: [0, 0.15, 0], pivot: [0, 0.3, 0] },
];

function testConfig(
  overrides: Partial<SkinnedFamilyConfig<"a" | "b">> = {},
): SkinnedFamilyConfig<"a" | "b"> {
  return {
    family: "walker",
    variants: ["a", "b"],
    boneCount: 3,
    partCount: PARTS.length,
    hasBabies: true,
    buildGeometry: () => buildSkinnedPartsGeometry(PARTS),
    buildTexture: () => new THREE.Texture(),
    textureSource: ownedTextureSource,
    ...overrides,
  };
}

describe("buildSkinnedPartsGeometry", () => {
  it("writes bone, pivot and atlas row on every vertex", () => {
    const geometry = buildSkinnedPartsGeometry(PARTS);
    const skin = geometry.getAttribute("skinIndex");
    const weight = geometry.getAttribute("skinWeight");
    const pivot = geometry.getAttribute("pivotOffset");
    const part = geometry.getAttribute("partIndex");
    const position = geometry.getAttribute("position");
    assert.equal(skin.count, position.count);
    for (let v = 0; v < position.count; v++) {
      const row = part.getX(v);
      assert.equal(skin.getX(v), PARTS[row].bone);
      assert.equal(weight.getX(v), 1);
      const expected = PARTS[row].pivot ?? [0, 0, 0];
      assert.deepEqual(
        [pivot.getX(v), pivot.getY(v), pivot.getZ(v)].map((n) =>
          Number(n.toFixed(5)),
        ),
        [...expected],
      );
    }
  });

  it("refuses an empty body", () => {
    assert.throws(() => buildSkinnedPartsGeometry([]), /at least one part/);
  });
});

describe("SkinnedInstancePool", () => {
  it("allocates per variant, reuses freed slots, and refuses unknowns", () => {
    const pool = new SkinnedInstancePool(testConfig(), 2);
    const first = pool.allocate("a");
    const second = pool.allocate("a");
    assert.notEqual(first, -1);
    assert.notEqual(second, -1);
    assert.equal(pool.allocate("a"), -1, "a full variant has no slot");
    assert.notEqual(pool.allocate("b"), -1, "variants have their own slots");
    assert.equal(pool.allocate("c" as "a"), -1, "unknown variants never bake");
    assert.equal(pool.getActiveCount(), 3);

    pool.free(first);
    assert.equal(pool.getActiveCount(), 2);
    assert.notEqual(pool.allocate("a"), -1, "a freed slot is reused");
    pool.dispose();
  });

  it("serves the adult body to babies of a family without babies", () => {
    const pool = new SkinnedInstancePool(testConfig({ hasBabies: false }), 4);
    const slot = pool.allocate("a", true);
    assert.equal(pool.getInstanceType(slot), "a");
    assert.equal(pool.warmableVariantCount(), 2);
    pool.dispose();
  });

  it("warms every adult and baby variant, in roster order", () => {
    const pool = new SkinnedInstancePool(testConfig(), 4);
    const keys: string[] = [];
    for (;;) {
      const key = pool.peekNextVariantKey();
      if (!pool.warmNextVariant()) break;
      keys.push(key!);
    }
    assert.equal(keys.length, pool.warmableVariantCount());
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(pool.peekNextVariantKey(), null);
    pool.dispose();
  });

  it("measures the rig and merges family facts over it", () => {
    const pool = new SkinnedInstancePool(
      testConfig({ rigInfo: () => ({ tail: 2 }) }),
      2,
    );
    const info = pool.getRigInfo("a") as unknown as {
      boneCount: number;
      meshTop: number;
      tail: number;
    };
    assert.equal(info.boneCount, 3);
    assert.ok(Math.abs(info.meshTop - 0.95) < 1e-6);
    assert.equal(info.tail, 2);
    pool.dispose();
  });

  it("seeds and toggles the emissive attribute", () => {
    const pool = new SkinnedInstancePool(
      testConfig({ emissive: (variant) => (variant === "a" ? 1 : 0) }),
      2,
    );
    const slot = pool.allocate("a");
    const mesh = pool.listVariantMeshes().get("a")!;
    const attr = mesh.geometry.getAttribute("instanceEmissive");
    assert.equal(attr.getX(0), 1);
    pool.setEmissive(slot, 0);
    assert.equal(attr.getX(0), 0);
    pool.dispose();
  });
});

describe("defineSkinnedFamily", () => {
  it("compiles named bones into a pool config", () => {
    const family = defineSkinnedFamily({
      type: "critter",
      variants: ["sand", "moss"],
      bones: ["body", "head"],
      parts: () => [
        { bone: "body", size: [0.5, 0.4, 0.7], at: [0, 0.45, 0] },
        { bone: "head", size: [0.3, 0.3, 0.3], at: [0, 0.7, 0.4] },
      ],
    });
    assert.deepEqual(family.bone, { body: 0, head: 1 });
    assert.equal(family.config.boneCount, 2);
    assert.equal(family.config.partCount, 2);
    assert.equal(family.config.family, "critter");
    const geometry = family.config.buildGeometry("moss", false);
    assert.equal(geometry.getAttribute("skinIndex").getX(0), 0);
  });

  it("names the missing bone when a part points at one", () => {
    assert.throws(
      () =>
        defineSkinnedFamily({
          type: "broken",
          variants: ["only"],
          bones: ["body"],
          parts: () => [
            { bone: "tail" as "body", size: [1, 1, 1], at: [0, 0.5, 0] },
          ],
        }),
      /bone "tail", which is not in bones \[body\]/,
    );
  });
});
