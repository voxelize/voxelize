import {
  MessageProtocol,
  PROTOCOL_MISMATCH_CLOSE_CODE,
  PROTOCOL_VERSION,
  protocol,
} from "@voxelize/protocol";
import DOMUrl from "domurl";

import { setWorkerInterval } from "../../libs/setWorkerInterval";
import { WorkerPool } from "../../libs/worker-pool";
import {
  annotateIncomingMessages,
  isPerfLogging,
  logChatWireSend,
  logIncomingMessage,
  setPerfWorld,
} from "../perf";

import { NetIntercept } from "./intercept";
import { WebRTCConnection } from "./webrtc";
import DecodeWorker from "./workers/decode-worker.ts?worker&inline";

export * from "./intercept";
export { WebRTCConnection } from "./webrtc";

const { Message } = protocol;

export type ProtocolWS = WebSocket & {
  sendEvent: (event: any) => boolean;
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

  /**
   * Upper bound on command packets (see {@link COMMAND_PACKET_TYPES}) held
   * for retry after a send raced a closing socket. Beyond it the oldest are
   * dropped loudly and counted in {@link Network.droppedCommandCount}:
   * bounded loss beats unbounded buffering, but a command must never vanish
   * in silence.
   */
  maxPendingCommandPackets: number;
};

const defaultOptions: NetworkOptions = {
  maxPacketsPerTick: 64,
  maxBacklogFactor: 16,
  maxQueuedPackets: 4096,
  joinRetryTimeout: 10000,
  maxPendingCommandPackets: 256,
};

/**
 * Client-to-server packet types that carry one-shot intent. Dropping one
 * silently desyncs the caller from the server (a METHOD or CHAT the caller
 * believes was delivered). Every other outgoing type is continuous state
 * (PEER samples, chunk interest) that the rejoin handshake re-converges, so
 * those may drop by design.
 */
const COMMAND_PACKET_TYPES = new Set(["METHOD", "CHAT"]);

