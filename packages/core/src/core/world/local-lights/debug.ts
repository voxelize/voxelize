import {
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  SphereGeometry,
} from "three";

import { LightClusterGrid, MAX_CLUSTERED_LIGHTS } from "./clustering";
import { LIGHT_FLAG_STATIC, LightSourceRegistry } from "./registry";

const STATIC_COLOR = new Color(1.0, 0.7, 0.2);
const DYNAMIC_COLOR = new Color(0.2, 0.8, 1.0);

/**
 * Wireframe range spheres for every clustered light: warm for static block
 * emitters, cyan for dynamic sources. One instanced draw call; buffers are
 * allocated once at the clustered-set ceiling.
 */
export class LocalLightsDebugOverlay {
  readonly object: InstancedMesh;

  private readonly registry: LightSourceRegistry;
  private readonly grid: LightClusterGrid;
  private readonly matrix = new Matrix4();
  private readonly geometry: SphereGeometry;
  private readonly material: MeshBasicMaterial;

  constructor(registry: LightSourceRegistry, grid: LightClusterGrid) {
    this.registry = registry;
    this.grid = grid;
    this.geometry = new SphereGeometry(1, 12, 8);
    this.material = new MeshBasicMaterial({
      wireframe: true,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    this.material.userData.skipShadow = true;
    this.object = new InstancedMesh(
      this.geometry,
      this.material,
      MAX_CLUSTERED_LIGHTS,
    );
    this.object.instanceMatrix.setUsage(DynamicDrawUsage);
    this.object.frustumCulled = false;
    this.object.count = 0;
  }

  update(): void {
    if (!this.object.parent) return;
    const { positions, ranges, flags } = this.registry;
    const selected = this.grid.selectedIndices;
    const count = this.grid.selectedCount;

    for (let rank = 0; rank < count; rank++) {
      const i = selected[rank];
      const range = ranges[i];
      this.matrix.makeScale(range, range, range);
      this.matrix.setPosition(
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2],
      );
      this.object.setMatrixAt(rank, this.matrix);
      this.object.setColorAt(
        rank,
        flags[i] & LIGHT_FLAG_STATIC ? STATIC_COLOR : DYNAMIC_COLOR,
      );
    }
    this.object.count = count;
    this.object.instanceMatrix.needsUpdate = true;
    if (this.object.instanceColor) this.object.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.object.dispose();
  }
}
