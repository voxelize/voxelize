import { protocol } from "@voxelize/common";
import WebSocket from "ws";

import { Network } from "../core/network";
import { ClientFilter, defaultFilter } from "../core/shared";

import { ClientEntity } from "./client";
import { World } from "./world";

const { Message } = protocol;

type RoomParams = {
  name: string;
  maxClients: number;
  pingInterval: number;
  updateInterval: number;
};

class Room {
  public name: string;
  public started = false;

  public world: World;
  public clients: Map<string, ClientEntity> = new Map();

  private updateInterval: NodeJS.Timeout = null;
  private pingInterval: NodeJS.Timeout = null;

  constructor(public params: RoomParams) {
    const { name } = params;

    this.name = name;
    this.world = new World(this);
  }

  onConnect = (socket: WebSocket) => {
    const { maxClients, pingInterval } = this.params;

    if (this.clients.size === maxClients) {
      socket.send(
        Network.encode({
          type: Message.Type.ERROR,
          text: "Server full. Try again later.",
        })
      );
      socket.terminate();
      return;
    }

    const { registry } = this.world;

    const client = new ClientEntity(socket);
    client.isAlive = true;

    client.send({
      type: "INIT",
      json: {
        id: client.id,
        blocks: registry.getBlockMap(),
        ranges: registry.getRanges(),
      },
      peers: Array.from(this.clients.values()).map(({ id }) => id),
    });

    this.broadcast({
      type: "JOIN",
      text: client.id,
    });

    socket.once("close", () => this.onDisconnect(client));
    socket.on("message", (data) => this.onMessage(client, data));
    socket.on("pong", () => (client.isAlive = true));

    if (!this.pingInterval) {
      this.pingInterval = setInterval(this.ping, pingInterval);
    }

    this.clients.set(client.id, client);
  };

  onMessage = (client: ClientEntity, data: WebSocket.Data) => {
    let request: protocol.Message;
    try {
      request = Network.decode(data);
    } catch (e) {
      return;
    }
    this.onRequest(client, request);
  };

  onRequest = (client: ClientEntity, request: any) => {
    switch (request.type) {
      case "PEER": {
        const { peer } = request;
        if (peer) {
          const { id, name, position, direction } = peer;
          const client = this.clients.get(id);

          if (client) {
            client.setName(name);
            client.setPosition(position.x, position.y, position.z);
            client.setDirection(direction.x, direction.y, direction.z);
          }
        }
        break;
      }
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

  onDisconnect = (client: ClientEntity) => {
    const { id } = client;

    // would return true if client exists
    if (this.clients.delete(id)) {
      this.broadcast({
        type: "LEAVE",
        text: client.id,
      });
    }
  };

  start = () => {
    const { updateInterval } = this.params;
    this.world.start();
    this.updateInterval = setInterval(this.update, updateInterval);
    this.started = true;
  };

  // TODO: maybe stop clients too?
  stop = () => {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.world.stop();
      this.updateInterval = null;
    }
  };

  ping = () => {
    this.clients.forEach((client) => {
      if (client.isAlive === false) {
        client.socket.terminate();
        return;
      }
      client.isAlive = false;
      client.socket.ping();
    });
  };

  findClient = (id: string) => {
    const client = this.clients.get(id);
    return client || null;
  };

  broadcast = (event: any, filter: ClientFilter = defaultFilter) => {
    if (this.clients.size === 0) return;

    this.filterClients(filter, (client) => {
      client.send(event);
    });
  };

  update = () => {
    this.world.update();
  };

  private filterClients = (
    { exclude, include }: ClientFilter,
    func: (client: ClientEntity) => void
  ) => {
    include = include || [];
    exclude = exclude || [];

    if (exclude.length !== 0) {
      Array.from(this.clients.keys()).forEach((id) => {
        if (exclude.includes(id)) return;
        const client = this.clients.get(id);
        func(client);
      });
    } else if (include.length !== 0) {
      include.forEach((id) => {
        const client = this.findClient(id);
        func(client);
      });
    } else {
      this.clients.forEach((client) => {
        func(client);
      });
    }
  };
}

export { Room };
