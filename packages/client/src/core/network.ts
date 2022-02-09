import { protocol } from "@voxelize/common";
import URL from "domurl";
import Pako from "pako";

const { Message } = protocol;

type CustomWebSocket = WebSocket & {
  sendEvent: (event: any) => void;
};

type NetworkOptions = {
  serverURL: string;
  reconnectTimeout: number;
};

class Network {
  public ws: CustomWebSocket;

  public url: URL<string>;
  public socket: URL<string>;
  public connected = false;

  private reconnection: any;

  constructor(public options: NetworkOptions) {
    this.url = new URL(this.options.serverURL);

    this.socket = new URL(this.options.serverURL);
    this.socket.protocol = this.socket.protocol.replace(/http/, "ws");
    this.socket.hash = "";
  }

  connect = () => {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.close();
      if (this.reconnection) {
        clearTimeout(this.reconnection);
      }
    }

    const ws = new WebSocket(this.socket.toString()) as CustomWebSocket;
    ws.binaryType = "arraybuffer";
    ws.sendEvent = (event: any) => {
      ws.send(Network.encode(event));
    };
    ws.onopen = () => {
      this.connected = true;

      console.log("Websocket connected.");

      clearTimeout(this.reconnection);
    };
    ws.onerror = console.error;
    ws.onmessage = this.onMessage;
    ws.onclose = () => {
      this.connected = false;
      this.reconnection = setTimeout(() => {
        this.connect();
      }, this.options.reconnectTimeout);
    };

    this.ws = ws;
  };

  private onEvent = (event: any) => {
    console.log(event);

    const { type } = event;

    switch (type) {
      case "INIT": {
        break;
      }
    }
  };

  private onMessage = ({ data }: MessageEvent) => {
    let event: any;
    try {
      event = Network.decode(new Uint8Array(data));
    } catch (e) {
      return;
    }
    this.onEvent(event);
  };

  private static decode = (buffer: any) => {
    if (buffer[0] === 0x78 && buffer[1] === 0x9c) {
      buffer = Pako.inflate(buffer);
    }
    const message = Message.decode(buffer);
    // @ts-ignore
    message.type = Message.Type[message.type];
    if (message.json) {
      message.json = JSON.parse(message.json);
    }
    return message;
  };

  private static encode(message: any) {
    if (message.json) {
      message.json = JSON.stringify(message.json);
    }
    message.type = Message.Type[message.type];
    return protocol.Message.encode(protocol.Message.create(message)).finish();
  }
}

export type { NetworkOptions };

export { Network };
