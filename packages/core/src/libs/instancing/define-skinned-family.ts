import * as THREE from "three";

import type { Entities } from "../../core/entities";

import type { TexelDensity } from "./face-density";
import {
  InstancedEntity,
  InstancedEntityData,
  InstancedEntityOptions,
} from "./instanced-entity";
import type { InstancedEntityRoster } from "./instanced-entity-roster";
import {
  SkinnedFamilyConfig,
  SkinnedInstancePool,
} from "./skinned-instance-pool";
import {
  buildSkinnedPartsGeometry,
  paintSkinnedPartsAtlas,
  SkinnedPart,
} from "./skinned-parts";

/** A {@link SkinnedPart} whose bone is named instead of numbered. */
export type NamedSkinnedPart<TBone extends string> = Omit<
  SkinnedPart,
  "bone"
> & { bone: TBone };

/** What `animate` sees each frame, and how it poses the bones. */
export interface SkinnedPose<
  TBone extends string,
  TData extends InstancedEntityData,
> {
  /** World shader clock, seconds: every client poses idle motion alike. */
  readonly time: number;
  readonly deltaTime: number;
  /** 0 at rest, 1 while travelling, eased between. */
  readonly movement: number;
  /** The latest server metadata. */
  readonly data: TData;
  readonly variant: string;
  readonly isBaby: boolean;
  /** Rotates a bone about its pivot (radians, applied in YXZ order). */
  rotateBone(bone: TBone, x: number, y?: number, z?: number): void;
  /** Sets a bone's full matrix, relative to its pivot. */
  setBone(bone: TBone, matrix: THREE.Matrix4): void;
}

export interface SkinnedFamilyDefinition<
  TVariant extends string,
  TBone extends string,
  TData extends InstancedEntityData,
> {
  /** The entity type the server spawns; also the family's name. */
  type: string;
  variants: readonly TVariant[];
  /** Bone names, in index order. */
  bones: readonly TBone[];
  /** The body of one variant, adult or baby. Index = atlas row. */
  parts: (variant: TVariant, isBaby: boolean) => NamedSkinnedPart<TBone>[];
  /** Whether babies get their own body (`parts(variant, true)`). */
  hasBabies?: boolean;
  /** Texels per block of the painted atlas. */
  density?: TexelDensity;
  /** Poses the bones each frame; a still body when unset. */
  animate?: (pose: SkinnedPose<TBone, TData>) => void;
  /** Anything else the pool takes (material, emissive, ...). */
  config?: Partial<
    Omit<
      SkinnedFamilyConfig<TVariant>,
      "family" | "variants" | "buildGeometry" | "buildTexture"
    >
  >;
}

export interface InstallSkinnedFamilyOptions extends InstancedEntityOptions {
  entities: Entities;
  /** Owns the pool: warms it, advances it, adds it to the scene. */
  roster: InstancedEntityRoster;
  /** Instances per variant (and per baby variant). Defaults to 128. */
  maxPerVariant?: number;
  /** A subclass of the family's `Entity` to register instead. */
  entity?: new (
    id: string,
    pool: SkinnedInstancePool<any>,
    options?: InstancedEntityOptions,
  ) => InstancedEntity<any, any>;
}

export interface SkinnedFamily<
  TVariant extends string,
  TBone extends string,
  TData extends InstancedEntityData,
> {
  readonly type: string;
  /** Bone name to index. */
  readonly bone: Readonly<Record<TBone, number>>;
  /** The pool configuration this definition compiles to. */
  readonly config: SkinnedFamilyConfig<TVariant, THREE.CanvasTexture>;
  /** The entity class `install` registers; subclass it for more control. */
  readonly Entity: new (
    id: string,
    pool: SkinnedInstancePool<TVariant>,
    options?: InstancedEntityOptions,
  ) => InstancedEntity<TData, TVariant>;
  createPool(maxPerVariant?: number): SkinnedInstancePool<TVariant>;
  /**
   * Creates the pool, registers it on the roster, and registers the entity
   * class for `type` on `entities`. Returns the pool.
   */
  install(options: InstallSkinnedFamilyOptions): SkinnedInstancePool<TVariant>;
}

