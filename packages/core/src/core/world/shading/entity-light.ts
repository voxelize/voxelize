import type { Color, NodeMaterial } from "three/webgpu";
import {
  materialColor,
  output,
  positionWorld,
  vec3,
  vec4,
} from "three/tsl";

import { markLightConesCovered, type LightConeUniforms } from "../light-cones";

import { lightConeShading } from "./light-cones";
import { materialValue, type Vec3Node, type Vec4Node } from "./types";

/** The node inputs an entity material had before the voxel light took it. */
type EntityLightOriginal = {
  colorNode: NodeMaterial["colorNode"];
  outputNode: NodeMaterial["outputNode"];
};

const originals = new WeakMap<NodeMaterial, EntityLightOriginal>();

/**
 * The light an entity material is drawn in: a colour the CPU samples at its
 * owner (LightShined), changed in place. The material holds it
 * (`userData.entityLight`) and its graph reads it per draw.
 */
export type EntityLightValue = { value: Color };

type LitNodes = { colorNode: Vec4Node; outputNode: Vec4Node };

/** Stands for an unset node in the composed graphs' cache. */
const NONE = {};

/** The composed nodes, by cones, then original colour, then output node. */
const composed = new WeakMap<
  LightConeUniforms,
  WeakMap<object, WeakMap<object, LitNodes>>
>();

/**
 * The light composed over a material's own colour and output nodes: one
 * pair per pair of originals, so every material composed over the same
 * nodes (every body part's, every block drop's) shares one graph.
 */
function litNodes(
  original: EntityLightOriginal,
  cones: LightConeUniforms,
): LitNodes {
  let byColor = composed.get(cones);
  if (!byColor) composed.set(cones, (byColor = new WeakMap()));
  const colorKey = original.colorNode ?? NONE;
  let byOutput = byColor.get(colorKey);
  if (!byOutput) byColor.set(colorKey, (byOutput = new WeakMap()));
  const outputKey = original.outputNode ?? NONE;
  const cached = byOutput.get(outputKey);
  if (cached) return cached;

  const shading = lightConeShading(cones);
  const light = materialValue("userData.entityLight.value", "color");
  const base = (original.colorNode ?? materialColor) as unknown as Vec4Node;
  const lit = shading.entityLit(light, positionWorld);
  const finished = (original.outputNode ?? output) as unknown as Vec4Node;
  const nodes: LitNodes = {
    colorNode: vec4(vec3(base.xyz).mul(lit), base.w) as unknown as Vec4Node,
    outputNode: vec4(
      shading.applyScatter(finished.xyz, positionWorld),
      finished.w,
    ) as unknown as Vec4Node,
  };
  byOutput.set(outputKey, nodes);
  return nodes;
}

/**
 * Light an entity's material by the voxel light at its owner (`light`)
 * with the light cones screen-blended in, and draw the beams'
 * in-scattered glow over its finished colour, so a body standing in a beam
 * neither stays dark nor cuts a hole in the shaft. Composes over the
 * material's own colour and output nodes; `restore` hands them back.
 */
export function applyEntityLight(
  material: NodeMaterial,
  light: EntityLightValue,
  cones: LightConeUniforms,
): void {
  const original = originals.get(material) ?? {
    colorNode: material.colorNode,
    outputNode: material.outputNode,
  };
  originals.set(material, original);

  const nodes = litNodes(original, cones);
  material.userData.entityLight = light;
  material.colorNode = nodes.colorNode as unknown as NodeMaterial["colorNode"];
  material.outputNode = nodes.outputNode as unknown as NodeMaterial["outputNode"];
  markLightConesCovered(material);
  material.needsUpdate = true;
}

/** Undo {@link applyEntityLight}: the material's own nodes back. */
export function restoreEntityLight(material: NodeMaterial): void {
  const original = originals.get(material);
  if (!original) return;
  material.colorNode = original.colorNode;
  material.outputNode = original.outputNode;
  originals.delete(material);
  material.needsUpdate = true;
}

/** The colour and output nodes `material` had before the voxel light. */
export function entityLightOriginalOf(
  material: NodeMaterial,
): EntityLightOriginal | null {
  return originals.get(material) ?? null;
}
