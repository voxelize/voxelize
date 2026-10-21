import * as THREE from "three";

import { ShaderLightingUniforms } from "../../core/world/chunk-renderer";
import { updateEntityShadowUniforms } from "../../core/world/entity-shadow-uniforms";

import { BoneTextureManager } from "./bone-texture-manager";
import { atlasSurface, EntitySurfaceOptions } from "./entity-surface";
import { writeInstanceColor, writeInstanceMatrix } from "./instance-write";
import {
  EntityFaceShades,
  InstancedSkinnedDepthMaterial,
  InstancedSkinnedMaterial,
  InstancedSkinnedMaterialOptions,
} from "./instanced-skinned-material";
import { measureLegLength } from "./leg-length";
import { measureMeshTop } from "./mesh-top";
import {
  noteLazyBake,
  peekNextRosterEntry,
  warmableRosterCount,
  warmNextRosterEntry,
} from "./pool-warmup";

/// Where a pool gets each variant's texture. The default builds it and the
/// pool owns it; a game with a persistent atlas cache (painted once, restored
/// on later visits) plugs that in and keeps ownership.
export interface SkinnedTextureSource {
  acquire(
    family: string,
    variant: string,
    isBaby: boolean,
    build: () => THREE.Texture,
  ): THREE.Texture;
  /// The key `isVariantReady` is asked about during the roster warmup.
  key(family: string, variant: string, isBaby: boolean): string;
  /// True when the pool disposes what `acquire` returned.
  isPoolOwned: boolean;
}

export const ownedTextureSource: SkinnedTextureSource = {
  acquire: (_family, _variant, _isBaby, build) => build(),
  key: (family, variant, isBaby) =>
    isBaby ? `${family}:${variant}:baby` : `${family}:${variant}`,
  isPoolOwned: true,
};

let defaultTextureSource: SkinnedTextureSource = ownedTextureSource;

/// The texture source every pool uses unless its family names one. Set once,
/// before the first pool is built.
export function setDefaultSkinnedTextureSource(
  source: SkinnedTextureSource,
): void {
  defaultTextureSource = source;
}

/**
 * One family of GPU-instanced, bone-skinned entities: its variants, its
 * rig, and how to build each variant's geometry and texture. Adding a
 * variant is a row in `variants`; adding a family is one of these and a
 * {@link SkinnedInstancePool} over it.
 *
 * Geometry is one box per part, every vertex carrying `skinIndex` /
 * `skinWeight` (its bone), `pivotOffset` (the bone's pivot) and `partIndex`
 * (its row in the part atlas); see `buildSkinnedParts` for a builder that
 * writes all of them from a part list.
 */
export interface SkinnedFamilyConfig<
  TVariant extends string = string,
  TTexture extends THREE.Texture = THREE.Texture,
> {
  family: string;
  variants: readonly TVariant[];
  /// Bones per instance, or per variant when variants differ in shape.
  boneCount: number | ((variant: TVariant) => number);
  partCount: number;
  hasBabies: boolean;
  buildGeometry: (variant: TVariant, isBaby: boolean) => THREE.BufferGeometry;
  buildTexture: (variant: TVariant, isBaby: boolean) => TTexture;
  /// Variants outside the warmup roster that the family can still bake on
  /// first sight. Anything else stays unrendered, so a malformed key can
  /// never mint a pool.
  isBakeableVariant?: (variant: string) => boolean;
  /// How the material reads the art; a part atlas when unset.
  surface?: (variant: TVariant, isBaby: boolean) => EntitySurfaceOptions;
  /// Material options past the defaults (opaque, double-sided, shadowed).
  material?: (
    variant: TVariant,
    isBaby: boolean,
  ) => Partial<InstancedSkinnedMaterialOptions>;
  /// Whether the variant's empty texels cast no shadow. Only for surfaces
  /// whose UVs address the texture directly.
  hasAlphaCutShadow?: (variant: TVariant) => boolean;
  /// Gives each variant an `instanceEmissive` attribute, seeded with this
  /// value per slot (see `emissiveFace`); `setEmissive` changes it.
  emissive?: (variant: TVariant, isBaby: boolean) => number;
  /// Family-specific rig facts, merged over the measured ones.
  rigInfo?: (
    variant: TVariant,
    isBaby: boolean,
    measured: SkinnedRigInfo,
  ) => object;
  /// Peak of the red hit flash, mixed in after lighting. Defaults to 0.5.
  hitEffectIntensity?: number;
  faceShades?: EntityFaceShades;
  textureSource?: SkinnedTextureSource;
}

