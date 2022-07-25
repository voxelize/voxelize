import { ChunkProtocol, MeshProtocol } from "@voxelize/transport/src/types";
import ndarray, { NdArray } from "ndarray";
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Material,
  Mesh,
  Scene,
} from "three";

import { OPAQUE_RENDER_ORDER, TRANSPARENT_RENDER_ORDER } from "../../common";
import { Coords2, Coords3 } from "../../types";
import { BlockUtils, ChunkUtils, LightColor, LightUtils } from "../../utils";

import { BlockRotation } from "./block";

type ChunkParams = {
  size: number;
  maxHeight: number;
  subChunks: number;
};

class ChunkMesh extends Group {
  public opaque = new Map<number, Mesh>();
  public transparent = new Map<number, Mesh>();

  constructor(public chunk: Chunk) {
    super();

    this.frustumCulled = false;
  }

  set = (
    meshData: MeshProtocol,
    materials: { opaque?: Material; transparent?: Material }
  ) => {
    let { level } = meshData;

    if (!level) {
      level = 0;
    }

    ["opaque", "transparent"].forEach((type) => {
      const data = meshData[type];
      const map = this[type];

      if (!data) {
        const existing = map.get(level);

        if (existing) {
          this.remove(existing);
        }

        return;
      }

      const { positions, indices, uvs, lights } = data;

      // No mesh actually
      if (positions.length === 0 || indices.length === 0) {
        return;
      }

      let mesh = map.get(level) as Mesh;

      if (!mesh) {
        mesh = new Mesh(new BufferGeometry(), materials[type]);
        mesh.name = `${this.chunk.name}-${type}-${level}`;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder =
          type === "opaque" ? OPAQUE_RENDER_ORDER : TRANSPARENT_RENDER_ORDER;
        mesh.frustumCulled = false;
        mesh.position.set(...this.chunk.min);
        mesh.updateMatrix();
        map.set(level, mesh);
      }

      if (!mesh.parent) {
        this.add(mesh);
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
    });
  };

  dispose = () => {
    [this.opaque, this.transparent].forEach((map) => {
      map.forEach((mesh) => {
        mesh.geometry.dispose();
      });
    });
  };

  get isEmpty() {
    return this.opaque.size === 0 && this.transparent.size === 0;
  }
}

class Chunk {
  public mesh: ChunkMesh;

  public name: string;
  public coords: Coords2;

  public min: Coords3;
  public max: Coords3;

  public voxels: NdArray<Uint32Array>;
  public lights: NdArray<Uint32Array>;

  // ms
  public static SUB_MESHING_INTERVAL = 100;

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

    this.mesh = new ChunkMesh(this);
  }

  build = (
    data: ChunkProtocol,
    materials: { opaque?: Material; transparent?: Material }
  ) => {
    const { meshes, lights, voxels } = data;

    if (lights && lights.byteLength) this.lights.data = new Uint32Array(lights);
    if (voxels && voxels.byteLength) this.voxels.data = new Uint32Array(voxels);

    if (meshes) {
      const keepMeshing = (index = 0) => {
        const meshData = meshes[index];
        if (!meshData) return;
        this.mesh.set(meshData, materials);
        if (index + 1 < meshes.length) {
          const timeout = setTimeout(() => {
            keepMeshing(index + 1);
            clearTimeout(timeout);
          }, Chunk.SUB_MESHING_INTERVAL);
        }
      };

      keepMeshing();
    }
  };

  addToScene = (scene: Scene) => {
    if (this.mesh && !this.mesh.isEmpty && !this.mesh.parent) {
      scene.add(this.mesh);
    }
  };

  removeFromScene = (scene: Scene) => {
    if (this.mesh && !this.mesh.isEmpty) {
      scene.remove(this.mesh);
    }
  };

  getRawValue = (vx: number, vy: number, vz: number) => {
    if (!this.contains(vx, vy, vz)) {
      return 0;
    }

    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.voxels.get(lx, ly, lz);
  };

  setRawValue = (vx: number, vy: number, vz: number, val: number) => {
    if (!this.contains(vx, vy, vz)) return 0;
    const [lx, ly, lz] = this.toLocal(vx, vy, vz);
    return this.voxels.set(lx, ly, lz, val);
  };

  setRawLight = (vx: number, vy: number, vz: number, level: number) => {
    if (!this.contains(vx, vy, vz)) return 0;
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
    if (!this.contains(vx, vy, vz)) return new BlockRotation(0, 0);
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
    if (!this.contains(vx, vy, vz)) return 0;
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
    if (!this.contains(vx, vy, vz)) {
      return 0;
    }

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
    if (!this.contains(vx, vy, vz)) {
      return 0;
    }

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
    if (!this.contains(vx, vy, vz)) {
      return 0;
    }

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
    if (!this.contains(vx, vy, vz)) {
      return 0;
    }

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
    this.mesh.dispose();
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
}

export { Chunk, ChunkMesh };
