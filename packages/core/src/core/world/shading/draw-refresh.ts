import type { Material, Matrix4, Node, Object3D } from "three/webgpu";
import { modelNormalMatrix, modelWorldMatrixInverse } from "three/tsl";

/*
 * Per-draw refresh for node materials whose per-object inputs are known.
 *
 * three refreshes a node material's per-object bindings on every draw (its
 * observer cannot tell what a node reads): every per-object node runs and
 * every per-object uniform buffer is compared again, ~3 µs a draw, the
 * largest part of what a draw costs on the CPU. A chunk mesh's per-object
 * inputs are few and checkable: its world matrix, the material values its
 * graph reads (`materialValue`, `materialTexture`), the textures it binds
 * and its geometry's attributes. This observer refreshes a draw fully only
 * when one of them changed since that render object last drew, and
 * otherwise as three does for a static draw (the shared groups once a
 * render, else nothing).
 *
 * It only skips for a graph whose every per-object input it recognises: a
 * plain per-object uniform the game sets, a uniform array or storage
 * buffer in a per-object group, a per-object callback it does not know
 * (the batched meshes' per-camera cull), or nodes run before or after a
 * draw keep three's full refresh for that graph.
 */

/** three's `RenderObjectRefreshType`. */
const REFRESH_NONE = 0;
const REFRESH_SHARED = 1;
const REFRESH_FULL = 2;

/** Marks a per-object callback (or a uniform it updates) as reading only
 *  `material[property]` of the material drawn: the draw's own material,
 *  which a chunk mesh's material is in the passes that refresh narrowly. */
export function markMaterialPropertyRead(node: object, property: string) {
  (node as { readsMaterialProperty?: string }).readsMaterialProperty = property;
}

type AnyNode = Node & {
  updateType?: string;
  updateBeforeType?: string;
  updateAfterType?: string;
  isMaterialReferenceNode?: boolean;
  isUniformGroup?: boolean;
  isEventNode?: boolean;
  readsMaterialProperty?: string;
  scope?: string;
  material?: Material | null;
  node?: AnyNode | null;
  properties?: string[];
  getValueFromReference?: (object: object) => unknown;
};

type Binding = {
  isNodeUniformsGroup?: boolean;
  isNodeUniformBuffer?: boolean;
  isStorageBuffer?: boolean;
  isSampledTexture?: boolean;
  isSampler?: boolean;
  groupNode?: { shared?: boolean };
  uniforms?: { nodeUniform?: { node?: AnyNode } }[];
  texture?: { id: number; version: number } | null;
  textureNode?: { value: { id: number; version: number } | null };
};

type RenderObject = {
  object: Object3D;
  material: Material;
  geometry: { id: number; index: { version: number } | null };
  getNodeBuilderState(): {
    updateNodes: AnyNode[];
    updateBeforeNodes: AnyNode[];
    updateAfterNodes: AnyNode[];
  };
  getBindings(): { bindings: Binding[] }[];
  getAttributes(): {
    version?: number;
    data?: { version: number };
    isInterleavedBufferAttribute?: boolean;
  }[];
};

type Observer = {
  needsRefresh(renderObject: unknown, nodeFrame: unknown): number;
  firstInitialization(renderObject: unknown): boolean;
  hasDynamicInstancing(object: unknown): boolean;
  needsVelocity(renderer: unknown): boolean;
  getOutputTarget(renderer: unknown): unknown;
  getRenderObjectData(renderObject: unknown): {
    attributesDisposeVersion: number;
  };
  hasDisposedAttributes(renderObject: unknown, data: unknown): boolean;
  hasAnimation: boolean;
  renderId: number;
};

/** What one graph's per-object inputs are, once checked. */
type GraphInputs = {
  references: AnyNode[];
  /** Material properties read by marked per-object callbacks. */
  properties: string[];
};

const MATRIX_WORLD_SCOPES = new Set([
  "worldMatrix",
  "position",
  "scale",
  "direction",
]);
const MATRIX_WORLD_UNIFORMS = new Set<unknown>([
  modelNormalMatrix,
  modelWorldMatrixInverse,
]);

