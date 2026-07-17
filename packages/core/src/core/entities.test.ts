import { EntityMotionProtocol, MessageProtocol } from "@voxelize/protocol";
import { describe, expect, it } from "vitest";

import { Entities, Entity } from "./entities";

type ProbeData = {
  position: [number, number, number];
  direction?: [number, number, number];
  rigidBody?: { isInFluid: boolean; fluidRatio: number };
  target?: { targetType?: string; position?: [number, number, number] | null };
  name?: string;
};

class ProbeEntity extends Entity<ProbeData> {
  public createCount = 0;
  public updateCount = 0;
  public deleteCount = 0;
  public snapCount = 0;

  onCreate = () => {
    this.createCount += 1;
  };

  onUpdate = () => {
    this.updateCount += 1;
  };

  onDelete = () => {
    this.deleteCount += 1;
  };

  snapToTarget = () => {
    this.snapCount += 1;
  };
}

function makeEntities(): Entities {
  const entities = new Entities();
  entities.setClass("probe", ProbeEntity);
  return entities;
}

function entityMessage(
  operation: "CREATE" | "UPDATE" | "DELETE" | "OUT_OF_RANGE",
  id: string,
  metadata: Partial<ProbeData> | null = { position: [0, 0, 0] },
  options: { motion?: EntityMotionProtocol; tick?: number } = {},
): MessageProtocol {
  return {
    type: "ENTITY",
    tick: options.tick,
    entities: [
      { operation, id, type: "probe", metadata, motion: options.motion },
    ],
  } as MessageProtocol;
}

function initMessage(): MessageProtocol {
  return { type: "INIT", json: {} } as MessageProtocol;
}

describe("Entities interest lifecycle", () => {
  it("creates on CREATE and releases on OUT_OF_RANGE through onDelete", () => {
    const entities = makeEntities();

    entities.onMessage(entityMessage("CREATE", "a"));
    const probe = entities.getEntityById("a") as ProbeEntity;
    expect(probe.createCount).toBe(1);

    entities.onMessage(entityMessage("OUT_OF_RANGE", "a", null));
    expect(entities.getEntityById("a")).toBeUndefined();
    expect(probe.deleteCount).toBe(1);
  });

  it("resyncs an existing entity when the server re-creates it", () => {
    const entities = makeEntities();

    entities.onMessage(entityMessage("CREATE", "a"));
    const probe = entities.getEntityById("a") as ProbeEntity;

    entities.onMessage(entityMessage("CREATE", "a"));
    expect(entities.getEntityById("a")).toBe(probe);
    expect(probe.createCount).toBe(1);
    expect(probe.updateCount).toBe(1);
    expect(probe.snapCount).toBe(1);
  });

  it("treats metadata-less updates as keep-alives, never creating", () => {
    const entities = makeEntities();

    entities.onMessage(entityMessage("UPDATE", "ghost", null));
    expect(entities.getEntityById("ghost")).toBeUndefined();
  });

  it("releases every tracked entity when a new session INIT arrives", () => {
    const entities = makeEntities();

    entities.onMessage(entityMessage("CREATE", "a"));
    entities.onMessage(entityMessage("CREATE", "b"));
    const probeA = entities.getEntityById("a") as ProbeEntity;
    const probeB = entities.getEntityById("b") as ProbeEntity;

    entities.onMessage(initMessage());

    expect(entities.map.size).toBe(0);
    expect(probeA.deleteCount).toBe(1);
    expect(probeB.deleteCount).toBe(1);
  });

  it("streams a fresh session cleanly after an INIT resync", () => {
    const entities = makeEntities();

    entities.onMessage(entityMessage("CREATE", "a"));
    entities.onMessage(initMessage());
    entities.onMessage(entityMessage("CREATE", "a"));

    const probe = entities.getEntityById("a") as ProbeEntity;
    expect(probe.createCount).toBe(1);
    expect(entities.map.size).toBe(1);
  });
});

