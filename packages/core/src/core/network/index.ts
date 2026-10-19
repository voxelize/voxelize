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
import {
  CachedRegistry,
  createRegistryBackend,
  INIT_REGISTRY_CACHED_KEY,
  INIT_REGISTRY_DIGEST_KEY,
  isRegistryEntry,
  ParsedRegistry,
  readRegistryInWorker,
  RegistryStore,
  resolveInitRegistry,
  withDigestHint,
} from "./registry-cache";
import { WebRTCConnection } from "./webrtc";
import { decodeMessage, finishRawJson } from "./workers/decode-utils";
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
   * dropped, loudly and counted in {@link Network.droppedPacketCount}: the
   * interest/keep-alive protocol re-converges on fresh state, so bounded loss
   * beats unbounded memory growth when processing stalls.
   */
  maxQueuedPackets: number;

  /**
   * Decode workers to run, at most one per core. Every worker is a V8
   * isolate, and every isolate in a renderer (the page and all of its
   * workers) draws its heap from one shared pointer-compression cage of about
   * 4 GB, whatever heap limit each isolate reports; the renderer dies when
   * their sum reaches it. A decode worker that has been busy keeps tens of
   * megabytes of young generation committed for good, and decoding (LZ4 and
   * protobuf) is light enough that a few workers keep up with any stream, so
   * one per core spent the shared budget for nothing.
   */
  maxDecodeWorkers: number;

  /**
   * Packets one decode job carries. A tick's backlog goes to as few workers
   * as this allows rather than being spread over all of them, so the workers
   * a light stream does not need stay idle and small, and no single job's
   * decoded messages can balloon a worker's heap. What a tick does not hand
   * out waits in the packet queue as raw buffers, outside the V8 heap.
   */
  maxPacketsPerDecodeJob: number;

  /**
   * Milliseconds one decode job may take before its worker is presumed dead
   * or hung. A worker the renderer kills (out of memory, most often) dies
   * without an error event, and its job would never settle: the page stayed
   * connected and joined while every packet after it waited forever. Past
   * this the worker is replaced and the job's packets are decoded again.
   * Must be positive: decoded messages are delivered in the order their
   * packets arrived, so a job that never settled would hold back every
   * message behind it.
   */
  decodeJobTimeoutMs: number;

  /**
   * Times one job's packets are decoded before they are given up on, loudly.
   * Bounds a packet that kills or hangs every worker it is handed to.
   */
  maxDecodeAttempts: number;

  /**
   * Milliseconds a (re)join handshake may await its INIT before a join
   * request that never reached an open socket is sent again.
   */
  joinRetryTimeout: number;

  /**
   * Milliseconds a join request handed to an open socket may go unanswered
   * before it is sent again, loudly. The server answers every such request
   * with an INIT, an ERROR or a close, and a repeated JOIN makes it replay
   * the whole INIT, which the page then applies a second time. A loaded
   * server can take well over {@link NetworkOptions.joinRetryTimeout} to
   * answer, so this one only bounds a server that never does.
   */
  joinAnswerTimeout: number;

  /**
   * Upper bound on command packets (see {@link COMMAND_PACKET_TYPES}) held
   * for retry after a send raced a closing socket. Beyond it the oldest are
   * dropped loudly and counted in {@link Network.droppedCommandCount}:
   * bounded loss beats unbounded buffering, but a command must never vanish
   * in silence.
   */
  maxPendingCommandPackets: number;

  /**
   * Keep the server's block registry (the bulk of every INIT) in Cache
   * Storage or IndexedDB between joins and page loads. A JOIN then names the
   * registry kept and the server leaves it out of the INIT while it still
   * matches; see `./registry-cache`. Servers that do not know the handshake
   * ignore it, and a client without a kept registry gets the full INIT.
   */
  cacheRegistry: boolean;

  /**
   * Milliseconds an INIT that left the registry out may wait for the kept
   * copy to finish loading from storage. The JOIN itself never waits: it
   * names the registry storage says it keeps, and the read (started when the
   * network is created, or with a later JOIN) has normally landed by the
   * time the INIT does. Past this the client joins again, on a fresh socket
   * and without a digest, and gets the full registry.
   */
  registryCacheWaitMs: number;
};

const defaultOptions: NetworkOptions = {
  maxPacketsPerTick: 64,
  maxBacklogFactor: 16,
  maxQueuedPackets: 4096,
  joinRetryTimeout: 10000,
  joinAnswerTimeout: 60000,
  maxPendingCommandPackets: 256,
  maxDecodeWorkers: 4,
  maxPacketsPerDecodeJob: 64,
  decodeJobTimeoutMs: 10000,
  maxDecodeAttempts: 3,
  cacheRegistry: true,
  registryCacheWaitMs: 3000,
};

