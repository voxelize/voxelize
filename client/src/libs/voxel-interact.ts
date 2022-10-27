import { AABB } from "@voxelize/aabb";
import { raycast } from "@voxelize/raycast";
import {
  ArrowHelper,
  BoxGeometry,
  Color,
  CylinderBufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Vector3,
} from "three";
import { Coords3 } from "types";

import {
  NX_ROTATION,
  NY_ROTATION,
  NZ_ROTATION,
  PX_ROTATION,
  PY_ROTATION,
  PZ_ROTATION,
  World,
  Y_ROT_MAP,
} from "../core/world";
import { ChunkUtils, MathUtils } from "../utils";

export type VoxelInteractParams = {
  reachDistance: number;
  ignoreFluid: boolean;
  highlightScale: number;
  highlightType: "box" | "lines";
  highlightLerp: number;
  highlightColor: Color;
  highlightOpacity: number;
  potentialVisuals: boolean;
};

const defaultParams: VoxelInteractParams = {
  reachDistance: 32,
  ignoreFluid: true,
  highlightType: "box",
  highlightScale: 1.002,
  highlightLerp: 0.8,
  highlightColor: new Color("white"),
  highlightOpacity: 0.1,
  potentialVisuals: false,
};

export class VoxelInteract extends Group {
  public params: VoxelInteractParams;

  public potential: {
    voxel: Coords3;
    rotation: number;
    yRotation: number;
  } | null = {
    voxel: [0, 0, 0],
    rotation: PY_ROTATION,
    yRotation: 0,
  };

  public target: Coords3 | null = [0, 0, 0];

  private newTargetScale = new Vector3();
  private newTargetPosition = new Vector3();

  private targetGroup = new Group();
  private potentialGroup = new Group();

  private potentialArrow: ArrowHelper;
  private yRotArrow: ArrowHelper;

  constructor(
    public object: Object3D,
    public camera: PerspectiveCamera,
    public world: World,
    params: Partial<VoxelInteractParams> = {}
  ) {
    super();

    const { potentialVisuals } = (this.params = {
      ...defaultParams,
      ...params,
    });

    this.setup();

    this.add(this.targetGroup, this.potentialGroup);
    this.potentialGroup.visible = potentialVisuals;
  }

  toggle = (force = null) => {
    this.visible = force !== null ? force : !this.visible;
    this.potential = null;
    this.target = null;
  };

  update = () => {
    const { reachDistance, highlightScale } = this.params;

    this.targetGroup.scale.lerp(this.newTargetScale, this.params.highlightLerp);
    this.targetGroup.position.lerp(
      this.newTargetPosition,
      this.params.highlightLerp
    );

    const camDir = new Vector3();
    const objPos = this.object.position;
    this.camera.getWorldDirection(camDir);
    camDir.normalize();

    const result = raycast(
      (wx, wy, wz) => {
        const [vx, vy, vz] = ChunkUtils.mapWorldPosToVoxelPos([wx, wy, wz]);
        const id = this.world.getVoxelByVoxel(vx, vy, vz);
        const { aabbs, isFluid } = this.world.getBlockById(id);

        if (this.params.ignoreFluid && isFluid) {
          return [];
        }

        const rotation = this.world.getVoxelRotationByVoxel(vx, vy, vz);
        return aabbs.map((aabb) => rotation.rotateAABB(aabb));
      },
      [objPos.x, objPos.y, objPos.z],
      [camDir.x, camDir.y, camDir.z],
      reachDistance
    );

    // No target.
    if (!result) {
      this.toggle(false);
      return;
    }

    const { voxel, normal } = result;

    const [nx, ny, nz] = normal;
    const newTarget = ChunkUtils.mapWorldPosToVoxelPos(<Coords3>voxel);

    // Pointing at air.
    const newLookingID = this.world.getVoxelByVoxel(...newTarget);
    if (newLookingID === 0) {
      this.toggle(false);
      return;
    }

    this.visible = true;
    this.target = newTarget;

    const { lookingAt } = this;

    if (lookingAt && this.target) {
      const { aabbs } = lookingAt;
      if (!aabbs.length) return;

      const rotation = this.world.getVoxelRotationByVoxel(...this.target);

      let union: AABB = rotation.rotateAABB(aabbs[0]);

      for (let i = 1; i < aabbs.length; i++) {
        const aabb = rotation.rotateAABB(aabbs[i]);
        union = union.union(aabb);
      }

      union.translate(this.target);

      let { width, height, depth } = union;

      width *= highlightScale;
      height *= highlightScale;
      depth *= highlightScale;

      this.newTargetScale.set(width, height, depth);
      this.newTargetPosition.set(union.minX, union.minY, union.minZ);
    }

    const targetVoxel = [
      this.target[0] + nx,
      this.target[1] + ny,
      this.target[2] + nz,
    ] as Coords3;

    // target block is look block summed with the normal
    const rotation =
      nx !== 0
        ? nx > 0
          ? PX_ROTATION
          : NX_ROTATION
        : ny !== 0
        ? ny > 0
          ? PY_ROTATION
          : NY_ROTATION
        : nz !== 0
        ? nz > 0
          ? PZ_ROTATION
          : NZ_ROTATION
        : 0;

    const yRotation = (() => {
      if (Math.abs(ny) !== 0) {
        this.yRotArrow.visible = true;

        const [vx, vy, vz] = [objPos.x, objPos.y, objPos.z];

        const [tx, ty, tz] = [
          targetVoxel[0] + 0.5,
          targetVoxel[1] + 0.5,
          targetVoxel[2] + 0.5,
        ];

        let angle =
          vy >= ty
            ? ny > 0
              ? Math.atan2(vx - tx, vz - tz)
              : Math.atan2(vz - tz, vx - tx)
            : ny > 0
            ? Math.atan2(tz - vz, tx - vx)
            : Math.atan2(tx - vx, tz - vz);
        if (ny < 0) angle += Math.PI;
        const normalized = MathUtils.normalizeAngle(angle);

        let min = Infinity;
        let closest: number;
        let closestA: number;

        Y_ROT_MAP.forEach(([a, yRot]) => {
          if (Math.abs(normalized - a) < min) {
            min = Math.abs(normalized - a);
            closest = yRot;
            closestA = a;
          }
        });

        const x = Math.sin(closestA);
        const z = Math.cos(closestA);
        this.yRotArrow.setDirection(new Vector3(x, 0, z).normalize());
        return closest;
      }

      this.yRotArrow.visible = false;
      return 0;
    })();

    this.potential = {
      voxel: targetVoxel,
      rotation: rotation,
      yRotation,
      // lookingAt.rotatable ? closest : undefined,
    };

    if (this.potential) {
      this.potentialGroup.position.set(
        this.potential.voxel[0] + 0.5,
        this.potential.voxel[1] + 0.5,
        this.potential.voxel[2] + 0.5
      );
      this.potentialArrow.setDirection(new Vector3(nx, ny, nz));
    }
  };

