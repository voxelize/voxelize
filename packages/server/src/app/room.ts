import { BaseWorldParams, protocol } from "@voxelize/common";
import WebSocket from "ws";

import { Network } from "../core/network";
import { ClientFilter, defaultFilter } from "../core/shared";

import { ChunkRequestsComponent } from "./comps";
import { Client } from "./ents/client";
import { World } from "./world";

const { Message } = protocol;

/**
 * Room parameters
 */
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

/**
 * A room in the server. Rooms can hold clients, and have their
 * own world to be populated in.
 *
 * @param name - Name of the room, used for connection
 * @param params - `RoomParams`, data to construct a room/world
 */
class Room {
  /**
   * A reference of the room parameters.
   */
  public params: RoomParams;

  /**
   * Flag that shows if the room has started.
   */
  public started = false;

  /**
   * A world that all clients in this room play in. Contains all voxel information
   * such as block types and lighting data.
   */
  public world: World;

  /**
   * A map of clients in this room.
   */
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

  /**
   * Handler for client connection. Does the following:
   * - If the room is full, reject the client's web socket.
   * - Otherwise, create a new client instance and send all
   *  world/room information to the client.
   * - Inform all other clients in the room about the new client.
   * - Add client to world's ECS (Entity Component System)
   * - Setup client's socket handlers
   *
   * DO NOT CALL THIS DIRECTLY! THINGS MAY BREAK!
   *
   * @param socket
   */
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

  /**
   * Finds the client by ID in this room.
   *
   * @param id - ID of the client
   * @returns A client instance if exists, otherwise undefined
   */
  findClient = (id: string) => {
    return this.clients.get(id);
  };

  /**
   * Start the room, does the following:
   * - Call `this.world.start()` to kickstart the world of the room.
   * - Start the server-side game-tick interval for this room.
   */
  start = () => {
    const { updateInterval } = this.params;
    this.world.start();
    this.updateInterval = setInterval(this.update, updateInterval);
    this.started = true;
  };

  // TODO: maybe stop clients too?
  /**
   * Stops the room from running, does the following:
   * - Clear the game-tick interval of the room.
   * - Stop the world by calling `this.world.stop()`.
   */
  stop = () => {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.world.stop();
      this.updateInterval = null;
    }
  };

  /**
   * Broadcasts an event to all clients who are connected to this room
   *
   * @param event - Anything that follows the protocol buffers
   * @param filter - Filter to include/exclude certain clients
   */
  broadcast = (event: any, filter: ClientFilter = defaultFilter) => {
    if (this.clients.size === 0) return;

    const encoded = Network.encode(event);

    this.filterClients(filter, (client) => {
      client.send(encoded);
    });
  };

  /**
   * Updater of `Room`, does the following:
   * - Update the room's world
   *
   * DO NOT CALL THIS DIRECTLY! THINGS MAY BREAK!
   */
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

  private onMessage = (client: Client, data: WebSocket.Data) => {
    let request: protocol.Message;
    try {
      request = Network.decode(data);
    } catch (e) {
      return;
    }
    this.onRequest(client, request);
  };

  private onRequest = (client: Client, request: any) => {
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

  private onDisconnect = (client: Client) => {
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

  private ping = () => {
    this.clients.forEach((client) => {
      if (client.isAlive === false) {
        client.socket.terminate();
        return;
      }
      client.isAlive = false;
      client.socket.ping();
    });
  };
}

export type { RoomParams };

export { Room };
