export type GeometryData = {
  blockId: number;
  faceName?: string;
  positions: number[];
  uvs: number[];
  indices: number[];
  lights: number[];
};

export type MeshData = {
  level: number;
  geometries: GeometryData[];
};

export type ChunkData<T> = {
  x: number;
  z: number;
  id: string;
  meshes: MeshData[];
  blocks: Uint32Array;
  lights: Uint32Array;
  metainfo: T;
};

export type EntityData<T> = {
  operation: "CREATE" | "UPDATE" | "DELETE";
  id: string;
  type: string;
  metainfo: T;
};

export type EventData<T> = {
  name: string;
  payload: T;
};

export type MethodData<T> = {
  name: string;
  payload: T;
};

export type ActionData<T> = {
  name: string;
  payload: T;
};

export type Packet<
  T extends {
    chunk?: unknown;
    entity?: unknown;
    event?: unknown;
    method?: unknown;
    action?: unknown;
    json?: unknown;
  } = Record<string, unknown>,
> = {
  type:
    | "INIT"
    | "JOIN"
    | "LEAVE"
    | "ERROR"
    | "ENTITY"
    | "CHUNK"
    | "UNCHUNK"
    | "METHOD"
    | "EVENT"
    | "ACTION"
    | "STATS";
  json?: T["json"];
  text?: string;

  method?: MethodData<T["method"]>;
  action?: ActionData<T["action"]>;

  entities?: EntityData<T["entity"]>[];
  chunks?: ChunkData<T["chunk"]>[];
  events?: EventData<T["event"]>[];
};

export type Message = {
  packets: Packet[];
};
