import { MessageProtocol, protocol } from "@voxelize/protocol";
import DOMUrl from "domurl";

import { setWorkerInterval } from "../../libs/setWorkerInterval";
import { WorkerPool } from "../../libs/worker-pool";
import { JsonValue } from "../../types";

import { NetIntercept } from "./intercept";
import { WebRTCConnection } from "./webrtc";
import DecodeWorker from "./workers/decode-worker.ts?worker&inline";

export * from "./intercept";
export { WebRTCConnection } from "./webrtc";

const { Message } = protocol;

export type ProtocolWS = WebSocket & {
  sendEvent: (event: MessageProtocol) => void;
};

export type NetworkOptions = {
  maxPacketsPerTick: number;
  maxBacklogFactor: number;
};

const defaultOptions: NetworkOptions = {
  maxPacketsPerTick: 64,
  maxBacklogFactor: 16,
};

const toHttpProtocol = (protocol: string) => {
  if (protocol.startsWith("wss")) {
    return "https:";
  }
  if (protocol.startsWith("ws")) {
    return "http:";
  }
  return protocol;
};

const toWsProtocol = (protocol: string) => {
  if (protocol.startsWith("https")) {
    return "wss:";
  }
  if (protocol.startsWith("http")) {
    return "ws:";
  }
  return protocol;
};

export type NetworkConnectionOptions = {
  reconnectTimeout?: number;
  secret?: string;
  useWebRTC?: boolean;
};

type ClientMetadata = Record<string, JsonValue>;

export class Network {
  public options: NetworkOptions;

  public clientInfo: {
    id: string;
    username: string;
    metadata?: ClientMetadata;
  } = {
    id: "",
    username: "",
    metadata: {},
  };

  public intercepts: NetIntercept[] = [];

  public ws: ProtocolWS;

  public url: DOMUrl<Record<string, string>>;

  public world: string;

  public socket: URL;

  public connected = false;

  public joined = false;

  public onJoin: (world: string) => void;

  public onLeave: (world: string) => void;

  public onConnect: () => void;

  public onDisconnect: () => void;

  public disconnectReason = "";

  private pool: WorkerPool = new WorkerPool(DecodeWorker, {
    maxWorker: window.navigator.hardwareConcurrency || 4,
    name: "decode-worker",
  });

  private priorityWorker: Worker = new DecodeWorker({
    name: "decode-priority",
  });

  private reconnection: ReturnType<typeof setTimeout>;

  private joinResolve: ((value: Network) => void) | null = null;

  private joinReject: ((reason: string) => void) | null = null;

  private packetQueue: ArrayBuffer[] = [];
  private packetQueueHead = 0;
  private decodePromises: Array<Promise<MessageProtocol[]>> = [];
  private decodePacketBatches: Array<ArrayBuffer[]> = [];
  private reusableDecodePacketBatches: Array<ArrayBuffer[]> = [];
  private priorityDecodeBatch: ArrayBuffer[] = [new ArrayBuffer(0)];

  private joinStartTime = 0;

  private waitingForInit = false;

  private initPacketReceived = false;

  private rtc: WebRTCConnection | null = null;

  private useWebRTC = false;

  private hasPendingPackets = () => this.packetQueueHead < this.packetQueue.length;

  private queuedPacketCount = () => this.packetQueue.length - this.packetQueueHead;

  private normalizePacketQueue = () => {
    if (this.packetQueueHead === 0) {
      return;
    }

    if (this.packetQueueHead >= this.packetQueue.length) {
      this.packetQueue.length = 0;
      this.packetQueueHead = 0;
      return;
    }

    if (
      this.packetQueueHead >= 1024 &&
      this.packetQueueHead * 2 >= this.packetQueue.length
    ) {
      this.packetQueue.copyWithin(0, this.packetQueueHead);
      this.packetQueue.length -= this.packetQueueHead;
      this.packetQueueHead = 0;
    }
  };

