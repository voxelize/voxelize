import http, { createServer } from "http";
import zlib from "zlib";

import { protocol } from "@voxelize/common";
import cors from "cors";
import express, { Express } from "express";
import WebSocket, { WebSocketServer } from "ws";

import { Server } from "..";

const { Message } = protocol;

const corsConfig = {
  origin: "*",
};

type NetworkParams = {
  test: string;
};

class Network {
  public app: Express;
  public http: http.Server;
  public wss: WebSocketServer;

  public listening = false;

  constructor(public server: Server, public params: NetworkParams) {
    this.app = express();
    this.app.use(cors(corsConfig));

    this.http = createServer(this.app);
    this.wss = new WebSocket.Server({ server: this.http });
  }

  listen = (port: number) => {
    this.http.listen({ port });
    this.listening = true;
  };

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
