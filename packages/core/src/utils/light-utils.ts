import type { Coords3 } from "../types";

/**
 * A utility class for extracting and inserting light data from and into numbers.
 *
 * The light data is stored in the following format:
 * - Sunlight: `0xff000000`
 * - Red light: `0x00ff0000`
 * - Green light: `0x0000ff00`
 * - Blue light: `0x000000ff`
 *
 * TODO-DOCS
 * For more information about lighting data, see [here](/)
 *
 * # Example
 * ```ts
 * // Insert a level 13 sunlight into zero.
 * const number = LightUtils.insertSunlight(0, 13);
 * ```
 *
 * @category Utils
 */
export class LightUtils {
  /**
   * Extract the sunlight level from a number.
   *
   * @param light The light value to extract from.
   * @returns The extracted sunlight value.
   */
  static extractSunlight = (light: number) => {
    return (light >> 12) & 0xf;
  };

  /**
   * Insert a sunlight level into a number.
   *
   * @param light The light value to insert the level into.
   * @param level The sunlight level to insert.
   * @returns The inserted light value.
   */
  static insertSunlight = (light: number, level: number) => {
    return (light & 0xfff) | (level << 12);
  };

  /**
   * Extract the red light level from a number.
   *
   * @param light The light value to extract from.
   * @returns The extracted red light value.
   */
  static extractRedLight = (light: number) => {
    return (light >> 8) & 0xf;
  };

  /**
   * Insert a red light level into a number.
   *
   * @param light The light value to insert the level into.
   * @param level The red light level to insert.
   * @returns The inserted light value.
   */
  static insertRedLight = (light: number, level: number) => {
    return (light & 0xf0ff) | (level << 8);
  };

  /**
   * Extract the green light level from a number.
   *
   * @param light The light value to extract from.
   * @returns The extracted green light value.
   */
  static extractGreenLight = (light: number) => {
    return (light >> 4) & 0xf;
  };

  /**
   * Insert a green light level into a number.
   *
   * @param light The light value to insert the level into.
   * @param level The green light level to insert.
   * @returns The inserted light value.
   */
  static insertGreenLight = (light: number, level: number) => {
    return (light & 0xff0f) | (level << 4);
  };

  /**
   * Extract the blue light level from a number.
   *
   * @param light The light value to extract from.
   * @returns The extracted blue light value.
   */
  static extractBlueLight = (light: number) => {
    return light & 0xf;
  };

  /**
   * Insert a blue light level into a number.
   *
   * @param light The light value to insert the level into.
   * @param level The blue light level to insert.
   * @returns The inserted light value.
   */
  static insertBlueLight = (light: number, level: number) => {
    return (light & 0xfff0) | level;
  };

  /**
   * Check to see if light can go "into" one block, disregarding the source.
   *
   * @param target The target block's transparency.
   * @param dx The change in x direction.
   * @param dy The change in y direction.
   * @param dz The change in z direction.
   * @returns Whether light can enter into the target block.
   */
  static canEnterInto = (
    target: boolean[],
    dx: number,
    dy: number,
    dz: number,
  ) => {
    if (Math.abs(dx + dy + dz) !== 1) {
      throw new Error(
        "This isn't supposed to happen. Light neighboring direction should be on 1 axis only.",
      );
    }

    const [px, py, pz, nx, ny, nz] = target;

    // Going into the NX of the target.
    if (dx === 1) {
      return nx;
    }

    // Going into the PX of the target.
    if (dx === -1) {
      return px;
    }

    // Going into the NY of the target.
    if (dy === 1) {
      return ny;
    }

    // Going into the PY of the target.
    if (dy === -1) {
      return py;
    }

    // Going into the NZ of the target.
    if (dz === 1) {
      return nz;
    }

    // Going into the PZ of the target.
    return pz;
  };

  /**
   * Check to see if light can enter from one block to another.
   *
   * @param source The source block's transparency.
   * @param target The target block's transparency.
   * @param dx The change in x direction.
   * @param dy The change in y direction.
   * @param dz The change in z direction.
   * @returns Whether light can enter from the source block to the target block.
   */
  static canEnter = (
    source: boolean[],
    target: boolean[],
    dx: number,
    dy: number,
    dz: number,
  ) => {
    if (Math.abs(dx + dy + dz) !== 1) {
      throw new Error(
        "This isn't supposed to happen. Light neighboring direction should be on 1 axis only.",
      );
    }

    const [spx, spy, spz, snx, sny, snz] = source;
    const [tpx, tpy, tpz, tnx, tny, tnz] = target;

    // Going from PX of source to NX of target
    if (dx === 1) {
      return spx && tnx;
    }

    // Going from NX of source to PX of target
    if (dx === -1) {
      return snx && tpx;
    }

    // Going from PY of source to NY of target
    if (dy === 1) {
      return spy && tny;
    }

    // Going from NY of source to PY of target
    if (dy === -1) {
      return sny && tpy;
    }

    // Going from PZ of source to NZ of target
    if (dz === 1) {
      return spz && tnz;
    }

    // Going from NZ of source to PZ of target
    return snz && tpz;
  };

  static dedupeFillQueue<T extends { voxel: Coords3; level: number }>(
    nodes: T[],
  ): T[] {
    const byKey = new Map<string, T>();
    for (const node of nodes) {
      const key = `${node.voxel[0]},${node.voxel[1]},${node.voxel[2]}`;
      const existing = byKey.get(key);
      if (!existing || node.level > existing.level) {
        byKey.set(key, node);
      }
    }
    return Array.from(byKey.values());
  }

