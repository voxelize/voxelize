import { protocol } from "@voxelize/protocol";
import * as fflate from "fflate";
import * as lz4 from "lz4js";

import { JsonObject, JsonValue } from "../../../types";

const { Message, Entity } = protocol;

const LZ4_MAGIC_0 = 0x04;
const LZ4_MAGIC_1 = 0x22;
const LZ4_MAGIC_2 = 0x4d;
const LZ4_MAGIC_3 = 0x18;
const ZLIB_MAGIC_0 = 0x78;
const ZLIB_MAGIC_1 = 0x9c;
const EMPTY_U8 = new Uint8Array(0);
const EMPTY_U16 = new Uint16Array(0);
const EMPTY_U32 = new Uint32Array(0);
const EMPTY_I32 = new Int32Array(0);
const EMPTY_F32 = new Float32Array(0);

type DecodedGeometry = {
  indices?: Uint8Array | Uint16Array | Uint32Array;
  lights?: Uint8Array | Int32Array | Uint32Array;
  positions?: Uint8Array | Float32Array;
  uvs?: Uint8Array | Float32Array;
};

type DecodedMesh = {
  geometries?: DecodedGeometry[];
};

type DecodedChunk = {
  lights?: Uint8Array | Uint32Array;
  voxels?: Uint8Array | Uint32Array;
  meshes?: DecodedMesh[];
};

type DecodedEntity = {
  metadata?: string | JsonValue;
  operation?: number | string;
};

type DecodedPeer = {
  metadata?: string | JsonValue;
};

type DecodedEvent = {
  payload?: JsonValue;
};

const pushTransferableBuffer = (
  transferables: ArrayBuffer[],
  view: ArrayBufferView
) => {
  const { buffer } = view;
  if (buffer instanceof ArrayBuffer) {
    transferables.push(buffer);
  }
};

export type DecodedMessage = Record<string, JsonValue | object | undefined> & {
  type: number | string;
  json?: JsonValue;
  entities?: DecodedEntity[];
  peers?: DecodedPeer[];
  events?: DecodedEvent[];
  chunks?: DecodedChunk[];
};

const isJsonObject = (value: JsonValue): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function isLz4Frame(buffer: Uint8Array): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === LZ4_MAGIC_0 &&
    buffer[1] === LZ4_MAGIC_1 &&
    buffer[2] === LZ4_MAGIC_2 &&
    buffer[3] === LZ4_MAGIC_3
  );
}

function decompressLz4Block(data: Uint8Array): Uint8Array {
  if (data.length < 4) return EMPTY_U8;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const uncompressedSize = view.getUint32(0, true);
  if (uncompressedSize === 0) return EMPTY_U8;
  const compressedData = data.subarray(4);
  const result = new Uint8Array(uncompressedSize);
  lz4.decompressBlock(compressedData, result, 0, compressedData.length, 0);
  return result;
}

function decompressToUint32Array(
  data: Uint8Array,
  transferables: ArrayBuffer[]
): Uint32Array {
  if (data.length === 0) return EMPTY_U32;
  const bytes = decompressLz4Block(data);
  if (bytes.length === 0) return EMPTY_U32;
  const result = new Uint32Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength >>> 2
  );
  pushTransferableBuffer(transferables, result);
  return result;
}

function decompressToInt32Array(
  data: Uint8Array,
  transferables?: ArrayBuffer[]
): Int32Array {
  if (data.length === 0) return EMPTY_I32;
  const bytes = decompressLz4Block(data);
  if (bytes.length === 0) return EMPTY_I32;
  const result = new Int32Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength >>> 2
  );
  if (transferables) {
    pushTransferableBuffer(transferables, result);
  }
  return result;
}

function decompressToFloat32Array(
  data: Uint8Array,
  transferables: ArrayBuffer[]
): Float32Array {
  if (data.length === 0) return EMPTY_F32;
  const bytes = decompressLz4Block(data);
  if (bytes.length === 0) return EMPTY_F32;
  const result = new Float32Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength >>> 2
  );
  pushTransferableBuffer(transferables, result);
  return result;
}