function describeCommandPacket(packet: MessageProtocol): string {
  if (packet.type === "METHOD") {
    const name = (packet as { method?: { name?: string } }).method?.name;
    return name ? `METHOD:${name}` : "METHOD";
  }
  return String(packet.type);
}

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

  private pool: WorkerPool | null = null;

  private priorityWorker: Worker | null = null;

  private serverURL: string | null = null;

  private connectionOptions: NetworkConnectionOptions | null = null;

  private lastConnectAttemptAt = Number.NEGATIVE_INFINITY;

  /**
   * Set when the server closes the socket terminally (a protocol-version
   * mismatch, {@link PROTOCOL_MISMATCH_CLOSE_CODE}). Reconnecting would hit the
   * same rejection, so the client stops retrying and surfaces `client_outdated`
   * instead of burning reconnect grace.
   */
  private isTerminallyOutdated = false;

  /**
   * Command packets whose send raced a closing socket: {@link flush} retries
   * them, in order and ahead of newer packets, once the session is connected
   * and joined again. Bounded by `options.maxPendingCommandPackets`.
   */
  private pendingCommandPackets: MessageProtocol[] = [];

  private droppedCommandPacketCount = 0;

  private joinGenerationCount = 0;

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

    if (typeof window !== "undefined") {
      this.ensureDecodeWorkers();
      this.startSyncInterval();
    }

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
    // A deliberate (re)connect attempt clears any prior terminal state so a
    // freshly-loaded build can try again.
    this.isTerminallyOutdated = false;
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
      ws.sendEvent = (event: any): boolean => {
        // Honest by construction: the packet is either handed to an OPEN
        // socket right now, or it is not sent and the caller is told so.
        // Waiting out a CONNECTING window here would let the answer race the
        // socket's fate; a JOIN issued during that window is covered by the
        // onopen rejoin path instead.
        if (this.ws !== ws || ws.readyState !== WebSocket.OPEN) {
          return false;
        }
        const encoded = Network.encodeSync(event);
        logChatWireSend(event, encoded.byteLength);
        ws.send(encoded);
        return true;
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

        if (event.code === PROTOCOL_MISMATCH_CLOSE_CODE) {
          // Terminal: the client build is out of date. Do not reconnect.
          this.isTerminallyOutdated = true;
          this.disconnectReason = "client_outdated";
          console.error(
            `[NETWORK] Protocol mismatch (client is v${PROTOCOL_VERSION}); ` +
              "server refused the connection. Not reconnecting.",
          );
        }

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

    // A terminal protocol reject is not retryable: reconnecting would hit the
    // same close(4001). Stay down until the page reloads a fresh build.
    if (this.isTerminallyOutdated) {
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
    setPerfWorld(world);
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
        // Protocol capabilities this client supports; servers only use a
        // path a client advertised, so older servers simply ignore this.
        capabilities: ["motion.v1"],
        // Wire protocol version. Deterministic (fixed-step) worlds assert
        // strict equality and refuse a mismatch; non-deterministic worlds
        // ignore it, so this is always safe to send.
        protocol: PROTOCOL_VERSION,
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

      this.rtc.onMessage = this.enqueuePacket;

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

    const pool = this.pool;
    if (!pool) return;
    const availableWorkers = Math.max(1, pool.availableCount);
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
    // Outgoing packets are only meaningful on a connected, joined session.
    // While disconnected or mid-(re)join they stay queued in their
    // intercepts — exactly where the sync loop has always left them — and go
    // out once the INIT handshake completes. Splicing them out earlier hands
    // them to a socket that silently drops them, which is how a command
    // could be "acked" by the client yet never applied by the server.
    if (!this.connected || this.waitingForInit) {
      return;
    }

    if (this.pendingCommandPackets.length > 0) {
      const retries = this.pendingCommandPackets.splice(
        0,
        this.pendingCommandPackets.length,
      );
      for (let i = 0; i < retries.length; i++) {
        this.dispatchOutgoingPacket(retries[i]);
      }
    }

    for (let i = 0; i < this.intercepts.length; i++) {
      const intercept = this.intercepts[i];
      const packets = intercept.packets;
      if (packets && packets.length) {
        const toSend = packets.splice(0, packets.length);
        for (let j = 0; j < toSend.length; j++) {
          this.dispatchOutgoingPacket(toSend[j]);
        }
      }
    }
  };

  private dispatchOutgoingPacket = (packet: MessageProtocol) => {
    if (this.send(packet)) {
      return;
    }
    // State samples (PEER, LOAD, ...) re-converge after the rejoin
    // handshake; commands must never vanish silently, so they wait in a
    // bounded retry queue that the next successful flush drains first.
    if (!COMMAND_PACKET_TYPES.has(String(packet.type))) {
      return;
    }
    this.pendingCommandPackets.push(packet);
    const excess =
      this.pendingCommandPackets.length - this.options.maxPendingCommandPackets;
    if (excess > 0) {
      const dropped = this.pendingCommandPackets.splice(0, excess);
      this.droppedCommandPacketCount += dropped.length;
      console.error(
        `[NETWORK] Dropped ${dropped.length} queued command packet(s) ` +
          `(${dropped.map(describeCommandPacket).join(", ")}): more than ` +
          `${this.options.maxPendingCommandPackets} commands accumulated while the socket could not send.`,
      );
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

    // A deliberate teardown is the end of the line for queued commands:
    // nothing will ever send them, so say what is being lost instead of
    // letting them evaporate.
    if (this.pendingCommandPackets.length > 0) {
      const abandoned = this.pendingCommandPackets.splice(
        0,
        this.pendingCommandPackets.length,
      );
      this.droppedCommandPacketCount += abandoned.length;
      console.error(
        `[NETWORK] Disconnecting with ${abandoned.length} undelivered command packet(s) ` +
          `(${abandoned.map(describeCommandPacket).join(", ")}); they will never be sent.`,
      );
    }

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

  /**
   * Hand one event to the socket. Returns whether the packet was actually
   * given to an OPEN socket: `false` means it was NOT sent (no socket, still
   * connecting, closing, or closed). Callers that carry one-shot intent must
   * check the answer; {@link flush} does this for every intercept packet.
   */
  send = (event: any): boolean => {
    return this.ws?.sendEvent(event) ?? false;
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
    return this.pool?.workingCount ?? 0;
  }

  get packetQueueLength() {
    return this.packetQueue.length;
  }

  /** True between a (re)join request and its INIT: reads of world state are
   * answered from a map the server may no longer agree with. */
  get isJoinPending() {
    return this.waitingForInit;
  }

  /** Completed INIT handshakes so far; bumps on first join, every rejoin,
   * and every world switch. */
  get joinGeneration() {
    return this.joinGenerationCount;
  }

  /** Command packets waiting for a live session to retry on. */
  get pendingCommandCount() {
    return this.pendingCommandPackets.length;
  }

  /** Command packets dropped for good, with an error logged for each batch. */
  get droppedCommandCount() {
    return this.droppedCommandPacketCount;
  }

  /** Terminal protocol rejection: only a fresh client build can reconnect. */
  get isClientOutdated() {
    return this.isTerminallyOutdated;
  }

  get serverUrl(): string | null {
    return this.serverURL;
  }

  /**
   * Whether this exact packet object is still waiting in the command retry
   * queue. Together with the packet's absence from its intercept queue this
   * lets a caller prove a command was handed to an OPEN socket.
   */
  isPacketPendingSend = (packet: MessageProtocol): boolean =>
    this.pendingCommandPackets.includes(packet);

  /**
   * Trigger an immediate reconnect attempt, bypassing the periodic backoff.
   * Returns false when there is nothing to do: already connected, never
   * connected, or terminally rejected (outdated client build).
   */
  reconnectNow = (): boolean => {
    if (
      this.connected ||
      !this.serverURL ||
      !this.connectionOptions ||
      this.isTerminallyOutdated
    ) {
      return false;
    }
    console.log("[NETWORK] Reconnect requested; attempting now");
    void this.connect(this.serverURL, this.connectionOptions);
    return true;
  };

  get rtcConnected() {
    return this.rtc?.isConnected ?? false;
  }

  private onMessage = (message: MessageProtocol) => {
    const { type } = message;
    logIncomingMessage(message);
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
      // Monotone across first joins, rejoins, and world switches: observers
      // (e.g. the agent daemon) compare generations to know a rejoin
      // actually completed rather than merely started.
      this.joinGenerationCount += 1;

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
    const priorityWorker = this.priorityWorker;
    if (!priorityWorker) {
      this.enqueuePacket(buffer);
      return;
    }
    const handler = (e: MessageEvent) => {
      priorityWorker.removeEventListener("message", handler);

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

    priorityWorker.addEventListener("message", handler);
    priorityWorker.postMessage([buffer]);
  };

  private decode = (data: ArrayBuffer[]): Promise<MessageProtocol[]> => {
    return new Promise<MessageProtocol[]>((resolve) => {
      const pool = this.pool;
      if (!pool) {
        resolve([]);
        return;
      }
      const byteSizes = isPerfLogging()
        ? data.map((buffer) => buffer.byteLength)
        : null;
      pool.addJob({
        message: data,
        buffers: data,
        resolve: (messages) => {
          // A dead decode worker resolves `null`. The packets are gone (their
          // buffers were transferred into the corpse), so say so loudly and
          // settle with nothing rather than handing callers a non-iterable —
          // which used to throw in the packet loop and mask the real loss.
          if (!messages) {
            console.error(
              `[network] decode worker died; ${data.length} packet(s) lost`,
            );
            resolve([]);
            return;
          }
          if (byteSizes) {
            annotateIncomingMessages(messages, byteSizes);
          }
          resolve(messages);
        },
      });
    });
  };

  private startSyncInterval = () => {
    if (this.stopSyncInterval || typeof window === "undefined") {
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
    if (this.pool && this.priorityWorker && !this.hasTerminatedDecodeWorkers) {
      return;
    }

    this.pool = this.createDecodeWorkerPool();
    this.priorityWorker = this.createPriorityDecodeWorker();
    this.hasTerminatedDecodeWorkers = false;
  };

  private terminateDecodeWorkers = () => {
    if (this.hasTerminatedDecodeWorkers || !this.pool || !this.priorityWorker) {
      return;
    }

    this.pool.terminate();
    this.priorityWorker.terminate();
    this.pool = null;
    this.priorityWorker = null;
    this.hasTerminatedDecodeWorkers = true;
  };
}
