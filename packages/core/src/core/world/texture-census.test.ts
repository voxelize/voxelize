import { describe, expect, it } from "vitest";

import {
  emptyTally,
  IsolatedFaceLedger,
  sortUnpainted,
  tallyState,
  type UnpaintedSurface,
} from "./texture-census";

type FakeMaterial = { name: string };

const PANEL_ID = 40026;
const FACE = "platepz";
const voxelKey = (x: number, y: number, z: number) =>
  `${PANEL_ID}-${FACE}-${x}-${y}-${z}`;

const entryAt = (x: number, y: number, z: number, name = "m") => ({
  blockId: PANEL_ID,
  faceName: FACE,
  voxel: [x, y, z] as [number, number, number],
  material: { name } as FakeMaterial,
});

describe("IsolatedFaceLedger", () => {
  it("registers a seeded material and lets the real paint promote it", () => {
    const ledger = new IsolatedFaceLedger<FakeMaterial>();
    const key = voxelKey(1, 2, 3);
    ledger.note(key, entryAt(1, 2, 3), "unknown", 100);
    expect(ledger.get(key)?.state).toBe("unknown");
    expect(ledger.get(key)?.createdAt).toBe(100);

    ledger.note(key, entryAt(1, 2, 3), "painted", 250);
    expect(ledger.get(key)?.state).toBe("painted");
    // The first sighting keeps its birth time.
    expect(ledger.get(key)?.createdAt).toBe(100);
  });

  it("never lets a later seed demote a painted face", () => {
    const ledger = new IsolatedFaceLedger<FakeMaterial>();
    const key = voxelKey(1, 2, 3);
    ledger.note(key, entryAt(1, 2, 3), "painted", 0);
    ledger.note(key, entryAt(1, 2, 3), "default", 10);
    expect(ledger.get(key)?.state).toBe("painted");
  });

  it("finds the faces of one block still on the checker, and only those", () => {
    const ledger = new IsolatedFaceLedger<FakeMaterial>();
    ledger.note(voxelKey(0, 0, 0), entryAt(0, 0, 0, "a"), "unknown", 0);
    ledger.note(voxelKey(3, 0, 0), entryAt(3, 0, 0, "b"), "default", 0);
    ledger.note(voxelKey(6, 0, 0), entryAt(6, 0, 0, "c"), "unknown", 0);
    ledger.note(
      `77-screen-0-0-0`,
      { ...entryAt(0, 0, 0, "d"), blockId: 77, faceName: "screen" },
      "unknown",
      0,
    );

    const unknownPanels = ledger.entriesForFace(PANEL_ID, FACE, "unknown");
    expect(unknownPanels.map((e) => e.entry.material.name).sort()).toEqual([
      "a",
      "c",
    ]);
    expect(ledger.entriesForFace(PANEL_ID, FACE)).toHaveLength(3);
    expect(ledger.entriesForFace(77, "screen", "unknown")).toHaveLength(1);
  });

  it("forgets a removed material and empties its face index", () => {
    const ledger = new IsolatedFaceLedger<FakeMaterial>();
    const key = voxelKey(1, 1, 1);
    ledger.note(key, entryAt(1, 1, 1), "unknown", 0);
    expect(ledger.remove(key)).toBe(true);
    expect(ledger.get(key)).toBeUndefined();
    expect(ledger.entriesForFace(PANEL_ID, FACE)).toEqual([]);
    expect(ledger.size).toBe(0);
    expect(ledger.remove(key)).toBe(false);
  });
});

describe("tallies and ordering", () => {
  it("counts every state into the tally", () => {
    const tally = emptyTally();
    tallyState(tally, "painted");
    tallyState(tally, "painted");
    tallyState(tally, "unknown");
    tallyState(tally, "default");
    tallyState(tally, "fallback");
    expect(tally).toEqual({
      total: 5,
      painted: 2,
      default: 1,
      fallback: 1,
      unknown: 1,
    });
  });

  it("lists the checker first, then fallbacks, then defaults still waiting", () => {
    const surface = (
      state: UnpaintedSurface["state"],
      blockName: string,
    ): UnpaintedSurface => ({
      kind: "isolated-face",
      state,
      blockId: 1,
      blockName,
      faceName: "f",
      textureGroup: null,
    });
    const sorted = sortUnpainted([
      surface("default", "Painting"),
      surface("unknown", "Zebra Block"),
      surface("fallback", "Screen"),
      surface("unknown", "Apple Block"),
    ]);
    expect(sorted.map((s) => `${s.state}:${s.blockName}`)).toEqual([
      "unknown:Apple Block",
      "unknown:Zebra Block",
      "fallback:Screen",
      "default:Painting",
    ]);
  });
});