/// Bones per instance of `variant`.
export function familyBoneCount<TVariant extends string>(
  config: Pick<SkinnedFamilyConfig<TVariant>, "boneCount">,
  variant: TVariant,
): number {
  return typeof config.boneCount === "function"
    ? config.boneCount(variant)
    : config.boneCount;
}

export interface SkinnedRigInfo {
  type: string;
  boneCount: number;
  /// Hip-to-sole length of the drawn legs, mesh units (leg-length.ts).
  legLength: number | null;
  /// Tallest point of the drawn mesh above the origin, mesh units
  /// (mesh-top.ts).
  meshTop: number | null;
}

interface InstanceSlot {
  localIndex: number;
  boneOffset: number;
  hitEffect: number;
  hitEffectDecayStart: number;
}

interface VariantPool {
  key: string;
  variant: string;
  mesh: THREE.InstancedMesh;
  material: InstancedSkinnedMaterial;
  depthMaterial: InstancedSkinnedDepthMaterial;
  boneManager: BoneTextureManager;
  geometry: THREE.BufferGeometry;
  texture: THREE.Texture;
  rigInfo: SkinnedRigInfo;
  slots: Map<number, InstanceSlot>;
  freeIndices: number[];
  instanceBoneOffsetAttr: THREE.InstancedBufferAttribute;
  instanceHitEffectAttr: THREE.InstancedBufferAttribute;
  instanceLightColorAttr: THREE.InstancedBufferAttribute;
  instanceEmissiveAttr: THREE.InstancedBufferAttribute | null;
  emissiveDefault: number;
}

const HIT_EFFECT_DURATION_MS = 300;
const DEFAULT_HIT_EFFECT_INTENSITY = 0.5;

/**
 * Renders every live instance of a {@link SkinnedFamilyConfig}: one
 * `InstancedMesh` per variant (and per baby variant), skinned on the GPU from
 * a flat bone texture, lit per instance, flashed red on a hit, and shadowed.
 *
 * Instances are addressed by the global slot `allocate` returns. Per frame:
 * `setInstanceMatrix` (the root transform), `setBoneMatrix` /
 * `setBoneMatrices` (each bone relative to its pivot), and
 * `setInstanceLightColor` (the voxel light at the instance). Writes that do
 * not change anything upload nothing.
 *
 * Implements `WarmablePool`, so an {@link InstancedEntityRoster} bakes every
 * variant before play begins.
 */
export class SkinnedInstancePool<
  TVariant extends string = string,
  TInfo extends SkinnedRigInfo = SkinnedRigInfo,
