import URL from "domurl";

type CustomWebSocket = WebSocket & {
  sendEvent: (event: any) => void;
  serverURL: string;
};

type ClientOptions = {
  serverURL: string;
};

class Client {
  url: URL<any>;
  server: CustomWebSocket;

  private reconnection: any;

  constructor(public options: ClientOptions) {}

  connect = () => {
    const { serverURL } = this.options;

    this.url = new URL(serverURL);

    if (this.server) {
      this.server.onclose = null;
      this.server.onmessage = null;
      this.server.close();
      if (this.reconnection) {
        clearTimeout(this.reconnection);
      }
    }

    const socket = new URL(serverURL);
    socket.protocol =
      !socket.protocol || socket.protocol === "http" ? "ws" : "wss";
    socket.hash = "";

    this.server = new WebSocket(socket.toString()) as CustomWebSocket;
    this.server.binaryType = "arraybuffer";
  };
}

export { Client };
