import { BlockRotation } from "../block";

import { LightSourceRegistry } from "./registry";
import { BlockLightProfile, LightHandle, LocalLightDescriptor } from "./types";

/**
 * The slice of a block face the anchor derivation needs: authored corner
 * geometry plus the server-declared emissive strength.
 */
export interface EmitterBlockFace {
  corners: { pos: [number, number, number] }[];
  emissive?: number;
}

/**
 * The slice of a client block definition the scanner needs. Structural on
 * purpose: tests feed it plain objects, the world feeds it its registry.
 */
export interface EmitterBlock {
  id: number;
  isLight: boolean;
  redLightLevel: number;
  greenLightLevel: number;
  blueLightLevel: number;
  /**
   * Authored face geometry. When present and the block declares emissive
   * faces, the default emitter anchor is derived from the hot faces instead
   * of the voxel center — a torch emits from its flame, not its stick.
   */
  faces?: EmitterBlockFace[];
}

interface ResolvedProfile {
  /** Prebuilt and shared by every emitter of this block; `add()` copies. */
  descriptor: LocalLightDescriptor;
  offset: [number, number, number];
  isAggregated: boolean;
  aggregateThreshold: number;
  maxProxiesPerSection: number;
}

/**
 * Per-block-id lookup the scan hot loop runs against: a byte LUT for the
 * "is this an emitter" test and a resolved profile for everything after.
 * Rebuilt only when the block registry or a declared profile changes.
 */
export class BlockProfileTable {
  readonly isLightById: Uint8Array;
  private readonly profiles: (ResolvedProfile | undefined)[];

  constructor(
    blocks: Iterable<EmitterBlock>,
    declared: Map<number, BlockLightProfile>,
    maxLightLevel: number,
  ) {
    let maxId = 0;
    const list: EmitterBlock[] = [];
    for (const block of blocks) {
      list.push(block);
      if (block.id > maxId) maxId = block.id;
    }

    this.isLightById = new Uint8Array(maxId + 1);
    this.profiles = new Array(maxId + 1);

    for (const block of list) {
      if (!block.isLight) continue;
      this.isLightById[block.id] = 1;
      this.profiles[block.id] = resolveProfile(
        block,
        declared.get(block.id),
        maxLightLevel,
      );
    }
  }

  profileFor(id: number): ResolvedProfile | undefined {
    return this.profiles[id];
  }
}

const clampAnchor = (v: number) => Math.min(Math.max(v, 0.02), 0.98);

/**
 * Where inside its voxel a block emits from, when the game declares no
 * explicit offset: the emissive-strength-weighted centroid of its authored
 * hot faces. A torch whose stick is plain wood and whose tip face carries
 * `face_emissive` anchors its light — analytic falloff, shadow projection,
 * mount tests, and source bounds alike — at the tip, not the block center.
 * Falls back to the voxel center when nothing is declared emissive.
 */
export function deriveEmissiveAnchor(
  faces: EmitterBlockFace[] | undefined,
): [number, number, number] | null {
  if (!faces || faces.length === 0) return null;
  let weight = 0;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const face of faces) {
    const strength = face.emissive ?? 0;
    if (strength <= 0 || face.corners.length === 0) continue;
    let fx = 0;
    let fy = 0;
    let fz = 0;
    for (const corner of face.corners) {
      fx += corner.pos[0];
      fy += corner.pos[1];
      fz += corner.pos[2];
    }
    const inv = strength / face.corners.length;
    sx += fx * inv;
    sy += fy * inv;
    sz += fz * inv;
    weight += strength;
  }
  if (weight <= 0) return null;
  // The clamp keeps the anchor strictly inside the voxel so mount tests and
  // cell binning attribute it to the emitter block, not a neighbor.
  return [
    clampAnchor(sx / weight),
    clampAnchor(sy / weight),
    clampAnchor(sz / weight),
  ];
}

