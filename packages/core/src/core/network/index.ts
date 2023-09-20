import { protocol } from "@voxelize/transport/src/protocol";
import { MessageProtocol } from "@voxelize/transport/src/types";
import DOMUrl from "domurl";
import DecodeWorker from "shared-worker:./workers/decode-worker.ts";

import { SharedWorkerPool } from "../../libs/worker-pool";

import { NetIntercept } from "./intercept";

export * from "./intercept";

const { Message } = protocol;

/**
 * A custom WebSocket type that supports protocol buffer sending.
 */
export type ProtocolWS = WebSocket & {
  /**
   * Send a protocol buffer encoded message to the server.
   */
  sendEvent: (event: any) => void;
};

export type NetworkOptions = {
  maxPacketsPerTick: number;
};

const defaultOptions: NetworkOptions = {
  maxPacketsPerTick: 8,
};

/**
 * Parameters to customize the connection to a Voxelize server. For example, setting a secret
 * key to authenticate the connection with the server.
 */
export type NetworkConnectionOptions = {
  /**
   * On disconnection, the timeout to attempt to reconnect. Defaults to 5000.
   */
  reconnectTimeout?: number;

  /**
   * The secret to joining a server, a key that if set on the server, then must be provided to
   * connect to the server successfully.
   */
  secret?: string;
};

/**
 * A network connector to the Voxelize backend. Establishes a WebSocket connection to the backend
 * server and handles the Protocol Buffer encoding and decoding.
 *
 * # Example
 * ```ts
 * const network = new VOXELIZE.Network();
 *
 * network
 *  .connect("ws://localhost:5000")
 *  .then(() => {
 *    network.join("my-world").then(() => {
 *      console.log("Joined world!");
 *    });
 * });
 * ```
 *
 * @category Core
 */
export class Network {
  public options: NetworkOptions;

  /**
   * Information about the client that is sent to the server on connection. Initialize the username
   * through `setUsername` and the id through `setID`. If nothing is set, then the information will
   * be generated by the server and sent back to this client.
   *
   * This is also the information passed into `NetIntercept` callbacks.
   */
  public clientInfo: {
    /**
     * The unique ID of the client. This can be set by `setID` **BEFORE** connecting to the server.
     * If this is set before connection, then the ID will be used and the server will not generate
     * a new ID for this client.
     */
    id: string;

    /**
     * The username of the client. This can be set by `setUsername` **BEFORE** connecting to the server.
     * Setting this username after connecting to the server will not change anything.
     */
    username: string;
  } = {
    id: "",
    username: "",
  };

  /**
   * A list of network event interceptors that are called when a network event is received. You can add
   * interceptors by calling `register` and remove them by calling `unregister`.
   */
  public intercepts: NetIntercept[] = [];

  /**
   * The inner WebSocket client for Voxelize, with support for protocol buffers.
   */
  public ws: ProtocolWS;

  /**
   * A {@link https://github.com/Mikhus/domurl | domurl Url instance} constructed with `network.options.serverURL`,
   * representing a HTTP connection URL to the server.
   */
  public url: DOMUrl<{
    [key: string]: any;
  }>;

  /**
   * The name of the world that the client is connected to. This is only set after the connection
   * is established.
   */
  public world: string;

  /**
   * A native URL instance constructed with `network.options.serverURL`,
   * representing a WebSocket connection URL to the server.
   */
  public socket: URL;

  /**
   * Whether or not the network connection is established.
   */
  public connected = false;

  /**
   * Whether or not the client has joined a specific world on the server.
   */
  public joined = false;

  /**
   * A custom event listener that is called when this network instance has joined a world.
   */
  public onJoin: (world: string) => void;

  /**
   * A custom event listener that is called when this network instance has left a world.
   */
  public onLeave: (world: string) => void;

  /**
   * A custom event listener that is called when this network instance is connected to a server.
   */
  public onConnect: () => void;

  /**
   * A custom event listener that is called when this network instance is disconnected from a server.
   */
  public onDisconnect: () => void;

  /**
   * The worker pool for decoding network packets.
   */
  private pool = new SharedWorkerPool(DecodeWorker, {
    maxWorker: window.navigator.hardwareConcurrency || 4,
  });

  /**
   * To keep track of the reconnection.
   */
  private reconnection: any;

  /**
   * The join promise resolves when the client has joined a world,
   * in other words when "INIT" type message is received.
   */
  private joinResolve: (value: Network) => void = null;

  /**
   * Called when an error occurs in the network connection.
   */
  private joinReject: (reason: string) => void = null;

  private packetQueue: any[] = [];

  /**
   * Create a new network instance.
   */
  constructor(options: Partial<NetworkOptions> = {}) {
    this.options = {
      ...defaultOptions,
      ...options,
    };
  }

  /**
   * Connect to a Voxelize server. Remember to set username and ID before connection if
   * you want to specify them manually. Otherwise ID is generated by the server, and username
   * would be "Guest XXXXX" where `XXXXX` is a random 5-digit number.
   *
   * @param serverURL The URL to the Voxelize server.
   * @param options Parameters to customize the connection to a Voxelize server.
   * @returns A promise that resolves when the client has connected to the server.
   */
  connect = async (
    serverURL: string,
    options: NetworkConnectionOptions = {}
  ) => {
    if (!serverURL) {
      throw new Error("No server URL provided.");
    }

    if (typeof serverURL !== "string") {
      throw new Error("Server URL must be a string.");
    }

    this.url = new DOMUrl(serverURL);
    this.url.protocol = this.url.protocol.replace(/ws/, "http");
    this.url.hash = "";

    const socketURL = new DOMUrl(serverURL);
    socketURL.path = "/ws/";

    this.socket = new URL(socketURL.toString());
    this.socket.protocol = this.socket.protocol.replace(/http/, "ws");
    this.socket.hash = "";
    this.socket.searchParams.set("secret", options.secret || "");
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
        this.onConnect?.();

        clearTimeout(this.reconnection);

        resolve(this);
      };
      ws.onerror = console.error;
      ws.onmessage = ({ data }) => {
        this.packetQueue.push(new Uint8Array(data));
      };
      ws.onclose = () => {
        this.connected = false;
        this.onDisconnect?.();

        // fire reconnection every "reconnectTimeout" ms
        if (options.reconnectTimeout) {
          this.reconnection = setTimeout(() => {
            this.connect(serverURL, options);
          }, options.reconnectTimeout);
        }
      };

