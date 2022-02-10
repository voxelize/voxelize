import WebSocket from "ws";

export type ClientType = WebSocket & {
  id: string;
  name: string;
  isAlive: boolean;
};

export type ClientFilter = {
  roomId?: string;
  exclude?: string[];
  include?: string[];
};

export const defaultFilter: ClientFilter = {
  roomId: "",
  exclude: [],
  include: [],
};
