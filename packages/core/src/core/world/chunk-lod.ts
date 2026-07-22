import { ChunkProtocol, GeometryProtocol } from "@voxelize/protocol";
import { BufferAttribute, BufferGeometry, Group, Material, Mesh } from "three";

import { Coords2 } from "../../types";
import { ChunkUtils } from "../../utils";

/**
 * Level-of-detail rendering of distant chunks.
 *
 * Worlds that enable `chunk_lod` server-side serve distant chunks as compact,
 * reduced-detail whole-column meshes (see `crates/mesher/src/lod.rs` for the
 * meshing and seam strategy). This module owns the client half:
 *
 * - mapping chunk distance to a LOD level in geometric rings — full detail up
 *   to the render radius `R`, level `L` for distances in
 *   `(R * 2^(L-1), R * 2^L]` — with a hysteresis band so chunks never thrash
 *   between levels at a ring boundary,
 * - requesting, tracking, and retiring LOD chunk meshes as the viewer moves,
 *   swapping forms only when the replacement is ready (no popping holes, and
 *   never two forms visible in the same frame),
 * - batching LOD chunk geometry into per-region merged meshes so thousands of
 *   distant chunks cost a handful of draw calls.
 */

/**
 * The LOD level a chunk at `distance` (in chunks) should display, ignoring
 * hysteresis: `0` for full detail, `1..maxLodLevel` for the LOD rings, and
 * `null` beyond the outermost ring.
 */
export function lodLevelForDistance(
  distance: number,
  renderRadius: number,
  maxLodLevel: number,
): number | null {
  if (distance <= renderRadius) {
    return 0;
  }

  for (let level = 1; level <= maxLodLevel; level++) {
    if (distance <= renderRadius * (1 << level)) {
      return level;
    }
  }

  return null;
}

/**
 * Resolve the level a chunk should target given what it currently displays,
 * applying a hysteresis band of `hysteresis` chunks on both sides of the
 * current level's ring: while `distance` stays inside the widened ring, the
 * chunk keeps its current level. Only when it leaves the band does the target
 * become {@link lodLevelForDistance}. `currentLevel` and the result use `0`
 * for full detail and `null` for "nothing displayed".
 */
export function resolveLodTarget(
  distance: number,
  currentLevel: number | null,
  renderRadius: number,
  maxLodLevel: number,
  hysteresis: number,
): number | null {
  if (currentLevel !== null && currentLevel <= maxLodLevel) {
    const innerRadius =
      currentLevel === 0 ? 0 : renderRadius * (1 << (currentLevel - 1));
    const outerRadius = renderRadius * (1 << currentLevel);

    if (
      distance > innerRadius - hysteresis &&
      distance <= outerRadius + hysteresis
    ) {
      return currentLevel;
    }
  }

  return lodLevelForDistance(distance, renderRadius, maxLodLevel);
}

/**
 * LOD regions batch `sideInChunks x sideInChunks` chunk meshes into merged
 * meshes. The side doubles with the level, so every ring settles at roughly
 * the same region count — and therefore the same draw call count — no matter
 * how far it is.
 */
export function lodRegionSideInChunks(level: number): number {
  return 1 << (level + 1);
}

export function lodRegionKey(cx: number, cz: number, level: number): string {
  const side = lodRegionSideInChunks(level);
  return `${level}|${Math.floor(cx / side)},${Math.floor(cz / side)}`;
}

/**
 * Everything the manager needs from the world, kept behind a narrow adapter
 * so the manager stays testable without a live scene or network.
 */
export type LodChunkManagerHost = {
  chunkSize: number;
  renderRadius: () => number;
  /** Resolve a geometry's material and its stable bucketing key. */
  resolveMaterial: (
    voxel: number,
    faceName?: string,
  ) => { key: string; material: Material } | null;
  /** Apply transparent render-order / sorting setup to a merged mesh. */
  configureTransparentMesh: (mesh: Mesh, voxel: number) => void;
  /** Send a LOAD packet with `[x, z, level]` LOD chunk requests. */
  requestLodChunks: (requests: [number, number, number][]) => void;
  /** Send an UNLOAD packet releasing server-side interest. */
  unloadChunks: (coords: Coords2[]) => void;
  isWithinWorld: (cx: number, cz: number) => boolean;
  /** Whether a loaded full-detail chunk currently exists for these coords. */
  isFullChunkActive: (cx: number, cz: number) => boolean;
  /** Dispose the full-detail form now that its LOD replacement displays. */
  disposeFullChunk: (cx: number, cz: number) => void;
  /** Show or hide the full-detail chunk group. */
  setFullChunkVisible: (cx: number, cz: number, isVisible: boolean) => void;
  /**
   * Re-request the full form of a loaded chunk so the server's interest
   * flips back from LOD after a discarded stale LOD arrival.
   */
  refreshFullChunk: (cx: number, cz: number) => void;
};