      this.ws = ws;
    });
  };

  /**
   * Join a world on the server.
   *
   * @param world The name of the world to join.
   * @returns A promise that resolves when the client has joined the world.
   */
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

    return new Promise<Network>((resolve, reject) => {
      this.joinResolve = resolve;
      this.joinReject = reject;
    });
  };

  /**
   * Leave the current world. If the client is not in a world, this method does nothing.
   *
   * @returns A promise that resolves when the client has left the world.
   */
  leave = () => {
    if (!this.joined) {
      return;
    }

    this.joined = false;

    this.send({
      type: "LEAVE",
      text: this.world,
    });
  };

  /**
   * Send an `ACTION` type message to the server. For more information about the protocol
   * buffer message system, see [here](/tutorials/basics/protocol-networking).
   *
   * @param type The type of action to perform.
   * @param data The specific data attached to this action.
   */
  action = async (type: string, data?: any) => {
    this.send({
      type: "ACTION",
      json: {
        action: type,
        data,
      },
    });
  };

  sync = () => {
    if (!this.packetQueue.length) {
      return;
    }

    if (this.pool.isBusy) {
      return;
    }

    console.log(this.packetQueue.length);

    this.decode(
      this.packetQueue.splice(
        0,
        Math.min(this.options.maxPacketsPerTick, this.packetQueue.length)
      )
    ).then((messages) => {
      messages.forEach((message) => {
        this.onMessage(message);
      });
    });
  };

  /**
   * Gathers all the network packets from the network intercepts and sends them to the server.
   * This method should be called at the end of each client-side game tick.
   */
  flush = () => {
    this.intercepts.forEach((intercept) => {
      if (intercept.packets && intercept.packets.length) {
        intercept.packets
          .splice(0, intercept.packets.length)
          .forEach((packet) => {
            this.send(packet);
          });
      }
    });
  };

  /**
   * Register a network intercept to the network. This is used so that one can define
   * the reaction to the network packets received. For instance, one can define a network
   * intercept to handle the `EVENT` type messages and perform something based on the
   *
   * @param intercepts One or more intercepts to add to the network.
   * @returns The network instance itself for chaining.
   */
  register = (...intercepts: NetIntercept[]) => {
    intercepts.forEach((intercept) => {
      this.intercepts.push(intercept);
    });

    return this;
  };

  /**
   * Unregister a network intercept from the network.
   *
   * @param intercepts One or more intercepts to remove from the network.
   * @returns The network instance itself for chaining.
   */
  unregister = (...intercepts: NetIntercept[]) => {
    intercepts.forEach((intercept) => {
      const index = this.intercepts.indexOf(intercept);

      if (index !== -1) {
        this.intercepts.splice(index, 1);
      }
    });

    return this;
  };

  /**
   * Disconnect the client from the server.
   */
  disconnect = () => {
    if (!this.connected) {
      return;
    }

    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.close();
    }

    if (this.reconnection) {
      clearTimeout(this.reconnection);
    }
  };

  /**
   * Send a raw network packet to the server. Must be a valid network packet, or else
   * the server may crash. For more details on network protocol messaging, see [here](/tutorials/basics/protocol-networking).
   *
   * @param event The event packet to send to the server.
   */
  send = (event: any) => {
    this.ws.sendEvent(event);
  };

  /**
   * Set the client's ID. This **needs** to be called before the network has connected to the server,
   * otherwise the client will be assigned a server-generated ID.
   *
   * @param id The ID of the client that is used to identify the client on server connection.
   */
  setID = (id: string) => {
    this.clientInfo.id = id || "";
  };

  /**
   * Set the client's username. This **needs** to be called before the network has connected to the server,
   * otherwise the client will be assigned a `Guest XXXXX` username.
   *
   * @param username The username of the client that is used to identify the client on server connection.
   */
  setUsername = (username: string) => {
    this.clientInfo.username = username || " ";
  };

  /**
   * The number of active web workers decoding network packets.
   */
  get concurrentWorkers() {
    return this.pool.workingCount;
  }

  /**
   * The number of network packets waiting to be decoded.
   */
  get packetQueueLength() {
    return this.packetQueue.length;
  }

  /**
   * The listener to protocol buffer events. Basically sends the event packets into
   * the network intercepts.
   */
  private onMessage = async (message: MessageProtocol) => {
    const { type } = message;

    if (type === "ERROR") {
      const { text } = message;
      this.disconnect();
      this.joinReject(text);
      return;
    }

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
      intercept.onMessage?.(message, this.clientInfo);
    });

    if (type === "INIT") {
      if (!this.joinResolve) {
        throw new Error("Something went wrong with joining worlds...");
      }

      this.joinResolve(this);
      this.onJoin?.(this.world);
    }
  };

  /**
   * Encode a message synchronously using the protocol buffer.
   */
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
   * Decode a message asynchronously by giving it to the web worker pool.
   */
  private decode = async (data: Uint8Array[]) => {
    return new Promise<any>((resolve) => {
      this.pool.addJob({
        message: data,
        buffers: data.map((d) => d.buffer),
        resolve,
      });
    });
  };
}
