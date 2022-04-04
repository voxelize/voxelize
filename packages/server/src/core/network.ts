import http, { createServer } from "http";
import zlib from "zlib";

import { protocol } from "@voxelize/common";
import cors from "cors";
import express, { Express } from "express";
import { WebSocketServer } from "ws";

import { Server } from "..";

const { Message } = protocol;

const corsConfig = {
  origin: "*",
};

/**
 * Network manager of the game, sets up `Express` and a websocket server.
 *
 * @param server - Server that the network resides in
 * @param params - Parameters for this network
 */
class Network {
  /**
   * `Express` instance of the game.
   */
  public app: Express;

  /**
   * HTTP server of the game.
   */
  public http: http.Server;

  /**
   * Websocket server, receives most incoming messages.
   */
  public wss: WebSocketServer;

  /**
   * Whether if the game is running.
   */
  public listening = false;

  constructor(public server: Server) {
    this.app = express();
    this.app.use(cors(corsConfig));

    this.http = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.http });
  }

  /**
   * Starts listening on a specified port.
   *
   * @param port - Port to listen on
   */
  listen = (port: number) => {
    this.http.listen({ port });
    this.listening = true;
  };

  /**
   * Decodes a protocol buffer message to the voxelize schema.
   *
   * @static
   * @param buffer - Protocol buffer
   * @returns A decoded protobuf message
   */
  static decode = (buffer: any) => {
    const message = Message.decode(buffer);
    // @ts-ignore
    message.type = Message.Type[message.type];
    if (message.json) {
      message.json = JSON.parse(message.json);
    }
    return message;
  };

  /**
   * Encodes a message to protocol buffers according to the voxelize schema.
   *
   * @param message - Message to encode
   * @returns Encoded protocol buffers
   */
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
