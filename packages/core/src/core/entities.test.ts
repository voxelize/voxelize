import { MessageProtocol } from "@voxelize/protocol";
import { describe, expect, it } from "vitest";

import { Entities, Entity } from "./entities";

type ProbeData = { position: [number, number, number] };

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
  metadata: ProbeData | null = { position: [0, 0, 0] },
): MessageProtocol {
  return {
    type: "ENTITY",
    entities: [{ operation, id, type: "probe", metadata }],
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
