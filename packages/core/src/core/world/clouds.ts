import ndarray from "ndarray";
import {
  BufferGeometry,
  Clock,
  Color,
  Float32BufferAttribute,
  FrontSide,
  Group,
  Int8BufferAttribute,
  Mesh,
  ShaderMaterial,
  Vector3,
} from "three";

import { cull } from "../../libs/cull";
import { WorkerPool } from "../../libs/worker-pool";
import CloudsFragmentShader from "../../shaders/clouds/fragment.glsl?raw";
import CloudsVertexShader from "../../shaders/clouds/vertex.glsl?raw";
import { Coords2, Coords3 } from "../../types";

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
   * The horizontal count of how many cloud blocks are in a cloud cell. Defaults to `8`.
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
   * The speed at which the clouds move. Defaults to `8`.
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
   * The seed used to generate the clouds. Defaults to `-1`.
   */
  seed: number;

  /**
   * The number of cloud cells to generate, `count` * `count`. Defaults to `16`.
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
   * An object that is used as the uniform for the clouds fog near shader.
   */
  uFogNear?: {
    value: number;
  };

  /**
   * An object that is used as the uniform for the clouds fog far shader.
   */
  uFogFar?: {
    value: number;
  };

  /**
   * An object that is used as the uniform for the clouds fog color shader.
   */
  uFogColor?: {
    value: Color;
  };
};

const defaultOptions: CloudsOptions = {
  alpha: 0.8,
  color: "#fff",
  count: 16,
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
  public material: ShaderMaterial;

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
   * The new position to lerp the clouds.
   */
  private newPosition = new Vector3();

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
  private clock = new Clock();

  /**
   * Create a new {@link Clouds} instance, initializing it asynchronously automatically.
   *
   * @param options Parameters used to create a new {@link Clouds} instance.
   */
  constructor(options: Partial<CloudsOptions> = {}) {
    super();

    this.options = { ...defaultOptions, ...options };

    const { seed, color, alpha, uFogNear, uFogFar, uFogColor } = this.options;

    if (seed === -1) {
      this.options.seed = Math.floor(Math.random() * 10230123);
    }

    this.material = new ShaderMaterial({
      transparent: true,
      vertexShader: CloudsVertexShader,
      fragmentShader: CloudsFragmentShader,
      side: FrontSide,
      uniforms: {
        uFogNear: uFogNear || { value: 500 },
        uFogFar: uFogFar || { value: 1000 },
        uFogColor: uFogColor || { value: new Color("#fff") },
        uCloudColor: {
          value: new Color(color),
        },
        uCloudAlpha: {
          value: alpha,
        },
      },
    });

    this.material.toneMapped = false;

    this.initialize();
  }

  /**
   * Reset the clouds to their initial state.
   */
  reset = async () => {
    this.children.forEach((child: Mesh) => {
      if (child.parent) {
        child.parent.remove(child);
        child.geometry?.dispose();
      }
    });

    this.meshes.length = 0;

    await this.initialize();
  };

  /**
   * Move the clouds to centering around the passed in position. If there aren't enough cloud
   * cells at any side, new clouds are generated.
   *
   * @param position The new position that this cloud should be centered around.
   */
  update = (position: Vector3) => {
    if (!this.isInitialized) return;

    // Normalize the delta
    const delta = Math.min(0.1, this.clock.getDelta());

    const { speedFactor, count, dimensions } = this.options;

    this.newPosition = this.position.clone();
    this.newPosition.z -= speedFactor * delta;

    const locatedCell: Coords2 = [
      Math.floor((position.x - this.position.x) / (count * dimensions[0])),
      Math.floor((position.z - this.position.z) / (count * dimensions[2])),
    ];

    if (
      this.locatedCell[0] !== locatedCell[0] ||
      this.locatedCell[1] !== locatedCell[1]
    ) {
      const dx = locatedCell[0] - this.locatedCell[0];
      const dz = locatedCell[1] - this.locatedCell[1];

      this.locatedCell = locatedCell;

      if (Math.abs(dx) > 1 || Math.abs(dz) > 1) {
        this.reset();
      } else {
        if (dx) {
          this.shiftX(dx);
        }

        if (dz) {
          this.shiftZ(dz);
        }
      }
    }

    this.position.lerp(this.newPosition, this.options.lerpFactor);
  };

  /**
   * Initialize the clouds asynchronously.
   */
  private initialize = async () => {
    const { width } = this.options;
    const [lx, lz] = this.locatedCell;

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

    for (let z = 0; z < width; z++) {
      await this.makeCell(
        this.xOffset + (direction > 0 ? width : 0),
        z + this.zOffset,
        arr[z]
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
        this.zOffset + (direction > 0 ? width : 0),
        cell
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

    const data = await new Promise<any>((resolve) =>
      this.pool.addJob({
        message: {
          data: array.data,
          configs: {
            min,
            max,
            noiseScale,
            threshold,
            stride: array.stride,
            octaves,
            falloff,
            seed,
          },
        },
        resolve,
        buffers: [array.data.buffer.slice(0)],
      })
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
