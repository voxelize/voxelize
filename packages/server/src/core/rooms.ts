import http from "http";

import { Server } from "..";

import { Network } from "./network";
import { Room } from "./room";
import { ClientType } from "./shared";

type ClientFilter = { roomId?: string; exclude?: string[]; include?: string[] };

const defaultFilter: ClientFilter = {
  roomId: "",
  exclude: [],
  include: [],
};

type RoomsOptions = {
  maxClients: number;
  pingInterval: number;
};

class Rooms {
  private list: Map<string, Room> = new Map();

  constructor(public server: Server, public options: RoomsOptions) {
    const { network } = this.server;

    network.wss.on(
      "connection",
      (client: ClientType, req: http.IncomingMessage) => {
        const roomId = new URLSearchParams(req.url.split("?")[1]).get("room");
        const room = this.list.get(roomId);

        if (!room) {
          console.warn("Room not found.");
          return;
        }

        room.onConnect(client);
      }
    );

    network.app.get("/has-room", (req, res) => {
      res.json(this.list.has(req.query.room as string));
    });

    network.app.get("/rooms", (_, res) => {
      const rooms = [];
      this.list.forEach((room) => {
        rooms.push({
          name: room.name,
          clients: room.clients.map((c) => c.id),
        });
      });
      res.json(rooms);
    });
  }

  createRoom = (name: string) => {
    const { maxClients, pingInterval } = this.options;

    const room = new Room(name, {
      maxClients,
      pingInterval,
    });

    this.list.set(name, room);

    return room;
  };

  findClient = (id: string) => {
    for (const [, room] of Array.from(this.list)) {
      const client = room.clients.find((c) => (c.id = id));
      if (client) return client;
    }
    return null;
  };

  broadcast = (event: any, filter: ClientFilter = defaultFilter) => {
    const encoded = Network.encode(event);

    return this.filterClients(filter, (client) => {
      client.send(encoded);
    });
  };

  private filterClients = (
    { roomId, exclude, include }: ClientFilter,
    func: (client: ClientType) => void
  ) => {
    const pass = (client: ClientType) =>
      include &&
      (!include.length || include.indexOf(client.id) >= 0) &&
      exclude &&
      (!exclude.length || exclude.indexOf(client.id) === -1);

    if (roomId) {
      const room = this.list.get(roomId);
      if (!room) return [];

      room.clients.forEach((client) => {
        if (pass(client)) func(client);
      });
    } else {
      this.list.forEach((room) =>
        room.clients.forEach((client) => {
          if (pass(client)) func(client);
        })
      );
    }
  };
}

export { Rooms };
