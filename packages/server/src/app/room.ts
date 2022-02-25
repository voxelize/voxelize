import { protocol } from "@voxelize/common";
import { v4 as uuidv4 } from "uuid";
import WebSocket from "ws";

import { Network } from "../core/network";
import { Rooms } from "../core/rooms";
import { ClientFilter, ClientType, defaultFilter } from "../core/shared";

import { World } from "./world";

const { Message } = protocol;

type RoomParams = {
  name: string;
  maxClients: number;
  pingInterval: number;
  tickInterval: number;
};

class Room {
  public name: string;
  public started = false;

  public world: World;
  public clients: ClientType[] = [];

  private tickInterval: NodeJS.Timeout = null;
  private pingInterval: NodeJS.Timeout = null;

  constructor(public rooms: Rooms, public params: RoomParams) {
    const { name } = params;

    this.name = name;
    this.world = new World(this);
  }

  onConnect = (client: ClientType) => {
    const { maxClients, pingInterval } = this.params;

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

    const { registry } = this.world;

    client.id = uuidv4();
    client.isAlive = true;

    client.send(
      Network.encode({
        type: "INIT",
        json: {
          id: client.id,
          blocks: registry.getBlockMap(),
          ranges: registry.getRanges(),
        },
        peers: this.clients.map(({ id }) => id),
      })
    );

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

  onRequest = (client: ClientType, request: any) => {
    switch (request.type) {
      case "SIGNAL": {
        const { id, signal } = request.json;
        const other = this.findClient(id);
        if (other) {
          other.send(
            Network.encode({
              type: "SIGNAL",
              json: {
                id: client.id,
                signal,
              },
            })
          );
        }
        break;
      }
      default:
        break;
    }
  };

  onDisconnect = (client: ClientType) => {
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

  start = () => {
    const { tickInterval } = this.params;
    this.world.start();
    this.tickInterval = setInterval(this.tick, tickInterval);
    this.started = true;
  };

  // TODO: maybe stop clients too?
  stop = () => {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  };

  ping = () => {
    this.clients.forEach((client) => {
      if (client.isAlive === false) {
        client.terminate();
        return;
      }
      client.isAlive = false;
      client.ping();
    });
  };

  findClient = (id: string) => {
    const client = this.clients.find((c) => c.id === id);
    return client || null;
  };

  broadcast = (event: any, filter: ClientFilter = defaultFilter) => {
    if (this.clients.length === 0) return;

    const encoded = Network.encode(event);

    this.filterClients(filter, (client) => {
      client.send(encoded);
    });
  };

  tick = () => {
    if (!this.rooms.server.network.listening) return;

    this.world.tick();
  };

  private filterClients = (
    { exclude, include }: ClientFilter,
    func: (client: ClientType) => void
  ) => {
    include = include || [];
    exclude = exclude || [];

    this.clients.forEach((client) => {
      if (
        (!include.length || include.indexOf(client.id) >= 0) &&
        (!exclude.length || exclude.indexOf(client.id) === -1)
      )
        func(client);
    });
  };
}

export { Room };
