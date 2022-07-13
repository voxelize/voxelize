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
  }

  onInit?: (event: any) => void;
  onJoin?: (event: any) => void;
  onLeave?: (event: any) => void;
  onError?: (event: any) => void;
  onPeer?: (event: any) => void;
  onEntity?: (event: any) => void;
  onLoad?: (event: any) => void;
  onUnload?: (event: any) => void;
  onUpdate?: (event: any) => void;
  onMethod?: (event: any) => void;
  onChat?: (event: any) => void;
  onTransport?: (event: any) => void;
  onEvent?: (event: any) => void;

  connect = async (address: string, secret: string) => {
    const q = url.parse(address, true);
    super.connect(`${q.href}ws/?secret=${secret}&is_transport=true`);

    return new Promise<void>((resolve) => {
      this.on("connect", (connection) => {
        this.connection = connection;

        console.log("WebSocket Client Connected");

        connection.on("message", (message) => {
          if (message.type !== "binary") return;

          const decoded = Transport.decodeSync(message.binaryData);
          this.onMessage(decoded);
        });

        connection.on("close", function () {
          console.log("Transport connection closed.");
        });

        connection.on("error", function (error) {
          console.log(`Connection Error: ${error.toString()}`);
        });

        resolve();
      });

      this.on("connectFailed", function (error) {
        console.log(`Connect Error: ${error.toString()}`);
      });
    });
  };

  send = (event: any) => {
    if (!this.connection) return;
    this.connection.sendBytes(Buffer.from(Transport.encodeSync(event)));
  };

  private onMessage = (event: any) => {
    switch (event.type) {
      case "INIT": {
        this.onInit?.(event);
        break;
      }
      case "JOIN": {
        this.onJoin?.(event);
        break;
      }
      case "LEAVE": {
        this.onLeave?.(event);
        break;
      }
      case "ERROR": {
        this.onError?.(event);
        break;
      }
      case "PEER": {
        this.onPeer?.(event);
        break;
      }
      case "ENTITY": {
        this.onEntity?.(event);
        break;
      }
      case "LOAD": {
        this.onLoad?.(event);
        break;
      }
      case "UNLOAD": {
        this.onUnload?.(event);
        break;
      }
      case "UPDATE": {
        this.onUpdate?.(event);
        break;
      }
      case "METHOD": {
        this.onMethod?.(event);
        break;
      }
      case "CHAT": {
        this.onChat?.(event);
        break;
      }
      case "TRANSPORT": {
        this.onTransport?.(event);
        break;
      }
      case "EVENT": {
        this.onEvent?.(event);
        break;
      }
    }
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
    if (message.entities) {
      message.entities.forEach((entity) => {
        try {
          entity.metadata = JSON.parse(entity.metadata);
        } catch (e) {
          // do nothing
        }
      });
    }
    if (message.peers) {
      message.peers.forEach((peer) => {
        try {
          peer.metadata = JSON.parse(peer.metadata);
        } catch (e) {
          // do nothing
        }
      });
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
    if (message.peers) {
      message.peers.forEach(
        (peer) => (peer.metadata = JSON.stringify(peer.metadata))
      );
    }
    return protocol.Message.encode(protocol.Message.create(message)).finish();
  }
}