> extends THREE.Group {
  readonly config: SkinnedFamilyConfig<TVariant, THREE.Texture>;

  private variantPools: Map<string, VariantPool> = new Map();
  private globalSlotToVariant: Map<
    number,
    { key: string; localIndex: number }
  > = new Map();
  private nextGlobalSlot = 0;
  private maxInstancesPerVariant: number;
  private variants: Set<string>;
  private textureSource: SkinnedTextureSource;
  private hitEffectIntensity: number;
  private warnedFullKeys = new Set<string>();

  private zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

  /// The lighting the pools were last shown. A variant baked mid-session
  /// has missed every `updateShadowUniforms` so far, so it is caught up at
  /// birth rather than rendering its first frame with the material's
  /// unlit defaults.
  private lightingUniforms: ShaderLightingUniforms | null = null;

  constructor(
    config: SkinnedFamilyConfig<TVariant>,
    maxInstancesPerVariant: number = 100,
  ) {
    super();
    this.config = config;
    this.name = config.family;
    this.variants = new Set(config.variants);
    this.maxInstancesPerVariant = maxInstancesPerVariant;
    this.textureSource = config.textureSource ?? defaultTextureSource;
    this.hitEffectIntensity =
      config.hitEffectIntensity ?? DEFAULT_HIT_EFFECT_INTENSITY;
  }

  private poolKey(variant: string, isBaby: boolean): string {
    return isBaby ? `${variant}:baby` : variant;
  }

  /// A family without babies serves its adult pool to baby callers, so the
  /// baby flag is resolved against the config before it reaches a key.
  private getOrCreateVariantPool(
    variant: string,
    isBaby: boolean,
  ): VariantPool | undefined {
    const resolvedBaby = isBaby && this.config.hasBabies;
    const existing = this.variantPools.get(this.poolKey(variant, resolvedBaby));
    if (existing) return existing;
    if (
      !this.variants.has(variant) &&
      !this.config.isBakeableVariant?.(variant)
    ) {
      return undefined;
    }
    noteLazyBake(this.config.family, variant);
    return this.initializeVariantPool(variant as TVariant, resolvedBaby);
  }

  warmNextVariant(): boolean {
    return warmNextRosterEntry(
      this.config.variants,
      this.config.hasBabies,
      (variant, isBaby) => this.variantPools.has(this.poolKey(variant, isBaby)),
      (variant, isBaby) => this.initializeVariantPool(variant, isBaby),
    );
  }

  peekNextVariantKey(): string | null {
    const next = peekNextRosterEntry(
      this.config.variants,
      this.config.hasBabies,
      (variant, isBaby) => this.variantPools.has(this.poolKey(variant, isBaby)),
    );
    return (
      next && this.textureSource.key(this.config.family, next.type, next.baby)
    );
  }

  warmableVariantCount(): number {
    return warmableRosterCount(this.config.variants, this.config.hasBabies);
  }

  private initializeVariantPool(
    variant: TVariant,
    isBaby: boolean,
  ): VariantPool {
    const config = this.config;
    const max = this.maxInstancesPerVariant;
    const boneCount = familyBoneCount(config, variant);
    const key = this.poolKey(variant, isBaby);

    const geometry = config.buildGeometry(variant, isBaby);
    const measured: SkinnedRigInfo = {
      type: variant,
      boneCount,
      legLength: measureLegLength(geometry),
      meshTop: measureMeshTop(geometry),
    };
    const rigInfo = config.rigInfo
      ? { ...measured, ...config.rigInfo(variant, isBaby, measured) }
      : measured;
    const texture = this.textureSource.acquire(
      config.family,
      variant,
      isBaby,
      () => config.buildTexture(variant, isBaby),
    );

    const boneManager = new BoneTextureManager(max, boneCount);

    const material = new InstancedSkinnedMaterial(
      boneManager.getTexture(),
      boneManager.getWidth(),
      boneManager.getHeight(),
      boneCount,
      {
        map: texture,
        transparent: false,
        opacity: 1.0,
        side: THREE.DoubleSide,
        depthWrite: true,
        ...(config.surface?.(variant, isBaby) ??
          atlasSurface(config.partCount)),
        receiveShadows: true,
        ...(config.faceShades ? { faceShades: config.faceShades } : {}),
        ...config.material?.(variant, isBaby),
      },
    );

    if (this.lightingUniforms) {
      updateEntityShadowUniforms(
        material.shadowUniforms,
        this.lightingUniforms,
      );
    }

    const mesh = new THREE.InstancedMesh(geometry, material, max);
    mesh.name = `${config.family}:${key}`;
    mesh.frustumCulled = false;
    mesh.count = 0;

    const depthMaterial = new InstancedSkinnedDepthMaterial(
      boneManager.getTexture(),
      boneManager.getWidth(),
      boneManager.getHeight(),
      config.hasAlphaCutShadow?.(variant) ? texture : undefined,
    );
    mesh.customDepthMaterial = depthMaterial;
    mesh.castShadow = true;

    for (let i = 0; i < max; i++) {
      mesh.setMatrixAt(i, this.zeroMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;

    const boneOffsets = new Float32Array(max);
    const hitEffects = new Float32Array(max);
    const lightColors = new Float32Array(max * 3);

    for (let i = 0; i < max; i++) {
      boneOffsets[i] = i * boneCount;
      lightColors[i * 3] = 1;
      lightColors[i * 3 + 1] = 1;
      lightColors[i * 3 + 2] = 1;
    }

    const instanceBoneOffsetAttr = new THREE.InstancedBufferAttribute(
      boneOffsets,
      1,
    );
    const instanceHitEffectAttr = new THREE.InstancedBufferAttribute(
      hitEffects,
      1,
    );
    const instanceLightColorAttr = new THREE.InstancedBufferAttribute(
      lightColors,
      3,
    );

    geometry.setAttribute("instanceBoneOffset", instanceBoneOffsetAttr);
    geometry.setAttribute("instanceHitEffect", instanceHitEffectAttr);
    geometry.setAttribute("instanceLightColor", instanceLightColorAttr);

    const emissiveDefault = config.emissive?.(variant, isBaby) ?? 0;
    let instanceEmissiveAttr: THREE.InstancedBufferAttribute | null = null;
    if (config.emissive) {
      instanceEmissiveAttr = new THREE.InstancedBufferAttribute(
        new Float32Array(max).fill(emissiveDefault),
        1,
      );
      geometry.setAttribute("instanceEmissive", instanceEmissiveAttr);
    }

    const freeIndices: number[] = [];
    for (let i = max - 1; i >= 0; i--) {
      freeIndices.push(i);
    }

    const pool: VariantPool = {
      key,
      variant,
      mesh,
      material,
      depthMaterial,
      boneManager,
      geometry,
      texture,
      rigInfo,
      slots: new Map(),
      freeIndices,
      instanceBoneOffsetAttr,
      instanceHitEffectAttr,
      instanceLightColorAttr,
      instanceEmissiveAttr,
      emissiveDefault,
    };

    this.variantPools.set(key, pool);
    this.add(mesh);

    return pool;
  }

  /// A slot for one instance of `variant`, or -1 when the variant is unknown
  /// or its pool is full.
  allocate(variant: TVariant, isBaby: boolean = false): number {
    const pool = this.getOrCreateVariantPool(variant, isBaby);
    if (!pool) return -1;
    if (pool.freeIndices.length === 0) {
      this.warnFull(pool.key);
      return -1;
    }

    const localIndex = pool.freeIndices.pop()!;
    const boneOffset = pool.boneManager.allocate();

    if (boneOffset === -1) {
      pool.freeIndices.push(localIndex);
      this.warnFull(pool.key);
      return -1;
    }

    const slot: InstanceSlot = {
      localIndex,
      boneOffset,
      hitEffect: 0,
      hitEffectDecayStart: 0,
    };

    pool.slots.set(localIndex, slot);

    pool.instanceBoneOffsetAttr.setX(
      localIndex,
      boneOffset * pool.rigInfo.boneCount,
    );
    pool.instanceBoneOffsetAttr.needsUpdate = true;

    pool.mesh.count = Math.max(pool.mesh.count, localIndex + 1);

    const globalSlot = this.nextGlobalSlot++;
    this.globalSlotToVariant.set(globalSlot, { key: pool.key, localIndex });

    return globalSlot;
  }

  free(globalSlot: number): void {
    const mapping = this.globalSlotToVariant.get(globalSlot);
    if (!mapping) return;

    const { key, localIndex } = mapping;
    const pool = this.variantPools.get(key);
    if (!pool) return;

    const slot = pool.slots.get(localIndex);
    if (!slot) return;

    pool.boneManager.free(slot.boneOffset);
    pool.slots.delete(localIndex);
    pool.freeIndices.push(localIndex);

    pool.mesh.setMatrixAt(localIndex, this.zeroMatrix);
    pool.mesh.instanceMatrix.needsUpdate = true;

    pool.instanceHitEffectAttr.setX(localIndex, 0);
    pool.instanceHitEffectAttr.needsUpdate = true;

    if (pool.instanceEmissiveAttr) {
      pool.instanceEmissiveAttr.setX(localIndex, pool.emissiveDefault);
      pool.instanceEmissiveAttr.needsUpdate = true;
    }

    this.updateMeshCount(pool);
    this.globalSlotToVariant.delete(globalSlot);
  }

  private warnFull(key: string): void {
    if (this.warnedFullKeys.has(key)) return;
    this.warnedFullKeys.add(key);
    console.warn(
      `SkinnedInstancePool(${this.config.family}): no free slots for ${key}`,
    );
  }

  private updateMeshCount(pool: VariantPool): void {
    let maxUsedIndex = -1;
    for (const [index] of pool.slots) {
      if (index > maxUsedIndex) maxUsedIndex = index;
    }
    pool.mesh.count = maxUsedIndex + 1;
  }

  private resolve(
    globalSlot: number,
  ): { pool: VariantPool; slot: InstanceSlot } | null {
    const mapping = this.globalSlotToVariant.get(globalSlot);
    if (!mapping) return null;
    const pool = this.variantPools.get(mapping.key);
    if (!pool) return null;
    const slot = pool.slots.get(mapping.localIndex);
    if (!slot) return null;
    return { pool, slot };
  }

  setInstanceMatrix(globalSlot: number, matrix: THREE.Matrix4): void {
    const resolved = this.resolve(globalSlot);
    if (!resolved) return;
    writeInstanceMatrix(resolved.pool.mesh, resolved.slot.localIndex, matrix);
  }

  setBoneMatrix(
    globalSlot: number,
    boneIndex: number,
    matrix: THREE.Matrix4,
  ): void {
    const resolved = this.resolve(globalSlot);
    if (!resolved) return;
    resolved.pool.boneManager.setBoneMatrix(
      resolved.slot.boneOffset,
      boneIndex,
      matrix,
    );
  }

  /// Every bone of one instance in a single slot lookup.
  setBoneMatrices(globalSlot: number, matrices: THREE.Matrix4[]): void {
    const resolved = this.resolve(globalSlot);
    if (!resolved) return;
    const { pool, slot } = resolved;
    for (let bone = 0; bone < matrices.length; bone++) {
      pool.boneManager.setBoneMatrix(slot.boneOffset, bone, matrices[bone]);
    }
  }

  markHit(globalSlot: number): void {
    const resolved = this.resolve(globalSlot);
    if (!resolved) return;
    resolved.slot.hitEffect = this.hitEffectIntensity;
    resolved.slot.hitEffectDecayStart = performance.now();
  }

  setInstanceLightColor(
    globalSlot: number,
    r: number,
    g: number,
    b: number,
  ): void {
    const resolved = this.resolve(globalSlot);
    if (!resolved) return;
    writeInstanceColor(
      resolved.pool.instanceLightColorAttr,
      resolved.slot.localIndex,
      r,
      g,
      b,
    );
  }

  /// Lights the family's emissive face on one instance (config `emissive`).
  setEmissive(globalSlot: number, value: number): void {
    const resolved = this.resolve(globalSlot);
    const attr = resolved?.pool.instanceEmissiveAttr;
    if (!resolved || !attr) return;
    const index = resolved.slot.localIndex;
    if (attr.getX(index) === value) return;
    attr.setX(index, value);
    attr.needsUpdate = true;
  }

  update(_deltaTime: number, renderer: THREE.WebGLRenderer): void {
    const now = performance.now();

    for (const pool of this.variantPools.values()) {
      let isHitEffectDirty = false;
      for (const [localIndex, slot] of pool.slots) {
        if (slot.hitEffect > 0) {
          const elapsed = now - slot.hitEffectDecayStart;
          if (elapsed >= HIT_EFFECT_DURATION_MS) {
            slot.hitEffect = 0;
          } else {
            slot.hitEffect =
              this.hitEffectIntensity * (1 - elapsed / HIT_EFFECT_DURATION_MS);
          }
          pool.instanceHitEffectAttr.setX(localIndex, slot.hitEffect);
          isHitEffectDirty = true;
        }
      }

      if (isHitEffectDirty) pool.instanceHitEffectAttr.needsUpdate = true;
      pool.boneManager.upload(renderer);
      pool.material.setTime(now * 0.001);
    }
  }

  /// What the family's `rigInfo` adds, over the measured facts.
  getRigInfo(variant: TVariant, isBaby: boolean = false): TInfo | undefined {
    return this.getOrCreateVariantPool(variant, isBaby)?.rigInfo as
      | TInfo
      | undefined;
  }

  /// The variant a live slot was allocated as (its pool key: `variant`, or
  /// `variant:baby`).
  getInstanceType(globalSlot: number): string | undefined {
    return this.globalSlotToVariant.get(globalSlot)?.key;
  }

  getActiveCount(): number {
    let count = 0;
    for (const pool of this.variantPools.values()) {
      count += pool.slots.size;
    }
    return count;
  }

  /// The baked variant pools' meshes, keyed like `getInstanceType`.
  listVariantMeshes(): Map<string, THREE.InstancedMesh> {
    const meshes = new Map<string, THREE.InstancedMesh>();
    for (const pool of this.variantPools.values()) {
      meshes.set(pool.key, pool.mesh);
    }
    return meshes;
  }

  updateShadowUniforms(lightingUniforms: ShaderLightingUniforms): void {
    this.lightingUniforms = lightingUniforms;

    for (const pool of this.variantPools.values()) {
      updateEntityShadowUniforms(
        pool.material.shadowUniforms,
        lightingUniforms,
      );
    }
  }

  dispose(): void {
    for (const pool of this.variantPools.values()) {
      pool.geometry.dispose();
      pool.material.dispose();
      pool.depthMaterial.dispose();
      pool.boneManager.dispose();
      if (this.textureSource.isPoolOwned) pool.texture.dispose();
    }
    this.variantPools.clear();
    this.globalSlotToVariant.clear();
  }
}
