import { MessageProtocol } from "@voxelize/protocol";
import { describe, expect, it } from "vitest";

import { Entities } from "../src/core/entities";

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