export type LodChunkManagerOptions = {
  maxLodLevel: number;
  hysteresis: number;
  maxRequestsPerUpdate: number;
  /** Updates between re-issuing an unanswered LOD request. */
  rerequestInterval: number;
  /** Hard clamp on the LOD horizon, in chunks. */
  maxLodRadius: number;
};

type LodGeometryBucket = {
  material: Material;
  voxel: number;
  geometries: { chunk: LodChunkState; geometry: GeometryProtocol }[];
};

type LodChunkState = {
  name: string;
  coords: Coords2;
  displayedLevel: number | null;
  geometries: GeometryProtocol[] | null;
  requestedLevel: number | null;
  requestedAt: number;
};

type LodRegion = {
  key: string;
  level: number;
  members: Set<LodChunkState>;
  group: Group;
  meshes: Mesh[];
  isDirty: boolean;
};

const SCAN_INTERVAL_UPDATES = 30;

function computeFlatNormalsInto(
  normals: Float32Array,
  positions: Float32Array,
  indices: Uint32Array,
): void {
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3;
    const ib = indices[i + 1] * 3;
    const ic = indices[i + 2] * 3;
    const e1x = positions[ib] - positions[ia];
    const e1y = positions[ib + 1] - positions[ia + 1];
    const e1z = positions[ib + 2] - positions[ia + 2];
    const e2x = positions[ic] - positions[ia];
    const e2y = positions[ic + 1] - positions[ia + 1];
    const e2z = positions[ic + 2] - positions[ia + 2];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (length > 0) {
      nx /= length;
      ny /= length;
      nz /= length;
    }
    normals[ia] = nx;
    normals[ia + 1] = ny;
    normals[ia + 2] = nz;
    normals[ib] = nx;
    normals[ib + 1] = ny;
    normals[ib + 2] = nz;
    normals[ic] = nx;
    normals[ic + 1] = ny;
    normals[ic + 2] = nz;
  }
}

/**
 * Owns the lifecycle of every LOD-form chunk: requesting by distance ring,
 * receiving meshes, batching them into region meshes, and swapping against
 * the full-detail pipeline without ever leaving a hole or showing two forms
 * of the same chunk in one frame. All scene mutations happen inside
 * {@link update} so each frame observes one consistent state.
 */
export class LodChunkManager {
  /** Root of all LOD region groups; the world adds this to the scene. */
  public readonly group = new Group();

  private states = new Map<string, LodChunkState>();
  private regions = new Map<string, LodRegion>();

  private updateCount = 0;
  private lastScanUpdate = -Infinity;
  private lastCenter: Coords2 | null = null;

  private candidates: [number, number, number][] = [];
  private pendingFullDisposals: Coords2[] = [];
  private pendingFullReveals: Coords2[] = [];

  constructor(
    private host: LodChunkManagerHost,
    private options: LodChunkManagerOptions,
  ) {
    this.group.name = "lod-chunks";
  }

  get maxLodLevel(): number {
    return this.options.maxLodLevel;
  }

  /** The LOD horizon in chunks for the current render radius. */
  get visualRadius(): number {
    return Math.min(
      this.host.renderRadius() * (1 << this.options.maxLodLevel),
      this.options.maxLodRadius,
    );
  }

  /** Whether the manager currently displays a LOD form for this chunk. */
  hasDisplayedForm(cx: number, cz: number): boolean {
    const state = this.states.get(ChunkUtils.getChunkName([cx, cz]));
    return state?.displayedLevel != null;
  }

  /**
   * Whether the manager tracks this chunk in any way (displayed or with an
   * in-flight request) and therefore owns its server-side interest.
   */
  owns(cx: number, cz: number): boolean {
    return this.states.has(ChunkUtils.getChunkName([cx, cz]));
  }

  get displayedCount(): number {
    let count = 0;
    for (const state of this.states.values()) {
      if (state.displayedLevel !== null) count++;
    }
    return count;
  }

