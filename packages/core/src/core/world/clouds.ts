import ndarray from "ndarray";
import {
  BufferGeometry,
  Timer,
  Color,
  Float32BufferAttribute,
  FrontSide,
  Group,
  Int8BufferAttribute,
  Mesh,
  NodeMaterial,
  Vector2,
  Vector3,
} from "three/webgpu";
import {
  cameraPosition,
  dot,
  float,
  length,
  max,
  mix,
  normalize,
  normalWorld,
  positionWorld,
  select,
  smoothstep,
  vec4,
} from "three/tsl";

import { cull } from "../../libs/cull";
import { WorkerPool } from "../../libs/worker-pool";
import { Coords2, Coords3 } from "../../types";

import { markNeverCaster } from "./shadow-casters";
import { skyFog, type SkyFogInputs } from "./shading/sky-fog";
import type { VolumetricCloudsSharedInputs } from "./shading/volumetric-clouds";
import type { FloatNode, Vec3Node } from "./shading/types";
import { ownUniform } from "./shading/uniforms";
import CloudWorker from "./workers/clouds-worker.ts?worker&inline";

/**
 * Parameters used to create a new {@link Clouds} instance.
 */
export type CloudsOptions = {
  /**
   * The scale of the noise used to generate the clouds. Defaults to `0.08`.
   */
  noiseScale: number;

  /**
   * The scale of the noise along the vertical axis. Defaults to `noiseScale`.
   *
   * Raise it above `noiseScale` for a shallow deck: a handful of layers span
   * almost no noise at the horizontal scale, so every column fills to the same
   * layer and the top comes out perfectly flat.
   */
  verticalNoiseScale?: number;

  /**
   * The number of cloud cells along each axis of the grid, `width` * `width` in
   * total. Defaults to `8`.
   */
  width: number;

  /**
   * The vertical count of how many cloud blocks are in a cloud cell. This is also
   * used to determine the overall count of cloud blocks of all the clouds. Defaults to `3`.
   */
  height: number;

  /**
   * The y-height at which the clouds are generated. Defaults to `256`.
   */
  cloudHeight: number;

  /**
   * The dimension of each cloud block. Defaults to `[20, 20, 20]`.
   */
  dimensions: Coords3;

  /**
   * The threshold at which noise values are considered to be "cloudy" and should generate a new
   * cloud block. Defaults to `0.05`.
   */
  threshold: number;

  /**
   * The lerp factor used to translate cloud blocks from their original position to their
   * new position. Defaults to `0.3`.
   */
  lerpFactor: number;

  /**
   * The speed at which the clouds drift along `-z`, in blocks per second of
   * the clock handed to {@link Clouds.update}. Defaults to `8`.
   */
  speedFactor: number;

  /**
   * The color of the clouds. Defaults to `#fff`.
   */
  color: string;

  /**
   * The opacity of the clouds. Defaults to `0.8`.
   */
  alpha: number;

  /**
   * Brightness of the vertical faces of a cloud block relative to its top,
   * `0..1`. Defaults to `0.86`.
   */
  sideShade: number;

  /**
   * Brightness of the underside of a cloud block relative to its top, `0..1`.
   * Defaults to `0.7`.
   */
  bottomShade: number;

  /**
   * Extra brightness given to faces pointing at the sun, as a fraction.
   * Defaults to `0.12`.
   */
  sunTint: number;

  /**
   * The seed used to generate the clouds. Defaults to `-1`, which draws a
   * random seed at construction. A `World` replaces that with the server's
   * world seed once INIT delivers it ({@link Clouds.setSeed}), so every
   * client of one world grows the same deck; name a seed here to override.
   */
  seed: number;

  /**
   * The horizontal count of how many cloud blocks are along each edge of a
   * cloud cell, `count` * `count` per cell. Defaults to `16`.
   *
   * The whole cloud sheet therefore spans `width` * `count` * `dimensions[0]`
   * blocks: it is `width`, not this, that adds cells.
   */
  count: number;

  /**
   * The number of octaves used to generate the noise. Defaults to `5`.
   */
  octaves: number;

  /**
   * The noise falloff factor used to generate the clouds. Defaults to `0.9`.
   */
  falloff: number;

  /**
   * The world's atmosphere the deck hazes into: its sky fog, the sky's
   * glow and the camera's water. The deck keeps its own fog range (it sits
   * far above the ground fog) and fogs by horizontal distance only. Clear
   * air without one.
   */
  atmosphere?: SkyFogInputs;

  /** Toward the light the flanks shade by; straight up without one. */
  sunDirection?: Vec3Node;

  /** The sun's colour and strength, for a volumetric deck's light. */
  sunColor?: Vec3Node;
  sunlightIntensity?: FloatNode;

  /**
   * The range the deck's far edge fades out over, in fog-scaled blocks
   * (the world's fog range); from the deck's radius without one.
   */
  endFadeNear?: FloatNode;
  endFadeFar?: FloatNode;

  endFadeNearRatio: number;

  endFadeFarRatio: number;
};