describe("Entities compact motion path", () => {
  it("folds a motion payload into the accumulated metadata", () => {
    const entities = makeEntities();
    entities.onMessage(
      entityMessage("CREATE", "a", {
        position: [0, 0, 0],
        name: "keeper",
        target: { targetType: "Players", position: [1, 1, 1] },
      }),
    );

    entities.onMessage(
      entityMessage("UPDATE", "a", null, {
        motion: {
          position: [5, 6, 7],
          direction: [0, 0, 1],
          rigidBody: { isInFluid: true, fluidRatio: 0.5 },
          targetPosition: [9, 9, 9],
        },
      }),
    );

    const probe = entities.getEntityById("a") as ProbeEntity;
    expect(probe.updateCount).toBe(1);
    expect(probe.metadata).toMatchObject({
      position: [5, 6, 7],
      direction: [0, 0, 1],
      rigidBody: { isInFluid: true, fluidRatio: 0.5 },
      name: "keeper",
      target: { targetType: "Players", position: [9, 9, 9] },
    });
  });

  it("merges partial metadata updates instead of replacing", () => {
    const entities = makeEntities();
    entities.onMessage(
      entityMessage("CREATE", "a", { position: [1, 2, 3], name: "keeper" }),
    );

    // A compact metadata-lane update carries only the non-motion keys.
    entities.onMessage(entityMessage("UPDATE", "a", { name: "renamed" }));

    const probe = entities.getEntityById("a") as ProbeEntity;
    expect(probe.metadata).toMatchObject({
      position: [1, 2, 3],
      name: "renamed",
    });
  });

  it("deep-merges target so metadata-lane updates keep the motion-maintained position", () => {
    const entities = makeEntities();
    entities.onMessage(
      entityMessage("CREATE", "a", {
        position: [0, 0, 0],
        target: { targetType: "Players", position: [1, 1, 1] },
      }),
    );

    // Motion maintains the target position...
    entities.onMessage(
      entityMessage("UPDATE", "a", null, {
        motion: { position: [2, 2, 2], targetPosition: [7, 7, 7] },
      }),
    );

    // ...then a metadata-lane update arrives with target identity only (the
    // compact server strips target.position). It must not drop the
    // motion-maintained position.
    entities.onMessage(
      entityMessage("UPDATE", "a", {
        target: { targetType: "Entities" },
      }),
    );

    const probe = entities.getEntityById("a") as ProbeEntity;
    expect(probe.metadata!.target).toMatchObject({
      targetType: "Entities",
      position: [7, 7, 7],
    });

    // An explicit incoming position (legacy full snapshot shape) still wins.
    entities.onMessage(
      entityMessage("UPDATE", "a", {
        target: { targetType: "Entities", position: [9, 9, 9] },
      }),
    );
    expect(probe.metadata!.target).toMatchObject({ position: [9, 9, 9] });
  });

  it("nulls the target position when motion reports the target lost", () => {
    const entities = makeEntities();
    entities.onMessage(
      entityMessage("CREATE", "a", {
        position: [0, 0, 0],
        target: { targetType: "Players", position: [1, 1, 1] },
      }),
    );

    entities.onMessage(
      entityMessage("UPDATE", "a", null, { motion: { position: [2, 2, 2] } }),
    );

    const probe = entities.getEntityById("a") as ProbeEntity;
    expect(probe.metadata!.target).toMatchObject({
      targetType: "Players",
      position: null,
    });
  });

  it("does not construct entities from motion-only updates", () => {
    const entities = makeEntities();

    entities.onMessage(
      entityMessage("UPDATE", "ghost", null, {
        motion: { position: [1, 2, 3] },
      }),
    );

    expect(entities.getEntityById("ghost")).toBeUndefined();
  });
});

