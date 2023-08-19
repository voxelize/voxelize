import DomUrl from "domurl";

export type ProtocolWS = WebSocket & {
  sendEvent: (event: any) => void;
};

type NetworkOptions = {
  serverUrl: string;
  reconnectTimeout?: number;
};

const defaultOptions: NetworkOptions = {
  serverUrl: "http://localhost:8080/ws/",
  reconnectTimeout: 1000,
};

export class Network {
  public options: NetworkOptions;

  public connected = false;

  public httpUrl: DomUrl<{ [key: string]: any }>;
  public wsUrl: DomUrl<{ [key: string]: any }>;

  public ws: ProtocolWS | null = null;

  public onConnect: (() => void) | null = null;
  public onDisconnect: (() => void) | null = null;

  private reconnection: any = null;

  private packetQueue: Uint8Array[] = [];

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
      ws.sendEvent = (event: any) => {
        // ws.send(Network.encodeSync(event));
      };
      ws.onopen = () => {
        this.connected = true;
        this.onConnect?.();

        clearTimeout(this.reconnection);

        resolve(this);
      };
      ws.onerror = console.error;
      ws.onmessage = ({ data }) => {
        this.packetQueue.push(new Uint8Array(data as ArrayBuffer));
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
}
