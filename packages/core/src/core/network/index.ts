import { MessageProtocol, protocol } from "@voxelize/protocol";
import DOMUrl from "domurl";

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
  joinTimeoutMs: number;
};

const defaultOptions: NetworkOptions = {
  maxPacketsPerTick: 64,
  maxBacklogFactor: 16,
  joinTimeoutMs: 10000,
};

export type NetworkConnectionOptions = {
  reconnectTimeout?: number;
  secret?: string;
  useWebRTC?: boolean;
};

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

  public ws: ProtocolWS;

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

  private clearSyncInterval: () => void;

  private pool: WorkerPool = new WorkerPool(DecodeWorker, {
    maxWorker: window.navigator.hardwareConcurrency || 4,
    name: "decode-worker",
  });

  private decodeApplyChain: Promise<void> = Promise.resolve();

  private pendingDecodeBatches = 0;

  private decodeGeneration = 0;

  private reconnection: ReturnType<typeof setTimeout>;

  private joinResolve: ((value: Network) => void) | null = null;

  private joinReject: ((reason: string) => void) | null = null;

  private joinTimeout: ReturnType<typeof setTimeout> | null = null;

  private packetQueue: ArrayBuffer[] = [];

  private waitingForInit = false;

  private rtc: WebRTCConnection | null = null;

  private useWebRTC = false;

  constructor(options: Partial<NetworkOptions> = {}) {
    this.options = {
      ...defaultOptions,
      ...options,
    };

    const syncInterval = window.setInterval(() => {
      if (!this.connected) return;
      this.flush();
      this.sync();
    }, 1000 / 60);
    this.clearSyncInterval = () => window.clearInterval(syncInterval);

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

    this.useWebRTC = options.useWebRTC ?? false;
    this.disconnectReason = "";

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
      this.ws.close();

      if (this.reconnection) {
        clearTimeout(this.reconnection);
      }
    }

    if (this.rtc) {
      this.rtc.close();
      this.rtc = null;
    }

    this.pendingDecodeBatches = 0;
    this.decodeGeneration += 1;

    return new Promise<Network>((resolve) => {
      const ws = new WebSocket(this.socket.toString()) as ProtocolWS;
      ws.binaryType = "arraybuffer";
      ws.sendEvent = async (event: any) => {
        while (!this.connected) {
          console.log(`waiting for websocket connection...`);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (ws.readyState === WebSocket.OPEN) {
          const encoded = Network.encodeSync(event);
          ws.send(encoded);
        }
      };
      ws.onopen = async () => {
        console.log("[NETWORK] WebSocket opened");
        this.connected = true;
        this.onConnect?.();

        clearTimeout(this.reconnection);

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
        this.packetQueue.push(arrayBuffer);
        if (this.waitingForInit) {
          this.sync();
        }
      };
      ws.onclose = (event) => {
        console.log(
          `[NETWORK] WebSocket closed, code: ${event.code} reason: ${
            event.reason || "(none)"
          }`,
        );

        this.connected = false;
        this.onDisconnect?.();

        if (options.reconnectTimeout) {
          this.reconnection = setTimeout(() => {
            this.connect(serverURL, options);
          }, options.reconnectTimeout);
        }
      };

      this.ws = ws;
    });
  };

  dispose = () => {
    this.disconnect();
    this.clearSyncInterval();
    this.pool.dispose();
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

    const wasJoined = this.joined;
    if (wasJoined) {
      this.leave();
    }

    this.joined = true;
    this.world = world;
    this.waitingForInit = true;

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
      this.joinTimeout = setTimeout(() => {
        if (!this.waitingForInit) return;
        const reason =
          `Timed out waiting for INIT after ${this.options.joinTimeoutMs}ms ` +
          `(queued packets: ${this.packetQueue.length}, connected: ${this.connected})`;
        this.rejectJoin(reason);
      }, this.options.joinTimeoutMs);
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

    this.pendingDecodeBatches += 1;
    const generation = this.decodeGeneration;
    const decodePromise = Promise.all(
      batches.map((batch, index) =>
        this.decode(batch).then((messages) => ({ index, messages })),
      ),
    );

    this.decodeApplyChain = this.decodeApplyChain
      .catch(() => undefined)
      .then(async () => {
        try {
          const results = await decodePromise;
          if (generation !== this.decodeGeneration) return;
          results.sort((a, b) => a.index - b.index);
          for (const { messages } of results) {
            this.handleDecodedMessages(messages);
          }
        } catch (error) {
          this.handleDecodeError(
            error instanceof Error ? error : String(error),
            "Decode failed",
          );
        } finally {
          this.pendingDecodeBatches = Math.max(
            0,
            this.pendingDecodeBatches - 1,
          );
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

    this.connected = false;
    this.onDisconnect?.();
    this.pendingDecodeBatches = 0;
    this.decodeGeneration += 1;
    this.pool.queue.length = 0;

    if (this.reconnection) {
      clearTimeout(this.reconnection);
    }
    if (this.joinTimeout) {
      clearTimeout(this.joinTimeout);
      this.joinTimeout = null;
    }
  };

  send = (event: any) => {
    this.ws.sendEvent(event);
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

  get decodeQueueLength() {
    return this.pool.queue.length + this.pendingDecodeBatches;
  }

  get isDecodingPacket() {
    return this.pendingDecodeBatches > 0 || this.pool.workingCount > 0;
  }

  get hasPendingMessages() {
    return (
      this.packetQueue.length > 0 ||
      this.pool.queue.length > 0 ||
      this.pendingDecodeBatches > 0 ||
      this.pool.workingCount > 0
    );
  }

  get rtcConnected() {
    return this.rtc?.isConnected ?? false;
  }

  private onMessage = (message: MessageProtocol) => {
    const { type } = message;
    if (type === "ERROR") {
      const { text } = message;
      console.error("[NETWORK] Received ERROR:", text);
      this.disconnectReason = text || "";
      this.disconnect();
      this.waitingForInit = false;
      this.joinReject?.(text);
      this.joinResolve = null;
      this.joinReject = null;
      if (this.joinTimeout) {
        clearTimeout(this.joinTimeout);
        this.joinTimeout = null;
      }
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
      if (!this.joinResolve) {
        throw new Error("Something went wrong with joining worlds...");
      }

      this.waitingForInit = false;
      this.joinResolve(this);
      this.joinResolve = null;
      this.joinReject = null;
      if (this.joinTimeout) {
        clearTimeout(this.joinTimeout);
        this.joinTimeout = null;
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

  private rejectJoin = (reason: string) => {
    this.disconnectReason = reason;
    if (!this.waitingForInit) return;

    this.waitingForInit = false;
    this.joinReject?.(reason);
    this.joinResolve = null;
    this.joinReject = null;
    if (this.joinTimeout) {
      clearTimeout(this.joinTimeout);
      this.joinTimeout = null;
    }
    console.error("[NETWORK]", reason);
  };

  private handleDecodedMessages = (messages: MessageProtocol[]) => {
    for (const message of messages) {
      this.onMessage(message);
    }
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

  private handleDecodeError = (
    error: Error | ErrorEvent | string,
    prefix: string,
  ) => {
    const errorMessage =
      typeof error === "string"
        ? error
        : "message" in error
          ? error.message
          : String(error);
    const reason = `${prefix}: ${errorMessage}`;
    if (this.waitingForInit) {
      this.rejectJoin(reason);
    } else {
      console.error("[NETWORK]", reason);
    }
  };
}