  /**
   * Ingest a LOD chunk protocol (LOAD or UPDATE). Geometry becomes visible on
   * the next {@link update}, at which point any older form is retired in the
   * same frame.
   */
  onLodChunk(data: ChunkProtocol): void {
    const { x, z, meshes } = data;
    const mesh = meshes?.[0];
    const level = mesh?.lod ?? 0;
    if (!mesh || level < 1) return;

    // A LOD mesh landing while the viewer is back inside the full-detail
    // ring is stale (demote raced a return trip): discard it and flip the
    // server's interest back to the full form.
    if (this.host.isFullChunkActive(x, z) && this.lastCenter) {
      const dx = x - this.lastCenter[0];
      const dz = z - this.lastCenter[1];
      const target = resolveLodTarget(
        Math.sqrt(dx * dx + dz * dz),
        0,
        this.host.renderRadius(),
        this.options.maxLodLevel,
        this.options.hysteresis,
      );

      if (target === 0) {
        const staleName = ChunkUtils.getChunkName([x, z]);
        const staleState = this.states.get(staleName);
        if (staleState && staleState.displayedLevel === null) {
          this.states.delete(staleName);
        } else if (staleState?.requestedLevel === level) {
          staleState.requestedLevel = null;
        }
        this.host.refreshFullChunk(x, z);
        return;
      }
    }

    const name = ChunkUtils.getChunkName([x, z]);
    let state = this.states.get(name);
    if (!state) {
      state = {
        name,
        coords: [x, z],
        displayedLevel: null,
        geometries: null,
        requestedLevel: null,
        requestedAt: 0,
      };
      this.states.set(name, state);
    }

    if (state.requestedLevel === level) {
      state.requestedLevel = null;
    }

    if (state.displayedLevel !== null && state.displayedLevel !== level) {
      this.removeFromRegion(state, state.displayedLevel);
    }

    state.geometries = mesh.geometries ?? [];
    state.displayedLevel = level;
    this.addToRegion(state, level);

    // Reaching here with an active full form means this arrival is the
    // demote replacement: the full chunk is disposed after regions rebuild.
    if (this.host.isFullChunkActive(x, z)) {
      this.pendingFullDisposals.push([x, z]);
    }
  }

  /**
   * The full-detail pipeline finished building every sub-chunk mesh of this
   * chunk: retire the LOD form and reveal the full group on the next update,
   * in the same frame.
   */
  onFullChunkDisplayable(cx: number, cz: number): void {
    const state = this.states.get(ChunkUtils.getChunkName([cx, cz]));
    if (!state || state.displayedLevel === null) return;

    this.removeFromRegion(state, state.displayedLevel);
    state.displayedLevel = null;
    state.geometries = null;
    state.requestedLevel = null;
    this.pendingFullReveals.push([cx, cz]);
  }

  /**
   * After a reconnect the server holds no interests: re-request every
   * displayed LOD chunk at its current level so interest re-registers and
   * refreshed meshes stream back in. Displayed geometry stays up meanwhile.
   */
  resyncForRejoin(): void {
    for (const state of this.states.values()) {
      if (state.displayedLevel !== null) {
        state.requestedLevel = state.displayedLevel;
        state.requestedAt = this.updateCount;
        this.candidates.push([
          state.coords[0],
          state.coords[1],
          state.displayedLevel,
        ]);
      }
    }
    this.flushRequests();
  }

  /**
   * Per-frame pump: scan rings (throttled), issue requests, retire
   * out-of-range chunks, rebuild dirty regions, then commit pending swaps —
   * all within this call so the frame renders one consistent state.
   */
  update(center: Coords2): void {
    this.updateCount++;

    const centerChanged =
      !this.lastCenter ||
      this.lastCenter[0] !== center[0] ||
      this.lastCenter[1] !== center[1];

    if (
      centerChanged ||
      this.updateCount - this.lastScanUpdate >= SCAN_INTERVAL_UPDATES
    ) {
      this.scan(center);
      this.lastScanUpdate = this.updateCount;
      this.lastCenter = [center[0], center[1]];
    }

    this.flushRequests();
    this.rebuildDirtyRegions();
    this.commitSwaps();
  }

  dispose(): void {
    for (const region of this.regions.values()) {
      this.disposeRegionMeshes(region);
      this.group.remove(region.group);
    }
    this.regions.clear();
    this.states.clear();
    this.candidates = [];
  }

