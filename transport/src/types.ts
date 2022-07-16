export type GeometryProtocol = {
  positions: number[];
  uvs: number[];
  indices: number[];
  lights: number[];
};

export type MeshProtocol = {
  level: number;
  opaque: GeometryProtocol;
  transparent: GeometryProtocol;
};

export type ChunkProtocol = {
  x: number;
  z: number;
  id: string;
  meshes: MeshProtocol[];
  voxels: Uint32Array;
  lights: Uint32Array;
};

export type PeerProtocol<T> = {
  id: string;
  username: string;
  metadata: T;
};

export type EntityProtocol<T> = {
  id: string;
  type: string;
  metadata: T;
};

export type EventProtocol<T> = {
  name: string;
  payload: T;
};

export type UpdateProtocol = {
  vx: number;
  vy: number;
  vz: number;
  voxel: number;
  light: number;
};

export type ChatProtocol = {
  type: string;
  sender: string;
  body: string;
};

export type MessageProtocol<T = any, Peer = any, Entity = any, Event = any> = {
  type:
    | "INIT"
    | "JOIN"
    | "LEAVE"
    | "ERROR"
    | "PEER"
    | "ENTITY"
    | "LOAD"
    | "UNLOAD"
    | "UPDATE"
    | "METHOD"
    | "CHAT"
    | "TRANSPORT"
    | "EVENT";
  json: T;
  text: string;

  chat: ChatProtocol;

  peers: PeerProtocol<Peer>[];
  entities: EntityProtocol<Entity>[];
  chunks: ChunkProtocol[];
  events: EventProtocol<Event>[];
  updates: UpdateProtocol[];
};
