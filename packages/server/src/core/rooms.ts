import http from "http";

import WebSocket from "ws";

import { Server } from "..";
import { ChunkRequestsComponent } from "../app/comps";
import { Client } from "../app/ents";
import { Room, RoomParams } from "../app/room";

import { Network } from "./network";
import { ClientFilter, defaultFilter } from "./shared";

/**
 * Manager of all rooms. Handles the following:
 * - Client connection, directing traffic to corresponding rooms.
 * - Sets up debugging route `/rooms` and `/has-room`.
 *
 * @param server - Server instance that the rooms exist in
 */
class Rooms extends Map<string, Room> {
  constructor(public server: Server) {
    super();

    const { network } = this.server;

    network.wss.on(
      "connection",
      (client: WebSocket, req: http.IncomingMessage) => {
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
      const fields = ["id", "name", "position", "direction", "currentChunk"];
      this.forEach((room) => {
        rooms.push({
          name: room.name,
          clients: Array.from(room.clients.values()).map((client) => {
            const print = {};
            fields.forEach((f) => {
              print[f] = client[f];
            });
            const requests = ChunkRequestsComponent.get(client).data;
            print["requests"] = Array.from(requests);
            return print;
          }),
          world: {
            pipeline: room.world.pipeline.queue.map(([c, s]) => [c.name, s]),
            chunks: {
              size: room.world.chunks.all().length,
              map: room.world.chunks.all().map((chunk) => ({
                id: chunk.id,
                name: chunk.name,
                coords: chunk.coords,
                min: chunk.min,
                max: chunk.max,
                test: chunk.getVoxel(chunk.min[0], 0, chunk.min[2] + 2),
                height: chunk.getMaxHeight(chunk.min[0], chunk.min[2] + 2),
                light: chunk.getSunlight(chunk.min[0], 10, chunk.min[2] + 2),
                mesh: {
                  opaque: !!chunk.mesh.opaque,
                  transparent: !!chunk.mesh.transparent,
                },
              })),
            },
          },
        });
      });

      res.header("Content-Type", "application/json");
      res.send(JSON.stringify(rooms, null, 4));
    });
  }

  /**
   * Create a room to play in.
   *
   * @param name - Name of the room
   * @param params - Parameters to create the room
   * @returns A room instance
   */
  createRoom = (name: string, params: Partial<RoomParams>) => {
    const room = new Room(name, params);

    this.set(name, room);

    return room;
  };

  /**
   * Find a client through all rooms by ID.
   *
   * @param id - ID of the client
   * @returns Client instance if exists, else null
   */
  findClient = (id: string) => {
    for (const [, room] of Array.from(this)) {
      const client = room.clients.get(id);
      if (client) return client;
    }
    return null;
  };

  /**
   * Broadcast to all clients in all rooms. Useful for cross-room announcements.
   *
   * @param event - Event to broadcast, obeying the protocol buffers
   * @param filter - Filter to include/exclude clients
   */
  broadcast = (event: any, filter: ClientFilter = defaultFilter) => {
    const encoded = Network.encode(event);

    this.filterClients(filter, (client) => {
      client.send(encoded);
    });
  };

  private filterClients = (
    { roomId, exclude, include }: ClientFilter,
    func: (client: Client) => void
  ) => {
    include = include || [];
    exclude = exclude || [];

    const pass = (client: Client) => {
      if (include.length !== 0) {
        return include.includes(client.id);
      } else if (exclude.length !== 0) {
        return !exclude.includes(client.id);
      } else {
        return true;
      }
    };

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
