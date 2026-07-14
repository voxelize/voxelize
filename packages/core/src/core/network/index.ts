import { MessageProtocol, protocol } from "@voxelize/protocol";
import DOMUrl from "domurl";

import { setWorkerInterval } from "../../libs/setWorkerInterval";
import { WorkerPool } from "../../libs/worker-pool";

import { NetIntercept } from "./intercept";
import { WebRTCConnection } from "./webrtc";
import DecodeWorker from "./workers/decode-worker.ts?worker&inline";

export * from "./intercept";
export { WebRTCConnection } from "./webrtc";

const { Message } = protocol;

export type ProtocolWS = WebSocket & {
  sendEvent: (event: any) => void;
};

export type NetworkOptions = {
  maxPacketsPerTick: number;
  maxBacklogFactor: number;

  /**
   * Upper bound on buffered inbound packets. Beyond it the oldest packets are
   * dropped: the interest/keep-alive protocol re-converges on fresh state, so
   * bounded loss beats unbounded memory growth when processing stalls.
   */
  maxQueuedPackets: number;

  /**
   * Milliseconds a (re)join handshake may await its INIT before the join
   * request is sent again.
   */
  joinRetryTimeout: number;
};

const defaultOptions: NetworkOptions = {
  maxPacketsPerTick: 64,
  maxBacklogFactor: 16,
  maxQueuedPackets: 4096,
  joinRetryTimeout: 10000,
};

export type NetworkConnectionOptions = {
  /**
   * Milliseconds between reconnection attempts after the socket drops.
   * Defaults to {@link DEFAULT_RECONNECT_TIMEOUT_MS}; pass 0 to disable
   * automatic reconnection.
   */
  reconnectTimeout?: number;
  secret?: string;
  useWebRTC?: boolean;
};

const DEFAULT_RECONNECT_TIMEOUT_MS = 3000;

export class Network {
  public options: NetworkOptions;

  public clientInfo: {
    id: string;
    username: string;
    metadata?: Record<string, any>;
  } = {
    id: "",
    username: "",
    metadata: {},
  };

  public intercepts: NetIntercept[] = [];

  public ws: ProtocolWS | null = null;

  public url: DOMUrl<{
    [key: string]: any;
  }>;

  public world: string;

  public socket: URL;

  public connected = false;

  public joined = false;

  public onJoin: (world: string) => void;

  public onLeave: (world: string) => void;

  public onConnect: () => void;

  public onDisconnect: () => void;

  public disconnectReason = "";

  private pool = this.createDecodeWorkerPool();

  private priorityWorker: Worker = this.createPriorityDecodeWorker();

  private serverURL: string | null = null;

  private connectionOptions: NetworkConnectionOptions | null = null;

  private lastConnectAttemptAt = Number.NEGATIVE_INFINITY;

  private stopSyncInterval: (() => void) | null = null;

  private hasTerminatedDecodeWorkers = false;

  private joinResolve: ((value: Network) => void) | null = null;

  private joinReject: ((reason: string) => void) | null = null;

  private packetQueue: ArrayBuffer[] = [];

  private joinStartTime = 0;

  private waitingForInit = false;

  private initPacketReceived = false;

  private rtc: WebRTCConnection | null = null;

  private useWebRTC = false;

  constructor(options: Partial<NetworkOptions> = {}) {
    this.options = {
      ...defaultOptions,
      ...options,
    };

    this.startSyncInterval();

    const MAX = 10000;
    let index = Math.floor(Math.random() * MAX).toString();
    index =
      new Array(MAX.toString().length - index.length).fill("0").join("") +
      index;
    this.clientInfo.username = `Guest ${index}`;
  }

  connect = async (
    serverURL: string,
    options: NetworkConnectionOptions = {},
  ) => {
    if (!serverURL) {
      throw new Error("No server URL provided.");
    }

    if (typeof serverURL !== "string") {
      throw new Error("Server URL must be a string.");
    }

    this.serverURL = serverURL;
    this.connectionOptions = options;
    this.lastConnectAttemptAt = performance.now();
    this.useWebRTC = options.useWebRTC ?? false;
    this.disconnectReason = "";
    console.log(`[NETWORK] Connecting to ${serverURL}`);
    this.ensureDecodeWorkers();
    this.startSyncInterval();

    this.url = new DOMUrl(serverURL);
    this.url.protocol = this.url.protocol.replace(/ws/, "http");
    this.url.hash = "";

    const socketURL = new DOMUrl(serverURL);
    socketURL.path = "/ws/";

    this.socket = new URL(socketURL.toString());
    this.socket.protocol = this.socket.protocol.replace(/http/, "ws");
    this.socket.hash = "";
    this.socket.searchParams.set("secret", options.secret || "");
    if (this.clientInfo.id) {
      this.socket.searchParams.set("client_id", this.clientInfo.id);
    }

    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.close();
    }

