import { createServer, Server as HTTPServer } from "http";

import cors from "cors";
import express, { Express } from "express";
import WebSocket, { WebSocketServer } from "ws";

type ServerOptions = {
  port: number;
  peerPort: number;
};

const corsConfig = {
  origin: "*",
};

class Server {
  app: Express;
  server: HTTPServer;
  wss: WebSocketServer;

  constructor(public options: ServerOptions) {
    this.app = express();

    this.app.use(cors(corsConfig));

    this.server = createServer(this.app);
    this.wss = new WebSocket.Server({ server: this.server });

    this.setupEvents();
  }

  setupEvents = () => {
    this.wss.on("connection", (socket) => {
      socket.on("join-room", (roomId: string, userId: string) => {
        console.log(roomId, userId);
      });
    });
  };

  start = (callback?: () => void) => {
    return this.server.listen(
      {
        port: this.options.port,
      },
      callback
        ? callback
        : () => {
            console.log(
              `Voxelize server started on port ${this.options.port}!`
            );
          }
    );
  };
}

export { Server };