const defaultOptions: CloudsOptions = {
  alpha: 0.8,
  color: "#fff",
  count: 16,
  sideShade: 0.86,
  bottomShade: 0.7,
  sunTint: 0.12,
  noiseScale: 0.08,
  width: 8,
  height: 3,
  dimensions: [20, 20, 20],
  speedFactor: 8,
  lerpFactor: 0.3,
  threshold: 0.05,
  octaves: 5,
  falloff: 0.9,
  seed: -1,
  cloudHeight: 256,
  endFadeNearRatio: 0.62,
  endFadeFarRatio: 0.94,
};

/**
 * A class that generates and manages clouds. Clouds are essentially a 2D grid of cells that contain further sub-grids of
 * cloud blocks. This 2D grid move altogether in the `+x` direction, and is generated at the start asynchronously using
 * web workers using simplex noise.
 *
 * When using {@link Clouds.update}, new clouds will be generated if the center of the grid
 * does not match the passed in position.
 *
 * ![Clouds](/img/docs/clouds.png)
 *
 * @noInheritDoc
 */
export class Clouds extends Group {
  /**
   * Parameters used to create a new {@link Clouds} instance.
   */
  public options: CloudsOptions;

  /**
   * Whether or not are the clouds done generating.
   */
  public isInitialized = false;

  /**
   * The shard shader material used to render the clouds.
   */
  public material: NodeMaterial;

  /** The deck's live look, tunable without a rebuild. */
  public readonly uniforms: ReturnType<typeof createCloudUniforms>;

  /**
   * What a volumetric deck shares with this one, so both light and haze
   * alike: the atmosphere at the deck's fog range, its look and the sun.
   */
  public readonly shared: VolumetricCloudsSharedInputs;

  /**
   * The authored cloud colour, kept because the day/night cycle overwrites the
   * live uniform every frame and would otherwise have nothing to scale from.
   */
  public baseColorHSL: { h: number; s: number; l: number };

  /**
   * A 2D array of cloud meshes. The first dimension is the x-axis, and the second dimension is the z-axis.
   */
  public meshes: Mesh[][] = [];

  /**
   * The x-offset of the clouds since initialization. This is determined by diffing the `locatedCell` and the
   * position passed into {@link Clouds.update}.
   */
  public xOffset = 0;

  /**
   * The z-offset of the clouds since initialization. This is determined by diffing the `locatedCell` and the
   * position passed into {@link Clouds.update}.
   */
  public zOffset = 0;

  /**
   * The cell that this cloud is currently centered around.
   */
  public locatedCell: Coords2 = [0, 0];

  /**
   * Where the drift wants the deck this frame; the group eases toward it.
   */
  private driftTarget = new Vector3();

  /**
   * The worker pool used to generate the clouds.
   */
  private pool = new WorkerPool(CloudWorker, {
    maxWorker: 2,
    name: "cloud-worker",
  });

  /**
   * A inner THREE.JS clock used to determine the time delta between frames.
   */
  private timer = new Timer();