/**
 * Declares a family of GPU-instanced, bone-animated entities in one place:
 * its variants, named bones, a box body per variant, and its animation.
 * The result builds the pool (geometry, painted atlas, skinning, lighting,
 * hit flash, shadows) and the entity class that follows the server stream.
 *
 * @example
 * ```ts
 * const critter = defineSkinnedFamily({
 *   type: "critter",
 *   variants: ["sand", "moss"],
 *   bones: ["body", "head", "legL", "legR"],
 *   parts: (variant) => {
 *     const coat = variant === "sand" ? "#c8a46e" : "#5d7a3a";
 *     return [
 *       { bone: "body", size: [0.5, 0.4, 0.7], at: [0, 0.45, 0], paint: coat },
 *       { bone: "head", size: [0.35, 0.35, 0.35], at: [0, 0.7, 0.45],
 *         pivot: [0, 0.6, 0.3], paint: coat },
 *       { bone: "legL", size: [0.12, 0.25, 0.12], at: [-0.15, 0.125, 0],
 *         pivot: [-0.15, 0.25, 0], paint: "#3b2b1a" },
 *       { bone: "legR", size: [0.12, 0.25, 0.12], at: [0.15, 0.125, 0],
 *         pivot: [0.15, 0.25, 0], paint: "#3b2b1a" },
 *     ];
 *   },
 *   animate: (pose) => {
 *     const swing = Math.sin(pose.time * 8) * 0.6 * pose.movement;
 *     pose.rotateBone("legL", swing);
 *     pose.rotateBone("legR", -swing);
 *     pose.rotateBone("head", Math.sin(pose.time * 1.5) * 0.05);
 *   },
 * });
 *
 * const roster = new InstancedEntityRoster();
 * world.add(roster);
 * critter.install({ entities, roster, world, lightAt: lightShined.lightAt });
 * // per frame: roster.update(deltaTime, renderer)
 * ```
 */
export function defineSkinnedFamily<
  TVariant extends string,
  TBone extends string,
  TData extends InstancedEntityData = InstancedEntityData,
>(
  definition: SkinnedFamilyDefinition<TVariant, TBone, TData>,
): SkinnedFamily<TVariant, TBone, TData> {
  const bone = Object.fromEntries(
    definition.bones.map((name, index) => [name, index]),
  ) as Record<TBone, number>;

  const resolveParts = (variant: TVariant, isBaby: boolean): SkinnedPart[] =>
    definition.parts(variant, isBaby).map((part) => {
      const index = bone[part.bone];
      if (index === undefined) {
        throw new Error(
          `defineSkinnedFamily(${definition.type}): part names bone "${part.bone}", which is not in bones [${definition.bones.join(", ")}]`,
        );
      }
      return { ...part, bone: index };
    });

  const partCount = resolveParts(definition.variants[0], false).length;

  const config: SkinnedFamilyConfig<TVariant, THREE.CanvasTexture> = {
    boneCount: definition.bones.length,
    partCount,
    hasBabies: definition.hasBabies ?? false,
    ...definition.config,
    family: definition.type,
    variants: definition.variants,
    buildGeometry: (variant, isBaby) =>
      buildSkinnedPartsGeometry(resolveParts(variant, isBaby)),
    buildTexture: (variant, isBaby) =>
      paintSkinnedPartsAtlas(resolveParts(variant, isBaby), definition.density),
  };

  const animate = definition.animate;
  const rotation = new THREE.Euler();

  class DefinedEntity extends InstancedEntity<TData, TVariant> {
    private latest: TData | null = null;
    private pose: SkinnedPose<TBone, TData> | null = null;

    protected onData(data: TData): void {
      this.latest = data;
    }

    protected animate(time: number, deltaTime: number): void {
      if (!animate || !this.latest) return;
      const pose = (this.pose ??= this.makePose());
      Object.assign(pose, {
        time,
        deltaTime,
        movement: this.movement,
        data: this.latest,
        variant: this.variant,
        isBaby: this.isBaby,
      });
      animate(pose);
    }

    private makePose(): SkinnedPose<TBone, TData> {
      const matrix = this.boneMatrix;
      return {
        time: 0,
        deltaTime: 0,
        movement: 0,
        data: this.latest as TData,
        variant: this.variant,
        isBaby: this.isBaby,
        rotateBone: (name, x, y = 0, z = 0) => {
          rotation.set(x, y, z, "YXZ");
          this.setBone(bone[name], matrix.makeRotationFromEuler(rotation));
        },
        setBone: (name, boneMatrix) => this.setBone(bone[name], boneMatrix),
      };
    }
  }

  const createPool = (maxPerVariant = 128) =>
    new SkinnedInstancePool<TVariant>(config, maxPerVariant);

  return {
    type: definition.type,
    bone,
    config,
    Entity: DefinedEntity,
    createPool,
    install: ({
      entities,
      roster,
      maxPerVariant,
      entity,
      ...entityOptions
    }) => {
      const pool = roster.register(createPool(maxPerVariant));
      const EntityClass = entity ?? DefinedEntity;
      entities.setClass(
        definition.type,
        (id: string) => new EntityClass(id, pool, entityOptions),
      );
      return pool;
    },
  };
}
