import { EventEmitter } from "events";

import { protocol } from "@voxelize/transport/src/protocol";
import { MessageProtocol } from "@voxelize/transport/src/types";
import DOMUrl from "domurl";
import DecodeWorker from "web-worker:./workers/decode-worker";

import { WorkerPool } from "../../libs/worker-pool";

import { NetIntercept } from "./intercept";

export * from "./intercept";

const { Message } = protocol;

/**
 * A custom WebSocket type that supports protocol buffer sending.
 */
type ProtocolWS = WebSocket & {
  /**
   * Send a protocol buffer encoded message to the server.
   */
  sendEvent: (event: any) => void;
};

/**
 * Parameters to initializing a Voxelize {@link Network} connection to the server.
 */
type NetworkParams = {
  /**
   * The HTTP url to the backend. Example: `http://localhost:4000`
   */
  serverURL: string;

  /**
   * On disconnection, the timeout to attempt to reconnect. Defaults to 5000.
   */
  reconnectTimeout?: number;

  /**
   * The secret to joining a server.
   */
  secret?: string;
};

type ClientInfo = {
  id: string;
  username: string;
};

/**
 * A **built-in** network connector to the Voxelize backend. Establishes a WebSocket connection to the backend
 * server and handles the Protocol Buffer encoding and decoding.
 *
 * @category Core
 */
class Network extends EventEmitter {
  /**
   * Reference linking back to the Voxelize client instance.
   */
  public clientInfo: {
    id: string;
    username: string;
  } = {
    id: "",
    username: "",
  };

  /**
   * The interceptions to network events.
   */
  public intercepts: NetIntercept[] = [];

  /**
   * Parameters to initialize the Network instance.
   */
  public params: NetworkParams;

  /**
   * The WebSocket client for Voxelize.
   */
  public ws: ProtocolWS;

  /**
   * A {@link https://github.com/Mikhus/domurl | domurl Url instance} constructed with `network.params.serverURL`,
   * representing a HTTP connection URL to the server.
   */
  public url: DOMUrl<{
    [key: string]: any;
  }>;

  /**
   * The name of the world that the client is connected to.
   */
  public world: string;

  /**
   * A native URL instance constructed with `network.params.serverURL`,
   * representing a WebSocket connection URL to the server.
   */
  public socket: URL;

  /**
   * Whether or not the network connection is established.
   */
  public connected = false;
  public joined = false;

  private pool: WorkerPool = new WorkerPool(DecodeWorker, {
    maxWorker: window.navigator.hardwareConcurrency || 4,
  });

  private reconnection: any;
  private joinResolve: (value: Network) => void = null;

  /**
   * Used internally in `client.connect` to connect to the Voxelize backend.
   *
   * @hidden
   */
  connect = async (params: NetworkParams) => {
    this.params = params;

    this.url = new DOMUrl(this.params.serverURL);
    this.url.protocol = this.url.protocol.replace(/ws/, "http");
    this.url.hash = "";

    const socketURL = new DOMUrl(this.params.serverURL);
    socketURL.path = "/ws/";

    this.socket = new URL(socketURL.toString());
    this.socket.protocol = this.socket.protocol.replace(/http/, "ws");
    this.socket.hash = "";
    this.socket.searchParams.set("secret", this.params.secret || "");
    this.socket.searchParams.set("client_id", this.clientInfo.id || "");

    const MAX = 10000;
    let index = Math.floor(Math.random() * MAX).toString();
    index =
      new Array(MAX.toString().length - index.length).fill("0").join("") +
      index;
    this.clientInfo.username = `Guest ${index}`;

    // if websocket connection already exists, disconnect it
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.close();

      if (this.reconnection) {
        clearTimeout(this.reconnection);
      }
    }