describe("Entities resilience with Town-like consumers", () => {
  // Town-style entity classes destructure/iterate metadata fields directly
  // (`const [x, y, z] = data.position`), so handing them metadata missing
  // those keys throws "x is not iterable" — the live staging breakage.
  class DestructuringEntity extends Entity<ProbeData> {
    public applied: [number, number, number][] = [];

    onCreate = (data: ProbeData) => {
      const [x, y, z] = data.position;
      this.applied.push([x, y, z]);
    };

    onUpdate = (data: ProbeData) => {
      const [x, y, z] = data.position;
      this.applied.push([x, y, z]);
    };
  }

  class ThrowingEntity extends Entity<ProbeData> {
    onCreate = () => {
      // A game-code bug: always throws on apply.
      throw new Error("boom");
    };

    onUpdate = () => {
      throw new Error("boom");
    };
  }

  function makeTownEntities(): Entities {
    const entities = new Entities();
    entities.setClass("probe", ProbeEntity);
    entities.setClass("town", DestructuringEntity);
    entities.setClass("buggy", ThrowingEntity);
    return entities;
  }

  it("never constructs an entity from a partial metadata-lane update", () => {
    const entities = makeTownEntities();

    // A compact metadata-lane payload (position stripped server-side)
    // arrives for an entity whose CREATE this client never processed.
    expect(() =>
      entities.onMessage({
        type: "ENTITY",
        entities: [
          {
            operation: "UPDATE",
            id: "ghost",
            type: "town",
            metadata: { name: "partial-only" },
          },
        ],
      } as MessageProtocol),
    ).not.toThrow();

    expect(entities.getEntityById("ghost")).toBeUndefined();

    // A full snapshot (carries position) still heals against old servers.
    entities.onMessage({
      type: "ENTITY",
      entities: [
        {
          operation: "UPDATE",
          id: "ghost",
          type: "town",
          metadata: { position: [1, 2, 3] },
        },
      ],
    } as MessageProtocol);
    const healed = entities.getEntityById("ghost") as DestructuringEntity;
    expect(healed).toBeDefined();
    expect(healed.applied).toContainEqual([1, 2, 3]);
  });

  it("isolates a throwing entity so the rest of the batch still applies", () => {
    const entities = makeTownEntities();
    entities.onMessage(
      entityMessage("CREATE", "healthy", { position: [0, 0, 0] }),
    );

    // One message carrying a poisoned entity first, then a healthy update:
    // the poison must not abort the batch (or escape the interceptor and
    // stall everything queued behind the message).
    expect(() =>
      entities.onMessage({
        type: "ENTITY",
        entities: [
          {
            operation: "CREATE",
            id: "bad",
            type: "buggy",
            metadata: { position: [1, 1, 1] },
          },
          {
            operation: "UPDATE",
            id: "healthy",
            type: "probe",
            metadata: { position: [9, 9, 9] },
          },
        ],
      } as MessageProtocol),
    ).not.toThrow();

    const healthy = entities.getEntityById("healthy") as ProbeEntity;
    expect(healthy.updateCount).toBe(1);
    expect(healthy.metadata!.position).toEqual([9, 9, 9]);
  });

  it("keeps iterable metadata fields iterable through merges and motion", () => {
    const entities = makeTownEntities();
    entities.onMessage({
      type: "ENTITY",
      entities: [
        {
          operation: "CREATE",
          id: "a",
          type: "town",
          metadata: {
            position: [1, 2, 3],
            path: {
              nodes: [
                [1, 1, 1],
                [2, 2, 2],
              ],
            },
          },
        },
      ],
    } as MessageProtocol);

    // Partial metadata update, then a motion-only update.
    entities.onMessage(entityMessage("UPDATE", "a", { name: "renamed" }));
    entities.onMessage(
      entityMessage("UPDATE", "a", null, { motion: { position: [4, 5, 6] } }),
    );

    const town = entities.getEntityById("a") as DestructuringEntity;
    const metadata = town.metadata as unknown as {
      position: number[];
      path: { nodes: number[][] };
    };
    expect(Array.isArray(metadata.position)).toBe(true);
    expect(metadata.position).toEqual([4, 5, 6]);
    expect(metadata.path.nodes).toEqual([
      [1, 1, 1],
      [2, 2, 2],
    ]);
    expect(town.applied).toContainEqual([4, 5, 6]);
  });
});

