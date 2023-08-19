import * as fflate from "fflate";
import { protocol } from "../../generated/protocol";
import { unpackagePacket } from "../unpackage-packet";

const { Message } = protocol;

self.addEventListener("message", (e) => {
  let { data: buffers } = e;

  if (!Array.isArray(buffers)) {
    buffers = [buffers];
  }

  const transferables: ArrayBuffer[] = [];

  const messages = buffers.map((buffer: Uint8Array) => {
    if (buffer[0] === 0x78 && buffer[1] === 0x9c) {
      buffer = fflate.unzlibSync(buffer);
    }

    const message = Message.toObject(Message.decode(buffer), {
      defaults: true,
    });

    message.packets = message.packets.map((packet: any) => {
      return unpackagePacket(packet, transferables);
    });

    return message;
  });

  // @ts-ignore
  self.postMessage(messages, transferables);
});
