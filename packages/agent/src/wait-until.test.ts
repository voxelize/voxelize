import { describe, expect, it } from "vitest";

import {
  describeLastSeen,
  filterWaitCandidates,
  matchesPredicate,
  resolvePath,
} from "./wait-until";

describe("resolvePath", () => {
  const entity = {
    id: "e1",
    kind: "penguin",
    metadata: {
      swimComp: { state: { type: "swimming", target: [1, 2, 3] } },
      depthPref: ["middle"],
      health: { current: 6, max: 6 },
    },
  };

  it("resolves nested dot paths", () => {
    expect(resolvePath(entity, "metadata.swimComp.state.type")).toBe(
      "swimming",
    );
  });

  it("indexes arrays with numeric segments", () => {
    expect(resolvePath(entity, "metadata.swimComp.state.target.1")).toBe(2);
    expect(resolvePath(entity, "metadata.depthPref.0")).toBe("middle");
  });

  it("returns undefined for missing segments", () => {
    expect(resolvePath(entity, "metadata.nope.deeper")).toBeUndefined();
    expect(
      resolvePath(entity, "metadata.depthPref.notANumber"),
    ).toBeUndefined();
    expect(resolvePath(null, "anything")).toBeUndefined();
  });
});

describe("matchesPredicate", () => {
  it("never matches a missing value, whatever the operator", () => {
    for (const op of ["eq", "ne", "gt", "lt", "contains"] as const) {
      expect(
        matchesPredicate(undefined, { path: "x", op, value: "swimming" }),
      ).toBe(false);
    }
  });

  it("compares eq and ne strictly", () => {
    expect(
      matchesPredicate("swimming", { path: "x", op: "eq", value: "swimming" }),
    ).toBe(true);
    expect(matchesPredicate(6, { path: "x", op: "eq", value: "6" })).toBe(
      false,
    );
    expect(
      matchesPredicate("Foraging", { path: "x", op: "ne", value: "swimming" }),
    ).toBe(true);
  });

  it("compares gt and lt only between finite numbers", () => {
    expect(matchesPredicate(5, { path: "x", op: "gt", value: 4 })).toBe(true);
    expect(matchesPredicate(5, { path: "x", op: "lt", value: 4 })).toBe(false);
    expect(matchesPredicate("5", { path: "x", op: "gt", value: 4 })).toBe(
      false,
    );
    expect(matchesPredicate(NaN, { path: "x", op: "gt", value: 4 })).toBe(
      false,
    );
  });

  it("contains works on strings and arrays", () => {
    expect(
      matchesPredicate("deep swimming", {
        path: "x",
        op: "contains",
        value: "swim",
      }),
    ).toBe(true);
    expect(
      matchesPredicate(["middle", "deep"], {
        path: "x",
        op: "contains",
        value: "deep",
      }),
    ).toBe(true);
    expect(
      matchesPredicate(42, { path: "x", op: "contains", value: "4" }),
    ).toBe(false);
  });
});

describe("filterWaitCandidates", () => {
  const entities = [
    { id: "a", kind: "penguin" },
    { id: "b", kind: "emperor-penguin" },
    { id: "c", kind: "shark" },
  ];

  it("matches kind as case-insensitive substring", () => {
    expect(filterWaitCandidates(entities, { kind: "PENGUIN" })).toHaveLength(2);
    expect(filterWaitCandidates(entities, { kind: "shark" })).toHaveLength(1);
  });

  it("matches entityId exactly and combines with kind", () => {
    expect(filterWaitCandidates(entities, { entityId: "b" })).toHaveLength(1);
    expect(
      filterWaitCandidates(entities, { entityId: "c", kind: "penguin" }),
    ).toHaveLength(0);
  });
});

describe("describeLastSeen", () => {
  it("reports the resolved value per candidate, bounded", () => {
    const entities = [
      { id: "a", kind: "fish", metadata: { state: "idle" }, distance: 3 },
      { id: "b", kind: "fish", metadata: {}, distance: 5 },
      { id: "c", kind: "fish", metadata: { state: "swim" }, distance: 9 },
    ];
    const seen = describeLastSeen(entities, "metadata.state", 2);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({
      id: "a",
      kind: "fish",
      value: "idle",
      distance: 3,
    });
    expect(seen[1].value).toBeUndefined();
  });
});