    return new Promise<Network>((resolve) => {
      // initialize a websocket connection to socket
      const ws = new WebSocket(this.socket.toString()) as ProtocolWS;
      ws.binaryType = "arraybuffer";
      // custom Protobuf event sending
      ws.sendEvent = (event: any) => {
        ws.send(Network.encodeSync(event));
      };
      ws.onopen = () => {
        this.connected = true;
        this.emit("connected");

        clearTimeout(this.reconnection);

        resolve(this);
      };
      ws.onerror = console.error;
      ws.onmessage = ({ data }) => {
        this.decode(new Uint8Array(data)).then((data) => {
          this.onMessage(data);
          this.emit("network-event", data);
        });
      };
      ws.onclose = () => {
        this.connected = false;
        this.emit("disconnected");

        // fire reconnection every "reconnectTimeout" ms
        if (this.params.reconnectTimeout) {
          this.reconnection = setTimeout(() => {
            this.connect(params);
          }, this.params.reconnectTimeout);
        }
      };

      this.ws = ws;
    });
  };

  join = async (world: string) => {
    if (this.joined) {
      this.leave();
    }

    this.joined = true;
    this.world = world;

    this.send({
      type: "JOIN",
      json: {
        world,
        username: this.clientInfo.username,
      },
    });

    this.emit("join");

    return new Promise<Network>((resolve) => {
      this.joinResolve = resolve;
    });
  };

  leave = () => {
    if (!this.joined) {
      return;
    }

    this.joined = false;

    this.send({
      type: "LEAVE",
      text: this.world,
    });

    this.emit("leave");
  };

  flush = () => {
    this.intercepts.forEach((intercept) => {
      if (intercept.packets) {
        intercept.packets
          .splice(0, intercept.packets.length)
          .forEach((packet) => {
            this.send(packet);
          });
      }
    });
  };

  cover = (intercept: NetIntercept) => {
    if (typeof intercept.onMessage !== "function") {
      throw new Error(
        "Cannot intercept network events without the `.onMessage` function!"
      );
    }

    this.intercepts.push(intercept);

    return this;
  };

  /**
   * Used internally to disconnect from the Voxelize backend.
   *
   * @hidden
   */
  disconnect = () => {
    this.ws.onclose = null;
    this.ws.onmessage = null;
    this.ws.close();

    this.emit("disconnected");

    if (this.reconnection) {
      clearTimeout(this.reconnection);
    }
  };

  /**
   * Encode and send a protocol buffer message to the server.
   *
   * @param event - An object that obeys the protocol buffers.
   */
  send = (event: any) => {
    this.ws.sendEvent(event);
  };

  setID = (id: string) => {
    this.clientInfo.id = id || "";
  };

  setUsername = (username: string) => {
    this.clientInfo.username = username || " ";
  };

  /**
   * The number of active workers decoding network packets.
   */
  get concurrentWorkers() {
    return this.pool.workingCount;
  }

  private onMessage = async (message: MessageProtocol) => {
    const { type } = message;

    if (type === "INIT") {
      const { id } = message.json;

      if (id) {
        if (this.clientInfo.id && this.clientInfo.id !== id) {
          throw new Error(
            "Something went wrong with IDs! Better check if you're passing two same ID's to the same Voxelize server."
          );
        }

        this.clientInfo.id = id;
      }
    }

    this.intercepts.forEach((intercept) => {
      intercept.onMessage(message);
    });

    if (type === "INIT") {
      this.intercepts.forEach((intercept) => {
        intercept.onMessage({ type: "READY" });
      });

      if (!this.joinResolve) {
        throw new Error("Something went wrong with joining worlds...");
      }

      this.joinResolve(this);
    }
  };

  private static encodeSync(message: any) {
    if (message.json) {
      message.json = JSON.stringify(message.json);
    }
    message.type = Message.Type[message.type];
    if (message.entities) {
      message.entities.forEach(
        (entity) => (entity.metadata = JSON.stringify(entity.metadata))
      );
    }
    if (message.peers) {
      message.peers.forEach(
        (peer) => (peer.metadata = JSON.stringify(peer.metadata))
      );
    }
    return protocol.Message.encode(protocol.Message.create(message)).finish();
  }

  /**
   * Decode a byte array into protocol buffer objects.
   *
   * @param data - Data to offload to the worker pool to decode.
   */
  private decode = async (data: Uint8Array) => {
    return new Promise<any>((resolve) => {
      this.pool.addJob({
        message: data,
        buffers: [data.buffer],
        resolve,
      });
    });
  };
}

export type { NetworkParams, ProtocolWS };

export { Network };