/** A node fed only by the drawn object's world matrix. */
function readsWorldMatrixOnly(node: AnyNode): boolean {
  if (MATRIX_WORLD_UNIFORMS.has(node)) return true;
  const type = (node.constructor as { type?: string }).type;
  return type === "ModelNode" && MATRIX_WORLD_SCOPES.has(node.scope ?? "");
}

/**
 * The graph's per-object inputs, or null when one of them is not
 * recognised (the graph keeps three's full refresh).
 */
export function graphInputsOf(renderObject: RenderObject): GraphInputs | null {
  const state = renderObject.getNodeBuilderState();
  const isPerObject = (type: string | undefined) => type === "object";
  if (
    state.updateBeforeNodes.some((n) => isPerObject(n.updateBeforeType)) ||
    state.updateAfterNodes.some((n) => isPerObject(n.updateAfterType))
  ) {
    return null;
  }
  const references: AnyNode[] = [];
  const properties: string[] = [];
  /** Uniforms in per-object groups whose values these nodes write. */
  const fed = new Set<unknown>();
  for (const node of state.updateNodes) {
    if (!isPerObject(node.updateType)) continue;
    if (node.isUniformGroup) continue;
    if (node.isMaterialReferenceNode && node.material == null) {
      references.push(node);
      fed.add(node);
      if (node.node) fed.add(node.node);
      continue;
    }
    if (node.readsMaterialProperty !== undefined) {
      properties.push(node.readsMaterialProperty);
      // A uniform it writes (a fixed sway's) changes with that property.
      fed.add(node);
      continue;
    }
    if (readsWorldMatrixOnly(node)) {
      fed.add(node);
      fed.add((node as { uniformNode?: unknown }).uniformNode);
      continue;
    }
    return null;
  }
  for (const group of renderObject.getBindings()) {
    for (const binding of group.bindings) {
      if (binding.isStorageBuffer) return null;
      if (binding.groupNode?.shared === true) continue;
      if (binding.isNodeUniformBuffer) return null;
      if (binding.isNodeUniformsGroup) {
        for (const uniform of binding.uniforms ?? []) {
          if (!fed.has(uniform.nodeUniform?.node)) return null;
        }
      }
    }
  }
  return { references, properties };
}

/** One render object's inputs as it last drew. */
type Snapshot = {
  worldMatrix: Matrix4;
  materialVersion: number;
  values: unknown[];
  numbers: number[];
};

/** Holds `value` for a later comparison (vectors and matrices by copy). */
function hold(value: unknown): unknown {
  const cloneable = value as { isTexture?: boolean; clone?: () => unknown };
  if (value === null || typeof value !== "object") return value;
  if (cloneable.isTexture) return value;
  return typeof cloneable.clone === "function" ? cloneable.clone() : value;
}

function isSame(held: unknown, value: unknown): boolean {
  if (held === value) return true;
  const comparable = held as {
    isTexture?: boolean;
    equals?: (other: unknown) => boolean;
  } | null;
  if (
    comparable === null ||
    typeof comparable !== "object" ||
    comparable.isTexture ||
    typeof comparable.equals !== "function" ||
    value === null ||
    typeof value !== "object"
  ) {
    return false;
  }
  return comparable.equals(value);
}

/**
 * Collects what a draw of `renderObject` depends on beyond its matrix and
 * material values: the textures it binds (identity and version) and its
 * geometry's attributes and index (version).
 */
function collectNumbers(renderObject: RenderObject, out: number[]): number[] {
  out.length = 0;
  for (const group of renderObject.getBindings()) {
    for (const binding of group.bindings) {
      if (!binding.isSampledTexture) continue;
      // The node's value, not the binding's copy: the binding catches up
      // only in a full refresh.
      const texture = binding.textureNode?.value ?? binding.texture;
      out.push(texture ? texture.id : -1, texture ? texture.version : -1);
    }
  }
  for (const attribute of renderObject.getAttributes()) {
    out.push(
      attribute.isInterleavedBufferAttribute
        ? attribute.data!.version
        : attribute.version ?? 0,
    );
  }
  out.push(renderObject.geometry.id, renderObject.geometry.index?.version ?? -1);
  return out;
}