    if (this.rtc) {
      this.rtc.close();
      this.rtc = null;
    }

    return new Promise<Network>((resolve) => {
      const ws = new WebSocket(this.socket.toString()) as ProtocolWS;
      ws.binaryType = "arraybuffer";
      ws.sendEvent = async (event: any) => {
        // Only wait out the socket's own connecting window. Sends attempted
        // while disconnected are dropped: session state is rebuilt by the
        // rejoin handshake after reconnecting, and unbounded waiters would
        // pile up for the whole outage otherwise.
        while (ws.readyState === WebSocket.CONNECTING && this.ws === ws) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (this.ws === ws && ws.readyState === WebSocket.OPEN) {
          const encoded = Network.encodeSync(event);
          ws.send(encoded);
        }
      };
      ws.onopen = async () => {
        console.log("[NETWORK] WebSocket opened");
        this.connected = true;
        this.onConnect?.();

        // A reconnect of a session that had already joined a world: the new
        // server process knows nothing about this client, so re-send the join
        // handshake to rebuild the server-side session (entity interests,
        // chunk interests, peer state) and receive a fresh INIT.
        if (this.joined && this.world) {
          console.log(
            `[NETWORK] Rejoining world ${this.world} after reconnect`,
          );
          this.sendJoinRequest();
        }

        resolve(this);
      };
      ws.onerror = (err: Event) => {
        console.error(
          `[NETWORK] WebSocket error\n` +
            `  Type: ${err.type}\n` +
            `  Connected: ${this.connected}\n` +
            `  ReadyState: ${ws.readyState} (${
              ["CONNECTING", "OPEN", "CLOSING", "CLOSED"][ws.readyState]
            })\n` +
            `  Pending packets: ${this.packetQueue.length}`,
        );
      };
      ws.onmessage = ({ data }) => {
        const arrayBuffer = data as ArrayBuffer;

        if (this.waitingForInit) {
          if (!this.initPacketReceived) {
            this.initPacketReceived = true;
            this.decodePriority(arrayBuffer);
          } else {
            this.enqueuePacket(arrayBuffer);
          }
          return;
        }

        this.enqueuePacket(arrayBuffer);
      };
      ws.onclose = (event) => {
        console.log(
          `[NETWORK] WebSocket closed, code: ${event.code} reason: ${
            event.reason || "(none)"
          }`,
        );

        this.connected = false;
        this.onDisconnect?.();
      };

      this.ws = ws;
    });
  };

  private enqueuePacket = (buffer: ArrayBuffer) => {
    this.packetQueue.push(buffer);

    const excess = this.packetQueue.length - this.options.maxQueuedPackets;
    if (excess > 0) {
      this.packetQueue.splice(0, excess);
    }
  };

  private maybeReconnect = () => {
    // Reconnection is driven by the worker-backed sync interval instead of a
    // timer chain hanging off socket close events, so a single missed event
    // or a throttled timer can never leave the session permanently offline.
    if (!this.serverURL || !this.connectionOptions) {
      return;
    }

    const reconnectTimeout =
      this.connectionOptions.reconnectTimeout ?? DEFAULT_RECONNECT_TIMEOUT_MS;
    if (reconnectTimeout <= 0) {
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      return;
    }

    if (performance.now() - this.lastConnectAttemptAt < reconnectTimeout) {
      return;
    }

    console.log("[NETWORK] Attempting to reconnect...");
    void this.connect(this.serverURL, this.connectionOptions);
  };

  join = async (world: string) => {
    if (this.waitingForInit) {
      console.warn(
        "[NETWORK] Already waiting for INIT, ignoring duplicate join request",
      );
      return new Promise<Network>((resolve) => {
        const checkInterval = setInterval(() => {
          if (!this.waitingForInit) {
            clearInterval(checkInterval);
            resolve(this);
          }
        }, 100);
      });
    }

    if (this.joined) {
      this.leave();
    }

    this.joined = true;
    this.world = world;
    this.sendJoinRequest();

    return new Promise<Network>((resolve, reject) => {
      this.joinResolve = resolve;
      this.joinReject = reject;
    });
  };

  private sendJoinRequest = () => {
    this.waitingForInit = true;
    this.initPacketReceived = false;
    this.joinStartTime = performance.now();

    this.send({
      type: "JOIN",
      json: {
        world: this.world,
        username: this.clientInfo.username,
        preferences:
          this.clientInfo.metadata?.preferences &&
          typeof this.clientInfo.metadata.preferences === "object"
            ? this.clientInfo.metadata.preferences
            : {},
      },
    });
  };

  connectWebRTC = async (): Promise<void> => {
    if (!this.useWebRTC) {
      return;
    }

    if (!this.clientInfo.id) {
      console.warn("[NETWORK] Cannot connect WebRTC without client ID");
      return;
    }

    try {
      this.rtc = new WebRTCConnection();

      this.rtc.onMessage = (data: ArrayBuffer) => {
        this.packetQueue.push(data);
      };

      this.rtc.onOpen = () => {
        console.log("[NETWORK] WebRTC DataChannel opened");
      };

      this.rtc.onClose = () => {
        console.log("[NETWORK] WebRTC DataChannel closed");
        this.rtc = null;
      };

      await this.rtc.connect(this.url.toString(), this.clientInfo.id);
      console.log("[NETWORK] WebRTC connected");
    } catch (e) {
      console.warn("[NETWORK] WebRTC connection failed:", e);
      this.rtc = null;
    }
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
  };

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
    if (!this.connected || !this.packetQueue.length) {
      return;
    }

    // Queued packets must not overtake a pending INIT: everything that
    // arrives during a (re)join is processed only after the INIT handshake
    // resets session state.
    if (this.waitingForInit) {
      return;
    }

    const queueLength = this.packetQueue.length;
    const backlogFactor = Math.min(
      this.options.maxBacklogFactor,
      Math.ceil(queueLength / 25),
    );
    const packetsToProcess = this.options.maxPacketsPerTick * backlogFactor;

    const packets = this.packetQueue.splice(
      0,
      Math.min(packetsToProcess, this.packetQueue.length),
    );

    const availableWorkers = Math.max(1, this.pool.availableCount);
    const perWorker = Math.ceil(packets.length / availableWorkers);

    const batches: ArrayBuffer[][] = [];
    for (let i = 0; i < packets.length; i += perWorker) {
      batches.push(packets.slice(i, i + perWorker));
    }

    Promise.all(
      batches.map((batch, idx) =>
        this.decode(batch).then((msgs) => ({ idx, msgs })),
      ),
    ).then((results) => {
      if (!this.connected) {
        return;
      }

      results.sort((a, b) => a.idx - b.idx);
      for (const { msgs } of results) {
        for (const message of msgs) {
          this.onMessage(message);
        }
      }
    });
  };

  flush = () => {
    for (let i = 0; i < this.intercepts.length; i++) {
      const intercept = this.intercepts[i];
      const packets = intercept.packets;
      if (packets && packets.length) {
        const toSend = packets.splice(0, packets.length);
        for (let j = 0; j < toSend.length; j++) {
          this.send(toSend[j]);
        }
      }
    }
  };

  register = (...intercepts: NetIntercept[]) => {
    intercepts.forEach((intercept) => {
      this.intercepts.push(intercept);
    });

    return this;
  };

  unregister = (...intercepts: NetIntercept[]) => {
    intercepts.forEach((intercept) => {
      const index = this.intercepts.indexOf(intercept);

      if (index !== -1) {
        this.intercepts.splice(index, 1);
      }
    });

    return this;
  };

  disconnect = () => {
    const wasConnected = this.connected;

    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }

    if (this.rtc) {
      this.rtc.close();
      this.rtc = null;
    }

    this.connected = false;
    this.joined = false;
    this.waitingForInit = false;
    this.initPacketReceived = false;
    this.packetQueue = [];
    this.joinResolve = null;
    this.joinReject = null;
    this.serverURL = null;
    this.connectionOptions = null;
    this.clearSyncInterval();
    this.terminateDecodeWorkers();

    if (wasConnected) {
      this.onDisconnect?.();
    }
  };

  send = (event: any) => {
    this.ws?.sendEvent(event);
  };

  setID = (id: string) => {
    this.clientInfo.id = id || "";
  };

  setUsername = (username: string) => {
    this.clientInfo.username = username || " ";
  };

  setMetadata = (metadata: Record<string, any>) => {
    this.clientInfo.metadata = metadata || {};
  };

  get concurrentWorkers() {
    return this.pool.workingCount;
  }

  get packetQueueLength() {
    return this.packetQueue.length;
  }

  get rtcConnected() {
    return this.rtc?.isConnected ?? false;
  }

  private onMessage = (message: MessageProtocol) => {
    const { type } = message;
    if (type === "ERROR") {
      const { text } = message;
      console.error("[NETWORK] Received ERROR:", text);
      const joinReject = this.joinReject;
      this.disconnectReason = text || "";
      this.disconnect();
      joinReject?.(text);
      return;
    }

    if (type === "INIT") {
      const { id } = message.json;

      if (id) {
        if (this.clientInfo.id && this.clientInfo.id !== id) {
          throw new Error(
            "Something went wrong with IDs! Better check if you're passing two same ID's to the same Voxelize server.",
          );
        }

        this.clientInfo.id = id;
      }
    }

    this.intercepts.forEach((intercept) => {
      intercept.onMessage?.(message, this.clientInfo);
    });

    if (type === "INIT") {
      this.waitingForInit = false;

      // Rejoin INITs (after a reconnect) have no pending join promise; the
      // handshake side effects below run for both first joins and rejoins.
      if (this.joinResolve) {
        const resolve = this.joinResolve;
        this.joinResolve = null;
        this.joinReject = null;
        resolve(this);
      }

      this.onJoin?.(this.world);

      if (this.useWebRTC && !this.rtc) {
        this.connectWebRTC().catch((e) => {
          console.warn("[NETWORK] WebRTC connection failed after INIT:", e);
        });
      }
    }
  };

  private static encodeSync(message: Record<string, unknown>) {
    if (message.json) {
      message.json = JSON.stringify(message.json);
    }
    message.type = Message.Type[message.type as string];
    if (message.entities) {
      (message.entities as Array<Record<string, unknown>>).forEach(
        (entity) => (entity.metadata = JSON.stringify(entity.metadata)),
      );
    }
    if (message.peers) {
      (message.peers as Array<Record<string, unknown>>).forEach(
        (peer) => (peer.metadata = JSON.stringify(peer.metadata)),
      );
    }
    return protocol.Message.encode(protocol.Message.create(message)).finish();
  }

  private decodePriority = (buffer: ArrayBuffer) => {
    const handler = (e: MessageEvent) => {
      this.priorityWorker.removeEventListener("message", handler);

      if (!this.connected) {
        // Never discard a possible INIT: the join handshake would wedge with
        // `waitingForInit` stuck. Re-queue it; a real teardown clears the
        // queue anyway.
        this.enqueuePacket(buffer);
        return;
      }

      const messages = e.data as MessageProtocol[];
      const decoded = messages[0];

      if (
        (decoded.type === "INIT" || decoded.type === "ERROR") &&
        this.waitingForInit
      ) {
        this.onMessage(decoded);
      } else {
        this.enqueuePacket(buffer);
      }
    };

    this.priorityWorker.addEventListener("message", handler);
    this.priorityWorker.postMessage([buffer]);
  };

  private decode = (data: ArrayBuffer[]): Promise<MessageProtocol[]> => {
    return new Promise<MessageProtocol[]>((resolve) => {
      this.pool.addJob({
        message: data,
        buffers: data,
        resolve,
      });
    });
  };

  private startSyncInterval = () => {
    if (this.stopSyncInterval) {
      return;
    }

    this.stopSyncInterval = setWorkerInterval(() => {
      if (!this.connected) {
        this.maybeReconnect();
        return;
      }
      if (this.waitingForInit) {
        this.maybeRetryJoin();
        return;
      }
      this.flush();
      this.sync();
    }, 1000 / 60);
  };

  private maybeRetryJoin = () => {
    if (!this.joined || !this.world) {
      return;
    }

    if (
      performance.now() - this.joinStartTime <
      this.options.joinRetryTimeout
    ) {
      return;
    }

    console.log(`[NETWORK] Join for ${this.world} unanswered, retrying...`);
    this.sendJoinRequest();
  };

  private clearSyncInterval = () => {
    this.stopSyncInterval?.();
    this.stopSyncInterval = null;
  };

  private createDecodeWorkerPool() {
    return new WorkerPool(DecodeWorker, {
      maxWorker: window.navigator.hardwareConcurrency || 4,
      name: "decode-worker",
    });
  }

  private createPriorityDecodeWorker() {
    return new DecodeWorker({
      name: "decode-priority",
    });
  }

  private ensureDecodeWorkers = () => {
    if (!this.hasTerminatedDecodeWorkers) {
      return;
    }

    this.pool = this.createDecodeWorkerPool();
    this.priorityWorker = this.createPriorityDecodeWorker();
    this.hasTerminatedDecodeWorkers = false;
  };

  private terminateDecodeWorkers = () => {
    if (this.hasTerminatedDecodeWorkers) {
      return;
    }

    this.pool.terminate();
    this.priorityWorker.terminate();
    this.hasTerminatedDecodeWorkers = true;
  };
}
