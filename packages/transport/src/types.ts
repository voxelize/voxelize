export type GeometryProtocol = {
  voxel: number;
  at?: [number, number, number];
  faceName?: string;
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  lights: Uint32Array;
};

export type MeshProtocol = {
  level: number;
  geometries: GeometryProtocol[];
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

export type EntityOperation = "CREATE" | "UPDATE" | "DELETE";

export type EntityProtocol<T> = {
  operation: EntityOperation;
  id: string;
  type: string;
  metadata: T;
};

export type EventProtocol<T> = {
  name: string;
  payload: T;
};

export type MethodProtocol<T> = {
  name: string;
  payload: T;
};

export type UpdateProtocol = {
  vx: number;
  vy: number;
  vz: number;
  voxel?: number;
  light?: number;
};

export type ChatProtocol = {
  type: string;
  sender?: string;
  body: string;
};

export type MessageProtocol<
  T = any,
  Peer = any,
  Entity = any,
  Event = any,
  Method = any
> = {
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
    | "EVENT"
    | "ACTION"
    | "STATS";
  json?: T;
  text?: string;

  chat?: ChatProtocol;
  method?: MethodProtocol<Method>;

  peers?: PeerProtocol<Peer>[];
  entities?: EntityProtocol<Entity>[];
  chunks?: ChunkProtocol[];
  events?: EventProtocol<Event>[];
  updates?: UpdateProtocol[];
};