const scratchNumbers: number[] = [];

/**
 * Gives `observer` (three's observer for one graph) the narrower refresh:
 * full when an input of the render object changed, else three's static
 * draw refresh. Graphs it cannot check keep three's own.
 */
export function narrowRefresh(observer: Observer): Observer {
  const base = observer.needsRefresh.bind(observer);
  const snapshots = new WeakMap<object, Snapshot>();
  let inputs: GraphInputs | null | undefined;

  observer.needsRefresh = (renderObjectArg, nodeFrameArg) => {
    const renderObject = renderObjectArg as RenderObject;
    const nodeFrame = nodeFrameArg as { renderId: number; renderer: unknown };
    if (inputs === undefined) inputs = graphInputsOf(renderObject);
    if (
      inputs === null ||
      observer.hasAnimation ||
      observer.hasDynamicInstancing(renderObject.object) ||
      observer.needsVelocity(nodeFrame.renderer)
    ) {
      return base(renderObjectArg, nodeFrameArg);
    }

    const { object, material } = renderObject;
    let snapshot = snapshots.get(renderObject);
    let refresh = REFRESH_NONE;
    if (observer.renderId !== nodeFrame.renderId) {
      observer.renderId = nodeFrame.renderId;
      refresh = REFRESH_SHARED;
    }
    // Three's own first-draw, output-target and disposed-buffer checks.
    if (observer.firstInitialization(renderObject)) refresh = REFRESH_FULL;
    const data = observer.getRenderObjectData(renderObject) as {
      outputTarget?: unknown;
      attributesDisposeVersion: number;
    };
    const outputTarget = observer.getOutputTarget(nodeFrame.renderer);
    if (data.outputTarget !== outputTarget) {
      data.outputTarget = outputTarget;
      refresh = REFRESH_FULL;
    }
    if (
      data.attributesDisposeVersion !==
        (renderObject as unknown as { _geometries: { attributes: { disposeVersion: number } } })
          ._geometries.attributes.disposeVersion &&
      observer.hasDisposedAttributes(renderObject, data)
    ) {
      refresh = REFRESH_FULL;
    }

    const numbers = collectNumbers(renderObject, scratchNumbers);
    if (!snapshot) {
      snapshot = {
        worldMatrix: object.matrixWorld.clone(),
        materialVersion: material.version,
        values: [],
        numbers: [],
      };
      snapshots.set(renderObject, snapshot);
      refresh = REFRESH_FULL;
    }
    if (!snapshot.worldMatrix.equals(object.matrixWorld)) {
      snapshot.worldMatrix.copy(object.matrixWorld);
      refresh = REFRESH_FULL;
    }
    if (snapshot.materialVersion !== material.version) {
      snapshot.materialVersion = material.version;
      refresh = REFRESH_FULL;
    }
    const { references, properties } = inputs;
    const values = snapshot.values;
    let at = 0;
    for (const reference of references) {
      const value = reference.getValueFromReference!(material);
      if (at >= values.length || !isSame(values[at], value)) {
        values[at] = hold(value);
        refresh = REFRESH_FULL;
      }
      at++;
    }
    for (const property of properties) {
      const value = (material as unknown as Record<string, unknown>)[property];
      if (at >= values.length || values[at] !== value) {
        values[at] = value;
        refresh = REFRESH_FULL;
      }
      at++;
    }
    const held = snapshot.numbers;
    let isNumbersSame = held.length === numbers.length;
    for (let i = 0; isNumbersSame && i < numbers.length; i++) {
      isNumbersSame = held[i] === numbers[i];
    }
    if (!isNumbersSame) {
      held.length = numbers.length;
      for (let i = 0; i < numbers.length; i++) held[i] = numbers[i];
      refresh = REFRESH_FULL;
    }
    return refresh;
  };
  return observer;
}
