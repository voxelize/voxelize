import * as fflate from "fflate";
import {
  client as WebSocket,
  connection as WebSocketConnection,
} from "websocket";

import protocol from "./protocol";
import { MessageProtocol } from "./types";

export * from "./types";
export * from "./utils";
export { protocol };

const { Message } = protocol.protocol;

/**
 * @noInheritDoc
 */
export class Transport extends WebSocket {
  public connection: WebSocketConnection;

  public static MessageTypes = Message.Type;

  private address: string;
  private secret: string;

  private reconnection: any;

  constructor(public reconnectTimeout?: number) {
    super();

    this.on("connectFailed", (error) => {
      console.log(`Connect Error: ${error.toString()}`);

      if (!this.reconnection) {
        this.tryReconnect();
      }
    });
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
  onAction?: (event: MessageProtocol) => void;

  connect = async (address: string, secret: string) => {
    this.address = address;
    this.secret = secret;

    if (this.connection) {
      this.connection.drop();
      this.connection.close();
      ["message", "close", "error"].forEach((event) => {
        this.connection.removeAllListeners(event);
      });
      if (this.reconnection) {
        clearTimeout(this.reconnection);
      }
    }

    const url = new URL(address);
    super.connect(`${url.href}ws/?secret=${secret}&is_transport=true`);

    return new Promise<void>((resolve) => {
      this.removeAllListeners("connect");

      this.on("connect", (connection) => {
        this.connection = connection;

        console.log("WebSocket Client Connected");

        clearTimeout(this.reconnection);

        connection.on("message", (message) => {
          if (message.type !== "binary") return;

          const decoded = Transport.decodeSync(message.binaryData);
          this.onMessage(decoded);
        });

        connection.on("close", () => {
          console.log("Transport connection closed.");

          if (!this.reconnection) {
            this.tryReconnect();
          }
        });

        connection.on("error", (error) => {
          console.log(`Connection Error: ${error.toString()}`);
        });

        resolve();
      });
    });
  };

  send = (event: MessageProtocol) => {
    if (!this.connection) return;
    this.connection.sendBytes(Buffer.from(Transport.encodeSync(event)));
  };

  tryReconnect = () => {
    if (this.reconnectTimeout && !this.reconnection) {
      this.reconnection = setTimeout(() => {
        clearTimeout(this.reconnection);
        this.reconnection = undefined;
        console.log("Transport reconnecting...");
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
      case "ACTION": {
        this.onAction?.(event);
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
    return protocol.protocol.Message.encode(
      protocol.protocol.Message.create(message)
    ).finish();
  }
}
