/**
 * Wire protocol version. Must match the server's `PROTOCOL_VERSION` constant
 * (Rust). The client sends this on JOIN; a deterministic (fixed-step) world
 * asserts strict equality and refuses a mismatch. Client + server deploy in
 * lockstep on every bump.
 */
export const PROTOCOL_VERSION = 1;

/**
 * Application WebSocket close code sent when the server refuses a client for a
 * protocol-version mismatch. The client treats it as terminal
 * (`client_outdated`): it never retries and never burns reconnect grace.
 */
export const PROTOCOL_MISMATCH_CLOSE_CODE = 4001;

export type GeometryProtocol = {
  voxel: number;
  at?: [number, number, number];
  faceName?: string;
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  lights: Uint32Array;
  normals?: Float32Array;
  bsCenter?: [number, number, number];
  bsRadius?: number;
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

export type EntityOperation = "CREATE" | "UPDATE" | "DELETE" | "OUT_OF_RANGE";

/**
 * The decoded compact motion payload of an entity UPDATE (the versioned
 * `motion.v1` wire format negotiated through the JOIN capabilities). Servers
 * send it in place of JSON motion metadata to clients that advertised
 * support; the client merges it back into the entity's metadata so consumer
 * code keeps reading `metadata.position` / `metadata.direction` /
 * `metadata.rigidBody` / `metadata.target.position` unchanged.
 */
export type EntityMotionProtocol = {
  position: [number, number, number];
  direction?: [number, number, number];
  rigidBody?: { isInFluid: boolean; fluidRatio: number };
  targetPosition?: [number, number, number];
};

export type EntityProtocol<T> = {
  operation: EntityOperation;
  id: string;
  type: string;
  metadata: T;
  motion?: EntityMotionProtocol;
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
    | "STATS";
  json?: T;
  text?: string;

  /**
   * Server tick at which this message's payload was captured. Stamped on
   * high-frequency state messages (ENTITY, PEER) so receivers can drop
   * out-of-order state on unordered transports (WebRTC).
   */
  tick?: number;

  chat?: ChatProtocol;
  method?: MethodProtocol<Method>;

  peers?: PeerProtocol<Peer>[];
  entities?: EntityProtocol<Entity>[];
  chunks?: ChunkProtocol[];
  events?: EventProtocol<Event>[];
  updates?: UpdateProtocol[];
  bulkUpdate?: BulkUpdateProtocol;
  perfByteSize?: number;
  perfTraceId?: string;
};
