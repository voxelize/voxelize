import zlib from "zlib";

import { protocol } from "@voxelize/common";

const { Message } = protocol;

class Network {
  static decode = (buffer: any) => {
    const message = Message.decode(buffer);
    // @ts-ignore
    message.type = Message.Type[message.type];
    if (message.json) {
      message.json = JSON.parse(message.json);
    }
    return message;
  };

  static encode = (message: any) => {
    // @ts-ignore
    message.type = Message.Type[message.type];
    if (message.json) {
      message.json = JSON.stringify(message.json);
    }
    const buffer = Message.encode(Message.create(message)).finish();
    if (buffer.length > 1024) {
      return zlib.deflateSync(buffer);
    }
    return buffer;
  };
}

export { Network };
