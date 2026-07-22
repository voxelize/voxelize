import { describe, expect, it } from "vitest";

import { protocol } from "./protocol";

const { Message, Mesh } = protocol;

/**
 * Guards the generated protobuf output against a stale regen: the `Mesh.lod`
 * field must survive a real encode/decode round-trip. A skipped
 * `pnpm run proto` after editing messages.proto historically dropped fields
 * silently — this test fails loudly instead.
 */
describe("Mesh.lod wire round-trip", () => {
  it("preserves the lod field through encode/decode", () => {
    const message = Message.create({
      type: Message.Type.LOAD,
      chunks: [
        {
          x: 4,
          z: -2,
          id: "lod-chunk",
          meshes: [
            {
              level: 0,
              lod: 2,
              geometries: [],
            },
          ],
        },
      ],
    });

    const encoded = Message.encode(message).finish();
    const decoded = Message.decode(encoded);

    expect(decoded.chunks).toHaveLength(1);
    expect(decoded.chunks[0].meshes).toHaveLength(1);
    expect(decoded.chunks[0].meshes[0].lod).toBe(2);
    expect(decoded.chunks[0].meshes[0].level).toBe(0);
  });

  it("defaults lod to 0 for full-detail meshes from older servers", () => {
    const legacy = Message.encode(
      Message.create({
        type: Message.Type.LOAD,
        chunks: [{ x: 0, z: 0, id: "full", meshes: [{ level: 3 }] }],
      }),
    ).finish();

    const decoded = Message.toObject(Message.decode(legacy), {
      defaults: true,
    });

    expect(decoded.chunks[0].meshes[0].lod).toBe(0);
    expect(decoded.chunks[0].meshes[0].level).toBe(3);
  });

  it("keeps the generated Mesh type in sync with the schema", () => {
    const mesh = Mesh.create({ level: 1, lod: 3 });
    expect(mesh.lod).toBe(3);
  });
});