  /**
   * Cell generation runs serially through this chain: a reset that lands
   * while the first build is still awaiting its workers must wait for it,
   * or both builds push rows into `meshes` and the grid comes out doubled.
   */
  private generation: Promise<void> = Promise.resolve();

  /** One reconcile waits in the chain at a time; it reads the latest cell. */
  private isReconcileQueued = false;

  private isDisposed = false;

  /**
   * Create a new {@link Clouds} instance, initializing it asynchronously automatically.
   *
   * @param options Parameters used to create a new {@link Clouds} instance.
   */
  constructor(options: Partial<CloudsOptions> = {}) {
    super();

    this.options = { ...defaultOptions, ...options };

    const { seed, color, alpha } = this.options;

    const cloudRadius =
      (this.options.width *
        this.options.count *
        Math.max(this.options.dimensions[0], this.options.dimensions[2])) /
      2;

    if (seed === -1) {
      this.options.seed = Math.floor(Math.random() * 10230123);
    }

    this.uniforms = createCloudUniforms(color, alpha, this.options);
    const u = this.uniforms;
    this.shared = {
      atmosphere: {
        ...(this.options.atmosphere ?? clearAtmosphere()),
        fogNear: u.fogNear,
        fogFar: u.fogFar,
        // The deck is open sky: never the cave's true-3D haze.
        fogVerticalBlend: float(0),
      } as unknown as SkyFogInputs,
      cloudColor: u.cloudColor,
      sideShade: u.sideShade,
      bottomShade: u.bottomShade,
      fogDistanceScale: u.fogDistanceScale,
      sunDirection:
        this.options.sunDirection ?? ownUniform(new Vector3(0, 1, 0)),
      sunColor: this.options.sunColor ?? ownUniform(new Color(1, 0.98, 0.9)),
      sunlightIntensity: this.options.sunlightIntensity ?? ownUniform(1),
    };
    this.material = createCloudMaterial(this.uniforms, {
      atmosphere: this.shared.atmosphere,
      sunDirection: this.shared.sunDirection,
      endFadeNear:
        this.options.endFadeNear ??
        ownUniform(cloudRadius * this.options.endFadeNearRatio),
      endFadeFar:
        this.options.endFadeFar ??
        ownUniform(cloudRadius * this.options.endFadeFarRatio),
    });

    this.material.toneMapped = false;
    this.baseColorHSL = new Color(color).getHSL({ h: 0, s: 0, l: 0 });
    // A depth pass would draw the see-through deck as solid slabs, and a
    // cascade reaches it only from high enough up, so a flier would see a
    // hard dark wedge on ground that nobody walking it sees.
    markNeverCaster(this);

    this.initialize();
  }

  /**
   * Regrow the deck around the current cell, after any grid work already in
   * flight has finished.
   */
  reset = () => this.enqueueGridWork(() => this.rebuild());

  /**
   * Regrow the deck from a new seed. A `World` calls this with the server's
   * world seed once INIT delivers it, so all of its clients see one deck.
   */
  setSeed = (seed: number) => {
    if (this.options.seed === seed) return this.generation;

    this.options.seed = seed;
    return this.reset();
  };

  dispose = () => {
    this.isDisposed = true;
    this.pool.terminate();
    this.children.forEach((child: Mesh) => {
      child.geometry?.dispose();
    });
    this.meshes.length = 0;
    this.material.dispose();
  };

