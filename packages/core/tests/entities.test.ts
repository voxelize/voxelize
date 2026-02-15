import { MessageProtocol } from "@voxelize/protocol";
import { describe, expect, it } from "vitest";

import { Entities, Entity } from "../src/core/entities";

describe("Entities.onMessage", () => {
  it("ignores create operations for unregistered entity types", () => {
    const entities = new Entities();
    const message: MessageProtocol = {
      type: "ENTITY",
      entities: [
        {
          id: "missing-1",
          type: "npc::ghost",
          operation: "CREATE",
          metadata: { hp: 10 },
        },
      ],
    };

    expect(() => entities.onMessage(message)).not.toThrow();
    expect(entities.getEntityById("missing-1")).toBeUndefined();
  });

  it("ignores update operations for unregistered entity types", () => {
    const entities = new Entities();
    const message: MessageProtocol = {
      type: "ENTITY",
      entities: [
        {
          id: "missing-2",
          type: "npc::ghost",
          operation: "UPDATE",
          metadata: { hp: 11 },
        },
      ],
    };

    expect(() => entities.onMessage(message)).not.toThrow();
    expect(entities.getEntityById("missing-2")).toBeUndefined();
  });
});

describe("Entities.setClass", () => {
  it("invokes function factories without constructor semantics", () => {
    const entities = new Entities();
    let invokedWithNew = false;

    function createGhost(id: string) {
      invokedWithNew = new.target !== undefined;
      return new Entity(id);
    }

    entities.setClass("npc::ghost", createGhost);

    const message: MessageProtocol = {
      type: "ENTITY",
      entities: [
        {
          id: "ghost-1",
          type: "npc::ghost",
          operation: "CREATE",
          metadata: { hp: 20 },
        },
      ],
    };

    entities.onMessage(message);

    expect(invokedWithNew).toBe(false);
    expect(entities.getEntityById("ghost-1")).toBeDefined();
  });
});
