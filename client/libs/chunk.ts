import ndarray, { NdArray } from "ndarray";
import { BufferAttribute, BufferGeometry, Material, Mesh, Scene } from "three";

import { OPAQUE_RENDER_ORDER, TRANSPARENT_RENDER_ORDER } from "../common";
import { Coords2, Coords3 } from "../types";
import { BlockUtils, ChunkUtils, LightColor, LightUtils } from "../utils";

import { BlockRotation } from "./block-rotation";
import { ServerChunk } from "./chunks";

type ChunkParams = {
  size: number;
  maxHeight: number;
};

class Chunk {
  public mesh: {
    opaque?: Mesh;
    transparent?: Mesh;
  } = {};

  public name: string;
  public coords: Coords2;

  public min: Coords3;
  public max: Coords3;

  public voxels: NdArray<Uint32Array>;
  public lights: NdArray<Uint32Array>;

  private added = false;

  constructor(
    public id: string,
    x: number,
    z: number,
    public params: ChunkParams
  ) {
    this.name = ChunkUtils.getChunkName([x, z]);
    this.coords = [x, z];

    const { size, maxHeight } = params;

    this.voxels = ndarray([] as any, [size, maxHeight, size]);
    this.lights = ndarray([] as any, [size, maxHeight, size]);

    this.min = [x * size, 0, z * size];
    this.max = [(x + 1) * size, maxHeight, (z + 1) * size];
  }

  build = (
    data: ServerChunk,
    scene: Scene,
    materials: { opaque?: Material; transparent?: Material }
  ) => {
    const { mesh: meshData, lights, voxels } = data;

    if (lights && lights.byteLength) this.lights.data = new Uint32Array(lights);
    if (voxels && voxels.byteLength) this.voxels.data = new Uint32Array(voxels);

    if (meshData) {
      ["opaque", "transparent"].forEach((type) => {
        const data = meshData[type];

        if (!data) {
          if (this.mesh[type]) {
            scene.remove(this.mesh[type]);
          }
          return;
        }

        const { positions, indices, uvs, lights } = data;

        if (positions.length === 0 || indices.length === 0) {
          return;
        }

        let mesh = this.mesh[type] as Mesh;

        if (!mesh) {
          const { opaque, transparent } = materials;

          mesh = new Mesh(
            new BufferGeometry(),
            type === "opaque" ? opaque : transparent
          );
          mesh.name = `${this.name}-${type}`;
          mesh.matrixAutoUpdate = false;
          mesh.renderOrder =
            type === "opaque" ? OPAQUE_RENDER_ORDER : TRANSPARENT_RENDER_ORDER;
          mesh.frustumCulled = false;
          mesh.position.set(...this.min);
        }

        const geometry = mesh.geometry;

        geometry.setAttribute(
          "position",
          new BufferAttribute(new Float32Array(positions), 3)
        );
        geometry.setAttribute(
          "uv",
          new BufferAttribute(new Float32Array(uvs), 2)
        );
        geometry.setAttribute(
          "light",
          new BufferAttribute(new Int32Array(lights), 1)
        );
        geometry.setIndex(Array.from(new Uint32Array(indices)));

        mesh.updateMatrix();

        this.mesh[type] = mesh;
      });
    }
  };

  addToScene = (scene: Scene) => {
    const { opaque, transparent } = this.mesh;

    if (transparent && !transparent.parent) {
      scene.add(transparent);
    }

    if (opaque && !opaque.parent) {
      scene.add(opaque);
    }
  };

  removeFromScene = (scene: Scene) => {
    const { opaque, transparent } = this.mesh;

    if (opaque) scene.remove(opaque);
    if (transparent) scene.remove(transparent);
  };

  getRawValue = (vx: number, vy: number, vz: number) => {
    if (!this.contains(vx, vy, vz)) {
      return 0;
    }

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.voxels.get(lx, ly, lz);
  };

  setRawValue = (vx: number, vy: number, vz: number, val: number) => {
    this.assert(vx, vy, vz);

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.voxels.set(lx, ly, lz, val);
  };

  setRawLight = (vx: number, vy: number, vz: number, level: number) => {
    this.assert(vx, vy, vz);

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.lights.set(lx, ly, lz, level);
  };

  getVoxel = (vx: number, vy: number, vz: number) => {
    return BlockUtils.extractID(this.getRawValue(vx, vy, vz));
  };

  setVoxel = (vx: number, vy: number, vz: number, id: number) => {
    const value = BlockUtils.insertId(0, id);
    this.setRawValue(vx, vy, vz, value);
    return id;
  };

  getVoxelRotation = (vx: number, vy: number, vz: number) => {
    this.assert(vx, vy, vz);
    return BlockUtils.extractRotation(this.getRawValue(vx, vy, vz));
  };

  setVoxelRotation = (
    vx: number,
    vy: number,
    vz: number,
    rotation: BlockRotation
  ) => {
    const value = BlockUtils.insertRotation(
      this.getRawValue(vx, vy, vz),
      rotation
    );
    this.setRawValue(vx, vy, vz, value);
  };

  getVoxelStage = (vx: number, vy: number, vz: number) => {
    this.assert(vx, vy, vz);
    return BlockUtils.extractStage(this.getRawValue(vx, vy, vz));
  };

  setVoxelStage = (vx: number, vy: number, vz: number, stage: number) => {
    const value = BlockUtils.insertStage(this.getRawValue(vx, vy, vz), stage);
    this.setRawValue(vx, vy, vz, value);
    return stage;
  };