  /**
   * Move the clouds to centering around the passed in position. If there aren't enough cloud
   * cells at any side, new clouds are generated.
   *
   * @param position The new position that this cloud should be centered around.
   * @param driftClock Seconds on a clock every viewer of this deck shares
   * (`World.sharedClock`). Given, the deck's drift is a pure function of it,
   * so two clients looking up see the same cloud in the same place; without
   * it the deck drifts by this instance's own frame time.
   */
  update = (position: Vector3, driftClock?: number) => {
    if (!this.isInitialized) return;

    // Normalize the delta
    this.timer.update();
    const delta = Math.min(0.1, this.timer.getDelta());

    const { speedFactor, count, dimensions } = this.options;

    this.driftTarget.copy(this.position);
    if (driftClock === undefined) {
      this.driftTarget.z -= speedFactor * delta;
    } else {
      this.driftTarget.z = -speedFactor * driftClock;
    }

    // A clock jump (a join, a `/time`, a reconnect) lands the target a long
    // way from the deck. Easing across that gap would stream the deck
    // through the frame and re-cut cells every step of the way, so snap,
    // and let the cell bookkeeping below regrow it once.
    if (
      Math.abs(this.driftTarget.z - this.position.z) >
      count * dimensions[2]
    ) {
      this.position.copy(this.driftTarget);
    }

    const locatedCell: Coords2 = [
      Math.floor((position.x - this.position.x) / (count * dimensions[0])),
      Math.floor((position.z - this.position.z) / (count * dimensions[2])),
    ];

    if (
      this.locatedCell[0] !== locatedCell[0] ||
      this.locatedCell[1] !== locatedCell[1]
    ) {
      this.locatedCell = locatedCell;
      this.reconcileGrid();
    }

    this.position.lerp(this.driftTarget, this.options.lerpFactor);
  };

  /**
   * Initialize the clouds asynchronously.
   */
  private initialize = () => this.enqueueGridWork(() => this.buildCells());

  /**
   * Every mutation of the grid runs through here, one after another. A
   * shift still awaiting its worker when a rebuild lands would otherwise
   * push its row into the fresh grid, and two builds racing would double it.
   */
  private enqueueGridWork = (work: () => Promise<void>) => {
    this.generation = this.generation.then(async () => {
      if (this.isDisposed) return;
      await work();
    });

    return this.generation;
  };

  /**
   * Bring the grid to the located cell. The displacement is judged when the
   * work runs, not when it was queued: a shift queued behind a rebuild that
   * already grew the grid at the new cell would move it one cell too far.
   */
  private reconcileGrid = () => {
    if (this.isReconcileQueued) return this.generation;
    this.isReconcileQueued = true;

    return this.enqueueGridWork(async () => {
      this.isReconcileQueued = false;

      const dx = this.locatedCell[0] - this.xOffset;
      const dz = this.locatedCell[1] - this.zOffset;

      if (Math.abs(dx) > 1 || Math.abs(dz) > 1) {
        await this.rebuild();
        return;
      }

      if (dx) {
        await this.shiftX(dx);
      }

      if (dz) {
        await this.shiftZ(dz);
      }
    });
  };

  /**
   * Discard every cell and grow the grid again around the current cell.
   */
  private rebuild = async () => {
    this.isInitialized = false;

    // Removing while iterating `children` skips every other child.
    for (const child of [...this.children] as Mesh[]) {
      this.remove(child);
      child.geometry?.dispose();
    }

    this.meshes.length = 0;

    await this.buildCells();
  };

  /**
   * Grow every cell of the grid around the current cell.
   */
  private buildCells = async () => {
    const { width } = this.options;
    const [lx, lz] = this.locatedCell;

    // The shift bookkeeping names cells relative to these; a grid grown
    // around a cell other than the origin without moving them would shift
    // in cells it already holds and leave a gap where the new ones belong.
    this.xOffset = lx;
    this.zOffset = lz;

    for (let x = 0; x < width; x++) {
      const arr = [];

      for (let z = 0; z < width; z++) {
        const cell = await this.makeCell(x + lx, z + lz);
        this.add(cell);
        arr.push(cell);
      }

      this.meshes.push(arr);
    }

    this.isInitialized = true;
  };

  /**
   * Generate a new cloud row in the `+/- x` direction.
   */
  private shiftX = async (direction = 1) => {
    const { width } = this.options;

    const arr = direction > 0 ? this.meshes.shift() : this.meshes.pop();

    // The grid holds cells `[offset, offset + width)`: the row that enters
    // ahead is `offset + width`, the one that enters behind is `offset - 1`.
    // Regrowing `offset` itself duplicated the first row and left a gap.
    for (let z = 0; z < width; z++) {
      await this.makeCell(
        this.xOffset + (direction > 0 ? width : -1),
        z + this.zOffset,
        arr[z],
      );
    }

    if (direction > 0) {
      this.meshes.push(arr);
    } else {
      this.meshes.unshift(arr);
    }

    this.xOffset += direction;
  };