/** A registry read the priority worker has not answered by then (it died or
 * hung) counts as nothing kept. */
const REGISTRY_WORKER_READ_TIMEOUT_MS = 10000;

/** Packet drops are reported at most this often, with the count since the
 * last report: a stalled page can overflow the queue on every packet. */
const PACKET_DROP_REPORT_INTERVAL_MS = 5000;

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
  /**
   * Signed session ticket proving who this client is (id, name, role, ...).
   * Sent as `?ticket=` on the socket upgrade and in the WebRTC offer. A
   * server with session authentication derives the client id from it and
   * ignores `client_id`; without one the client is admitted only where the
   * server trusts client-chosen ids.
   */
  ticket?: string | null;
  /**
   * Fetch a fresh ticket right before each (re)connect. Preferred over a
   * static `ticket`: tickets expire, and a long-lived tab that reconnects
   * past the expiry would otherwise be refused.
   */
  getTicket?: () => Promise<string | null>;
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

  /** The ticket the current socket connected with; reused by the RTC offer. */
  private sessionTicket: string | null = null;

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

  private droppedPacketTotal = 0;

  /** Drops not yet reported, and when the last report went out. */
  private unreportedPacketDrops = 0;

  private lastPacketDropReportAt = Number.NEGATIVE_INFINITY;
  /**
   * When each queued packet's bytes arrived, keyed by the buffer object. A
   * buffer transferred to a decode worker is detached but keeps its identity,
   * so the stamp survives to annotate the decoded message.
   */
  private packetArrivedAt = new WeakMap<ArrayBuffer, number>();

  /**
   * Decode jobs settle out of order (a later, smaller batch can finish
   * first, and a job whose worker died is decoded again), but their messages
   * are handed on in the order the packets arrived: a voxel edit applied
   * before the one it followed would leave the older value standing. Jobs
   * are numbered as they are dispatched; `nextDeliverySequence` is the first
   * one not yet handed on, and `decodedAhead` holds what finished before it.
   */
  private nextDecodeSequence = 0;

  private nextDeliverySequence = 0;

  private decodedAhead = new Map<number, MessageProtocol[]>();

  /** Bumped when the decode workers are torn down; older jobs are ignored. */
  private decodeEpoch = 0;

  private joinStartTime = 0;

  /** The socket the pending join request was handed to, if it was. */
  private joinSocket: ProtocolWS | null = null;

  private waitingForInit = false;

  private initPacketReceived = false;

  private rtc: WebRTCConnection | null = null;

  private useWebRTC = false;

  /**
   * The registry text in hand for the INIT a JOIN is waiting on (read back
   * from storage, or cut from a full INIT). Dropped once that INIT is handled:
   * storage keeps the text, and holding megabytes for the page's lifetime
   * would only serve a rejoin, which reads it back in milliseconds.
   */
  private registry: CachedRegistry | null = null;

  private registryStore: RegistryStore | null = null;

  /** The read of the kept registry from storage, while it is in flight. */
  private registryRead: Promise<void> | null = null;

  /** The digest of the registry storage keeps, as far as this page knows
   * (its synchronous hint at first, then what this page wrote or read). */
  private keptRegistryDigest: string | null = null;

  /** Bumped by every write or clear of the kept registry this page issues;
   * a read begun before one no longer says what storage holds. */
  private registryStoreChanges = 0;

  /** Bumped by every JOIN sent; an INIT held for the registry read is
   * dropped if another JOIN went out meanwhile. */
  private joinAttemptCount = 0;

  /** An INIT that left the registry out, held while the kept copy loads. */
  private initAwaitingRegistry: MessageProtocol | null = null;

  /** Set when an INIT left out a registry this client did not hold and the
   * JOIN was sent again without a digest; a second such INIT fails the join. */
  private hasRefetchedRegistry = false;

  /** The held registry parsed ahead of its INIT ({@link parseHeldRegistry}),
   * kept for that one INIT: whatever was built from it early is what the
   * INIT then carries. */
  private parsedRegistry: ParsedRegistry | null = null;

  /** The digest the JOIN in flight named, if any. */
  private joinNamedDigest: string | null = null;

  /** Whether the registry in hand was offered ({@link offerRegistry}) rather
   * than read back from storage. */
  private isRegistryOffered = false;

  /** Woken whenever a registry comes into hand (storage read or offer). */
  private registryHeldWaiters = new Set<() => void>();

  constructor(options: Partial<NetworkOptions> = {}) {
    this.options = {
      ...defaultOptions,
      ...options,
    };

    if (!(this.options.decodeJobTimeoutMs > 0)) {
      console.warn(
        `[NETWORK] decodeJobTimeoutMs must be positive (got ${this.options.decodeJobTimeoutMs}); ` +
          `using ${defaultOptions.decodeJobTimeoutMs}ms`,
      );
      this.options.decodeJobTimeoutMs = defaultOptions.decodeJobTimeoutMs;
    }

    if (typeof window !== "undefined") {
      this.ensureDecodeWorkers();
      this.startSyncInterval();
      if (this.options.cacheRegistry) this.openRegistryStore();
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

    // The connection being replaced stops being read now, before the ticket
    // is awaited: everything it would deliver meanwhile belongs to the
    // session being dropped, and a rejoin has already cleared what it queued.
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

    // Fresh on every connect: an expired ticket is a refused socket, and a
    // reconnect after a long session is exactly when it would have expired.
    let ticket: string | null = options.ticket ?? null;
    if (options.getTicket) {
      try {
        ticket = await options.getTicket();
      } catch (error) {
        console.warn(
          "[NETWORK] Session ticket fetch failed; connecting without one",
          error,
        );
        ticket = null;
      }
    }
    this.sessionTicket = ticket;
    if (ticket) {
      this.socket.searchParams.set("ticket", ticket);
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

        if (this.deliverOnArrival(arrayBuffer)) return;
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
    this.packetArrivedAt.set(buffer, performance.now());

    const excess = this.packetQueue.length - this.options.maxQueuedPackets;
    if (excess > 0) {
      this.packetQueue.splice(0, excess);
      this.droppedPacketTotal += excess;
      this.unreportedPacketDrops += excess;
      const now = performance.now();
      if (now - this.lastPacketDropReportAt >= PACKET_DROP_REPORT_INTERVAL_MS) {
        console.error(
          `[NETWORK] Dropped the ${this.unreportedPacketDrops} oldest unprocessed inbound packet(s): ` +
            `more than ${this.options.maxQueuedPackets} were waiting to be decoded ` +
            `(${this.droppedPacketTotal} dropped this session). Entity and chunk state re-converge; ` +
            "one-shot events among them are lost.",
        );
        this.unreportedPacketDrops = 0;
        this.lastPacketDropReportAt = now;
      }
    }
  };

  /**
   * While a registered intercept cannot do without what is arriving (a
   * world waiting on its spawn window, see
   * {@link NetIntercept.wantsMessagesOnArrival}), packets are decoded and
   * handed on here, the moment they arrive, instead of waiting for the next
   * sync tick and a decode worker's reply. On a main thread busy with long
   * loading tasks each of those two hops waits for its own free turn, which
   * put ~300 ms between a window's bytes arriving and the world seeing them.
   * Packets still queued for the workers go first, in order; nothing goes
   * while a worker job is out, so order is kept. A packet that fails to
   * decode here goes the usual way.
   */
  private deliverOnArrival = (buffer: ArrayBuffer): boolean =>
    this.drainOnArrival() && this.decodeAndDeliver(buffer, performance.now());

  /**
   * Decode and hand on every queued packet on this thread, in order. False
   * when nobody asks for it, a worker job is out, or a packet would not
   * decode (it and the ones behind it are left to the workers).
   */
  private drainOnArrival = (): boolean => {
    if (
      !this.connected ||
      this.waitingForInit ||
      this.nextDecodeSequence !== this.nextDeliverySequence ||
      !this.intercepts.some((intercept) => intercept.wantsMessagesOnArrival?.())
    ) {
      return false;
    }
    while (this.packetQueue.length > 0) {
      if (!this.connected) return false;
      const queued = this.packetQueue[0];
      const arrivedAt = this.packetArrivedAt.get(queued) ?? performance.now();
      if (!this.decodeAndDeliver(queued, arrivedAt)) return false;
      this.packetQueue.shift();
    }
    return true;
  };

  private decodeAndDeliver = (
    buffer: ArrayBuffer,
    arrivedAt: number,
  ): boolean => {
    let message: MessageProtocol;
    try {
      message = decodeMessage(
        new Uint8Array(buffer),
        [],
      ) as unknown as MessageProtocol;
    } catch (error) {
      console.error(
        "[NETWORK] Decoding a packet on arrival failed; handing it to the decode workers",
        error,
      );
      return false;
    }
    if (isPerfLogging()) {
      annotateIncomingMessages([message], [buffer.byteLength]);
    }
    message.perfArrivedAt = arrivedAt;
    try {
      this.onMessage(message);
    } catch (error) {
      console.error(
        `[NETWORK] Handling an inbound ${String(message.type)} message threw; continuing with the next one`,
        error,
      );
    }
    return true;
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
    this.joinAttemptCount += 1;
    const registryDigest = this.namedRegistryDigest();
    this.joinNamedDigest = registryDigest;

    const isSent = this.send({
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
        // The block registry this client already holds; the server leaves
        // it out of the INIT when it is still current.
        ...(registryDigest ? { registryDigest } : {}),
      },
    });
    this.joinSocket = isSent ? this.ws : null;
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

      await this.rtc.connect(
        this.url.toString(),
        this.clientInfo.id,
        this.sessionTicket,
        this.world,
      );
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

    if (this.drainOnArrival()) return;

    const pool = this.pool;
    if (!pool) return;

    const queueLength = this.packetQueue.length;
    const backlogFactor = Math.min(
      this.options.maxBacklogFactor,
      Math.ceil(queueLength / 25),
    );
    const packetsWanted = Math.min(
      queueLength,
      this.options.maxPacketsPerTick * backlogFactor,
    );
    const perJob = Math.max(1, this.options.maxPacketsPerDecodeJob);
    const jobCount = Math.min(
      Math.max(1, pool.availableCount),
      Math.ceil(packetsWanted / perJob),
    );

    const packets = this.packetQueue.splice(
      0,
      Math.min(packetsWanted, jobCount * perJob),
    );

    for (let i = 0; i < packets.length; i += perJob) {
      const sequence = this.nextDecodeSequence++;
      const epoch = this.decodeEpoch;
      void this.decode(packets.slice(i, i + perJob), epoch).then((messages) =>
        this.deliverDecoded(epoch, sequence, messages),
      );
    }
  };

  /** Hand on every decoded job up to the first one still decoding, in order. */
  private deliverDecoded = (
    epoch: number,
    sequence: number,
    messages: MessageProtocol[],
  ) => {
    if (epoch !== this.decodeEpoch) return;
    this.decodedAhead.set(sequence, messages);
    let ready = this.decodedAhead.get(this.nextDeliverySequence);
    while (ready !== undefined) {
      this.decodedAhead.delete(this.nextDeliverySequence);
      this.nextDeliverySequence++;
      for (const message of ready) {
        if (epoch !== this.decodeEpoch) return;
        if (!this.connected) break;
        try {
          this.onMessage(message);
        } catch (error) {
          console.error(
            `[NETWORK] Handling an inbound ${String(message.type)} message threw; continuing with the next one`,
            error,
          );
        }
      }
      ready = this.decodedAhead.get(this.nextDeliverySequence);
    }
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
        const sent: MessageProtocol[] = [];
        for (let j = 0; j < toSend.length; j++) {
          if (this.dispatchOutgoingPacket(toSend[j])) sent.push(toSend[j]);
        }
        if (sent.length > 0) intercept.onPacketsSent?.(sent);
      }
    }
  };

  /** Returns whether the packet reached an open socket on this call. */
  private dispatchOutgoingPacket = (packet: MessageProtocol): boolean => {
    if (this.send(packet)) {
      return true;
    }
    // State samples (PEER, LOAD, ...) re-converge after the rejoin
    // handshake; commands must never vanish silently, so they wait in a
    // bounded retry queue that the next successful flush drains first.
    if (!COMMAND_PACKET_TYPES.has(String(packet.type))) {
      return false;
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
    return false;
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
    // A join still waiting for its INIT never gets one now: settle it, or
    // whoever awaits it (a torn-down mount's start) waits forever. A
    // microtask late, so a caller that disconnects on a server ERROR and
    // then rejects with the server's own text still names the real reason.
    const joinReject = this.joinReject;
    if (joinReject) {
      queueMicrotask(() => joinReject("network closed before INIT"));
    }
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

  /** Inbound packets dropped unprocessed this session, each reported in an
   * error log (see {@link NetworkOptions.maxQueuedPackets}). */
  get droppedPacketCount() {
    return this.droppedPacketTotal;
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
    const initText =
      type === "INIT" && typeof message.json === "string" ? message.json : null;
    // Oversized `json` (the INIT block registry) crosses the worker boundary
    // as a string and is parsed exactly once, here.
    finishRawJson(message as unknown as Record<string, unknown>);
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
      if (!this.completeInitRegistry(message, initText)) return;

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

  /**
   * Make an INIT whole before any intercept reads it: put a registry the
   * server left out back in, and keep a registry it sent. Returns false when
   * the INIT is not to be handled now: it waits for the kept registry to
   * finish loading, or it left out a registry this client does not hold and
   * the JOIN has been sent again without a digest (once).
   */
  private completeInitRegistry = (
    message: MessageProtocol,
    initText: string | null,
  ): boolean => {
    const json = message.json as Record<string, unknown> | undefined;
    if (!json || typeof json !== "object") return true;

    const read = this.registryRead;
    if (this.initAwaitingRegistry === message) {
      this.initAwaitingRegistry = null;
    } else if (
      read &&
      json[INIT_REGISTRY_CACHED_KEY] === true &&
      this.registry?.digest !== json[INIT_REGISTRY_DIGEST_KEY]
    ) {
      this.awaitKeptRegistry(message, read);
      return false;
    }

    const resolution = resolveInitRegistry(
      json,
      initText,
      this.registry,
      this.parsedRegistry,
    );
    // Parsed for this INIT only: its objects are now the INIT's, and whoever
    // initializes from them mutates them.
    this.parsedRegistry = null;
    if (resolution.kind === "missing") {
      // Joining again must not name it again. A read still landing may yet
      // bring back a good copy, so only a settled miss forgets the store.
      this.keptRegistryDigest = null;
      if (this.registryRead) this.registry = null;
      else this.forgetRegistry();
      if (this.hasRefetchedRegistry) {
        const reason = `INIT for ${this.world} left out block registry ${resolution.digest} twice, and this client holds none`;
        console.error(`[NETWORK] ${reason}`);
        const joinReject = this.joinReject;
        this.disconnectReason = reason;
        this.disconnect();
        joinReject?.(reason);
        return false;
      }
      console.error(
        `[NETWORK] INIT for ${this.world} left out block registry ${resolution.digest}, ` +
          "which this client does not hold; joining again for the full registry",
      );
      this.hasRefetchedRegistry = true;
      this.rejoinOnFreshSocket();
      return false;
    }

    this.hasRefetchedRegistry = false;
    // The text has served this INIT; storage keeps it for the next one.
    const digest = json[INIT_REGISTRY_DIGEST_KEY];
    const held = this.registry;
    const wasOffered = this.isRegistryOffered;
    const isHeldCurrent = !!held && held.digest === digest;
    // An offered registry was never in storage, so it says nothing of it.
    const wasKept = isHeldCurrent && !wasOffered;
    this.registry = null;
    this.isRegistryOffered = false;
    if (wasKept) this.keptRegistryDigest = digest as string;
    // An offered registry this INIT confirmed is the server's current one:
    // storage keeps it as it keeps one cut from a full INIT, so a rejoin (a
    // reconnect) and the next page load name it too. Not when storage
    // already says it holds this digest.
    const keep =
      resolution.keep ??
      (isHeldCurrent && wasOffered && this.keptRegistryDigest !== digest
        ? held
        : null);
    const store = this.registryStore;
    if (keep && store) {
      const entry = keep;
      this.registryStoreChanges += 1;
      // Off the INIT's own path; the write clones the text once.
      setTimeout(() => {
        void store.write(entry).then((isKept) => {
          if (isKept) this.keptRegistryDigest = entry.digest;
        });
      }, 0);
    }
    return true;
  };

  /**
   * The registry digest a JOIN names: the text in hand, or the one storage
   * keeps, read back now (if it is not already being read) so an INIT that
   * leaves it out can wait for it. Null when neither is there.
   */
  private namedRegistryDigest = (): string | null => {
    if (this.registry) return this.registry.digest;
    if (!this.keptRegistryDigest || !this.registryStore) return null;
    if (!this.registryRead) this.readKeptRegistry();
    return this.keptRegistryDigest;
  };

  /**
   * Hand the network a block registry from elsewhere (an HTTP fetch made
   * while the page loaded, say) for the next JOIN to name, exactly as a
   * registry read back from storage is. The digest must be the one the
   * server gave with that text; the network never computes one.
   *
   * Taken only while it can still serve a JOIN: before one is sent, it
   * replaces whatever storage had brought back (a fetch answers for the
   * server's registry now, storage for an earlier one); with a JOIN in
   * flight, only the registry that JOIN named. Returns whether the network
   * now holds this registry.
   */
  offerRegistry = (entry: CachedRegistry | null | undefined): boolean => {
    if (!isRegistryEntry(entry)) return false;
    if (this.registry?.digest === entry.digest) return true;
    if (this.joined && !this.waitingForInit) return false;
    if (this.waitingForInit && this.joinNamedDigest !== entry.digest) {
      return false;
    }
    this.registry = { digest: entry.digest, blocks: entry.blocks };
    this.isRegistryOffered = true;
    if (this.parsedRegistry?.digest !== entry.digest) {
      this.parsedRegistry = null;
    }
    this.wakeRegistryHeldWaiters();
    return true;
  };

  /**
   * The registry this client holds for its next INIT, parsed now, once,
   * instead of when that INIT arrives. An INIT that leaves the registry out
   * is then completed with these very objects, so anything built from them
   * ahead of it (the world loading its blocks early) is built from what the
   * INIT carries. Null while no registry is held, or when its text does not
   * parse. Call it before the INIT lands; the objects belong to that INIT.
   */
  parseHeldRegistry = (): ParsedRegistry | null => {
    const held = this.registry;
    if (!held) return null;
    if (this.parsedRegistry?.digest === held.digest) return this.parsedRegistry;
    let blocks: unknown;
    try {
      blocks = JSON.parse(held.blocks);
    } catch {
      return null;
    }
    if (!blocks || typeof blocks !== "object" || Array.isArray(blocks)) {
      return null;
    }
    this.parsedRegistry = {
      digest: held.digest,
      blocks: blocks as Record<string, unknown>,
    };
    return this.parsedRegistry;
  };

  /**
   * Resolves with the registry this client holds once it holds one (read
   * back from storage or offered), or null after `timeoutMs`. Never rejects.
   */
  whenRegistryHeld = (timeoutMs: number): Promise<CachedRegistry | null> => {
    if (this.registry) return Promise.resolve(this.registry);
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.registryHeldWaiters.delete(wake);
        resolve(this.registry);
      };
      const timer = setTimeout(wake, Math.max(0, timeoutMs));
      this.registryHeldWaiters.add(wake);
    });
  };

  private wakeRegistryHeldWaiters = () => {
    for (const wake of [...this.registryHeldWaiters]) wake();
  };

  /**
   * Join again on a new socket. The server counts this session as joined
   * from its INIT on and streams the world behind it, so a JOIN repeated on
   * the same socket would have its INIT arrive behind that stream, where
   * nothing waiting for an INIT ever looks. A new socket starts a clean
   * session, and its open handler sends the JOIN.
   */
  private rejoinOnFreshSocket = () => {
    if (!this.serverURL || !this.connectionOptions) {
      this.sendJoinRequest();
      return;
    }
    // Nothing of the session being dropped may reach the new one. What it
    // queued is cleared; its decodes still running are dropped when they
    // land (the same reset `terminateDecodeWorkers` makes); and `connect`
    // detaches its socket synchronously, before awaiting a ticket.
    this.decodeEpoch += 1;
    this.nextDeliverySequence = this.nextDecodeSequence;
    this.decodedAhead.clear();
    this.packetQueue = [];
    this.initPacketReceived = false;
    this.joinSocket = null;
    void this.connect(this.serverURL, this.connectionOptions);
  };

  /**
   * Hold an INIT that left out the registry still loading from storage until
   * the read lands (bounded), then handle it. Everything behind it stays
   * queued meanwhile, exactly as while the INIT itself was in flight.
   */
  private awaitKeptRegistry = (
    message: MessageProtocol,
    read: Promise<void>,
  ) => {
    this.initAwaitingRegistry = message;
    const heldAt = performance.now();
    const attempt = this.joinAttemptCount;
    const epoch = this.decodeEpoch;
    const wanted = (message.json as Record<string, unknown>)[
      INIT_REGISTRY_DIGEST_KEY
    ];
    // An offer of the very registry left out serves it as well as the read.
    let stopOfferWait: () => void = () => {};
    const offered = new Promise<void>((resolve) => {
      const wake = () => {
        if (this.registry?.digest !== wanted) return;
        this.registryHeldWaiters.delete(wake);
        resolve();
      };
      stopOfferWait = () => this.registryHeldWaiters.delete(wake);
      this.registryHeldWaiters.add(wake);
    });
    void Promise.race([
      read,
      offered,
      new Promise((resolve) =>
        setTimeout(resolve, this.options.registryCacheWaitMs),
      ),
    ]).then(() => {
      stopOfferWait();
      if (this.initAwaitingRegistry !== message) return;
      if (
        !this.connected ||
        !this.waitingForInit ||
        attempt !== this.joinAttemptCount ||
        epoch !== this.decodeEpoch
      ) {
        // Torn down, or a newer JOIN is out and its own INIT will come.
        this.initAwaitingRegistry = null;
        return;
      }
      console.log(
        `[NETWORK] INIT waited ${Math.round(performance.now() - heldAt)}ms ` +
          `for the kept block registry (${this.registry ? "ready" : "not ready"})`,
      );
      this.onMessage(message);
    });
  };

  /**
   * Open the registry store and, when it says it keeps a registry, start
   * reading it back right away: the first JOIN will name it.
   */
  private openRegistryStore = () => {
    const backend = createRegistryBackend();
    if (!backend) return;
    this.registryStore = withDigestHint({
      ...backend,
      // Through the priority decode worker, idle until the INIT: the page's
      // main thread is at its busiest while the game starts, and a read
      // there waits behind that work at every step.
      read: () => {
        const worker = this.priorityWorker;
        return worker
          ? readRegistryInWorker(worker, REGISTRY_WORKER_READ_TIMEOUT_MS)
          : backend.read();
      },
    });
    this.keptRegistryDigest = this.registryStore.peekDigest();
    if (this.keptRegistryDigest) this.readKeptRegistry();
  };

  /** Read the kept registry back from storage, without holding anything up. */
  private readKeptRegistry = () => {
    const store = this.registryStore;
    if (!store) return;
    const startedAt = performance.now();
    const changes = this.registryStoreChanges;
    const read = store
      .read()
      .then((kept) => {
        // What the read found is what a later JOIN may name: nothing when
        // storage holds nothing (cleared, evicted, or no answer in time),
        // the other registry when it holds another. A write or clear issued
        // since says more than this read does.
        if (changes === this.registryStoreChanges) {
          this.keptRegistryDigest = kept?.digest ?? null;
        }
        // Kept only while there is a JOIN for it to serve.
        if (!kept || this.registry) return;
        if (this.joined && !this.waitingForInit) return;
        this.registry = kept;
        this.isRegistryOffered = false;
        this.wakeRegistryHeldWaiters();
        console.log(
          `[NETWORK] Kept block registry ${kept.digest} ready in ` +
            `${Math.round(performance.now() - startedAt)}ms ` +
            `(${Math.round(kept.blocks.length / 1024)} KB)`,
        );
      })
      .finally(() => {
        if (this.registryRead === read) this.registryRead = null;
      });
    this.registryRead = read;
  };

  private forgetRegistry = () => {
    this.registry = null;
    this.registryStoreChanges += 1;
    const store = this.registryStore;
    if (store) void store.clear();
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

  private decodePriority = (buffer: ArrayBuffer, attemptNumber = 1) => {
    const priorityWorker = this.priorityWorker;
    if (!priorityWorker) {
      this.enqueuePacket(buffer);
      return;
    }
    const { decodeJobTimeoutMs, maxDecodeAttempts } = this.options;
    const epoch = this.decodeEpoch;
    let isSettled = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const settle = () => {
      isSettled = true;
      if (watchdog !== null) clearTimeout(watchdog);
      priorityWorker.removeEventListener("message", handler);
      priorityWorker.removeEventListener("error", fail);
      priorityWorker.removeEventListener("messageerror", fail);
    };
    // The INIT a (re)join waits on is decoded here, so a worker that died or
    // hung with it would hold the join pending forever. The packet was
    // cloned into the worker, not transferred, and can be decoded again.
    const fail = () => {
      if (isSettled) return;
      settle();
      if (epoch !== this.decodeEpoch) return;
      if (this.priorityWorker === priorityWorker) {
        priorityWorker.terminate();
        this.priorityWorker = this.createPriorityDecodeWorker();
      }
      if (attemptNumber >= maxDecodeAttempts) {
        console.error(
          `[NETWORK] The priority decode worker failed ${attemptNumber} time(s) on one packet; ` +
            "handing it to the regular decode workers",
        );
        this.enqueuePacket(buffer);
        return;
      }
      console.error(
        `[NETWORK] The priority decode worker died, hung past ${decodeJobTimeoutMs}ms or threw; ` +
          `replaced it, decoding the packet again (attempt ${attemptNumber + 1} of ${maxDecodeAttempts})`,
      );
      this.decodePriority(buffer, attemptNumber + 1);
    };
    const handler = (e: MessageEvent) => {
      if (isSettled) return;
      // Decoded messages always come as an array; anything else is the
      // worker answering another request (a registry read).
      if (!Array.isArray(e.data)) return;
      settle();
      // A packet of a session dropped since (rejoined on a fresh socket).
      if (epoch !== this.decodeEpoch) return;

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

    watchdog = setTimeout(fail, decodeJobTimeoutMs);
    priorityWorker.addEventListener("message", handler);
    priorityWorker.addEventListener("error", fail);
    priorityWorker.addEventListener("messageerror", fail);
    priorityWorker.postMessage([buffer]);
  };

  private decode = (
    packets: ArrayBuffer[],
    epoch: number,
  ): Promise<MessageProtocol[]> => {
    const byteSizes = isPerfLogging()
      ? packets.map((buffer) => buffer.byteLength)
      : null;
    const arrivedAts = packets.map((buffer) =>
      this.packetArrivedAt.get(buffer),
    );
    const { decodeJobTimeoutMs, maxDecodeAttempts } = this.options;

    return new Promise<MessageProtocol[]>((resolve) => {
      const attempt = (attemptNumber: number) => {
        const pool = this.pool;
        if (!pool || epoch !== this.decodeEpoch) {
          resolve([]);
          return;
        }
        // A worker keeps the buffers transferred to it, a dead one included,
        // so every attempt hands over copies and the packets stay here until
        // one of them decodes.
        const copies = packets.map((buffer) => buffer.slice(0));
        pool.addJob({
          message: copies,
          buffers: copies,
          // On timeout the pool replaces the worker and settles the job null.
          timeoutMs: decodeJobTimeoutMs,
          resolve: (messages) => {
            if (messages) {
              if (byteSizes) {
                annotateIncomingMessages(messages, byteSizes);
              }
              // One message per packet, in packet order - the same 1:1 the
              // byte size annotation relies on.
              messages.forEach((message, index) => {
                const arrivedAt = arrivedAts[index];
                if (arrivedAt !== undefined) message.perfArrivedAt = arrivedAt;
              });
              resolve(messages);
              return;
            }
            if (epoch !== this.decodeEpoch) {
              resolve([]);
              return;
            }
            if (attemptNumber >= maxDecodeAttempts) {
              this.droppedPacketTotal += packets.length;
              console.error(
                `[NETWORK] Gave up decoding ${packets.length} packet(s) after ${attemptNumber} failed attempt(s); ` +
                  `they are lost (${this.droppedPacketTotal} dropped this session). Entity and chunk state ` +
                  "re-converge; one-shot events among them are lost.",
              );
              resolve([]);
              return;
            }
            console.error(
              `[NETWORK] A decode job of ${packets.length} packet(s) failed: its worker died, hung past ` +
                `${decodeJobTimeoutMs}ms or threw. Decoding them again (attempt ${attemptNumber + 1} of ` +
                `${maxDecodeAttempts}); later messages wait so they are still handed on in order.`,
            );
            attempt(attemptNumber + 1);
          },
        });
      };
      attempt(1);
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

    const isCarried = this.joinSocket !== null && this.joinSocket === this.ws;
    const waitedMs = performance.now() - this.joinStartTime;
    if (
      waitedMs <
      (isCarried
        ? this.options.joinAnswerTimeout
        : this.options.joinRetryTimeout)
    ) {
      return;
    }

    if (isCarried) {
      console.error(
        `[NETWORK] Join for ${this.world} has had no INIT for ${Math.round(
          waitedMs / 1000,
        )}s on the socket that carried it; sending it again`,
      );
    } else {
      console.log(
        `[NETWORK] Join for ${this.world} never reached an open socket, retrying...`,
      );
    }
    this.sendJoinRequest();
  };

  private clearSyncInterval = () => {
    this.stopSyncInterval?.();
    this.stopSyncInterval = null;
  };

  private createDecodeWorkerPool() {
    const { maxDecodeWorkers } = this.options;
    return new WorkerPool(DecodeWorker, {
      maxWorker: Math.max(
        1,
        Math.min(
          maxDecodeWorkers,
          window.navigator.hardwareConcurrency || maxDecodeWorkers,
        ),
      ),
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
    // Jobs on the terminated pool never settle; nothing may wait behind them.
    this.decodeEpoch += 1;
    this.nextDeliverySequence = this.nextDecodeSequence;
    this.decodedAhead.clear();
  };
}