function tryParseJSON(str: string): JsonValue {
  if (str.length === 0) return str;
  const firstChar = str.charCodeAt(0);
  const startsWithNumber = firstChar >= 48 && firstChar <= 57;
  const startsWithJsonToken =
    firstChar === 123 || // {
    firstChar === 91 || // [
    firstChar === 34 || // "
    firstChar === 45 || // -
    firstChar === 116 || // t
    firstChar === 102 || // f
    firstChar === 110; // n
  if (!startsWithNumber && !startsWithJsonToken) return str;
  try {
    return JSON.parse(str) as JsonValue;
  } catch {
    return str;
  }
}

function deepParseJSON(value: JsonValue): JsonValue {
  let current = value;
  while (typeof current === "string") {
    const parsed = tryParseJSON(current);
    if (parsed === current) {
      break;
    }
    current = parsed;
  }
  return current;
}

export function decodeMessage(
  buffer: Uint8Array,
  transferables: ArrayBuffer[]
): DecodedMessage {
  if (isLz4Frame(buffer)) {
    buffer = lz4.decompress(buffer);
  } else if (buffer[0] === ZLIB_MAGIC_0 && buffer[1] === ZLIB_MAGIC_1) {
    buffer = fflate.unzlibSync(buffer);
  }

  const message = Message.toObject(Message.decode(buffer), {
    defaults: true,
  }) as DecodedMessage;
  if (typeof message.type === "number") {
    message.type = Message.Type[message.type];
  }

  if (typeof message.json === "string") {
    message.json = tryParseJSON(message.json);
  }

  const entities = message.entities;
  if (entities && entities.length > 0) {
    const entityCount = entities.length;
    for (let i = 0; i < entityCount; i++) {
      const entity = entities[i];
      if (typeof entity.metadata === "string") {
        const parsed = tryParseJSON(entity.metadata);
        entity.metadata = parsed;
        if (isJsonObject(parsed) && parsed.json !== undefined) {
          parsed.json = deepParseJSON(parsed.json);
        }
      }
      if (typeof entity.operation === "number") {
        entity.operation = Entity.Operation[entity.operation];
      }
    }
  }

  const peers = message.peers;
  if (peers && peers.length > 0) {
    const peerCount = peers.length;
    for (let i = 0; i < peerCount; i++) {
      const peer = peers[i];
      if (typeof peer.metadata === "string") {
        peer.metadata = tryParseJSON(peer.metadata);
      }
    }
  }

  const events = message.events;
  if (events && events.length > 0) {
    const eventCount = events.length;
    for (let i = 0; i < eventCount; i++) {
      const event = events[i];
      if (typeof event.payload === "string") {
        event.payload = deepParseJSON(event.payload);
      }
    }
  }

  const chunks = message.chunks;
  if (chunks && chunks.length > 0) {
    const chunkCount = chunks.length;
    for (let i = 0; i < chunkCount; i++) {
      const chunk = chunks[i];

      if (chunk.lights instanceof Uint8Array) {
        chunk.lights = decompressToUint32Array(chunk.lights, transferables);
      }
      if (chunk.voxels instanceof Uint8Array) {
        chunk.voxels = decompressToUint32Array(chunk.voxels, transferables);
      }

      const meshes = chunk.meshes;
      if (meshes) {
        const meshCount = meshes.length;
        for (let j = 0; j < meshCount; j++) {
          const geometries = meshes[j].geometries;
          if (geometries) {
            const geometryCount = geometries.length;
            for (let k = 0; k < geometryCount; k++) {
              const geo = geometries[k];
              if (geo) {
                if (geo.indices instanceof Uint8Array) {
                  const decompressedI32 = decompressToInt32Array(
                    geo.indices
                  );
                  if (decompressedI32.length === 0) {
                    geo.indices = EMPTY_U16;
                    continue;
                  }
                  const decodedIndexCount = decompressedI32.length;
                  const indices = new Uint16Array(decodedIndexCount);
                  for (let idx = 0; idx < decodedIndexCount; idx++) {
                    indices[idx] = decompressedI32[idx];
                  }
                  geo.indices = indices;
                  pushTransferableBuffer(transferables, indices);
                }
                if (geo.lights instanceof Uint8Array) {
                  geo.lights = decompressToInt32Array(
                    geo.lights,
                    transferables
                  );
                }
                if (geo.positions instanceof Uint8Array) {
                  geo.positions = decompressToFloat32Array(
                    geo.positions,
                    transferables
                  );
                }
                if (geo.uvs instanceof Uint8Array) {
                  geo.uvs = decompressToFloat32Array(
                    geo.uvs,
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