function resolveProfile(
  block: EmitterBlock,
  declared: BlockLightProfile | undefined,
  maxLightLevel: number,
): ResolvedProfile {
  const r = block.redLightLevel;
  const g = block.greenLightLevel;
  const b = block.blueLightLevel;
  const maxLevel = Math.max(r, g, b, 1);

  const descriptor: LocalLightDescriptor = {
    shape: declared?.shape ?? "point",
    color:
      declared?.color ??
      (declared?.colorTemperatureK !== undefined
        ? undefined
        : [r / maxLevel, g / maxLevel, b / maxLevel]),
    colorTemperatureK: declared?.colorTemperatureK,
    intensity: declared?.intensity ?? maxLevel / maxLightLevel,
    range: declared?.range ?? maxLevel,
    isStatic: true,
    shadowPolicy: declared?.shadowPolicy ?? "voxelMask",
    direction: declared?.direction,
    angleDeg: declared?.angleDeg,
    innerRatio: declared?.innerRatio,
    endOffset: declared?.endOffset,
    analyticShare: declared?.analyticShare,
    flicker: declared?.flicker,
    priorityBias: declared?.priorityBias,
  };

  return {
    descriptor,
    offset: declared?.offset ??
      deriveEmissiveAnchor(block.faces) ?? [0.5, 0.5, 0.5],
    isAggregated: (declared?.aggregation ?? "cluster") === "cluster",
    aggregateThreshold: declared?.aggregateThreshold ?? 8,
    maxProxiesPerSection: declared?.maxProxiesPerSection ?? 4,
  };
}

/**
 * Everything the tracker needs to read voxels out of a loaded chunk. Matches
 * the world's `RawChunk` without importing it, so tests can fake one.
 */
export interface ScannableChunk {
  min: [number, number, number];
  voxels: { data: Uint32Array | number[] };
}

type SectionRecord = {
  /** Local voxel key to the handle of its individually registered emitter. */
  singles: Map<number, LightHandle>;
  /**
   * Local voxel key to the signature it was registered for: block id in the
   * low 16 bits, rotation bits above — so rotating a torch in place rescans
   * exactly like swapping the block, moving its anchored light with it.
   */
  singleIds: Map<number, number>;
  proxies: LightHandle[];
};

// Arithmetic packing keeps local keys unique for any chunk/section shape.
const packLocalKey = (lx: number, ly: number, lz: number, chunkSize: number) =>
  (ly * chunkSize + lz) * chunkSize + lx;

/** Emitters per aggregation subcell axis (4-block subcells). */
const SUBCELL_SHIFT = 2;
/** Aggregated intensity saturates at this many members' worth of output. */
const PROXY_INTENSITY_CAP = 4;

/**
 * Owns the static (block-anchored) side of the light registry: which
 * emitters exist per chunk section, individually or aggregated into proxy
 * records for dense fields like lava. Rescans are whole-section and diff
 * against what is registered, so an untouched emitter keeps its handle —
 * and with it its selection hysteresis — across neighboring edits.
 */
export class SectionTracker {
  private readonly registry: LightSourceRegistry;
  private readonly chunkSize: number;
  private readonly maxHeight: number;
  private readonly sectionHeight: number;
  private readonly sections = new Map<string, SectionRecord>();

  /** Scratch for one section scan; sections are scanned one at a time. */
  private readonly scanKeys: number[] = [];
  private readonly scanIds: number[] = [];
  private readonly desiredSingles = new Map<number, number>();
  private readonly staleKeys: number[] = [];
  private readonly groupKeys = new Map<number, number[]>();
  private readonly scanSignatures = new Map<number, number>();
  private readonly rotatedOffset: [number, number, number] = [0, 0, 0];

  constructor(
    registry: LightSourceRegistry,
    chunkSize: number,
    maxHeight: number,
    subChunks: number,
  ) {
    this.registry = registry;
    this.chunkSize = chunkSize;
    this.maxHeight = maxHeight;
    this.sectionHeight = maxHeight / subChunks;
  }

  get trackedSectionCount(): number {
    return this.sections.size;
  }

  sectionKey(cx: number, cz: number, sectionY: number): string {
    return `${cx},${cz},${sectionY}`;
  }

  *trackedSections(): IterableIterator<string> {
    yield* this.sections.keys();
  }

