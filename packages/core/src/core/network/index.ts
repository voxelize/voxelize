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
import { finishRawJson } from "./workers/decode-utils";
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
};

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
      settle();

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
