export type GeometryProtocol = {
  voxel: number;
  faceName?: string;
  positions: number[];
  uvs: number[];
  indices: number[];
  lights: number[];
};

export type MeshProtocol = {
  level: number;
  geometries: GeometryProtocol[];
  connectivity?: number;
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
  operation: "CREATE" | "UPDATE" | "DELETE";
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

export type BulkUpdateProtocol = {
  vx: number[];
  vy: number[];
  vz: number[];
  voxels: number[];
  lights: number[];
};

export type ChatProtocol = {
  type: string;
  sender?: string;
  body: string;
  metadata?: string;
  traceId?: string;
  tSendMs?: number;
};

/** One encoded packet of a player's voice (see `@voxelize/protocol`). */
export type VoiceProtocol = {
  sender?: string;
  seq: number;
  data: Uint8Array;
  end?: boolean;
};

export type MessageProtocol<
  T = any,
  Peer = any,
  Entity = any,
  Event = any,
  Method = any,
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
    | "STATS"
    | "VOICE";
  json?: T;
  text?: string;

  chat?: ChatProtocol;
  method?: MethodProtocol<Method>;

  peers?: PeerProtocol<Peer>[];
  entities?: EntityProtocol<Entity>[];
  chunks?: ChunkProtocol[];
  events?: EventProtocol<Event>[];
  updates?: UpdateProtocol[];
  bulkUpdate?: BulkUpdateProtocol;
  voices?: VoiceProtocol[];
};