describe("Entities out-of-order state protection", () => {
  it("never rewinds an entity to an older tick's state", () => {
    const entities = makeEntities();
    entities.onMessage(entityMessage("CREATE", "a", { position: [0, 0, 0] }));

    entities.onMessage(
      entityMessage("UPDATE", "a", { position: [10, 0, 0] }, { tick: 20 }),
    );
    entities.onMessage(
      entityMessage("UPDATE", "a", { position: [5, 0, 0] }, { tick: 10 }),
    );

    const probe = entities.getEntityById("a") as ProbeEntity;
    expect(probe.metadata!.position).toEqual([10, 0, 0]);
    expect(probe.updateCount).toBe(1);
  });

  it("blocks a stale update from resurrecting a released entity", () => {
    const entities = makeEntities();
    entities.onMessage(
      entityMessage("CREATE", "a", { position: [0, 0, 0] }, { tick: 1 }),
    );
    entities.onMessage(entityMessage("OUT_OF_RANGE", "a", null, { tick: 30 }));

    // A state frame captured before the release arrives late.
    entities.onMessage(
      entityMessage("UPDATE", "a", { position: [5, 0, 0] }, { tick: 20 }),
    );
    expect(entities.getEntityById("a")).toBeUndefined();

    // A genuine re-enter (newer tick) still streams.
    entities.onMessage(
      entityMessage("CREATE", "a", { position: [7, 0, 0] }, { tick: 40 }),
    );
    expect(entities.getEntityById("a")).toBeDefined();
  });

  it("applies a CREATE snapshot even when a newer partial UPDATE raced ahead", () => {
    const entities = makeEntities();

    // An unordered transport delivers a metadata-bearing UPDATE before the
    // reliable CREATE it causally follows.
    entities.onMessage(
      entityMessage("UPDATE", "a", { position: [5, 0, 0] }, { tick: 12 }),
    );
    const probe = entities.getEntityById("a") as ProbeEntity;
    expect(probe).toBeDefined();
    expect(probe.metadata!.name).toBeUndefined();

    // The CREATE (older tick, complete snapshot) must still apply — skipping
    // it would leave the entity permanently missing CREATE-only keys.
    entities.onMessage(
      entityMessage(
        "CREATE",
        "a",
        { position: [4, 0, 0], name: "keeper" },
        { tick: 10 },
      ),
    );
    expect(probe.metadata).toMatchObject({
      position: [4, 0, 0],
      name: "keeper",
    });
    expect(probe.snapCount).toBe(1);

    // The watermark did not regress: state older than the raced-ahead
    // UPDATE stays blocked, newer state applies.
    entities.onMessage(
      entityMessage("UPDATE", "a", { position: [1, 1, 1] }, { tick: 11 }),
    );
    expect(probe.metadata!.position).toEqual([4, 0, 0]);
    entities.onMessage(
      entityMessage("UPDATE", "a", { position: [6, 0, 0] }, { tick: 13 }),
    );
    expect(probe.metadata!.position).toEqual([6, 0, 0]);
  });

  it("keeps the release watermark monotonic so late lifecycle ticks cannot reopen resurrection", () => {
    const entities = makeEntities();
    entities.onMessage(
      entityMessage("CREATE", "a", { position: [0, 0, 0] }, { tick: 1 }),
    );

    // Fresh state applied from the unordered lane...
    entities.onMessage(
      entityMessage("UPDATE", "a", { position: [5, 0, 0] }, { tick: 20 }),
    );

    // ...then the reliable release arrives stamped at an OLDER tick. It must
    // not lower the watermark below the already-applied state.
    entities.onMessage(entityMessage("OUT_OF_RANGE", "a", null, { tick: 18 }));
    expect(entities.getEntityById("a")).toBeUndefined();

    // An in-between stale UPDATE (tick 19) would have resurrected the
    // entity if the watermark had regressed to 18.
    entities.onMessage(
      entityMessage("UPDATE", "a", { position: [9, 9, 9] }, { tick: 19 }),
    );
    expect(entities.getEntityById("a")).toBeUndefined();

    // A genuine re-enter still streams.
    entities.onMessage(
      entityMessage("CREATE", "a", { position: [7, 0, 0] }, { tick: 25 }),
    );
    expect(entities.getEntityById("a")).toBeDefined();
  });
});
