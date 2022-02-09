import http, { createServer } from "http";
import zlib from "zlib";

import { protocol } from "@voxelize/common";
import cors from "cors";
import express, { Express } from "express";
import { v4 as uuidv4 } from "uuid";
import WebSocket, { WebSocketServer } from "ws";

const { Message } = protocol;

const corsConfig = {
  origin: "*",
};

type ClientType = WebSocket & {
  id: string;
  name: string;
  isAlive: boolean;
};

type NetworkOptions = {
  maxClients: number;
  pingInterval: number; // ms
};

class Network {
  public app: Express;
  public server: http.Server;
  public wss: WebSocketServer;

  private clients: ClientType[] = [];
  private pingInterval: NodeJS.Timeout;

  constructor(public options: NetworkOptions) {
    this.app = express();
    this.app.use(cors(corsConfig));

    this.server = createServer(this.app);
    this.wss = new WebSocket.Server({ server: this.server });

    this.wss.on("connection", (client: ClientType) => {
      this.onConnect(client);
    });
  }

  listen = (port: number) => {
    this.server.listen({ port });
  };

  broadcast = (
    event: any,
    { exclude, include }: { exclude?: string[]; include?: string[] } = {
      exclude: [],
      include: [],
    }
  ) => {
    exclude = exclude || [];
    include = include || [];

    const encoded = Network.encode(event);

    this.clients.forEach((client) => {
      if (
        (!include.length || include.indexOf(client.id) >= 0) &&
        (!exclude.length || exclude.indexOf(client.id) === -1)
      ) {
        client.send(encoded);
      }
    });
  };

  private onConnect = (client: ClientType) => {
    const { maxClients, pingInterval } = this.options;

    if (this.clients.length === maxClients) {
      client.send(
        Network.encode({
          type: Message.Type.ERROR,
          text: "Server full. Try again later.",
        })
      );
      client.terminate();
      return;
    }

    client.id = uuidv4();
    client.isAlive = true;

    this.broadcast({
      type: "JOIN",
      text: client.id,
    });

    client.once("close", () => this.onDisconnect(client));
    client.on("message", (data) => this.onMessage(client, data));
    client.on("pong", () => (client.isAlive = true));

    if (!this.pingInterval) {
      this.pingInterval = setInterval(this.ping, pingInterval);
    }

    this.clients.push(client);
  };

  onMessage = (client: ClientType, data: WebSocket.Data) => {
    let request: protocol.Message;
    try {
      request = Network.decode(data);
    } catch (e) {
      return;
    }
    this.onRequest(client, request);
  };

  onRequest = (client: ClientType, request: protocol.Message) => {
    switch (request.type) {
      default:
        break;
    }
  };

  private onDisconnect = (client: ClientType) => {
    const { id } = client;
    const index = this.clients.findIndex((c) => c.id === id);

    if (index >= 0) {
      this.clients.splice(index, 1);
      this.broadcast({
        type: "LEAVE",
        text: client.id,
      });
    }
  };

  private ping = () => {
    this.clients.forEach((client) => {
      if (client.isAlive === false) {
        client.terminate();
        return;
      }
      client.isAlive = false;
      client.ping();
    });
  };

  private static decode = (buffer: any) => {
    const message = Message.decode(buffer);
    // @ts-ignore
    message.type = Message.Type[message.type];
    if (message.json) {
      message.json = JSON.parse(message.json);
    }
    return message;
  };

  private static encode = (message: any) => {
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