  /**
   * Scan one section of a loaded chunk and reconcile the registry with what
   * is actually there. Safe to call for load, edit, and re-load alike.
   */
  rescanSection(
    key: string,
    chunk: ScannableChunk,
    sectionY: number,
    table: BlockProfileTable,
  ) {
    const { chunkSize, maxHeight, sectionHeight } = this;
    const voxels = chunk.voxels.data;
    const isLightById = table.isLightById;
    const yStart = sectionY * sectionHeight;

    const keys = this.scanKeys;
    const ids = this.scanIds;
    keys.length = 0;
    ids.length = 0;

    for (let lx = 0; lx < chunkSize; lx++) {
      const xBase = lx * maxHeight * chunkSize;
      for (let ly = 0; ly < sectionHeight; ly++) {
        const yBase = xBase + (yStart + ly) * chunkSize;
        for (let lz = 0; lz < chunkSize; lz++) {
          const raw = voxels[yBase + lz];
          const id = raw & 0xffff;
          if (id < isLightById.length && isLightById[id]) {
            keys.push(packLocalKey(lx, ly, lz, chunkSize));
            // Signature keeps the rotation bits (16–23 of the raw voxel):
            // a wall torch's anchor rotates with its stick.
            ids.push(raw & 0xffffff);
          }
        }
      }
    }

    let record = this.sections.get(key);
    if (keys.length === 0 && !record) return;
    if (!record) {
      record = {
        singles: new Map(),
        singleIds: new Map(),
        proxies: [],
      };
      this.sections.set(key, record);
    }

    // Split the scan into individually registered emitters and aggregated
    // groups. A block id aggregates only past its threshold, so a couple of
    // lava blocks still register individually.
    const desired = this.desiredSingles;
    const groups = this.groupKeys;
    desired.clear();
    groups.clear();

    for (let n = 0; n < ids.length; n++) {
      const signature = ids[n];
      const id = signature & 0xffff;
      const profile = table.profileFor(id);
      if (!profile) continue;
      if (profile.isAggregated) {
        let group = groups.get(id);
        if (!group) {
          group = [];
          groups.set(id, group);
        }
        group.push(keys[n]);
        this.scanSignatures.set(keys[n], signature);
      } else {
        desired.set(keys[n], signature);
      }
    }
    for (const [id, group] of groups) {
      const profile = table.profileFor(id);
      if (!profile) continue;
      if (group.length <= profile.aggregateThreshold) {
        for (const localKey of group) {
          desired.set(localKey, this.scanSignatures.get(localKey) ?? id);
        }
        groups.delete(id);
      }
    }
    this.scanSignatures.clear();

    // Diff singles: registered emitters that are gone (or changed block)
    // release their handles; new ones register. Unchanged ones keep their
    // handle untouched.
    const stale = this.staleKeys;
    stale.length = 0;
    for (const [localKey, registeredId] of record.singleIds) {
      if (desired.get(localKey) !== registeredId) stale.push(localKey);
    }
    for (const localKey of stale) {
      const handle = record.singles.get(localKey);
      if (handle !== undefined) this.registry.remove(handle);
      record.singles.delete(localKey);
      record.singleIds.delete(localKey);
    }
    const [minX, , minZ] = chunk.min;
    for (const [localKey, signature] of desired) {
      if (record.singleIds.has(localKey)) continue;
      const id = signature & 0xffff;
      const profile = table.profileFor(id);
      if (!profile) continue;
      const lx = localKey % chunkSize;
      const lz = Math.floor(localKey / chunkSize) % chunkSize;
      const ly = Math.floor(localKey / (chunkSize * chunkSize));

      // The anchor rides the block's rotation: a wall torch's emitting tip
      // (and with it shadow projection and mount tests) leans with the stick.
      let ox = profile.offset[0];
      let oy = profile.offset[1];
      let oz = profile.offset[2];
      const rotBits = (signature >>> 16) & 0xff;
      if (rotBits !== 0) {
        const rotated = this.rotatedOffset;
        rotated[0] = ox;
        rotated[1] = oy;
        rotated[2] = oz;
        BlockRotation.encode(rotBits & 0xf, (rotBits >> 4) & 0xf).rotateNode(
          rotated,
          true,
          true,
        );
        ox = Math.min(Math.max(rotated[0], 0.02), 0.98);
        oy = Math.min(Math.max(rotated[1], 0.02), 0.98);
        oz = Math.min(Math.max(rotated[2], 0.02), 0.98);
      }

      const handle = this.registry.add(
        profile.descriptor,
        minX + lx + ox,
        yStart + ly + oy,
        minZ + lz + oz,
      );
      record.singles.set(localKey, handle);
      record.singleIds.set(localKey, signature);
    }

    // Proxies rebuild wholesale: membership defines them, so any edit in an
    // aggregated field re-derives that field's few records. Deterministic by
    // construction (scan order, ascending subcells, fixed partition).
    for (const handle of record.proxies) this.registry.remove(handle);
    record.proxies.length = 0;
    for (const [id, group] of groups) {
      const profile = table.profileFor(id);
      if (!profile) continue;
      this.buildProxies(record.proxies, group, profile, minX, yStart, minZ);
    }

    if (
      record.singles.size === 0 &&
      record.proxies.length === 0 &&
      keys.length === 0
    ) {
      this.sections.delete(key);
    }
  }

