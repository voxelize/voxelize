import type { GeometryProtocol } from "@voxelize/protocol";
import { BufferAttribute, BufferGeometry } from "three/webgpu";

import { writeBiomeTint } from "./biome-tint";
import {
  BYTE_VECTOR_STRIDE,
  POSITION_STRIDE,
  packQuantizedPositions,
} from "./vertex-layout";
import { computeNormalsFromBuffers } from "./chunk-normals";
import { computeQuadLightTwist } from "./quad-light";

type TypedArray =
  | Float32Array
  | Uint16Array
  | Uint32Array
  | Int32Array
  | Int8Array
  | Uint8Array;

type TypedArrayConstructor<T extends TypedArray> = {
  new (length: number): T;
  readonly BYTES_PER_ELEMENT: number;
};

/** Where a merge writes: arrays of exactly the length asked for. */
export type MergeStorage = <T extends TypedArray>(
  name: string,
  kind: TypedArrayConstructor<T>,
  length: number,
) => T;

/** Fresh arrays, owned by the geometry built on them (a mesh keeps them). */
export const ownMergeStorage: MergeStorage = (_name, kind, length) =>
  new kind(length);

/**
 * Scratch arrays reused by every merge, for a geometry that is copied
 * somewhere else at once (a region arena slot) and never kept: each
 * attribute's array grows to the largest merge seen and the merge gets a
 * view of the length it asked for, so merging allocates no buffers.
 */
export class ScratchMergeStorage {
  /**
   * By name and array kind: buckets merge different kinds under one name
   * (float positions for fluids, quantized ones for the rest). Keyed by
   * name alone, each switch of kind grew the array half again over the
   * other kind's length: a few thousand alternations held gigabytes.
   */
  private arrays = new Map<string, Map<unknown, TypedArray>>();

  readonly take: MergeStorage = (name, kind, length) => {
    let byKind = this.arrays.get(name);
    if (!byKind) {
      byKind = new Map();
      this.arrays.set(name, byKind);
    }
    let array = byKind.get(kind);
    if (!array || array.length < length) {
      const capacity = Math.max(length, Math.ceil((array?.length ?? 0) * 1.5));
      array = new kind(capacity);
      byKind.set(kind, array);
    }
    return (array as InstanceType<typeof kind>).subarray(0, length) as never;
  };
}

/** What the merged geometry carries beyond the protocol's own arrays. */
export type ChunkMergeExtras = {
  /** A chunk's biome colour corners: present, every vertex gets `biomeTint`. */
  biomeCorners?: Uint8Array;
  chunkSize: number;
  /** Position units per block and bias of quantized positions. */
  positionUnits: number;
  positionBias: number;
  /** Sway profile per voxel id, for buckets whose material sways. */
  swayProfileOf?: (voxel: number) => number;
};

/**
 * One section's geometries of one material bucket as a single indexed
 * geometry, the layout `makeChunkBufferGeometry` gives one of them:
 * position, uv, light, lightTwist, normal, biomeTint when the chunk has
 * colour corners (a quantized position carries the sway profile in its
 * fourth lane when the bucket sways), and an index offset
 * per part. Every array is sized once from the parts and written in place,
 * where a general merge collects plain arrays and copies them again.
 * Returns null for parts whose arrays disagree in type (one quantized, one
 * not), which no one geometry can hold.
 */
export function mergeSectionGeometries(
  parts: readonly GeometryProtocol[],
  extras: ChunkMergeExtras,
  storage: MergeStorage,
): BufferGeometry | null {
  if (parts.length === 0) return null;
  const first = parts[0];
  const positionKind = first.positions.constructor as TypedArrayConstructor<
    Float32Array | Uint16Array
  >;
  const uvKind = first.uvs.constructor as TypedArrayConstructor<
    Float32Array | Uint16Array
  >;
  const lightKind = first.lights.constructor as TypedArrayConstructor<
    Uint32Array | Int32Array
  >;
  const isQuantized = first.positions instanceof Uint16Array;
  const normalKind: TypedArrayConstructor<Float32Array | Int8Array> =
    isQuantized ? Int8Array : Float32Array;

  let vertexCount = 0;
  let indexCount = 0;
  for (const part of parts) {
    if (
      part.positions.constructor !== positionKind ||
      part.uvs.constructor !== uvKind ||
      part.lights.constructor !== lightKind
    ) {
      return null;
    }
    vertexCount += part.positions.length / 3;
    indexCount += part.indices.length;
  }

  // Quantized positions four-wide with the sway profile (vertex-layout).
  const positionStride = isQuantized ? POSITION_STRIDE : 3;
  const positions = storage(
    "position",
    positionKind,
    vertexCount * positionStride,
  );
  const uvs = storage("uv", uvKind, vertexCount * 2);
  const lights = storage("light", lightKind, vertexCount);
  const twists = storage("lightTwist", Uint8Array, vertexCount * 4);
  // Quantized normals and tints are bytes, carried four-wide (vertex-layout).
  const normalStride = isQuantized ? BYTE_VECTOR_STRIDE : 3;
  const normals = storage("normal", normalKind, vertexCount * normalStride);
  const tints = extras.biomeCorners
    ? storage("biomeTint", Uint8Array, vertexCount * BYTE_VECTOR_STRIDE)
    : null;
  const indices =
    vertexCount > 65535
      ? storage("index32", Uint32Array, indexCount)
      : storage("index16", Uint16Array, indexCount);

  let vertex = 0;
  let index = 0;
  for (const part of parts) {
    const count = part.positions.length / 3;
    if (isQuantized) {
      packQuantizedPositions(
        part.positions,
        extras.swayProfileOf?.(part.voxel) ?? 0,
        (positions as Uint16Array).subarray(
          vertex * POSITION_STRIDE,
          (vertex + count) * POSITION_STRIDE,
        ),
      );
    } else {
      positions.set(part.positions, vertex * 3);
    }
    uvs.set(part.uvs, vertex * 2);
    lights.set(part.lights, vertex);
    twists.set(
      part.lightTwist ?? computeQuadLightTwist(part.lights, part.indices),
      vertex * 4,
    );
    const source3 =
      part.normals && part.normals.length > 0
        ? part.normals
        : computeNormalsFromBuffers(part.positions, part.indices);
    const isFlat = !(part.normals && part.normals.length > 0);
    for (let v = 0; v < count; v++) {
      for (let c = 0; c < 3; c++) {
        const value = source3[v * 3 + c];
        normals[(vertex + v) * normalStride + c] =
          isQuantized && isFlat ? Math.round(value * 127) : value;
      }
    }
    if (tints) {
      writeBiomeTint(
        tints,
        vertex * BYTE_VECTOR_STRIDE,
        part.positions,
        part.lights,
        extras.biomeCorners,
        extras.chunkSize,
        isQuantized ? extras.positionUnits : 1,
        isQuantized ? extras.positionBias : 0,
      );
    }
    const source = part.indices;
    for (let i = 0; i < source.length; i++) {
      indices[index + i] = source[i] + vertex;
    }
    index += source.length;
    vertex += count;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(positions, positionStride),
  );
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2, isQuantized));
  geometry.setAttribute("light", new BufferAttribute(lights, 1));
  geometry.setAttribute("lightTwist", new BufferAttribute(twists, 4));
  geometry.setAttribute(
    "normal",
    new BufferAttribute(normals, normalStride, isQuantized),
  );
  if (tints) {
    geometry.setAttribute(
      "biomeTint",
      new BufferAttribute(tints, BYTE_VECTOR_STRIDE, true),
    );
  }
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}
