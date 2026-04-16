export type Vec3 = { x: number; y: number; z: number };

export type ChunkCoord = { cx: number; cz: number };

export type YawPitch = { yaw: number; pitch: number };

export type ChunkState = "loaded" | "pending" | "unloaded";

export type BlockInfo = {
  id: number;
  name: string;
  isEmpty: boolean;
  isFluid: boolean;
  isPassable: boolean;
};

export type EntitySnapshot = {
  id: string;
  kind: string;
  position: Vec3;
  metadata: Record<string, unknown>;
  distance: number;
};

export type PeerSnapshot = {
  id: string;
  username: string;
  position: Vec3;
  direction: Vec3;
  yaw: number;
  pitch: number;
  bodyYaw: number;
  distance: number;
  isSelf: boolean;
  isSpectator: boolean;
};

export type RaycastHit = {
  block: BlockInfo | null;
  entity: EntitySnapshot | null;
  position: Vec3;
  distance: number;
};

export type ChunkSnapshot = {
  coord: ChunkCoord;
  state: ChunkState;
};

export type Snapshot = {
  position: Vec3;
  facing: YawPitch;
  world: string;
  isReady: boolean;
  raycast: RaycastHit | null;
  nearbyEntities: EntitySnapshot[];
  chunks: {
    loaded: number;
    pending: number;
  };
};

export type ChatMsgIn = {
  type: string;
  sender: string;
  body: string;
  receivedAt: number;
};

export type CommandResult = {
  ok: boolean;
  message?: string;
};

export type FaceInput =
  | { target: Vec3 }
  | { yaw: number; pitch: number }
  | { direction: Vec3 };

export type WalkDirection = "forward" | "back" | "left" | "right";

export type WalkOptions = {
  durationMs?: number;
  isSprinting?: boolean;
};

export type WalkToOptions = {
  tolerance?: number;
  timeoutMs?: number;
  isSprinting?: boolean;
};

export type ViewOptions = {
  from?: Vec3;
  face?: FaceInput;
  isEnsuringChunks?: boolean;
};

export type AgentEventMap = {
  chat: ChatMsgIn;
  "chunk-loaded": ChunkCoord;
  "chunk-unloaded": ChunkCoord;
  "entity-spawned": EntitySnapshot;
  "entity-despawned": { id: string };
  "test-result": {
    name: string;
    status: "pass" | "fail";
    elapsedMs: number;
    error?: string;
  };
  "test-start": {
    name: string;
    arenaIndex: number;
    origin: Vec3;
  };
  tick: { time: number };
};

export type AgentEventName = keyof AgentEventMap;

export type Unsubscribe = () => void;

export interface ChunkBridge {
  state(target: Vec3 | ChunkCoord): ChunkState;
  waitFor(pos: Vec3, radius?: number, timeoutMs?: number): Promise<void>;
  loaded(): ChunkCoord[];
  pending(): ChunkCoord[];
  list(): ChunkSnapshot[];
}

export interface AgentBridge {
  readonly ready: Promise<void>;

  chat(text: string): Promise<CommandResult>;
  teleport(pos: Vec3, opts?: { isEnsuringChunks?: boolean }): Promise<void>;
  face(input: FaceInput): Promise<void>;
  walk(direction: WalkDirection, opts?: WalkOptions): Promise<void>;
  walkTo(target: Vec3, opts?: WalkToOptions): Promise<void>;
  view(opts: ViewOptions): Promise<void>;
  setFlying(isFlying: boolean): Promise<void>;
  call(method: string, payload: unknown): Promise<unknown>;

  position(): Vec3;
  facing(): YawPitch;
  raycast(): RaycastHit | null;
  blockAt(pos: Vec3): BlockInfo | null;
  entitiesNear(radius: number): EntitySnapshot[];
  peers(): PeerSnapshot[];
  chunks: ChunkBridge;
  snapshot(): Snapshot;

  on<E extends AgentEventName>(
    event: E,
    cb: (data: AgentEventMap[E]) => void,
  ): Unsubscribe;
}

declare global {
  interface Window {
    __agent__?: AgentBridge;
  }
}
