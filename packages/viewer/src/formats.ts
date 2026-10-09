/**
 * Readers for the files a viewer backend writes (`voxelize::viewer`,
 * `server/viewer/format.rs` documents the layouts) and for the bundle the
 * viewer server streams them in. Little-endian; every section starts on a
 * four-byte boundary of its file, so the arrays are views, not copies, as
 * long as the file itself starts on one.
 */

export const CHUNK_MESH_MAGIC = "VXVM";
export const FAR_TILE_MAGIC = "VXVF";
export const FORMAT_VERSION = 1;

/** What each column of a chunk shows from straight above. */
export type ColumnSummary = {
  /** y + 1 of the highest non-empty voxel; 0 for an empty column. */
  top: Uint16Array;
  topId: Uint16Array;
  /** y + 1 of the highest opaque voxel that is neither plant nor fluid. */
  ground: Uint16Array;
  groundId: Uint16Array;
  /** y + 1 of the highest fluid voxel; 0 where there is none. */
  water: Uint16Array;
};

export type MeshGeometry = {
  level: number;
  voxel: number;
  faceName: string | null;
  /** The voxel an isolated face belongs to. */
  at: [number, number, number] | null;
  /** Chunk-local x and z; y relative to the level's base. */
  positions: Float32Array;
  uvs: Float32Array;
  lights: Int32Array;
  indices: Uint32Array;
};

export type ChunkMesh = {
  cx: number;
  cz: number;
  chunkSize: number;
  maxHeight: number;
  levelHeight: number;
  biomeTints: Uint8Array | null;
  summary: ColumnSummary;
  geometries: MeshGeometry[];
};

export type FarTileFile = {
  x0: number;
  z0: number;
  step: number;
  size: number;
  heights: Uint16Array;
  materials: Uint16Array;
  water: Uint16Array;
  layers: Uint8Array[];
};

class Reader {
  private view: DataView;
  at: number;

  constructor(
    readonly buffer: ArrayBuffer,
    readonly start: number,
    readonly end: number,
  ) {
    this.view = new DataView(buffer);
    this.at = start;
  }

  private need(bytes: number) {
    if (this.at + bytes > this.end) {
      throw new Error(
        `truncated: needs ${bytes} bytes at ${this.at - this.start} of ${this.end - this.start}`,
      );
    }
  }

  magic(expected: string) {
    this.need(4);
    const text = String.fromCharCode(
      this.view.getUint8(this.at),
      this.view.getUint8(this.at + 1),
      this.view.getUint8(this.at + 2),
      this.view.getUint8(this.at + 3),
    );
    if (text !== expected) {
      throw new Error(`expected ${expected}, found ${JSON.stringify(text)}`);
    }
    this.at += 4;
  }

  u32() {
    this.need(4);
    const v = this.view.getUint32(this.at, true);
    this.at += 4;
    return v;
  }

  i32() {
    this.need(4);
    const v = this.view.getInt32(this.at, true);
    this.at += 4;
    return v;
  }

  bytes(length: number) {
    this.need(length);
    const out = new Uint8Array(this.buffer, this.at, length);
    this.at += length;
    return out;
  }

  pad() {
    this.at += (4 - ((this.at - this.start) % 4)) % 4;
  }

  /** A typed view when the offset allows one, a copy when it does not. */
  array<T extends Float32Array | Uint32Array | Int32Array | Uint16Array>(
    Kind: {
      new (buffer: ArrayBuffer, offset: number, length: number): T;
      new (length: number): T;
      BYTES_PER_ELEMENT: number;
    },
    length: number,
  ): T {
    const bytes = length * Kind.BYTES_PER_ELEMENT;
    this.need(bytes);
    let out: T;
    if (this.at % Kind.BYTES_PER_ELEMENT === 0) {
      out = new Kind(this.buffer, this.at, length);
    } else {
      out = new Kind(length);
      new Uint8Array(out.buffer).set(
        new Uint8Array(this.buffer, this.at, bytes),
      );
    }
    this.at += bytes;
    return out;
  }
}

const textDecoder = new TextDecoder();

