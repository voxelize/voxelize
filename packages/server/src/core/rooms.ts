import http from "http";

import { Server } from "..";
import { Room } from "../app";

import { Network } from "./network";
import { ClientFilter, ClientType, defaultFilter } from "./shared";

type RoomsParams = {
  maxClients: number;
  pingInterval: number;
  tickInterval: number;
};

class Rooms extends Map<string, Room> {
  constructor(public server: Server, public params: RoomsParams) {
    super();

    const { network } = this.server;

    network.wss.on(
      "connection",
      (client: ClientType, req: http.IncomingMessage) => {
        const roomId = new URLSearchParams(req.url.split("?")[1]).get("room");
        const room = this.get(roomId);

        if (!room) {
          console.warn("Room not found.");
          return;
        }

        room.onConnect(client);
      }
    );

    network.app.get("/has-room", (req, res) => {
      res.json(this.has(req.query.room as string));
    });

    network.app.get("/rooms", (_, res) => {
      const rooms = [];
      this.forEach((room) => {
        rooms.push({
          name: room.name,
          clients: room.clients.map((c) => c.id),
        });
      });
      res.json(rooms);
    });
  }

  createRoom = (name: string) => {
    const { maxClients, pingInterval, tickInterval } = this.params;

    const room = new Room(this, {
      name,
      maxClients,
      pingInterval,
      tickInterval,
    });

    this.set(name, room);

    return room;
  };

  findClient = (id: string) => {
    for (const [, room] of Array.from(this)) {
      const client = room.clients.find((c) => (c.id = id));
      if (client) return client;
    }
    return null;
  };

  broadcast = (event: any, filter: ClientFilter = defaultFilter) => {
    const encoded = Network.encode(event);

    this.filterClients(filter, (client) => {
      client.send(encoded);
    });
  };

  private filterClients = (
    { roomId, exclude, include }: ClientFilter,
    func: (client: ClientType) => void
  ) => {
    include = include || [];
    exclude = exclude || [];

    const pass = (client: ClientType) =>
      include &&
      (!include.length || include.indexOf(client.id) >= 0) &&
      exclude &&
      (!exclude.length || exclude.indexOf(client.id) === -1);

    if (roomId) {
      const room = this.get(roomId);
      if (!room) return [];

      room.clients.forEach((client) => {
        if (pass(client)) func(client);
      });
    } else {
      this.forEach((room) =>
        room.clients.forEach((client) => {
          if (pass(client)) func(client);
        })
      );
    }
  };
}

export { Rooms };
