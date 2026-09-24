import { describe, expect, it } from "vitest";

import { BlockEntityLedger } from "./block-entity-ledger";

type Payload = { type: string; symbol?: string };

const CHUNK = "11|-26";
const OTHER_CHUNK = "12|-26";
const VOXEL = "188|66|-404";

const ticker = (symbol: string) => ({
  id: "ticker-1",
  data: { type: "scoreboard", symbol } as Payload,
  etype: "block::scoreboard",
  operation: "UPDATE" as const,
});

describe("BlockEntityLedger", () => {
  it("holds an update whose chunk has no data until the chunk lands, then hands it over once", () => {
    const ledger = new BlockEntityLedger<Payload>();
    ledger.record(VOXEL, CHUNK, ticker("SPCX"), false);

    expect(ledger.get(VOXEL)?.isPendingDelivery).toBe(true);

    const first = ledger.takePendingForChunk(CHUNK);
    expect(first.map((p) => p.entry.data?.symbol)).toEqual(["SPCX"]);

    // The chunk unloading and landing again brings nothing new.
    expect(ledger.takePendingForChunk(CHUNK)).toEqual([]);
    // But the entry itself is still there for readers.
    expect(ledger.get(VOXEL)?.data?.symbol).toBe("SPCX");
  });

  it("delivers the latest data once when several updates arrive before the chunk", () => {
    const ledger = new BlockEntityLedger<Payload>();
    ledger.record(VOXEL, CHUNK, ticker("SPCX"), false);
    ledger.record(VOXEL, CHUNK, ticker("NVDA"), false);

    const pending = ledger.takePendingForChunk(CHUNK);
    expect(pending).toHaveLength(1);
    expect(pending[0].entry.data?.symbol).toBe("NVDA");
  });

  it("does not mark an update pending when the chunk already has data", () => {
    const ledger = new BlockEntityLedger<Payload>();
    ledger.record(VOXEL, CHUNK, ticker("SPCX"), true);

    expect(ledger.get(VOXEL)?.isPendingDelivery).toBe(false);
    expect(ledger.takePendingForChunk(CHUNK)).toEqual([]);
  });

  it("re-pends a voxel that changes after delivery, so the change reaches a chunk that reloads", () => {
    const ledger = new BlockEntityLedger<Payload>();
    ledger.record(VOXEL, CHUNK, ticker("SPCX"), true);
    // The chunk is away when the server pushes a change.
    ledger.record(VOXEL, CHUNK, ticker("TSLA"), false);

    const pending = ledger.takePendingForChunk(CHUNK);
    expect(pending.map((p) => p.entry.data?.symbol)).toEqual(["TSLA"]);
  });

  it("forgets a deleted entity and its chunk index", () => {
    const ledger = new BlockEntityLedger<Payload>();
    ledger.record(VOXEL, CHUNK, ticker("SPCX"), false);
    expect(ledger.delete(VOXEL, CHUNK)).toBe(true);

    expect(ledger.get(VOXEL)).toBeUndefined();
    expect(ledger.takePendingForChunk(CHUNK)).toEqual([]);
    expect(ledger.size).toBe(0);
  });

  it("keeps chunks apart", () => {
    const ledger = new BlockEntityLedger<Payload>();
    ledger.record(VOXEL, CHUNK, ticker("SPCX"), false);
    ledger.record("200|66|-404", OTHER_CHUNK, ticker("AAPL"), false);

    expect(
      ledger.takePendingForChunk(OTHER_CHUNK).map((p) => p.entry.data?.symbol),
    ).toEqual(["AAPL"]);
    expect(ledger.get(VOXEL)?.isPendingDelivery).toBe(true);
  });
});
