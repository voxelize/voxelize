import { protocol } from "packages/common/dist";
import { v4 as uuidv4 } from "uuid";
import WebSocket from "ws";

import { Network } from "./network";
import { ClientFilter, ClientType, defaultFilter } from "./shared";
import { World } from "./world";

const { Message } = protocol;

type RoomOptions = {
  maxClients: number;
  pingInterval: number;
};

class Room {
  public world: World;

  public clients: ClientType[] = [];

  private pingInterval: NodeJS.Timeout;

  constructor(public name: string, public options: RoomOptions) {}

  onConnect = (client: ClientType) => {
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

    client.send(
      Network.encode({
        type: "INIT",
        json: { id: client.id },
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
    const encoded = Network.encode(event);

    this.filterClients(filter, (client) => {
      client.send(encoded);
    });
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