  /**
   * Generate a new cloud row in the `+/- z` direction.
   */
  private shiftZ = async (direction = 1) => {
    const { width } = this.options;

    // Guard against uninitialized meshes array
    if (!this.meshes || this.meshes.length === 0) {
      return;
    }

    // Ensure all inner arrays exist
    for (let x = 0; x < width; x++) {
      if (!this.meshes[x]) {
        this.meshes[x] = [];
      }
      const arr = this.meshes[x];

      // Guard against empty arrays
      if (arr.length === 0) {
        continue;
      }

      // Safe array mutations with null checks
      const cell = direction > 0 ? arr.shift() : arr.pop();

      if (!cell) {
        continue;
      }

      // Generate new cell
      const newCell = await this.makeCell(
        x + this.xOffset,
        this.zOffset + (direction > 0 ? width : -1),
        cell,
      );

      // Safe array insertions
      if (direction > 0) {
        arr.push(newCell);
      } else {
        arr.unshift(newCell);
      }
    }

    this.zOffset += direction;
  };

  /**
   * Generate a new cloud cell's mesh.
   *
   * @param x The x position of the cell.
   * @param z The z position of the cell.
   * @param mesh The mesh to update.
   * @returns The mesh that was generated.
   */
  private makeCell = async (x: number, z: number, mesh?: Mesh) => {
    const {
      width,
      height,
      count,
      noiseScale,
      verticalNoiseScale,
      seed,
      threshold,
      dimensions,
      cloudHeight,
      octaves,
      falloff,
    } = this.options;

    const array = mesh
      ? mesh.userData.data
      : ndarray(new Uint8Array((count + 2) * height * (count + 2)), [
          count + 2,
          height,
          count + 2,
        ]);

    const min = [x * count - 1, 0, z * count - 1];
    const max = [(x + 1) * count + 1, height, (z + 1) * count + 1];

    const data = await new Promise<Uint8Array>((resolve) =>
      this.pool.addJob({
        message: {
          data: array.data,
          configs: {
            min,
            max,
            noiseScale,
            verticalNoiseScale,
            threshold,
            stride: array.stride,
            octaves,
            falloff,
            seed,
          },
        },
        resolve,
        buffers: [array.data.buffer.slice(0)],
      }),
    );

    array.data = data;

    const { positions, indices, normals } = await cull(array, {
      dimensions,
      min: [1, 0, 1],
      max: [count + 1, height, count + 1],
      realMin: [0, 0, 0],
      realMax: [count + 2, height, count + 2],
    });

    const geometry = mesh ? mesh.geometry : new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new Int8BufferAttribute(normals, 3));
    geometry.setIndex(Array.from(indices));
    geometry.computeBoundingBox();

    mesh = mesh || new Mesh(geometry, this.material);

    mesh.position.setX((-width / 2 + x) * count * dimensions[0]);
    mesh.position.setY(cloudHeight);
    mesh.position.setZ((-width / 2 + z) * count * dimensions[2]);
    mesh.userData.data = array;
    mesh.renderOrder = -1;

    return mesh;
  };
}

/** The deck's live look: colour, opacity, face shades, fog scale. */
function createCloudUniforms(
  color: string,
  alpha: number,
  options: CloudsOptions,
) {
  return {
    cloudColor: ownUniform(new Color(color)),
    cloudAlpha: ownUniform(alpha),
    sideShade: ownUniform(options.sideShade),
    bottomShade: ownUniform(options.bottomShade),
    sunTint: ownUniform(options.sunTint),
    /** The deck's fog distance divided by this: it hazes far later than the ground. */
    fogDistanceScale: ownUniform(8),
    /** The deck's own fog range, in scaled blocks. */
    fogNear: ownUniform(500),
    fogFar: ownUniform(1000),
  };
}

