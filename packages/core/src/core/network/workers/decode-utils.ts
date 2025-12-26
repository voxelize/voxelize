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
        chunk.lights = new Uint32Array(chunk.lights as ArrayLike<number>);
        transferables.push((chunk.lights as Uint32Array).buffer as ArrayBuffer);
      }
      if (chunk.voxels) {
        chunk.voxels = new Uint32Array(chunk.voxels as ArrayLike<number>);
        transferables.push((chunk.voxels as Uint32Array).buffer as ArrayBuffer);
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
                  geo.indices = new Uint16Array(
                    geo.indices as ArrayLike<number>
                  );
                  transferables.push(
                    (geo.indices as Uint16Array).buffer as ArrayBuffer
                  );
                }
                if (geo.lights) {
                  geo.lights = new Int32Array(geo.lights as ArrayLike<number>);
                  transferables.push(
                    (geo.lights as Int32Array).buffer as ArrayBuffer
                  );
                }
                if (geo.positions) {
                  geo.positions = new Float32Array(
                    geo.positions as ArrayLike<number>
                  );
                  transferables.push(
                    (geo.positions as Float32Array).buffer as ArrayBuffer
                  );
                }
                if (geo.uvs) {
                  geo.uvs = new Float32Array(geo.uvs as ArrayLike<number>);
                  transferables.push(
                    (geo.uvs as Float32Array).buffer as ArrayBuffer
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
