import URL from "domurl";
import * as fflate from "fflate";
import { Instance as PeerInstance } from "simple-peer";
// @ts-ignore
import SimplePeer from "simple-peer/simplepeer.min";
import DecodeWorker from "web-worker:./workers/decode-worker";

import { Client } from "..";
import { WorkerPool } from "../libs/worker-pool";
import { protocol } from "../protocol";

const { Message } = protocol;

type CustomWebSocket = WebSocket & {
  sendEvent: (event: any) => void;
};

type NetworkParams = {
  serverURL: string;
  reconnectTimeout: number;
  maxPacketsPerTick: number;
};

type QueryParams = {
  [key: string]: any;
};

class Network {
  public ws: CustomWebSocket;

  public id: string;
  public url: URL<QueryParams>;
  public world: string;
  public socket: URL<QueryParams>;
  public connected = false;

  private pool: WorkerPool = new WorkerPool(DecodeWorker, {
    maxWorker: window.navigator.hardwareConcurrency * 2,
  });

  private reconnection: any;

  constructor(public client: Client, public params: NetworkParams) {
    this.url = new URL(this.params.serverURL);
  }

  connect = async () => {
    // if websocket connection already exists, disconnect it
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.close();

      if (this.reconnection) {
        clearTimeout(this.reconnection);
      }
    }

    return new Promise<void>((resolve) => {
      this.socket = new URL(this.url.toString());
      this.socket.protocol = this.socket.protocol.replace(/http/, "ws");
      this.socket.hash = "";
      this.socket.path = "/ws/";

      // initialize a websocket connection to socket
      const ws = new WebSocket(this.socket.toString()) as CustomWebSocket;
      ws.binaryType = "arraybuffer";
      // custom Protobuf event sending
      ws.sendEvent = (event: any) => {
        ws.send(Network.encode(event));
      };
      ws.onopen = () => {
        this.connected = true;
        this.client.emit("connected");

        clearTimeout(this.reconnection);

        resolve();
      };
      ws.onerror = console.error;
      ws.onmessage = ({ data }) => {
        this.decode(new Uint8Array(data)).then((data) => {
          this.onEvent(data);
          this.client.emit("network-event", data);
        });
      };
      ws.onclose = () => {
        this.connected = false;
        this.client.emit("disconnected");
        this.client.peers.reset();

        // fire reconnection every "reconnectTimeout" ms
        this.reconnection = setTimeout(() => {
          this.connect();
        }, this.params.reconnectTimeout);
      };

      this.ws = ws;
    });
  };

  disconnect = () => {
    this.ws.onclose = null;
    this.ws.onmessage = null;
    this.ws.close();

    this.client.emit("disconnected");

    if (this.reconnection) {
      clearTimeout(this.reconnection);
    }
  };

  fetch = async (path: string, query: { [key: string]: any } = {}) => {
    const stage = this.url.toString();

    if (!path.startsWith("/")) path = `/${path}`;
    this.url.path = path;

    Object.keys(query).forEach((key) => {
      this.url.query[key] = query[key];
    });
    const result = await fetch(this.url.toString());

    this.url = new URL(stage);

    return result.json();
  };

  send = (event: any) => {
    this.ws.sendEvent(event);
  };

  get concurrentWorkers() {
    return this.pool.workingCount;
  }

  private onEvent = (() => {
    return (event: any) => {
      const { type } = event;

      switch (type) {
        case "INIT": {
          const {
            peers,
            json: { blocks, ranges, id, params },
          } = event;

          if (id) {
            this.id = id;
          }

          if (params) {
            this.client.world.setParams(params);
          }

          // if any other peers exist on load:
          // try to reach out to them as an initiator
          if (peers) {
            peers.forEach((i: string) => {
              this.connectToPeer(i, true);
            });
          }

          this.client.loader.load().then(() => {
            if (blocks && ranges) {
              this.client.registry.load(blocks, ranges);
            }
          });

          break;
        }
        case "JOIN": {
          // if a new peer joined, connect to them passively,
          // as they would have already tried to reach out
          const { text: id } = event;
          this.connectToPeer(id);

          break;
        }
        case "SIGNAL": {
          const {
            json: { id, signal },
          } = event;
          const { connection } = this.client.peers.get(id) || {};

          // receiving signal from another peer
          if (connection && !connection.destroyed) {
            connection.signal(signal);
          }
          break;
        }
        case "ENTITY": {
          const { entities } = event;
          entities.forEach((entity: any) => {
            this.client.entities.onEvent(entity);
          });
          break;
        }
        case "LOAD": {
          const { chunks } = event;

          if (chunks) {
            chunks.forEach((chunk) => {
              this.client.world.handleServerChunk(chunk);
            });
          }

          break;
        }
        case "CHAT": {
          const { chat } = event;

          if (chat) {
            this.client.chat.add(chat);
          }

          break;
        }
        case "UPDATE": {
          const { updates, chunks } = event;

          if (chunks) {
            chunks.forEach((chunk) => {
              this.client.world.handleServerChunk(chunk, true);
            });
          }

          if (updates) {
            const particleUpdates = updates
              .filter(({ voxel }) => voxel === 0)
              .map(({ vx, vy, vz }) => ({
                voxel: [vx, vy, vz],
                type: this.client.world.getVoxelByVoxel(vx, vy, vz),
              }));

            updates.forEach((update) => {
              const { vx, vy, vz, voxel, light } = update;
              const chunk = this.client.world.getChunkByVoxel(vx, vy, vz);

              if (chunk) {
                chunk.setRawValue(vx, vy, vz, voxel || 0);
                chunk.setRawLight(vx, vy, vz, light || 0);
              }
            });

            this.client.particles.addBreakParticles(particleUpdates, {
              count: particleUpdates.length > 3 ? 10 : 24,
            });
          }

          break;
        }
      }
    };
  })();

  private connectToPeer = (id: string, initiator = false) => {
    const connection = new SimplePeer({
      initiator,
      trickle: false,
      channelName: this.world,
    }) as PeerInstance;
    this.client.peers.addPeer(id, connection);
  };

  decode = async (data: any) => {
    return new Promise<any>((resolve) => {
      this.pool.addJob({
        message: data,
        buffers: [data.buffer],
        resolve,
      });
    });
  };

  static decodeSync = (buffer: any) => {
    if (buffer[0] === 0x78 && buffer[1] === 0x9c) {
      buffer = fflate.unzlibSync(buffer);
    }

    const message = Message.decode(buffer);
    // @ts-ignore
    message.type = Message.Type[message.type];
    if (message.json) {
      message.json = JSON.parse(message.json);
    }
    return message;
  };

  static encode(message: any) {
    if (message.json) {
      message.json = JSON.stringify(message.json);
    }
    message.type = Message.Type[message.type];
    if (message.entities) {
      message.entities.forEach(
        (entity) => (entity.metadata = JSON.stringify(entity.metadata))
      );
    }
    return protocol.Message.encode(protocol.Message.create(message)).finish();
  }
}

export type { NetworkParams };

export { Network };