  private acquireDecodePacketBatch(size: number) {
    const batch = this.reusableDecodePacketBatches.pop();
    if (batch) {
      batch.length = size;
      return batch;
    }
    return new Array<ArrayBuffer>(size);
  }

  private releaseDecodePacketBatch(batch: ArrayBuffer[]) {
    batch.length = 0;
    this.reusableDecodePacketBatches.push(batch);
  }

  private copyPacketRangeIntoBatch(
    source: ArrayBuffer[],
    start: number,
    end: number
  ) {
    const count = end - start;
    const batch = this.acquireDecodePacketBatch(count);
    for (let index = 0; index < count; index++) {
      batch[index] = source[start + index];
    }
    return batch;
  }

  constructor(options: Partial<NetworkOptions> = {}) {
    this.options = {
      ...defaultOptions,
      ...options,
    };

    setWorkerInterval(() => {
      if (!this.connected) return;
      this.flush();
      this.sync();
    }, 1000 / 60);

    const MAX = 10000;
    const maxDigits = MAX.toString().length;
    let index = Math.floor(Math.random() * MAX).toString();
    index = index.padStart(maxDigits, "0");
    this.clientInfo.username = `Guest ${index}`;
  }

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

    this.useWebRTC = options.useWebRTC ?? false;
    this.disconnectReason = "";

    this.url = new DOMUrl(serverURL);
    this.url.protocol = toHttpProtocol(this.url.protocol);
    this.url.hash = "";

    const socketURL = new DOMUrl(serverURL);
    socketURL.path = "/ws/";

    this.socket = new URL(socketURL.toString());
    this.socket.protocol = toWsProtocol(this.socket.protocol);
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