  private scan(center: Coords2): void {
    const renderRadius = this.host.renderRadius();
    const maxLodLevel = this.options.maxLodLevel;
    const hysteresis = this.options.hysteresis;
    const scanRadius = Math.ceil(this.visualRadius + hysteresis);
    const [centerX, centerZ] = center;

    const requests: { cx: number; cz: number; level: number; d: number }[] = [];
    const toRemove: LodChunkState[] = [];
    const visited = new Set<string>();

    const consider = (cx: number, cz: number, distance: number) => {
      if (!this.host.isWithinWorld(cx, cz)) return;

      const name = ChunkUtils.getChunkName([cx, cz]);
      visited.add(name);
      const state = this.states.get(name);

      const isFullActive = this.host.isFullChunkActive(cx, cz);
      const currentLevel =
        state?.displayedLevel != null
          ? state.displayedLevel
          : isFullActive
            ? 0
            : null;

      const target = resolveLodTarget(
        distance,
        currentLevel,
        renderRadius,
        maxLodLevel,
        hysteresis,
      );

      if (target === null) {
        if (state) toRemove.push(state);
        return;
      }

      if (target === 0) {
        // The full-detail pipeline owns requesting; the LOD form (if any)
        // stays displayed until the full chunk reports displayable.
        if (state?.requestedLevel != null) state.requestedLevel = null;
        return;
      }

      if (state?.displayedLevel === target) {
        if (state.requestedLevel != null && state.requestedLevel !== target) {
          state.requestedLevel = null;
        }
        return;
      }

      if (state?.requestedLevel === target) {
        const age = this.updateCount - state.requestedAt;
        if (age <= this.options.rerequestInterval) return;
      }

      requests.push({ cx, cz, level: target, d: distance });
    };

    for (let ox = -scanRadius; ox <= scanRadius; ox++) {
      for (let oz = -scanRadius; oz <= scanRadius; oz++) {
        const distance = Math.sqrt(ox * ox + oz * oz);
        if (distance > scanRadius) continue;
        consider(centerX + ox, centerZ + oz, distance);
      }
    }

    // States drifting outside the scan window (fast travel) still retire.
    for (const state of this.states.values()) {
      if (visited.has(state.name)) continue;
      const dx = state.coords[0] - centerX;
      const dz = state.coords[1] - centerZ;
      if (Math.sqrt(dx * dx + dz * dz) > scanRadius) {
        toRemove.push(state);
      }
    }

    requests.sort((a, b) => a.d - b.d);
    this.candidates = requests.map(({ cx, cz, level }) => [cx, cz, level]);

    if (toRemove.length) {
      const unloaded: Coords2[] = [];
      for (const state of toRemove) {
        if (state.displayedLevel !== null) {
          this.removeFromRegion(state, state.displayedLevel);
        }
        this.states.delete(state.name);
        unloaded.push(state.coords);
      }
      this.host.unloadChunks(unloaded);
    }
  }

  private flushRequests(): void {
    if (!this.candidates.length) return;

    const batch = this.candidates.splice(0, this.options.maxRequestsPerUpdate);
    const requests: [number, number, number][] = [];

    for (const [cx, cz, level] of batch) {
      const name = ChunkUtils.getChunkName([cx, cz]);
      let state = this.states.get(name);
      if (!state) {
        state = {
          name,
          coords: [cx, cz],
          displayedLevel: null,
          geometries: null,
          requestedLevel: null,
          requestedAt: 0,
        };
        this.states.set(name, state);
      }
      state.requestedLevel = level;
      state.requestedAt = this.updateCount;
      requests.push([cx, cz, level]);
    }

    if (requests.length) {
      this.host.requestLodChunks(requests);
    }
  }

  private addToRegion(state: LodChunkState, level: number): void {
    const key = lodRegionKey(state.coords[0], state.coords[1], level);
    let region = this.regions.get(key);
    if (!region) {
      region = {
        key,
        level,
        members: new Set(),
        group: new Group(),
        meshes: [],
        isDirty: false,
      };
      region.group.name = `lod-region-${key}`;
      this.group.add(region.group);
      this.regions.set(key, region);
    }
    region.members.add(state);
    region.isDirty = true;
  }

  private removeFromRegion(state: LodChunkState, level: number): void {
    const key = lodRegionKey(state.coords[0], state.coords[1], level);
    const region = this.regions.get(key);
    if (!region) return;
    region.members.delete(state);
    region.isDirty = true;
  }

