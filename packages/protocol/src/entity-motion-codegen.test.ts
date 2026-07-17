import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { protocol } from "./index";

const { Entity } = protocol;
const here = dirname(fileURLToPath(import.meta.url));

describe("Entity protobuf codegen (motion = 5)", () => {
  it("generated Entity.decode handles field 5 as bytes motion", () => {
    const generated = readFileSync(join(here, "protocol.js"), "utf8");
    expect(generated).toMatch(/Entity\.decode\s*=\s*function/);
    // Stale codegen from before messages.proto gained `optional bytes motion = 5`
    // falls through to skipType and never materializes entity.motion — which
    // freezes compact motion.v1 clients while legacy metadata.position still moves.
    expect(generated).toMatch(
      /case\s+5:\s*\{\s*message\.motion\s*=\s*reader\.bytes\(\);/,
    );
  });

  it("round-trips optional motion bytes through Entity.encode/decode", () => {
    const motion = Uint8Array.from([1, 0, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4]);
    const encoded = Entity.encode(
      Entity.create({
        operation: Entity.Operation.UPDATE,
        id: "fauna-1",
        type: "fauna",
        metadata: "",
        motion,
      }),
    ).finish();

    const decoded = Entity.decode(encoded);
    expect(decoded.operation).toBe(Entity.Operation.UPDATE);
    expect(decoded.id).toBe("fauna-1");
    expect(decoded.type).toBe("fauna");
    expect(decoded.motion).toBeInstanceOf(Uint8Array);
    expect(Array.from(decoded.motion as Uint8Array)).toEqual(Array.from(motion));
  });

  it("omits motion when absent so legacy clients stay on metadata.position", () => {
    const encoded = Entity.encode(
      Entity.create({
        operation: Entity.Operation.UPDATE,
        id: "legacy-1",
        type: "fauna",
        metadata: "{\"position\":[1,2,3]}",
      }),
    ).finish();
    const decoded = Entity.decode(encoded);
    expect(decoded.motion == null || decoded.motion.length === 0).toBe(true);
    expect(decoded.metadata).toContain("position");
  });
});
