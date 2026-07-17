import { describe, expect, it } from "vitest";

import {
  coerceMotionBytes,
  decodeMotion,
  normalizeEntityMotion,
} from "./decode-utils";

const FLAG_IN_FLUID = 1 << 0;
const FLAG_HAS_DIRECTION = 1 << 1;
const FLAG_HAS_RIGID_BODY = 1 << 2;
const FLAG_HAS_TARGET = 1 << 3;

type MotionFields = {
  position: [number, number, number];
  direction?: [number, number, number];
  rigidBody?: { isInFluid: boolean; fluidRatio: number };
  targetPosition?: [number, number, number];
};

// Mirrors the encoder in server/world/replication/motion.rs so the layout
// contract is pinned from both sides of the wire.
function encodeMotion(fields: MotionFields): Uint8Array {
  let flags = 0;
  if (fields.direction) flags |= FLAG_HAS_DIRECTION;
  if (fields.rigidBody) {
    flags |= FLAG_HAS_RIGID_BODY;
    if (fields.rigidBody.isInFluid) flags |= FLAG_IN_FLUID;
  }
  if (fields.targetPosition) flags |= FLAG_HAS_TARGET;

  const buffer = new ArrayBuffer(33);
  const view = new DataView(buffer);
  view.setUint8(0, 1);
  view.setUint8(1, flags);
  let offset = 2;
  for (const component of fields.position) {
    view.setInt32(offset, Math.round(component * 512), true);
    offset += 4;
  }
  if (fields.direction) {
    for (const component of fields.direction) {
      view.setInt16(offset, Math.round(component * 512), true);
      offset += 2;
    }
  }
  if (fields.rigidBody) {
    view.setUint8(offset, Math.round(fields.rigidBody.fluidRatio * 255));
    offset += 1;
  }
  if (fields.targetPosition) {
    for (const component of fields.targetPosition) {
      view.setInt32(offset, Math.round(component * 512), true);
      offset += 4;
    }
  }
  return new Uint8Array(buffer, 0, offset);
}

describe("decodeMotion", () => {
  it("decodes a full motion payload within quantization error", () => {
    const decoded = decodeMotion(
      encodeMotion({
        position: [123.456, -78.901, 0.001],
        direction: [0.267, -0.535, 0.802],
        rigidBody: { isInFluid: true, fluidRatio: 0.37 },
        targetPosition: [-1000.25, 87.5, 4321],
      }),
    );

    expect(decoded).toBeDefined();
    const motion = decoded!;
    expect(motion.position[0]).toBeCloseTo(123.456, 2);
    expect(motion.position[1]).toBeCloseTo(-78.901, 2);
    expect(motion.direction![2]).toBeCloseTo(0.802, 2);
    expect(motion.rigidBody).toMatchObject({ isInFluid: true });
    expect(motion.rigidBody!.fluidRatio).toBeCloseTo(0.37, 2);
    expect(motion.targetPosition![0]).toBeCloseTo(-1000.25, 2);
  });

  it("decodes a position-only payload without optional fields", () => {
    const decoded = decodeMotion(encodeMotion({ position: [1, 2, 3] }));

    expect(decoded).toBeDefined();
    expect(decoded!.position).toEqual([1, 2, 3]);
    expect(decoded!.direction).toBeUndefined();
    expect(decoded!.rigidBody).toBeUndefined();
    expect(decoded!.targetPosition).toBeUndefined();
  });

  it("rejects unknown versions and truncated payloads", () => {
    const payload = encodeMotion({ position: [1, 2, 3] });

    const wrongVersion = new Uint8Array(payload);
    wrongVersion[0] = 99;
    expect(decodeMotion(wrongVersion)).toBeUndefined();

    expect(decodeMotion(payload.subarray(0, 10))).toBeUndefined();

    const truncatedTarget = encodeMotion({
      position: [1, 2, 3],
      targetPosition: [4, 5, 6],
    }).subarray(0, 20);
    expect(decodeMotion(truncatedTarget)).toBeUndefined();
  });
});

describe("coerceMotionBytes", () => {
  it("accepts any ArrayBufferView, ArrayBuffer, or plain byte array", () => {
    const payload = encodeMotion({ position: [1, 2, 3] });

    expect(coerceMotionBytes(payload)).toBe(payload);

    // A different view type over the same bytes, at a nonzero offset.
    const padded = new Uint8Array(payload.length + 4);
    padded.set(payload, 4);
    const view = new DataView(padded.buffer, 4, payload.length);
    expect(Array.from(coerceMotionBytes(view) ?? [])).toEqual(
      Array.from(payload),
    );

    const copy = payload.buffer.slice(
      payload.byteOffset,
      payload.byteOffset + payload.byteLength,
    ) as ArrayBuffer;
    expect(Array.from(coerceMotionBytes(copy) ?? [])).toEqual(
      Array.from(payload),
    );

    expect(Array.from(coerceMotionBytes(Array.from(payload)) ?? [])).toEqual(
      Array.from(payload),
    );
  });

  it("returns null for non-byte-like values", () => {
    expect(coerceMotionBytes(null)).toBeNull();
    expect(coerceMotionBytes(undefined)).toBeNull();
  });
});

describe("normalizeEntityMotion", () => {
  it("decodes motion delivered as a non-Uint8Array view", () => {
    const payload = encodeMotion({ position: [4, 5, 6] });
    const entity: Record<string, unknown> = {
      motion: new DataView(
        payload.buffer,
        payload.byteOffset,
        payload.byteLength,
      ),
    };

    normalizeEntityMotion(entity);

    expect(entity.motion).toMatchObject({ position: [4, 5, 6] });
  });

  it("fails safe on undecodable motion so no update applies a missing position", () => {
    const corrupt = encodeMotion({ position: [1, 2, 3] });
    corrupt[0] = 99;
    const entity: Record<string, unknown> = {
      motion: corrupt,
      metadata: { name: "keeper" },
    };

    normalizeEntityMotion(entity);

    // The motion field is removed outright — the update degrades to its
    // metadata (or a keep-alive), never an apply with a half-decoded or
    // absent position.
    expect("motion" in entity).toBe(false);
    expect(entity.metadata).toEqual({ name: "keeper" });

    const empty: Record<string, unknown> = { motion: new Uint8Array(0) };
    normalizeEntityMotion(empty);
    expect("motion" in empty).toBe(false);

    const absent: Record<string, unknown> = {};
    normalizeEntityMotion(absent);
    expect("motion" in absent).toBe(false);
  });
});