export function decodeChunkMesh(
  buffer: ArrayBuffer,
  offset = 0,
  length = buffer.byteLength - offset,
): ChunkMesh {
  const r = new Reader(buffer, offset, offset + length);
  r.magic(CHUNK_MESH_MAGIC);
  const version = r.u32();
  if (version !== FORMAT_VERSION) {
    throw new Error(
      `chunk mesh format ${version}, this viewer reads ${FORMAT_VERSION}`,
    );
  }
  const cx = r.i32();
  const cz = r.i32();
  const chunkSize = r.u32();
  const maxHeight = r.u32();
  const levelHeight = r.u32();
  const hasTints = r.u32() === 1;
  const tints = r.bytes(12);
  const columns = chunkSize * chunkSize;
  const summary: ColumnSummary = {
    top: new Uint16Array(columns),
    topId: new Uint16Array(columns),
    ground: new Uint16Array(columns),
    groundId: new Uint16Array(columns),
    water: new Uint16Array(columns),
  };
  const packed = r.array(Uint16Array, columns * 5);
  for (let i = 0; i < columns; i++) {
    summary.top[i] = packed[i * 5];
    summary.topId[i] = packed[i * 5 + 1];
    summary.ground[i] = packed[i * 5 + 2];
    summary.groundId[i] = packed[i * 5 + 3];
    summary.water[i] = packed[i * 5 + 4];
  }
  r.pad();
  const count = r.u32();
  const geometries: MeshGeometry[] = [];
  for (let g = 0; g < count; g++) {
    const level = r.u32();
    const voxel = r.u32();
    const nameLength = r.u32();
    const faceName = nameLength
      ? textDecoder.decode(r.bytes(nameLength))
      : null;
    r.pad();
    const hasAt = r.u32() === 1;
    const ax = r.i32();
    const ay = r.i32();
    const az = r.i32();
    const vertices = r.u32();
    const indexCount = r.u32();
    geometries.push({
      level,
      voxel,
      faceName,
      at: hasAt ? [ax, ay, az] : null,
      positions: r.array(Float32Array, vertices * 3),
      uvs: r.array(Float32Array, vertices * 2),
      lights: r.array(Int32Array, vertices),
      indices: r.array(Uint32Array, indexCount),
    });
  }
  return {
    cx,
    cz,
    chunkSize,
    maxHeight,
    levelHeight,
    biomeTints: hasTints ? new Uint8Array(tints) : null,
    summary,
    geometries,
  };
}

export function decodeFarTile(
  buffer: ArrayBuffer,
  offset = 0,
  length = buffer.byteLength - offset,
): FarTileFile {
  const r = new Reader(buffer, offset, offset + length);
  r.magic(FAR_TILE_MAGIC);
  const version = r.u32();
  if (version !== FORMAT_VERSION) {
    throw new Error(
      `far tile format ${version}, this viewer reads ${FORMAT_VERSION}`,
    );
  }
  const x0 = r.i32();
  const z0 = r.i32();
  const step = r.u32();
  const size = r.u32();
  const layerCount = r.u32();
  const samples = size * size;
  const heights = r.array(Uint16Array, samples);
  r.pad();
  const materials = r.array(Uint16Array, samples);
  r.pad();
  const water = r.array(Uint16Array, samples);
  r.pad();
  const layers: Uint8Array[] = [];
  for (let i = 0; i < layerCount; i++) {
    const bytes = r.u32();
    layers.push(r.bytes(bytes));
    r.pad();
  }
  return { x0, z0, step, size, heights, materials, water, layers };
}

/**
 * The viewer server's batch body: records of a JSON header and an optional
 * file, each padded to four bytes so the files stay aligned:
 * `u32 header length, header, pad, u32 file length, file, pad`.
 */
export type BundleEntry<H> = {
  header: H;
  offset: number;
  length: number;
};

export function decodeBundle<H = Record<string, unknown>>(
  buffer: ArrayBuffer,
): BundleEntry<H>[] {
  const out: BundleEntry<H>[] = [];
  const r = new Reader(buffer, 0, buffer.byteLength);
  while (r.at < buffer.byteLength) {
    const headerLength = r.u32();
    const header = JSON.parse(textDecoder.decode(r.bytes(headerLength))) as H;
    r.pad();
    const length = r.u32();
    const offset = r.at;
    r.at += length;
    r.pad();
    out.push({ header, offset, length });
  }
  return out;
}

/** The writer side of {@link decodeBundle}, for servers and tests. */
export function encodeBundle(
  entries: { header: unknown; file?: Uint8Array | null }[],
): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  let length = 0;
  const push = (part: Uint8Array) => {
    parts.push(part);
    length += part.length;
  };
  const u32 = (v: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v, true);
    return b;
  };
  const pad = () => {
    const extra = (4 - (length % 4)) % 4;
    if (extra) push(new Uint8Array(extra));
  };
  for (const entry of entries) {
    const header = encoder.encode(JSON.stringify(entry.header));
    push(u32(header.length));
    push(header);
    pad();
    const file = entry.file ?? new Uint8Array(0);
    push(u32(file.length));
    push(file);
    pad();
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