  static retainLiveFillNodes<T extends { voxel: Coords3; level: number }>(
    nodes: T[],
    getLevelAt: (vx: number, vy: number, vz: number) => number,
  ): T[] {
    // A node is collected as fill the moment the removal front sees it, but a
    // later, stronger front can still zero it; flooding from that dead
    // snapshot would resurrect light the removal just proved stale.
    return nodes.filter(
      (node) =>
        getLevelAt(node.voxel[0], node.voxel[1], node.voxel[2]) === node.level,
    );
  }

  /**
   * Beer-Lambert transmission: I' = I * e^(-μd).
   * Each optical-density unit multiplies by 222/256 ≈ e^(-0.143).
   */
  static beerLambertTransmit(level: number, opticalDensity: number): number {
    if (level <= 0 || opticalDensity <= 0) {
      return level;
    }

    let next = level;
    for (let i = 0; i < opticalDensity; i += 1) {
      next = Math.floor(
        (next * LightUtils.BEER_LAMBERT_TRANSMITTANCE_NUM) /
          LightUtils.BEER_LAMBERT_TRANSMITTANCE_DEN,
      );
    }

    if (next >= level) {
      return Math.max(level - 1, 0);
    }
    return next;
  }

  /**
   * Next light level when flooding into a neighbor voxel.
   */
  static floodLightNextLevel(
    isSunlight: boolean,
    lightAttenuation: number,
    oy: number,
    level: number,
    maxLightLevel: number,
  ): number {
    if (level <= 0) {
      return 0;
    }

    if (
      isSunlight &&
      lightAttenuation === 0 &&
      oy === -1 &&
      level === maxLightLevel
    ) {
      return level;
    }

    if (lightAttenuation > 0) {
      return LightUtils.beerLambertTransmit(level, lightAttenuation);
    }

    return Math.max(level - 1, 0);
  }

  static readonly BEER_LAMBERT_TRANSMITTANCE_NUM = 222;
  static readonly BEER_LAMBERT_TRANSMITTANCE_DEN = 256;

  /**
   * Marker level for a flood seed whose light is to be read where the flood
   * runs, not where the edit was analysed.
   *
   * A cell opened out of an opaque block is lit by whatever stands around it,
   * and the analysis used to seed the flood from the neighbours' light as it
   * was on the main thread at that moment. Light lands a worker round-trip
   * later, so a neighbour opened by the previous packet could still read
   * zero: the cell then got no seed at all, and since nothing ever revisits
   * a lit-looking-enough cell, a pit cut into stone stayed black until a
   * reload. Seeded this way, the cell's neighbours are read from the flood's
   * own snapshot, which already holds every earlier batch's result.
   */
  static readonly LEVEL_FROM_NEIGHBORS = -1;

  /**
   * Replace every deferred seed ({@link LightUtils.LEVEL_FROM_NEIGHBORS}) with
   * ordinary seeds at its lit neighbours, read from `volume` now; other
   * seeds pass through. Duplicates collapse, so a wall of opened cells does
   * not seed the same lit neighbour a dozen times.
   */
  static resolveDeferredSeeds<TNode extends { voxel: Coords3; level: number }>(
    volume: {
      getSunlightAt(vx: number, vy: number, vz: number): number;
      getTorchLightAt(
        vx: number,
        vy: number,
        vz: number,
        color: LightColor,
      ): number;
    },
    seeds: TNode[],
    color: LightColor,
    maxHeight: number,
  ): { voxel: Coords3; level: number }[] {
    const isSunlight = color === SUNLIGHT;
    const resolved: { voxel: Coords3; level: number }[] = [];
    const seen = new Set<string>();

    const push = (voxel: Coords3, level: number) => {
      const key = `${voxel[0]},${voxel[1]},${voxel[2]},${level}`;
      if (seen.has(key)) return;
      seen.add(key);
      resolved.push({ voxel, level });
    };

    for (const seed of seeds) {
      if (seed.level !== LightUtils.LEVEL_FROM_NEIGHBORS) {
        push(seed.voxel, seed.level);
        continue;
      }

      const [vx, vy, vz] = seed.voxel;
      for (const [ox, oy, oz] of LIGHT_NEIGHBOR_OFFSETS) {
        const ny = vy + oy;
        if (ny < 0 || ny >= maxHeight) continue;
        const nx = vx + ox;
        const nz = vz + oz;
        const level = isSunlight
          ? volume.getSunlightAt(nx, ny, nz)
          : volume.getTorchLightAt(nx, ny, nz, color);
        if (level > 0) {
          push([nx, ny, nz], level);
        }
      }
    }

    return resolved;
  }

  private constructor() {
    // NOTHING
  }
}

const LIGHT_NEIGHBOR_OFFSETS: readonly Coords3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/**
 * The string representation of red light.
 */
export const RED_LIGHT = "RED";

/**
 * The string representation of green light.
 */
export const GREEN_LIGHT = "GREEN";

/**
 * The string representation of blue light.
 */
export const BLUE_LIGHT = "BLUE";

/**
 * The string representation of sunlight.
 */
export const SUNLIGHT = "SUNLIGHT";

/**
 * Sunlight or the color of torch light.
 */
export type LightColor = "RED" | "GREEN" | "BLUE" | "SUNLIGHT";