  get lookingAt() {
    if (this.target) {
      return this.world.getBlockByVoxel(
        this.target[0],
        this.target[1],
        this.target[2]
      );
    }

    return null;
  }

  private setup = () => {
    const { highlightType, highlightScale, highlightColor, highlightOpacity } =
      this.params;

    const mat = new MeshBasicMaterial({
      color: new Color(highlightColor),
      opacity: highlightOpacity,
      transparent: true,
    });

    if (highlightType === "lines") {
      const w = 0.01;
      const dim = highlightScale;
      const side = new Mesh(new BoxGeometry(dim, w, w), mat);

      for (let i = -1; i <= 1; i += 2) {
        for (let j = -1; j <= 1; j += 2) {
          const temp = side.clone();

          temp.position.y = ((dim - w) / 2) * i;
          temp.position.z = ((dim - w) / 2) * j;

          this.targetGroup.add(temp);
        }
      }

      for (let i = -1; i <= 1; i += 2) {
        for (let j = -1; j <= 1; j += 2) {
          const temp = side.clone();

          temp.position.z = ((dim - w) / 2) * i;
          temp.position.x = ((dim - w) / 2) * j;
          temp.rotation.z = Math.PI / 2;

          this.targetGroup.add(temp);
        }
      }

      for (let i = -1; i <= 1; i += 2) {
        for (let j = -1; j <= 1; j += 2) {
          const temp = side.clone();

          temp.position.x = ((dim - w) / 2) * i;
          temp.position.y = ((dim - w) / 2) * j;
          temp.rotation.y = Math.PI / 2;

          this.targetGroup.add(temp);
        }
      }

      const offset = new Vector3(0.5, 0.5, 0.5);

      this.children.forEach((child) => {
        child.position.add(offset);
      });
    } else if (highlightType === "box") {
      const box = new Mesh(
        new BoxGeometry(highlightScale, highlightScale, highlightScale),
        mat
      );

      box.position.x += 0.5;
      box.position.y += 0.5;
      box.position.z += 0.5;

      this.targetGroup.add(box);
    } else {
      throw new Error("Invalid highlight type");
    }

    const createArrow = (color: string) => {
      const arrow = new ArrowHelper(new Vector3(1, 0, 0), new Vector3());

      [...arrow.children].forEach((child) => arrow.remove(child));

      arrow.add(
        new Mesh(
          new CylinderBufferGeometry(0.1, 0.1, 0.8),
          new MeshBasicMaterial({ color })
        )
      );

      const cone = new Mesh(
        new CylinderBufferGeometry(0, 0.2, 0.2),
        new MeshBasicMaterial({ color })
      );
      cone.position.y = 0.5;
      arrow.add(cone);

      return arrow;
    };

    this.potentialArrow = createArrow("red");
    this.yRotArrow = createArrow("green");

    this.potentialGroup.add(this.potentialArrow, this.yRotArrow);

    this.targetGroup.frustumCulled = false;
    this.targetGroup.renderOrder = 1000000;
  };
}