/** Clear air at the default deck's range, for a deck with no world. */
function clearAtmosphere(): SkyFogInputs {
  return {
    fogColor: ownUniform(new Color("#B1CCFD")),
    fogNear: ownUniform(500),
    fogFar: ownUniform(1000),
    fogHeightOrigin: ownUniform(80),
    fogHeightDensity: ownUniform(0.005),
    fogVerticalBlend: ownUniform(0),
    skyFogTopColor: ownUniform(new Color(0.4, 0.6, 0.9)),
    skyFogMiddleColor: ownUniform(new Color(0.7, 0.8, 0.95)),
    skyFogBottomColor: ownUniform(new Color(0.15, 0.18, 0.25)),
    skyFogOffset: ownUniform(0),
    skyFogVoidOffset: ownUniform(1200),
    skyFogExponent: ownUniform(0.6),
    skyFogExponent2: ownUniform(1.2),
    skyFogDimension: ownUniform(2000),
    skyFogStrength: ownUniform(1),
    skyGlowSunDirection: ownUniform(new Vector3(0, 1, 0)),
    skyGlowColor: ownUniform(new Color(0, 0, 0)),
    skySunHaloColor: ownUniform(new Color(0, 0, 0)),
    skyMoonHaloColor: ownUniform(new Color(0, 0, 0)),
    skySunDiscColor: ownUniform(new Color(0, 0, 0)),
    skyMoonDiscColor: ownUniform(new Color(0, 0, 0)),
    skyDiscRadii: ownUniform(new Vector2(0.07, 0.07)),
    cameraSubmersion: ownUniform(0),
    cameraWaterPlaneY: ownUniform(0),
    underwaterAmbient: ownUniform(new Color(0, 0, 0)),
    underwaterViewScale: ownUniform(1),
    directSunlight: ownUniform(1),
  } as unknown as SkyFogInputs;
}

/**
 * The deck's material: three-way face shading toward the sun, the world's
 * sky fog by scaled horizontal distance, then a fade into the fog tint at
 * the deck's far edge.
 */
function createCloudMaterial(
  u: ReturnType<typeof createCloudUniforms>,
  shared: {
    atmosphere: SkyFogInputs;
    sunDirection: Vec3Node;
    endFadeNear: FloatNode;
    endFadeFar: FloatNode;
  },
): NodeMaterial {
  const fog = skyFog(shared.atmosphere);
  const normal = normalWorld;
  // Cloud faces are axis aligned, so splitting three ways by facing is
  // enough to give a bank of cloud a top, a shadowed underside, and flanks.
  // Without it every face renders at exactly one brightness and even a
  // deeply billowed deck reads as a flat sheet of paper.
  const faceShade = select(
    normal.y.greaterThan(0.5),
    float(1),
    select(normal.y.lessThan(-0.5), u.bottomShade, u.sideShade),
  );
  // Flanks turned away from the sun lose some brightness, which is what
  // separates the lit side of a billow from the shaded one. A darkening
  // rather than a boost: cloud colours sit close to white already, and
  // anything scaled above 1 clips flat and erases the shading it was for.
  const towardSun = max(0, dot(normal, normalize(shared.sunDirection)));
  const shade = faceShade.mul(mix(u.sunTint.oneMinus(), 1, towardSun));
  const flatDistance = length(positionWorld.xz.sub(cameraPosition.xz)).div(
    max(u.fogDistanceScale, 0.001),
  );
  const fogged = fog.apply(
    u.cloudColor.mul(shade),
    positionWorld,
    float(1),
    false,
    flatDistance,
    false,
  );
  const endFade = smoothstep(shared.endFadeNear, shared.endFadeFar, flatDistance);
  const ray = normalize(positionWorld.sub(cameraPosition));
  const material = new NodeMaterial();
  material.name = "clouds";
  material.transparent = true;
  material.side = FrontSide;
  material.fog = false;
  material.lights = false;
  // An output node, not a fragment node: the deck blends, and only a
  // material's output reaches the order-independent accumulation.
  material.outputNode = vec4(
    fog.haze(fogged, ray, endFade, false),
    u.cloudAlpha.mul(endFade.oneMinus()),
  );
  return material;
}
