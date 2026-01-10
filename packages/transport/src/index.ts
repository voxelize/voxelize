import { protocol } from "@voxelize/protocol";
import * as fflate from "fflate";
import * as lz4 from "lz4js";
import {
  client as WebSocket,
  connection as WebSocketConnection,
} from "websocket";

import { MessageProtocol } from "./types";

const { Message, Entity } = protocol;

function tryParseJSON(str: string): unknown {
  if (typeof str !== "string" || str.length === 0) return str;
  const firstChar = str.charCodeAt(0);
  if (firstChar !== 123 && firstChar !== 91 && firstChar !== 34) return str;
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

function deepParseJSON(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const parsed = tryParseJSON(value);
  if (parsed === value) return value;
  return deepParseJSON(parsed);
}

function decompressLz4Block(data: Uint8Array): Uint8Array {
  if (data.length < 4) return new Uint8Array(0);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const uncompressedSize = view.getUint32(0, true);
  if (uncompressedSize === 0) return new Uint8Array(0);
  const compressedData = data.subarray(4);
  const result = new Uint8Array(uncompressedSize);
  lz4.decompressBlock(compressedData, result, 0, compressedData.length, 0);
  return result;
}

function decompressToUint32Array(data: Uint8Array): Uint32Array {
  if (!data || data.length === 0) return new Uint32Array(0);
  const bytes = decompressLz4Block(data);
  return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

function decompressToInt32Array(data: Uint8Array): Int32Array {
  if (!data || data.length === 0) return new Int32Array(0);
  const bytes = decompressLz4Block(data);
  return new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

function decompressToFloat32Array(data: Uint8Array): Float32Array {
  if (!data || data.length === 0) return new Float32Array(0);
  const bytes = decompressLz4Block(data);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

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

  async connect(address: string, secret: string) {
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
  }

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
    const isLz4Frame =
      buffer.length >= 4 &&
      buffer[0] === 0x04 &&
      buffer[1] === 0x22 &&
      buffer[2] === 0x4d &&
      buffer[3] === 0x18;

    if (isLz4Frame) {
      buffer = lz4.decompress(buffer);
    } else if (buffer[0] === 0x78 && buffer[1] === 0x9c) {
      buffer = fflate.unzlibSync(buffer);
    }

    const message = Message.toObject(Message.decode(buffer), {
      defaults: true,
    });
    message.type = Message.Type[message.type];

    if (message.json) {
      message.json = tryParseJSON(message.json);
    }

    if (message.entities) {
      for (let i = 0; i < message.entities.length; i++) {
        const entity = message.entities[i];
        if (entity.metadata) {
          entity.metadata = tryParseJSON(entity.metadata);
        }
        entity.operation = Entity.Operation[entity.operation];
      }
    }

    if (message.peers) {
      for (let i = 0; i < message.peers.length; i++) {
        const peer = message.peers[i];
        if (peer.metadata) {
          peer.metadata = tryParseJSON(peer.metadata);
        }
      }
    }

    if (message.events) {
      for (let i = 0; i < message.events.length; i++) {
        const event = message.events[i];
        if (event.payload) {
          event.payload = deepParseJSON(event.payload);
        }
      }
    }

    if (message.chunks) {
      for (let i = 0; i < message.chunks.length; i++) {
        const chunk = message.chunks[i];
        if (chunk.lights) {
          chunk.lights = decompressToUint32Array(chunk.lights);
        }
        if (chunk.voxels) {
          chunk.voxels = decompressToUint32Array(chunk.voxels);
        }

        if (chunk.meshes) {
          for (let j = 0; j < chunk.meshes.length; j++) {
            const mesh = chunk.meshes[j];
            if (mesh.geometries) {
              for (let k = 0; k < mesh.geometries.length; k++) {
                const geometry = mesh.geometries[k];
                if (geometry) {
                  if (geometry.indices) {
                    const decompressedI32 = decompressToInt32Array(
                      geometry.indices
                    );
                    const indices = new Uint16Array(decompressedI32.length);
                    for (let idx = 0; idx < decompressedI32.length; idx++) {
                      indices[idx] = decompressedI32[idx];
                    }
                    geometry.indices = indices;
                  }
                  if (geometry.lights) {
                    geometry.lights = decompressToInt32Array(geometry.lights);
                  }
                  if (geometry.positions) {
                    geometry.positions = decompressToFloat32Array(
                      geometry.positions
                    );
                  }
                  if (geometry.uvs) {
                    geometry.uvs = decompressToFloat32Array(geometry.uvs);
                  }
                }
              }
            }
          }
        }
      }
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
    return Message.encode(Message.create(message)).finish();
  }
}
