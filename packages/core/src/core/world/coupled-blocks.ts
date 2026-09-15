import { Coords3 } from "../../types";

import { Block, BlockRotation, BlockUpdate } from "./block";

/**
 * The slice of a world the coupled-unit expansion reads. Kept to plain
 * queries so the rules can be exercised against a stub, and so they read
 * the same picture the server's intake does: committed voxels, plus what the
 * batch itself is about to write.
 */
export interface CoupledWorldView {
  maxHeight: number;
  getBlockById(id: number): Block | undefined;
  getVoxelAt(vx: number, vy: number, vz: number): number;
  getVoxelRotationAt(vx: number, vy: number, vz: number): BlockRotation;
  getVoxelStageAt(vx: number, vy: number, vz: number): number;
}

type ShapeState = {
  rotation: number;
  yRotation: number;
  stage: number;
};

function voxelKey(vx: number, vy: number, vz: number): string {
  return `${vx},${vy},${vz}`;
}

function shapeOf(update: BlockUpdate): ShapeState {
  return {
    rotation: update.rotation ?? 0,
    yRotation: update.yRotation ?? 0,
    stage: update.stage ?? 0,
  };
}

function committedShapeAt(
  view: CoupledWorldView,
  vx: number,
  vy: number,
  vz: number,
): ShapeState {
  const [rotation, yRotation] = BlockRotation.decode(
    view.getVoxelRotationAt(vx, vy, vz),
  );
  return { rotation, yRotation, stage: view.getVoxelStageAt(vx, vy, vz) };
}

function isSameShape(a: ShapeState, b: ShapeState): boolean {
  return (
    a.rotation === b.rotation &&
    a.yRotation === b.yRotation &&
    a.stage === b.stage
  );
}

/**
 * Whether a partner voxel holding `holding` may be taken by a part of a unit
 * being placed: air always, and the waterlogging fluid when the part can
 * hold it. Mirrors the server rule.
 */
function isFreeFor(
  view: CoupledWorldView,
  holding: number,
  partId: number,
): boolean {
  if (holding === 0) return true;
  const fluid = view.getBlockById(holding);
  const part = view.getBlockById(partId);
  return fluid?.isWaterloggingFluid === true && part?.isWaterloggable === true;
}

/**
 * Whether `block` is a non-anchor part of a coupled unit — a door's top
 * leaf, a tall flower's bloom. Such a block is never placed, picked, or
 * dropped on its own; see {@link resolveCoupledAnchor}.
 */
export function isCoupledPart(block: Block | undefined | null): boolean {
  return (
    !!block && (block.coupledParts?.length ?? 0) > 0 && !block.isCoupledAnchor
  );
}

/**
 * The anchor of the coupled unit `block` belongs to — the part a player
 * holds, places, and is paid in drops. A block that is not coupled, or is
 * the anchor itself, resolves to itself, so item and pick paths can call
 * this for every block.
 */
export function resolveCoupledAnchor(
  view: Pick<CoupledWorldView, "getBlockById">,
  block: Block,
): Block {
  if (!isCoupledPart(block)) return block;
  for (const part of block.coupledParts) {
    const partner = view.getBlockById(part.id);
    if (partner?.isCoupledAnchor) return partner;
  }
  return block;
}

/**
 * Expand a batch of block updates so every coupled unit it touches changes
 * whole — the client-side mirror of the server's update intake, so a local
 * prediction lands on exactly the voxels the authoritative echo will.
 *
 * For each update, in order:
 * - a coupled block being written brings its unit along: the anchor
 *   materialises its parts into free voxels (or the write is dropped when
 *   one is occupied) and its rotation and stage flow to the partners; a
 *   non-anchor part written without its anchor is dropped;
 * - a coupled block being replaced by a different id takes its remaining
 *   partners with it.
 *
 * A voxel the batch already writes is never second-guessed: the batch's own
 * word for it wins. The result is idempotent, so callers may expand once to
 * inspect the outcome and hand the expanded list back to `updateVoxels`.
 */
export function expandCoupledUpdates(
  view: CoupledWorldView,
  updates: BlockUpdate[],
): BlockUpdate[] {
  const planned = new Map<string, BlockUpdate>();
  for (const update of updates) {
    planned.set(voxelKey(update.vx, update.vy, update.vz), update);
  }

  const dropped = new Map<string, { count: number; first: Coords3 }>();
  const expanded: BlockUpdate[] = [];

  for (const update of updates) {
    const { vx, vy, vz } = update;
    const updatedBlock = view.getBlockById(update.type);
    const currentId = view.getVoxelAt(vx, vy, vz);

    let partnerWrites: BlockUpdate[] = [];
    if (updatedBlock && (updatedBlock.coupledParts?.length ?? 0) > 0) {
      const isRewrite = update.type === currentId;
      // The anchor dictates shape state to its parts; a part only pushes its
      // state back when it is the one being changed in place.
      const dictatesShape = updatedBlock.isCoupledAnchor || isRewrite;
      let rejection: string | null = null;

      for (const part of updatedBlock.coupledParts) {
        const px = vx + part.offset[0];
        const py = vy + part.offset[1];
        const pz = vz + part.offset[2];
        if (py < 0 || py >= view.maxHeight) {
          rejection = "partner outside the world";
          break;
        }

        const key = voxelKey(px, py, pz);
        const plannedThere = planned.get(key);
        const partnerId = plannedThere
          ? plannedThere.type
          : view.getVoxelAt(px, py, pz);

        if (partnerId === part.id) {
          if (plannedThere || !dictatesShape) continue;
          const shape = shapeOf(update);
          if (isSameShape(shape, committedShapeAt(view, px, py, pz))) continue;
          partnerWrites.push({
            vx: px,
            vy: py,
            vz: pz,
            type: part.id,
            ...shape,
          });
          continue;
        }

        if (!updatedBlock.isCoupledAnchor) {
          rejection = "written without its anchor";
          break;
        }
        if (plannedThere || !isFreeFor(view, partnerId, part.id)) {
          rejection = "partner voxel occupied";
          break;
        }
        partnerWrites.push({
          vx: px,
          vy: py,
          vz: pz,
          type: part.id,
          ...shapeOf(update),
        });
      }

      if (rejection) {
        const reasonKey = `${update.type}:${rejection}`;
        const entry = dropped.get(reasonKey);
        if (entry) {
          entry.count += 1;
        } else {
          dropped.set(reasonKey, { count: 1, first: [vx, vy, vz] });
        }
        partnerWrites = [];
        continue;
      }
    }

    const currentBlock = view.getBlockById(currentId);
    if (update.type !== currentId && currentBlock) {
      for (const part of currentBlock.coupledParts ?? []) {
        const px = vx + part.offset[0];
        const py = vy + part.offset[1];
        const pz = vz + part.offset[2];
        if (planned.has(voxelKey(px, py, pz))) continue;
        if (view.getVoxelAt(px, py, pz) === part.id) {
          partnerWrites.push({ vx: px, vy: py, vz: pz, type: 0 });
        }
      }
    }

    expanded.push(update);
    for (const write of partnerWrites) {
      planned.set(voxelKey(write.vx, write.vy, write.vz), write);
      expanded.push(write);
    }
  }

  for (const [reasonKey, { count, first }] of dropped) {
    const [type, reason] = reasonKey.split(":");
    const name = view.getBlockById(Number(type))?.name ?? `id ${type}`;
    console.warn(
      `[world] dropped ${count} update(s) of coupled block ${name}: ${reason}; first at ${first.join(", ")}`,
    );
  }

  return expanded;
}
