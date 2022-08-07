import url from "url";

import * as fflate from "fflate";
import {
  client as WebSocket,
  connection as WebSocketConnection,
} from "websocket";

import { protocol } from "./protocol";
import { MessageProtocol } from "./types";

export * from "./types";

const { Message } = protocol;

export class Transport extends WebSocket {
  public connection: WebSocketConnection;

  private address: string;
  private secret: string;

  public static MessageTypes = Message.Type;

  constructor(public reconnectTimeout?: number) {
    super();
  }

  onInit?: (event: MessageProtocol) => void;
  onJoin?: (event: MessageProtocol) => void;
  onLeave?: (event: MessageProtocol) => void;
  onError?: (event: MessageProtocol) => void;
  onPeer?: (event: MessageProtocol) => void;
  onEntity?: (event: MessageProtocol) => void;
  onLoad?: (event: MessageProtocol) => void;
  onUnload?: (event: MessageProtocol) => void;
  onUpdate?: (event: MessageProtocol) => void;
  onMethod?: (event: MessageProtocol) => void;
  onChat?: (event: MessageProtocol) => void;
  onTransport?: (event: MessageProtocol) => void;
  onEvent?: (event: MessageProtocol) => void;

  connect = async (address: string, secret: string) => {
    this.address = address;
    this.secret = secret;

    const q = url.parse(address, true);
    super.connect(`${q.href}ws/?secret=${secret}&is_transport=true`);

    return new Promise<void>((resolve, reject) => {
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
        this.tryReconnect();
      });
    });
  };

  send = (event: MessageProtocol) => {
    if (!this.connection) return;
    this.connection.sendBytes(Buffer.from(Transport.encodeSync(event)));
  };

  tryReconnect = () => {
    if (this.reconnectTimeout) {
      const timeout = setTimeout(() => {
        clearTimeout(timeout);
        this.connect(this.address, this.secret);
      }, this.reconnectTimeout);
    }
  };

  private onMessage = (event: MessageProtocol) => {
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
    return message as any as MessageProtocol;
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
