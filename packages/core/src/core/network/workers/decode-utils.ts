import { protocol } from "@voxelize/protocol";
import * as fflate from "fflate";

const { Message, Entity } = protocol;

export function decodeMessage(
  buffer: Uint8Array,
  transferables: ArrayBuffer[]
): Record<string, unknown> {
  if (buffer[0] === 0x78 && buffer[1] === 0x9c) {
    buffer = fflate.unzlibSync(buffer);
  }

  const message = Message.toObject(Message.decode(buffer), {
    defaults: true,
  }) as Record<string, unknown>;
  message.type = Message.Type[message.type as number];

  if (message.json) {
    message.json = JSON.parse(message.json as string);
  }

  if (message.entities) {
    (message.entities as Array<Record<string, unknown>>).forEach((entity) => {
      if (entity.metadata) {
        entity.metadata = JSON.parse(entity.metadata as string);
        const metadataObj = entity.metadata as Record<string, unknown>;
        if (metadataObj.json) {
          let json = metadataObj.json;
          while (typeof json === "string") {
            try {
              json = JSON.parse(json);
            } catch {
              break;
            }
          }
          metadataObj.json = json;
        }
      }
      entity.operation = Entity.Operation[entity.operation as number];
    });
  }

  if (message.peers) {
    (message.peers as Array<Record<string, unknown>>).forEach((peer) => {
      if (peer.metadata) {
        peer.metadata = JSON.parse(peer.metadata as string);
      }
    });
  }

  if (message.events) {
    (message.events as Array<Record<string, unknown>>).forEach((event) => {
      try {
        let parsedPayload = event.payload;
        for (let i = 0; i < 5; i++) {
          try {
            parsedPayload = JSON.parse(parsedPayload as string);
          } catch {
            break;
          }
        }
        event.payload = parsedPayload;
      } catch {
        // ignore parse errors
      }
    });
  }

  if (message.chunks) {
    (message.chunks as Array<Record<string, unknown>>).forEach((chunk) => {
      ["lights", "voxels"].forEach((key) => {
        const chunkRecord = chunk as Record<string, unknown>;
        if (chunkRecord[key]) {
          chunkRecord[key] = new Uint32Array(
            chunkRecord[key] as ArrayLike<number>
          );
          transferables.push(
            (chunkRecord[key] as Uint32Array).buffer as ArrayBuffer
          );
        }
      });

      if (chunk.meshes) {
        (chunk.meshes as Array<Record<string, unknown>>).forEach((mesh) => {
          (mesh.geometries as Array<Record<string, unknown>>).forEach(
            (geometry) => {
              if (geometry) {
                const geo = geometry as Record<string, unknown>;
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
          );
        });
      }
    });
  }

  return message;
}