    return new Promise<Network>((resolve) => {
      const ws = new WebSocket(this.socket.toString()) as ProtocolWS;
      ws.binaryType = "arraybuffer";
      const sendWhenConnected = async (event: MessageProtocol) => {
        while (!this.connected) {
          if (
            ws.readyState === WebSocket.CLOSING ||
            ws.readyState === WebSocket.CLOSED ||
            this.ws !== ws
          ) {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (ws.readyState === WebSocket.OPEN) {
          const encoded = Network.encodeSync(event);
          ws.send(encoded);
        }
      };
      ws.sendEvent = (event: MessageProtocol) => {
        if (!this.connected) {
          void sendWhenConnected(event);
          return;
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
            `  Pending packets: ${this.queuedPacketCount()}`
        );
      };
      ws.onmessage = ({ data }) => {
        const arrayBuffer = data as ArrayBuffer;

        if (this.waitingForInit) {
          if (!this.initPacketReceived) {
            this.initPacketReceived = true;
            this.decodePriority(arrayBuffer);
          } else {
            this.packetQueue.push(arrayBuffer);
          }
          return;
        }

        this.packetQueue.push(arrayBuffer);
      };
      ws.onclose = (event) => {
        console.log(
          `[NETWORK] WebSocket closed, code: ${event.code} reason: ${
            event.reason || "(none)"
          }`
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

  join = async (world: string) => {
    if (this.waitingForInit) {
      console.warn(
        "[NETWORK] Already waiting for INIT, ignoring duplicate join request"
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
    this.waitingForInit = true;
    this.initPacketReceived = false;
    this.joinStartTime = performance.now();

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

  action = async (type: string, data?: JsonValue) => {
    this.send({
      type: "ACTION",
      json: {
        action: type,
        data,
      },
    });
  };

  sync = () => {
    if (!this.connected || !this.hasPendingPackets()) {
      return;
    }

    const queueLength = this.queuedPacketCount();
    const backlogFactor = Math.min(
      this.options.maxBacklogFactor,
      Math.ceil(queueLength / 25)
    );
    const packetsToProcess = this.options.maxPacketsPerTick * backlogFactor;
    const batchEnd = Math.min(
      this.packetQueueHead + packetsToProcess,
      this.packetQueue.length
    );
    const packetCount = batchEnd - this.packetQueueHead;
    if (packetCount <= 0) {
      return;
    }

    const availableWorkers = Math.max(1, this.pool.availableCount);
    const perWorker = Math.ceil(packetCount / availableWorkers);

    if (packetCount <= perWorker) {
      let packets: ArrayBuffer[];
      let shouldReleasePackets = false;
      if (this.packetQueueHead === 0 && batchEnd === this.packetQueue.length) {
        packets = this.packetQueue;
        this.packetQueue = [];
        this.packetQueueHead = 0;
      } else {
        packets = this.copyPacketRangeIntoBatch(
          this.packetQueue,
          this.packetQueueHead,
          batchEnd
        );
        shouldReleasePackets = true;
        this.packetQueueHead = batchEnd;
        this.normalizePacketQueue();
      }
      this.decode(packets)
        .then((messages) => {
          for (
            let messageIndex = 0;
            messageIndex < messages.length;
            messageIndex++
          ) {
            this.onMessage(messages[messageIndex]);
          }
          if (shouldReleasePackets) {
            this.releaseDecodePacketBatch(packets);
          }
        }, (error) => {
          console.error("[NETWORK] Failed to decode packet batch.", error);
          if (shouldReleasePackets) {
            this.releaseDecodePacketBatch(packets);
          }
        });
      return;
    }

    const batchCount = Math.ceil(packetCount / perWorker);
    const decodePromises = this.decodePromises;
    const decodePacketBatches = this.decodePacketBatches;
    decodePromises.length = batchCount;
    decodePacketBatches.length = batchCount;
    const sourceQueue = this.packetQueue;
    const batchStart = this.packetQueueHead;
    let batchIndex = 0;
    for (let offset = batchStart; offset < batchEnd; offset += perWorker) {
      const end = Math.min(offset + perWorker, batchEnd);
      const packetBatch = this.copyPacketRangeIntoBatch(
        sourceQueue,
        offset,
        end
      );
      decodePacketBatches[batchIndex] = packetBatch;
      decodePromises[batchIndex] = this.decode(packetBatch);
      batchIndex++;
    }
    if (batchStart === 0 && batchEnd === sourceQueue.length) {
      this.packetQueue = [];
      this.packetQueueHead = 0;
    } else {
      this.packetQueueHead = batchEnd;
      this.normalizePacketQueue();
    }

    const clearDecodeBatches = () => {
      for (let batchIndex = 0; batchIndex < decodePacketBatches.length; batchIndex++) {
        this.releaseDecodePacketBatch(decodePacketBatches[batchIndex]);
      }
      decodePacketBatches.length = 0;
      this.decodePromises.length = 0;
    };

    Promise.all(decodePromises).then((results) => {
        for (let batchIndex = 0; batchIndex < results.length; batchIndex++) {
          const messages = results[batchIndex];
          for (
            let messageIndex = 0;
            messageIndex < messages.length;
            messageIndex++
          ) {
            this.onMessage(messages[messageIndex]);
          }
        }
        clearDecodeBatches();
      }, (error) => {
        console.error("[NETWORK] Failed to decode packet batches.", error);
        clearDecodeBatches();
      });
  };

  flush = () => {
    if (!this.connected || !this.ws) {
      return;
    }

    const ws = this.ws;
    for (let i = 0; i < this.intercepts.length; i++) {
      const intercept = this.intercepts[i];
      const packets = intercept.packets;
      if (packets && packets.length) {
        const packetCount = packets.length;
        for (let j = 0; j < packetCount; j++) {
          ws.sendEvent(packets[j]);
        }
        packets.length = 0;
      }
    }
  };

  register = (...intercepts: NetIntercept[]) => {
    for (let index = 0; index < intercepts.length; index++) {
      this.intercepts.push(intercepts[index]);
    }

    return this;
  };

  unregister = (...intercepts: NetIntercept[]) => {
    if (intercepts.length === 0 || this.intercepts.length === 0) {
      return this;
    }

    if (intercepts.length === 1) {
      const interceptToRemove = intercepts[0];
      const currentIntercepts = this.intercepts;
      let removed = false;
      let writeIndex = 0;
      for (let readIndex = 0; readIndex < currentIntercepts.length; readIndex++) {
        const intercept = currentIntercepts[readIndex];
        if (!removed && intercept === interceptToRemove) {
          removed = true;
          continue;
        }
        currentIntercepts[writeIndex] = intercept;
        writeIndex++;
      }
      currentIntercepts.length = writeIndex;

      return this;
    }
    if (intercepts.length === 2) {
      const firstIntercept = intercepts[0];
      const secondIntercept = intercepts[1];
      const currentIntercepts = this.intercepts;
      if (firstIntercept === secondIntercept) {
        let removalsLeft = 2;
        let writeIndex = 0;
        for (let readIndex = 0; readIndex < currentIntercepts.length; readIndex++) {
          const intercept = currentIntercepts[readIndex];
          if (removalsLeft > 0 && intercept === firstIntercept) {
            removalsLeft--;
            continue;
          }
          currentIntercepts[writeIndex] = intercept;
          writeIndex++;
        }
        currentIntercepts.length = writeIndex;
        return this;
      }

      let removeFirst = true;
      let removeSecond = true;
      let writeIndex = 0;
      for (let readIndex = 0; readIndex < currentIntercepts.length; readIndex++) {
        const intercept = currentIntercepts[readIndex];
        if (removeFirst && intercept === firstIntercept) {
          removeFirst = false;
          continue;
        }
        if (removeSecond && intercept === secondIntercept) {
          removeSecond = false;
          continue;
        }
        currentIntercepts[writeIndex] = intercept;
        writeIndex++;
      }
      currentIntercepts.length = writeIndex;
      return this;
    }

    const currentIntercepts = this.intercepts;
    if (intercepts.length <= 4) {
      const removalTargets: NetIntercept[] = [];
      const removalCounts: number[] = [];
      for (
        let interceptIndex = 0;
        interceptIndex < intercepts.length;
        interceptIndex++
      ) {
        const intercept = intercepts[interceptIndex];
        let targetIndex = -1;
        for (let index = 0; index < removalTargets.length; index++) {
          if (removalTargets[index] === intercept) {
            targetIndex = index;
            break;
          }
        }
        if (targetIndex === -1) {
          removalTargets.push(intercept);
          removalCounts.push(1);
        } else {
          removalCounts[targetIndex]++;
        }
      }

      let writeIndex = 0;
      for (
        let readIndex = 0;
        readIndex < currentIntercepts.length;
        readIndex++
      ) {
        const intercept = currentIntercepts[readIndex];
        let removed = false;
        for (let targetIndex = 0; targetIndex < removalTargets.length; targetIndex++) {
          if (
            removalCounts[targetIndex] > 0 &&
            removalTargets[targetIndex] === intercept
          ) {
            removalCounts[targetIndex]--;
            removed = true;
            break;
          }
        }
        if (!removed) {
          currentIntercepts[writeIndex] = intercept;
          writeIndex++;
        }
      }
      currentIntercepts.length = writeIndex;
      return this;
    }

    const removalCounts = new Map<NetIntercept, number>();
    for (
      let interceptIndex = 0;
      interceptIndex < intercepts.length;
      interceptIndex++
    ) {
      const intercept = intercepts[interceptIndex];
      removalCounts.set(intercept, (removalCounts.get(intercept) ?? 0) + 1);
    }

    let writeIndex = 0;
    for (let readIndex = 0; readIndex < currentIntercepts.length; readIndex++) {
      const intercept = currentIntercepts[readIndex];
      const remainingRemovals = removalCounts.get(intercept);
      if (remainingRemovals !== undefined && remainingRemovals > 0) {
        if (remainingRemovals === 1) {
          removalCounts.delete(intercept);
        } else {
          removalCounts.set(intercept, remainingRemovals - 1);
        }
        continue;
      }
      currentIntercepts[writeIndex] = intercept;
      writeIndex++;
    }
    currentIntercepts.length = writeIndex;

    return this;
  };

  disconnect = () => {
    if (!this.connected) {
      return;
    }

    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.close();
    }

    if (this.rtc) {
      this.rtc.close();
      this.rtc = null;
    }

    this.connected = false;
    this.onDisconnect?.();

    if (this.reconnection) {
      clearTimeout(this.reconnection);
    }
  };

  send = (event: MessageProtocol) => {
    this.ws.sendEvent(event);
  };

  setID = (id: string) => {
    this.clientInfo.id = id || "";
  };

  setUsername = (username: string) => {
    this.clientInfo.username = username || " ";
  };

  setMetadata = (metadata: ClientMetadata) => {
    this.clientInfo.metadata = metadata || {};
  };

  get concurrentWorkers() {
    return this.pool.workingCount;
  }

  get packetQueueLength() {
    return this.queuedPacketCount();
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

    for (let index = 0; index < this.intercepts.length; index++) {
      this.intercepts[index].onMessage?.(message, this.clientInfo);
    }

    if (type === "INIT") {
      if (!this.joinResolve) {
        throw new Error("Something went wrong with joining worlds...");
      }

      this.waitingForInit = false;
      this.joinResolve(this);
      this.onJoin?.(this.world);

      if (this.useWebRTC && !this.rtc) {
        this.connectWebRTC().catch((e) => {
          console.warn("[NETWORK] WebRTC connection failed after INIT:", e);
        });
      }
    }
  };

  private static encodeSync(message: Record<string, JsonValue | object>) {
    const messageJson = message.json;
    if (messageJson && typeof messageJson !== "string") {
      message.json = JSON.stringify(messageJson);
    }
    message.type = Message.Type[message.type as string];
    const entities = message.entities as Array<{
      metadata: string | JsonValue | null;
    }>;
    if (entities) {
      for (let index = 0; index < entities.length; index++) {
        const entity = entities[index];
        if (typeof entity.metadata !== "string") {
          entity.metadata = JSON.stringify(entity.metadata);
        }
      }
    }
    const peers = message.peers as Array<{
      metadata: string | JsonValue | null;
    }>;
    if (peers) {
      for (let index = 0; index < peers.length; index++) {
        const peer = peers[index];
        if (typeof peer.metadata !== "string") {
          peer.metadata = JSON.stringify(peer.metadata);
        }
      }
    }
    return protocol.Message.encode(protocol.Message.create(message)).finish();
  }

  private decodePriority = (buffer: ArrayBuffer) => {
    const handler = (e: MessageEvent<MessageProtocol[]>) => {
      this.priorityWorker.removeEventListener("message", handler);

      const messages = e.data;
      if (!messages || messages.length === 0) {
        this.packetQueue.push(buffer);
        return;
      }
      const decoded = messages[0];

      if (decoded.type === "INIT" && this.waitingForInit) {
        this.onMessage(decoded);
      } else {
        this.packetQueue.push(buffer);
      }
    };

    this.priorityWorker.addEventListener("message", handler);
    this.priorityDecodeBatch[0] = buffer;
    this.priorityWorker.postMessage(this.priorityDecodeBatch);
  };

  private decode = (data: ArrayBuffer[]): Promise<MessageProtocol[]> => {
    return new Promise<MessageProtocol[]>((resolve, reject) => {
      this.pool.addJob({
        message: data,
        buffers: data,
        resolve,
        reject,
      });
    });
  };
}