  private rebuildDirtyRegions(): void {
    for (const region of this.regions.values()) {
      if (!region.isDirty) continue;
      region.isDirty = false;
      this.rebuildRegion(region);
    }
  }

  private commitSwaps(): void {
    if (this.pendingFullDisposals.length) {
      for (const [cx, cz] of this.pendingFullDisposals) {
        this.host.disposeFullChunk(cx, cz);
      }
      this.pendingFullDisposals = [];
    }

    if (this.pendingFullReveals.length) {
      for (const [cx, cz] of this.pendingFullReveals) {
        this.host.setFullChunkVisible(cx, cz, true);
      }
      this.pendingFullReveals = [];
    }
  }

  private disposeRegionMeshes(region: LodRegion): void {
    for (const mesh of region.meshes) {
      mesh.geometry.dispose();
      region.group.remove(mesh);
    }
    region.meshes = [];
  }

  private rebuildRegion(region: LodRegion): void {
    this.disposeRegionMeshes(region);

    if (region.members.size === 0) {
      this.group.remove(region.group);
      this.regions.delete(region.key);
      return;
    }

    const buckets = new Map<string, LodGeometryBucket>();

    for (const state of region.members) {
      if (!state.geometries) continue;
      for (const geometry of state.geometries) {
        if (!geometry.positions?.length || !geometry.indices?.length) {
          continue;
        }
        // Isolated per-position faces cannot resolve a shared material at
        // LOD scale; the downsampler avoids such representatives, so simply
        // skip the rare leftover face.
        if (geometry.at && geometry.at.length) continue;

        const resolved = this.host.resolveMaterial(
          geometry.voxel,
          geometry.faceName ?? undefined,
        );
        if (!resolved) continue;

        let bucket = buckets.get(resolved.key);
        if (!bucket) {
          bucket = {
            material: resolved.material,
            voxel: geometry.voxel,
            geometries: [],
          };
          buckets.set(resolved.key, bucket);
        }
        bucket.geometries.push({ chunk: state, geometry });
      }
    }

    const chunkSize = this.host.chunkSize;

    for (const [key, bucket] of buckets) {
      let vertexCount = 0;
      let indexCount = 0;
      for (const { geometry } of bucket.geometries) {
        vertexCount += geometry.positions.length / 3;
        indexCount += geometry.indices.length;
      }
      if (vertexCount === 0 || indexCount === 0) continue;

      const positions = new Float32Array(vertexCount * 3);
      const uvs = new Float32Array(vertexCount * 2);
      const lights = new Int32Array(vertexCount);
      const indices = new Uint32Array(indexCount);

      let vertexBase = 0;
      let indexBase = 0;

      for (const { chunk, geometry } of bucket.geometries) {
        const offsetX = chunk.coords[0] * chunkSize;
        const offsetZ = chunk.coords[1] * chunkSize;
        const count = geometry.positions.length / 3;

        for (let i = 0; i < count; i++) {
          positions[(vertexBase + i) * 3] = geometry.positions[i * 3] + offsetX;
          positions[(vertexBase + i) * 3 + 1] = geometry.positions[i * 3 + 1];
          positions[(vertexBase + i) * 3 + 2] =
            geometry.positions[i * 3 + 2] + offsetZ;
        }
        uvs.set(geometry.uvs, vertexBase * 2);
        lights.set(geometry.lights, vertexBase);
        for (let i = 0; i < geometry.indices.length; i++) {
          indices[indexBase + i] = geometry.indices[i] + vertexBase;
        }

        vertexBase += count;
        indexBase += geometry.indices.length;
      }

      const normals = new Float32Array(vertexCount * 3);
      computeFlatNormalsInto(normals, positions, indices);

      const merged = new BufferGeometry();
      merged.setAttribute("position", new BufferAttribute(positions, 3));
      merged.setAttribute("uv", new BufferAttribute(uvs, 2));
      merged.setAttribute("light", new BufferAttribute(lights, 1));
      merged.setAttribute("normal", new BufferAttribute(normals, 3));
      merged.setIndex(new BufferAttribute(indices, 1));
      merged.computeBoundingSphere();

      const mesh = new Mesh(merged, bucket.material);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.userData = {
        isLodChunk: true,
        lodLevel: region.level,
        materialBucket: key,
        voxel: bucket.voxel,
      };

      if (bucket.material.transparent) {
        this.host.configureTransparentMesh(mesh, bucket.voxel);
      }

      region.group.add(mesh);
      region.meshes.push(mesh);
    }
  }
}
