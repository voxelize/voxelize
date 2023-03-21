import { protocol } from "@voxelize/transport/src/protocol";

// @ts-ignore
import * as fflate from "fflate";

const { Message, Entity } = protocol;

// @ts-ignore
onconnect = (e) => {
  const port = e.ports[0];

  port.start();

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

      if (message.chunks) {
        message.chunks.forEach((chunk) => {
          ["lights", "voxels"].forEach((key) => {
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
        });
      }

      return message;
    });

    // @ts-ignore
    port.postMessage(messages, transferables);
  };
};
