import { BaseWorldParams, protocol } from "@voxelize/common";
import WebSocket from "ws";

import { Network } from "../core/network";
import { ClientFilter, defaultFilter } from "../core/shared";

import { ChunkRequestsComponent } from "./comps";
import { Client } from "./ents/client";
import { World } from "./world";

const { Message } = protocol;

type RoomParams = {
  maxClients: number;
  pingInterval: number;
  updateInterval: number;

  chunkSize: number;
  maxHeight: number;
  maxLightLevel: number;
  maxChunksPerTick: number;
  maxResponsePerTick: number;
  preloadRadius: number;
};

const defaultParams: RoomParams = {
  maxClients: 100,
  pingInterval: 50000,
  updateInterval: 1000 / 60,
  chunkSize: 16,
  maxHeight: 256,
  maxLightLevel: 15,
  maxChunksPerTick: 16,
  maxResponsePerTick: 4,
  preloadRadius: 8,
};

class Room {
  public params: RoomParams;

  public started = false;

  public world: World;
  public clients: Map<string, Client> = new Map();

  private updateInterval: NodeJS.Timeout = null;
  private pingInterval: NodeJS.Timeout = null;

  constructor(public name: string, params: Partial<RoomParams>) {
    this.params = {
      ...defaultParams,
      ...params,
    };

    const {
      chunkSize,
      maxHeight,
      maxLightLevel,
      maxChunksPerTick,
      maxResponsePerTick,
    } = this.params;

    this.name = name;

    this.world = new World(this, {
      chunkSize,
      maxHeight,
      maxLightLevel,
      maxChunksPerTick,
      maxResponsePerTick,
    });
  }

  onConnect = (socket: WebSocket) => {
    const { maxClients, pingInterval, chunkSize, maxHeight, maxLightLevel } =
      this.params;

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

    const client = new Client(socket);
    client.isAlive = true;

    const peers = Array.from(this.clients.values()).map(({ id }) => id);
    this.clients.set(client.id, client);

    client.send(
      Network.encode({
        type: "INIT",
        json: {
          id: client.id,
          blocks: registry.getBlockMap(),
          ranges: registry.getRanges(),
          params: {
            chunkSize,
            maxHeight,
            maxLightLevel,
          } as BaseWorldParams,
        },
        peers,
      })
    );

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

    this.world.ecs.addEntity(client);
  };

  onMessage = (client: Client, data: WebSocket.Data) => {
    let request: protocol.Message;
    try {
      request = Network.decode(data);
    } catch (e) {
      return;
    }
    this.onRequest(client, request);
  };

  onRequest = (client: Client, request: any) => {
    switch (request.type) {
      case "PEER": {
        const { peer } = request;
        if (peer) {
          const { id, name, position, direction } = peer;
          const client = this.clients.get(id);

          if (client) {
            client.name = name;
            client.position = position;
            client.direction = direction;
          }
        }
        break;
      }
      case "SIGNAL": {
        const { id, signal } = request.json;
        const other = this.clients.get(id);
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
      case "REQUEST": {
        const { chunks } = request.json;

        if (chunks) {
          ChunkRequestsComponent.get(client).data.push(...chunks);
        }
        break;
      }
      default:
        break;
    }
  };

  onDisconnect = (client: Client) => {
    const { id } = client;

    // would return true if client exists
    if (this.clients.delete(id)) {
      this.world.onDisconnect(client);

      this.broadcast({
        type: "LEAVE",
        text: client.id,
      });
    }
  };

  findClient = (id: string) => {
    return this.clients.get(id);
  };

  // !!! DOESN'T WORK
  // TODO: make this asynchronous to actually check for preload progress
  // Issue here is that some chunks may not be preloaded as they are on the edge.
  preload = () => {
    const { preloadRadius } = this.params;

    for (let x = -preloadRadius; x <= preloadRadius; x++) {
      for (let z = -preloadRadius; z <= preloadRadius; z++) {
        this.world.chunks.getChunk(x, z);
      }
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

  broadcast = (event: any, filter: ClientFilter = defaultFilter) => {
    if (this.clients.size === 0) return;

    const encoded = Network.encode(event);

    this.filterClients(filter, (client) => {
      client.send(encoded);
    });
  };

  update = () => {
    this.world.update();
  };

  private filterClients = (
    { exclude, include }: ClientFilter,
    func: (client: Client) => void
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
        const client = this.clients.get(id);
        func(client);
      });
    } else {
      this.clients.forEach((client) => {
        func(client);
      });
    }
  };
}

export type { RoomParams };

export { Room };
