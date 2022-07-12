import url from "url";

import * as fflate from "fflate";
import {
  client as WebSocket,
  connection as WebSocketConnection,
} from "websocket";

import { protocol } from "./protocol";

const { Message } = protocol;

export class Transport extends WebSocket {
  public connection: WebSocketConnection;

  public static MessageTypes = Message.Type;

  constructor() {
    super();

    this.on("connect", (connection) => {
      this.connection = connection;
    });
  }

  connect = (address: string, secret: string) => {
    const q = url.parse(address, true);
    super.connect(`${q.href}ws/?secret=${secret}&is_transport=true`);
  };

  send = (event: any) => {
    if (!this.connection) return;
    this.connection.sendBytes(Buffer.from(Transport.encodeSync(event)));
  };

  static decodeSync = (buffer: any) => {
    if (buffer[0] === 0x78 && buffer[1] === 0x9c) {
      buffer = fflate.unzlibSync(buffer);
    }

    const message = Message.decode(buffer);
    // @ts-ignore
    message.type = Message.Type[message.type];
    if (message.json) {
      message.json = JSON.parse(message.json);
    }
    return message;
  };

  static encodeSync(message: any) {
    if (message.json) {
      message.json = JSON.stringify(message.json);
    }
    message.type = Message.Type[message.type];
    if (message.entities) {
      message.entities.forEach(
        (entity) => (entity.metadata = JSON.stringify(entity.metadata))
      );
    }
    return protocol.Message.encode(protocol.Message.create(message)).finish();
  }
}