  releaseSection(key: string) {
    const record = this.sections.get(key);
    if (!record) return;
    for (const handle of record.singles.values()) this.registry.remove(handle);
    for (const handle of record.proxies) this.registry.remove(handle);
    this.sections.delete(key);
  }

  releaseAll() {
    for (const key of [...this.sections.keys()]) {
      this.releaseSection(key);
    }
  }

  private buildProxies(
    out: LightHandle[],
    group: number[],
    profile: ResolvedProfile,
    minX: number,
    yStart: number,
    minZ: number,
  ) {
    // Bucket members into 4-block subcells, walk occupied subcells in
    // ascending order, and merge contiguous runs into at most
    // `maxProxiesPerSection` proxies.
    const chunkSize = this.chunkSize;
    const subcellsPerAxis = Math.ceil(chunkSize / (1 << SUBCELL_SHIFT));
    const bySubcell = new Map<number, number[]>();
    for (const localKey of group) {
      const lx = localKey % chunkSize;
      const lz = Math.floor(localKey / chunkSize) % chunkSize;
      const ly = Math.floor(localKey / (chunkSize * chunkSize));
      const subcell =
        ((ly >> SUBCELL_SHIFT) * subcellsPerAxis + (lz >> SUBCELL_SHIFT)) *
          subcellsPerAxis +
        (lx >> SUBCELL_SHIFT);
      let members = bySubcell.get(subcell);
      if (!members) {
        members = [];
        bySubcell.set(subcell, members);
      }
      members.push(localKey);
    }

    const occupied = [...bySubcell.keys()].sort((a, b) => a - b);
    const proxyCount = Math.min(profile.maxProxiesPerSection, occupied.length);
    const subcellsPerProxy = Math.ceil(occupied.length / proxyCount);
    const base = profile.descriptor;

    for (let p = 0; p < proxyCount; p++) {
      const start = p * subcellsPerProxy;
      const end = Math.min(start + subcellsPerProxy, occupied.length);
      if (start >= end) break;

      let sumX = 0;
      let sumY = 0;
      let sumZ = 0;
      let memberCount = 0;
      for (let s = start; s < end; s++) {
        for (const localKey of bySubcell.get(occupied[s])!) {
          sumX += minX + (localKey % chunkSize) + profile.offset[0];
          sumY +=
            yStart +
            Math.floor(localKey / (chunkSize * chunkSize)) +
            profile.offset[1];
          sumZ +=
            minZ +
            (Math.floor(localKey / chunkSize) % chunkSize) +
            profile.offset[2];
          memberCount++;
        }
      }
      const cx = sumX / memberCount;
      const cy = sumY / memberCount;
      const cz = sumZ / memberCount;

      let range = base.range;
      for (let s = start; s < end; s++) {
        for (const localKey of bySubcell.get(occupied[s])!) {
          const dx = minX + (localKey % chunkSize) + profile.offset[0] - cx;
          const dy =
            yStart +
            Math.floor(localKey / (chunkSize * chunkSize)) +
            profile.offset[1] -
            cy;
          const dz =
            minZ +
            (Math.floor(localKey / chunkSize) % chunkSize) +
            profile.offset[2] -
            cz;
          const reach = Math.sqrt(dx * dx + dy * dy + dz * dz) + base.range;
          if (reach > range) range = reach;
        }
      }

      const handle = this.registry.add(
        {
          ...base,
          intensity:
            base.intensity * Math.min(memberCount, PROXY_INTENSITY_CAP),
          range,
        },
        cx,
        cy,
        cz,
      );
      out.push(handle);
    }
  }
}
