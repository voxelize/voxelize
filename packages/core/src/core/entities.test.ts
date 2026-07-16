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
    entities: [{ operation, id, type: "probe", metadata, motion: options.motion }],
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
});
