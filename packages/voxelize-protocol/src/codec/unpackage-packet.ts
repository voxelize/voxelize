import { decodeStructToObject } from ".";
import { protocol } from "../generated/protocol";

const { Entity, Packet } = protocol;

export function unpackagePacket(packet: any, transferables?: ArrayBuffer[]) {
  packet.type = Packet.Type[packet.type];

  if (packet.json) {
    packet.json = decodeStructToObject(packet.json);
  }

  if (packet.method && packet.method.payload) {
    packet.method.payload = decodeStructToObject(packet.method.payload);
  }

  if (packet.action && packet.action.payload) {
    packet.action.payload = decodeStructToObject(packet.action.payload);
  }

  if (packet.entities) {
    packet.entities.forEach((entity: any) => {
      if (entity.metainfo) {
        entity.metainfo = decodeStructToObject(entity.metainfo);
      }

      entity.operation = Entity.Operation[entity.operation];
    });
  }

  if (packet.events) {
    packet.events.forEach((event: any) => {
      if (event.payload) {
        event.payload = decodeStructToObject(event.payload);
      }
    });
  }

  if (packet.chunks) {
    packet.chunks.forEach((chunk: any) => {
      if (chunk.metainfo) {
        chunk.metainfo = decodeStructToObject(chunk.metainfo);
      }

      if (transferables) {
        ["lights", "blocks"].forEach((key) => {
          if (chunk[key]) {
            chunk[key] = new Uint32Array(chunk[key]).buffer;
            transferables.push(chunk[key]);
          }
        });

        if (chunk.mesh) {
          ["indices", "lights"].forEach((key) => {
            const { opaque, transparent } = chunk.mesh;

            [opaque, transparent].forEach((mesh) => {
              if (mesh && mesh[key]) {
                mesh[key] = new Int32Array(mesh[key]).buffer;
                transferables.push(mesh[key]);
              }
            });
          });

          ["positions", "uvs"].forEach((key) => {
            const { opaque, transparent } = chunk.mesh;

            [opaque, transparent].forEach((mesh) => {
              if (mesh && mesh[key]) {
                mesh[key] = new Float32Array(mesh[key]).buffer;
                transferables.push(mesh[key]);
              }
            });
          });
        }
      }
    });
  }

  return packet;
}
