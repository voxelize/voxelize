import assert from "node:assert/strict";

import { beforeEach, describe, it } from "vitest";

import {
  isWarmablePool,
  markPlayInteractive,
  noteLazyBake,
  noteLazyWork,
  readLazyWork,
  readLazyWorkAfterInteractive,
  resetLazyWorkLedger,
  warmableRosterCount,
  warmNextRosterEntry,
} from "./pool-warmup";

describe("warmNextRosterEntry", () => {
  it("bakes the first variant nothing has claimed yet", () => {
    const warm = new Set<string>();
    const baked: string[] = [];

    const isWorked = warmNextRosterEntry(
      ["timber", "arctic"],
      false,
      (type) => warm.has(type),
      (type) => {
        warm.add(type);
        baked.push(type);
      },
    );

    assert.equal(isWorked, true);
    assert.deepEqual(baked, ["timber"]);
  });

  it("walks adults and babies of a family that has them", () => {
    const warm = new Set<string>();
    const baked: string[] = [];
    const key = (type: string, baby: boolean): string =>
      baby ? `${type}:baby` : type;

    while (
      warmNextRosterEntry(
        ["timber"],
        true,
        (type, baby) => warm.has(key(type, baby)),
        (type, baby) => {
          warm.add(key(type, baby));
          baked.push(key(type, baby));
        },
      )
    ) {
      assert.ok(baked.length <= 2);
    }

    assert.deepEqual(baked, ["timber", "timber:baby"]);
  });

  it("skips babies for a family without them", () => {
    const warm = new Set<string>();
    const baked: string[] = [];

    warmNextRosterEntry(
      ["striped"],
      false,
      (type) => warm.has(type),
      (type) => {
        warm.add(type);
        baked.push(type);
      },
    );
    const isMoreWork = warmNextRosterEntry(
      ["striped"],
      false,
      (type) => warm.has(type),
      (type) => baked.push(type),
    );

    assert.equal(isMoreWork, false);
    assert.deepEqual(baked, ["striped"]);
  });
});

describe("warmableRosterCount", () => {
  it("counts adults only when a family has no babies", () => {
    assert.equal(warmableRosterCount(["a", "b", "c"], false), 3);
  });

  it("counts adults and babies when a family has them", () => {
    assert.equal(warmableRosterCount(["a", "b"], true), 4);
  });
});

describe("isWarmablePool", () => {
  it("accepts pools that implement the full warm contract", () => {
    const pool = {
      warmNextVariant: () => true,
      warmableVariantCount: () => 2,
    };
    assert.equal(isWarmablePool(pool), true);
  });

  it("rejects duck-typed pools that omit warmableVariantCount", () => {
    const pool = {
      warmNextVariant: () => true,
    };
    assert.equal(isWarmablePool(pool), false);
  });
});

describe("late work ledger", () => {
  beforeEach(() => {
    resetLazyWorkLedger();
  });

  it("separates work done during load from work done in play", () => {
    noteLazyBake("walker", "tall");
    markPlayInteractive();
    noteLazyWork("mesh", "object:42");

    assert.deepEqual(
      readLazyWork().map((entry) => `${entry.kind} ${entry.label}`),
      ["instance-pool walker:tall", "mesh object:42"],
    );
    assert.deepEqual(
      readLazyWorkAfterInteractive().map(
        (entry) => `${entry.kind} ${entry.label}`,
      ),
      ["mesh object:42"],
    );
  });

  it("reports nothing once the ledger is reset", () => {
    markPlayInteractive();
    noteLazyWork("texture", "walker:short:adult");
    resetLazyWorkLedger();

    assert.deepEqual(readLazyWork(), []);
    assert.deepEqual(readLazyWorkAfterInteractive(), []);
  });
});
