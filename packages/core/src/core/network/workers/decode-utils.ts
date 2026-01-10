import { protocol } from "@voxelize/protocol";
import * as fflate from "fflate";
import * as lz4 from "lz4js";

const { Message, Entity } = protocol;

const LZ4_FRAME_MAGIC = [0x04, 0x22, 0x4d, 0x18];
const ZLIB_MAGIC_0 = 0x78;
const ZLIB_MAGIC_1 = 0x9c;

function isLz4Frame(buffer: Uint8Array): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === LZ4_FRAME_MAGIC[0] &&
    buffer[1] === LZ4_FRAME_MAGIC[1] &&
    buffer[2] === LZ4_FRAME_MAGIC[2] &&
    buffer[3] === LZ4_FRAME_MAGIC[3]
  );
}

function decompressLz4Block(data: Uint8Array): Uint8Array {
  if (data.length < 4) return new Uint8Array(0);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const uncompressedSize = view.getUint32(0, true);
  if (uncompressedSize === 0) return new Uint8Array(0);
  const compressedData = data.subarray(4);
  const result = new Uint8Array(uncompressedSize);
  lz4.decompressBlock(compressedData, result, 0, compressedData.length, 0);
  return result;
}

function decompressToUint32Array(
  data: Uint8Array,
  transferables: ArrayBuffer[]
): Uint32Array {
  if (!data || data.length === 0) return new Uint32Array(0);
  const bytes = decompressLz4Block(data);
  const result = new Uint32Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength / 4
  );
  transferables.push(result.buffer as ArrayBuffer);
  return result;
}

function decompressToInt32Array(
  data: Uint8Array,
  transferables: ArrayBuffer[]
): Int32Array {
  if (!data || data.length === 0) return new Int32Array(0);
  const bytes = decompressLz4Block(data);
  const result = new Int32Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength / 4
  );
  transferables.push(result.buffer as ArrayBuffer);
  return result;
}

function decompressToFloat32Array(
  data: Uint8Array,
  transferables: ArrayBuffer[]
): Float32Array {
  if (!data || data.length === 0) return new Float32Array(0);
  const bytes = decompressLz4Block(data);
  const result = new Float32Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength / 4
  );
  transferables.push(result.buffer as ArrayBuffer);
  return result;
}

function tryParseJSON(str: string): unknown {
  if (typeof str !== "string" || str.length === 0) return str;
  const firstChar = str.charCodeAt(0);
  if (firstChar !== 123 && firstChar !== 91 && firstChar !== 34) return str;
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

function deepParseJSON(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const parsed = tryParseJSON(value);
  if (parsed === value) return value;
  return deepParseJSON(parsed);
}

export function decodeMessage(
  buffer: Uint8Array,
  transferables: ArrayBuffer[]
): Record<string, unknown> {
  if (isLz4Frame(buffer)) {
    buffer = lz4.decompress(buffer);
  } else if (buffer[0] === ZLIB_MAGIC_0 && buffer[1] === ZLIB_MAGIC_1) {
    buffer = fflate.unzlibSync(buffer);
  }

  const message = Message.toObject(Message.decode(buffer), {
    defaults: true,
  }) as Record<string, unknown>;
  message.type = Message.Type[message.type as number];

  if (message.json) {
    message.json = tryParseJSON(message.json as string);
  }

  const entities = message.entities as
    | Array<Record<string, unknown>>
    | undefined;
  if (entities && entities.length > 0) {
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      if (entity.metadata) {
        const parsed = tryParseJSON(entity.metadata as string) as Record<
          string,
          unknown
        >;
        entity.metadata = parsed;
        if (parsed && typeof parsed === "object" && parsed.json) {
          parsed.json = deepParseJSON(parsed.json);
        }
      }
      entity.operation = Entity.Operation[entity.operation as number];
    }
  }

  const peers = message.peers as Array<Record<string, unknown>> | undefined;
  if (peers && peers.length > 0) {
    for (let i = 0; i < peers.length; i++) {
      const peer = peers[i];
      if (peer.metadata) {
        peer.metadata = tryParseJSON(peer.metadata as string);
      }
    }
  }

  const events = message.events as Array<Record<string, unknown>> | undefined;
  if (events && events.length > 0) {
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (event.payload) {
        event.payload = deepParseJSON(event.payload);
      }
    }
  }

  const chunks = message.chunks as Array<Record<string, unknown>> | undefined;
  if (chunks && chunks.length > 0) {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      if (chunk.lights) {
        chunk.lights = decompressToUint32Array(
          chunk.lights as Uint8Array,
          transferables
        );
      }
      if (chunk.voxels) {
        chunk.voxels = decompressToUint32Array(
          chunk.voxels as Uint8Array,
          transferables
        );
      }

      const meshes = chunk.meshes as Array<Record<string, unknown>> | undefined;
      if (meshes) {
        for (let j = 0; j < meshes.length; j++) {
          const geometries = meshes[j].geometries as
            | Array<Record<string, unknown>>
            | undefined;
          if (geometries) {
            for (let k = 0; k < geometries.length; k++) {
              const geo = geometries[k];
              if (geo) {
                if (geo.indices) {
                  const decompressedI32 = decompressToInt32Array(
                    geo.indices as Uint8Array,
                    []
                  );
                  const indices = new Uint16Array(decompressedI32.length);
                  for (let idx = 0; idx < decompressedI32.length; idx++) {
                    indices[idx] = decompressedI32[idx];
                  }
                  geo.indices = indices;
                  transferables.push(indices.buffer as ArrayBuffer);
                }
                if (geo.lights) {
                  geo.lights = decompressToInt32Array(
                    geo.lights as Uint8Array,
                    transferables
                  );
                }
                if (geo.positions) {
                  geo.positions = decompressToFloat32Array(
                    geo.positions as Uint8Array,
                    transferables
                  );
                }
                if (geo.uvs) {
                  geo.uvs = decompressToFloat32Array(
                    geo.uvs as Uint8Array,
                    transferables
                  );
                }
              }
            }
          }
        }
      }
    }
  }

  return message;
}