  getRedLight = (vx: number, vy: number, vz: number) => {
    if (!this.contains(vx, vy, vz)) {
      return 0;
    }

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.getLocalRedLight(lx, ly, lz);
  };

  setRedLight = (vx: number, vy: number, vz: number, level: number) => {
    this.assert(vx, vy, vz);

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.setLocalRedLight(lx, ly, lz, level);
  };

  getGreenLight = (vx: number, vy: number, vz: number) => {
    if (!this.contains(vx, vy, vz)) {
      return 0;
    }

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.getLocalGreenLight(lx, ly, lz);
  };

  setGreenLight = (vx: number, vy: number, vz: number, level: number) => {
    this.assert(vx, vy, vz);

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.setLocalGreenLight(lx, ly, lz, level);
  };

  getBlueLight = (vx: number, vy: number, vz: number) => {
    if (!this.contains(vx, vy, vz)) {
      return 0;
    }

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.getLocalBlueLight(lx, ly, lz);
  };

  setBlueLight = (vx: number, vy: number, vz: number, level: number) => {
    this.assert(vx, vy, vz);

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.setLocalBlueLight(lx, ly, lz, level);
  };

  getTorchLight = (vx: number, vy: number, vz: number, color: LightColor) => {
    switch (color) {
      case "RED":
        return this.getRedLight(vx, vy, vz);
      case "GREEN":
        return this.getGreenLight(vx, vy, vz);
      case "BLUE":
        return this.getBlueLight(vx, vy, vz);
      default:
        throw new Error("Received unknown light color...");
    }
  };

  setTorchLight = (
    vx: number,
    vy: number,
    vz: number,
    level: number,
    color: LightColor
  ) => {
    switch (color) {
      case "RED":
        return this.setRedLight(vx, vy, vz, level);
      case "GREEN":
        return this.setGreenLight(vx, vy, vz, level);
      case "BLUE":
        return this.setBlueLight(vx, vy, vz, level);
      default:
        throw new Error("Received unknown light color...");
    }
  };

  getSunlight = (vx: number, vy: number, vz: number) => {
    if (!this.contains(vx, vy, vz)) {
      return 0;
    }

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.getLocalSunlight(lx, ly, lz);
  };

  setSunlight = (vx: number, vy: number, vz: number, level: number) => {
    this.assert(vx, vy, vz);

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.setLocalSunlight(lx, ly, lz, level);
  };

  distTo = (vx: number, _: number, vz: number) => {
    const [mx, , mz] = this.min;

    return Math.sqrt(
      (mx + this.params.size / 2 - vx) ** 2 +
        (mz + this.params.size / 2 - vz) ** 2
    );
  };

  dispose = () => {
    this.mesh.opaque?.geometry.dispose();
    this.mesh.transparent?.geometry.dispose();
  };

  get isReady() {
    return (
      (!!this.mesh?.opaque || !!this.mesh?.transparent) &&
      this.lights.data.length !== 0 &&
      this.voxels.data.length !== 0
    );
  }

  private getLocalRedLight = (lx: number, ly: number, lz: number) => {
    return LightUtils.extractRedLight(this.lights.get(lx, ly, lz));
  };

  private setLocalRedLight = (
    lx: number,
    ly: number,
    lz: number,
    level: number
  ) => {
    return this.lights.set(
      lx,
      ly,
      lz,
      LightUtils.insertRedLight(this.lights.get(lx, ly, lz), level)
    );
  };

  private getLocalGreenLight = (lx: number, ly: number, lz: number) => {
    return LightUtils.extractGreenLight(this.lights.get(lx, ly, lz));
  };

  private setLocalGreenLight = (
    lx: number,
    ly: number,
    lz: number,
    level: number
  ) => {
    return this.lights.set(
      lx,
      ly,
      lz,
      LightUtils.insertGreenLight(this.lights.get(lx, ly, lz), level)
    );
  };

  private getLocalBlueLight = (lx: number, ly: number, lz: number) => {
    return LightUtils.extractBlueLight(this.lights.get(lx, ly, lz));
  };

  private setLocalBlueLight = (
    lx: number,
    ly: number,
    lz: number,
    level: number
  ) => {
    return this.lights.set(
      lx,
      ly,
      lz,
      LightUtils.insertBlueLight(this.lights.get(lx, ly, lz), level)
    );
  };

  private getLocalSunlight = (lx: number, ly: number, lz: number) => {
    return LightUtils.extractSunlight(this.lights.get(lx, ly, lz));
  };

  private setLocalSunlight = (
    lx: number,
    ly: number,
    lz: number,
    level: number
  ) => {
    return this.lights.set(
      lx,
      ly,
      lz,
      LightUtils.insertSunlight(this.lights.get(lx, ly, lz), level)
    );
  };

  private toLocal = (vx: number, vy: number, vz: number) => {
    const [mx, my, mz] = this.min;
    return [vx - mx, vy - my, vz - mz];
  };

  private contains = (vx: number, vy: number, vz: number) => {
    const { size, maxHeight } = this.params;
    const [lx, ly, lz] = this.toLocal(vx, vy, vz);

    return lx < size && ly >= 0 && ly < maxHeight && lz >= 0 && lz < size;
  };

  private assert = (vx: number, vy: number, vz: number) => {
    if (!this.contains(vx, vy, vz)) {
      throw new Error(`Chunk voxel out of bounds for chunk: ${this.coords}`);
    }
  };
}

export { Chunk };
