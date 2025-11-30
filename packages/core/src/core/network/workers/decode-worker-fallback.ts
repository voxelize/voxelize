import { protocol } from "@voxelize/protocol";
import * as fflate from "fflate";

const { Message, Entity } = protocol;

onmessage = (e) => {
  let { data: buffers } = e;

  if (!Array.isArray(buffers)) {
    buffers = [buffers];
  }

  const transferables: Transferable[] = [];

  const messages = buffers.map((buffer: Uint8Array) => {
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
        } catch (e) {
          console.log(e);
        }
      });
    }

    if (message.chunks) {
      (message.chunks as Array<Record<string, unknown>>).forEach((chunk) => {
        ["lights", "voxels"].forEach((key) => {
          if ((chunk as Record<string, unknown>)[key]) {
            (chunk as Record<string, unknown>)[key] = new Uint32Array(
              (chunk as Record<string, unknown>)[key] as ArrayLike<number>
            );
            transferables.push(
              ((chunk as Record<string, unknown>)[key] as Uint32Array).buffer
            );
          }
        });

        if (chunk.meshes) {
          (chunk.meshes as Array<Record<string, unknown>>).forEach((mesh) => {
            (mesh.geometries as Array<Record<string, unknown>>).forEach(
              (geometry) => {
                ["indices"].forEach((key) => {
                  if (geometry && (geometry as Record<string, unknown>)[key]) {
                    (geometry as Record<string, unknown>)[key] =
                      new Uint16Array(
                        (geometry as Record<string, unknown>)[
                          key
                        ] as ArrayLike<number>
                      );
                    transferables.push(
                      (
                        (geometry as Record<string, unknown>)[
                          key
                        ] as Uint16Array
                      ).buffer
                    );
                  }
                });

                ["lights"].forEach((key) => {
                  if (geometry && (geometry as Record<string, unknown>)[key]) {
                    (geometry as Record<string, unknown>)[key] = new Int32Array(
                      (geometry as Record<string, unknown>)[
                        key
                      ] as ArrayLike<number>
                    );
                    transferables.push(
                      ((geometry as Record<string, unknown>)[key] as Int32Array)
                        .buffer
                    );
                  }
                });

                ["positions", "uvs"].forEach((key) => {
                  if (geometry && (geometry as Record<string, unknown>)[key]) {
                    (geometry as Record<string, unknown>)[key] =
                      new Float32Array(
                        (geometry as Record<string, unknown>)[
                          key
                        ] as ArrayLike<number>
                      );
                    transferables.push(
                      (
                        (geometry as Record<string, unknown>)[
                          key
                        ] as Float32Array
                      ).buffer
                    );
                  }
                });
              }
            );
          });
        }
      });
    }

    return message;
  });

  postMessage(messages, { transfer: transferables });
};
