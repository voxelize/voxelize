import WebSocket from "ws";

export type ClientType = WebSocket & {
  id: string;
  name: string;
  isAlive: boolean;
};
