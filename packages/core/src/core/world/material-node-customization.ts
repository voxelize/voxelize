import { Vector2 } from "three";
import { uniform } from "three/tsl";
import type { Node, ShaderNodeObject } from "three/tsl";
import type { MeshBasicNodeMaterial } from "three/webgpu";

import { createSwayPositionNode } from "./sway-nodes";

type NodeTransform = (
  baseNode: ShaderNodeObject<Node>,
) => ShaderNodeObject<Node>;

export interface MaterialNodeOverrides {
  positionNode?: NodeTransform;
  colorNode?: NodeTransform;
  outputNode?: NodeTransform;
  opacityNode?: NodeTransform;
}

const buildOverrideKey = (
  blockIdOrName: string,
  faceName: string | null,
): string => `${blockIdOrName}:${faceName ?? "*"}`;

const applyNodeTransform = (
  baseNode: MeshBasicNodeMaterial["positionNode"],
  transform?: NodeTransform,
): ShaderNodeObject<Node> | null => {
  if (!baseNode || !transform) {
    return baseNode as ShaderNodeObject<Node> | null;
  }

  return transform(baseNode as ShaderNodeObject<Node>);
};

export class MaterialNodeRegistry {
  private overrides = new Map<string, MaterialNodeOverrides>();

  register(
    blockIdOrName: string,
    faceName: string | null,
    overrides: MaterialNodeOverrides,
  ): void {
    this.overrides.set(buildOverrideKey(blockIdOrName, faceName), overrides);
  }

  getOverrides(
    blockId: string,
    faceName: string | null,
  ): MaterialNodeOverrides | undefined {
    const baseOverrides = this.overrides.get(buildOverrideKey(blockId, null));
    const faceOverrides =
      faceName === null
        ? undefined
        : this.overrides.get(buildOverrideKey(blockId, faceName));

    if (!baseOverrides && !faceOverrides) {
      return undefined;
    }

    return {
      ...baseOverrides,
      ...faceOverrides,
    };
  }

  applyOverrides(
    material: MeshBasicNodeMaterial,
    blockId: string,
    faceName: string | null,
  ): void {
    const overrides = this.getOverrides(blockId, faceName);

    if (!overrides) {
      return;
    }

    let didApply = false;

    if (overrides.positionNode) {
      material.positionNode = applyNodeTransform(
        material.positionNode,
        overrides.positionNode,
      );
      didApply = true;
    }

    if (overrides.colorNode) {
      material.colorNode = applyNodeTransform(
        material.colorNode,
        overrides.colorNode,
      );
      didApply = true;
    }

    if (overrides.outputNode) {
      material.outputNode = applyNodeTransform(
        material.outputNode,
        overrides.outputNode,
      );
      didApply = true;
    }

    if (overrides.opacityNode) {
      material.opacityNode = applyNodeTransform(
        material.opacityNode,
        overrides.opacityNode,
      );
      didApply = true;
    }

    if (didApply) {
      material.needsUpdate = true;
    }
  }
}

type SwayNodeOverridesOptions = Partial<
  Omit<Parameters<typeof createSwayPositionNode>[0], "position">
>;

const createSwayNodeOverrides = (
  options: SwayNodeOverridesOptions = {},
): MaterialNodeOverrides => {
  const time = options.time ?? uniform(0);
  const windDirection = options.windDirection ?? uniform(new Vector2(1, 0));
  const windSpeed = options.windSpeed ?? uniform(1);

  return {
    positionNode: (base) =>
      createSwayPositionNode({
        position: base,
        time,
        windDirection,
        windSpeed,
        options: options.options,
      }),
  };
};

export const customNodes = {
  sway(options: SwayNodeOverridesOptions = {}): MaterialNodeOverrides {
    return createSwayNodeOverrides(options);
  },
  swayCross(options: SwayNodeOverridesOptions = {}): MaterialNodeOverrides {
    return createSwayNodeOverrides(options);
  },
};
