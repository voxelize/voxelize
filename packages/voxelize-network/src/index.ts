import {
  Decoder,
  Message,
  Packet,
  encodeMessagesSync,
  encodePacketsSync,
} from "@voxelize/protocol";
import DomUrl from "domurl";
import { NetIntercept } from "./intercept";

export * from "./intercept";

export type ProtocolWS = WebSocket & {
  sendPackets: (packets: Packet[]) => void;
  sendMessages: (messages: Message[]) => void;
};

type NetworkOptions = {
  serverUrl: string;
  maxMessagesPerIteration?: number;
  reconnectTimeout?: number;
};

const defaultOptions: NetworkOptions = {
  serverUrl: "http://localhost:8080/ws/",
  maxMessagesPerIteration: 100,
  reconnectTimeout: 1000,
};

export class Network {
  public options: NetworkOptions;

  public decoder = new Decoder();

  public connected = false;

  public httpUrl: DomUrl<{ [key: string]: any }>;
  public wsUrl: DomUrl<{ [key: string]: any }>;

  public ws: ProtocolWS | null = null;

  public onConnect: (() => void) | null = null;
  public onDisconnect: (() => void) | null = null;
  public onMessages: ((messages: Message[]) => void) | null = null;

  public intercepts: NetIntercept[] = [];

  private reconnection: any = null;
  private decodeProcess: any = null;

  private messagesToDecode: Uint8Array[] = [];

  constructor(options: Partial<NetworkOptions> = {}) {
    const { serverUrl } = (this.options = {
      ...defaultOptions,
      ...options,
    });

    this.httpUrl = new DomUrl(serverUrl);
    this.httpUrl.protocol = this.httpUrl.protocol.replace(/ws/, "http");
    this.httpUrl.hash = "";

    this.wsUrl = new DomUrl(serverUrl);
    this.wsUrl.protocol = this.wsUrl.protocol.replace(/http/, "ws");
    this.wsUrl.hash = "";
  }

  public async connect() {
    const { serverUrl, reconnectTimeout } = this.options;

    if (!serverUrl) {
      throw new Error("No server URL provided.");
    }

    if (typeof serverUrl !== "string") {
      throw new Error("Server URL must be a string.");
    }

    // Clear any existing reconnection attempts.
    this.disconnect();

    return new Promise<Network>((resolve) => {
      // initialize a websocket connection to socket
      const ws = new WebSocket(this.wsUrl.toString()) as ProtocolWS;
      ws.binaryType = "arraybuffer";
      // custom Protobuf event sending
      ws.sendPackets = (packets) => {
        ws.send(encodePacketsSync(packets));
      };
      ws.sendMessages = (messages) => {
        const encoded = encodeMessagesSync(messages);

        encoded.map((message) => {
          ws.send(message);
        });
      };
      ws.onopen = () => {
        this.connected = true;
        this.onConnect?.();

        clearTimeout(this.reconnection);

        resolve(this);
      };
      ws.onerror = console.error;
      ws.onmessage = ({ data }) => {
        this.messagesToDecode.push(new Uint8Array(data as ArrayBuffer));

        if (!this.decodeProcess) {
          requestAnimationFrame(() => {
            this.decodeMessages();
          });
        }
      };
      ws.onclose = () => {
        this.connected = false;
        this.onDisconnect?.();

        // fire reconnection every "reconnectTimeout" ms
        if (reconnectTimeout) {
          this.reconnection = setTimeout(() => {
            this.connect();
          }, reconnectTimeout);
        }
      };

      this.ws = ws;
    });
  }

  public sendPackets(packets: Packet[]) {
    if (!this.connected) {
      throw new Error("Cannot send packets while disconnected.");
    }

    this.ws?.sendPackets(packets);
  }

  public sendMessages(messages: Message[]) {
    if (!this.connected) {
      throw new Error("Cannot send messages while disconnected.");
    }

    this.ws?.sendMessages(messages);
  }

  public flush() {
    this.intercepts.forEach((intercept) => {
      if (intercept.messages && intercept.messages.length) {
        const messages = intercept.messages.splice(
          0,
          intercept.messages.length,
        );

        this.sendMessages(messages);
      }
    });
  }

  public register(...intercepts: NetIntercept[]) {
    intercepts.forEach((intercept) => {
      this.intercepts.push(intercept);
    });

    return this;
  }

  public unregister(...intercepts: NetIntercept[]) {
    intercepts.forEach((intercept) => {
      const index = this.intercepts.indexOf(intercept);

      if (index !== -1) {
        this.intercepts.splice(index, 1);
      }
    });

    return this;
  }

  public disconnect() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }

    if (this.reconnection) {
      clearTimeout(this.reconnection);
      this.reconnection = null;
    }
  }

  // Use requestAnimationFrame to process messages in batches.
  private async decodeMessages() {
    if (this.messagesToDecode.length === 0) {
      cancelAnimationFrame(this.decodeProcess);
      this.decodeProcess = null;
      return;
    }

    const { maxMessagesPerIteration } = this.options;

    const messagesToDecode = this.messagesToDecode.splice(
      0,
      maxMessagesPerIteration,
    );

    const results = await this.decoder.decode(messagesToDecode);
    this.onMessages?.(results);

    this.intercepts.forEach((intercept) => {
      intercept.onMessages?.(results);
    });

    if (this.messagesToDecode.length > 0) {
      this.decodeProcess = requestAnimationFrame(() => {
        this.decodeMessages();
      });
    }
  }
}
