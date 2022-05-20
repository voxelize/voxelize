import Pako from "pako";

import { protocol } from "../../protocol";

const { Message } = protocol;

self.addEventListener("message", async (e) => {
  let { data: buffer } = e;
  if (buffer[0] === 0x78 && buffer[1] === 0x9c) {
    buffer = Pako.inflate(buffer);
  }
  const message = Message.toObject(Message.decode(buffer), {
    defaults: true,
  });
  message.type = Message.Type[message.type];

  if (message.json) {
    message.json = JSON.parse(message.json);
  }

  if (message.entities) {
    message.entities.forEach(
      (entity) => (entity.metadata = JSON.parse(entity.metadata))
    );
  }

  const transferables = [];

  if (message.chunks) {
    message.chunks.forEach((chunk) => {
      ["heightMap", "lights", "voxels"].forEach((key) => {
        if (chunk[key]) {
          chunk[key] = new Uint32Array(chunk[key]).buffer;
          transferables.push(chunk[key]);
        }
      });

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
    });
  }

  // @ts-ignore
  self.postMessage(message, transferables);
});
