import { protocol } from "@voxelize/transport/src/protocol";
import * as fflate from "fflate";

const { Message, Entity } = protocol;

// @ts-ignore
onconnect = (e) => {
  const port = e.ports[0];

  port.onmessage = (e) => {
    let { data: buffers } = e;

    if (!Array.isArray(buffers)) {
      buffers = [buffers];
    }

    const transferables = [];

    const messages = buffers.map((buffer) => {
      if (buffer[0] === 0x78 && buffer[1] === 0x9c) {
        buffer = fflate.unzlibSync(buffer);
      }

      const message = Message.toObject(Message.decode(buffer), {
        defaults: true,
      });
      message.type = Message.Type[message.type];

      if (message.json) {
        message.json = JSON.parse(message.json);
      }

      if (message.entities) {
        message.entities.forEach((entity) => {
          if (entity.metadata) {
            entity.metadata = JSON.parse(entity.metadata);
          }

          entity.operation = Entity.Operation[entity.operation];
        });
      }

      if (message.peers) {
        message.peers.forEach((peer) => {
          if (peer.metadata) {
            peer.metadata = JSON.parse(peer.metadata);
          }
        });
      }

      if (message.events) {
        message.events.forEach((event) => {
          event.payload = JSON.parse(event.payload);
        });
      }

      if (message.chunks) {
        message.chunks.forEach((chunk) => {
          ["lights", "voxels"].forEach((key) => {
            if (chunk[key]) {
              chunk[key] = new Uint32Array(chunk[key]);
              transferables.push(chunk[key].buffer);
            }
          });

          if (chunk.meshes) {
            chunk.meshes.forEach((mesh) => {
              mesh.geometries.forEach((geometry) => {
                ["indices"].forEach((key) => {
                  if (geometry && geometry[key]) {
                    geometry[key] = new Uint16Array(geometry[key]);
                    transferables.push(geometry[key].buffer);
                  }
                });

                ["lights"].forEach((key) => {
                  if (geometry && geometry[key]) {
                    geometry[key] = new Int32Array(geometry[key]);
                    transferables.push(geometry[key].buffer);
                  }
                });

                ["positions", "uvs"].forEach((key) => {
                  if (geometry && geometry[key]) {
                    geometry[key] = new Float32Array(geometry[key]);
                    transferables.push(geometry[key].buffer);
                  }
                });
              });
            });
          }
        });
      }

      return message;
    });

    // @ts-ignore
    port.postMessage(messages, transferables);
  };
};
