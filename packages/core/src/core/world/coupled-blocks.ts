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

/** Local-frame offsets use the geometry transform, without its pivot shift.
 * Reject non-lattice rotations instead of rounding a unit into other cells. */
export function rotateCoupledOffset(
  offset: Coords3,
  rotation: BlockRotation,
): Coords3 | null {
  const origin: Coords3 = [0, 0, 0];
  const end: Coords3 = [...offset];
  rotation.rotateNode(origin);
  rotation.rotateNode(end);
  const delta = end.map((v, i) => v - origin[i]);
  if (
    delta.some(
      (v) => !Number.isFinite(v) || Math.abs(v - Math.round(v)) > 0.0001,
    )
  )
    return null;
  return delta.map((v) => Math.round(v) || 0) as Coords3;
}

function pointsBack(
  offset: Coords3,
  rotation: BlockRotation,
  delta: Coords3,
): boolean {
  const back = rotateCoupledOffset(offset.map((v) => -v) as Coords3, rotation);
  return !!back && back.every((v, i) => v === -delta[i]);
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
        const delta = rotateCoupledOffset(
          part.offset,
          BlockRotation.encode(update.rotation ?? 0, update.yRotation ?? 0),
        );
        if (!delta) {
          rejection = "partner rotation is not grid aligned";
          break;
        }
        const px = vx + delta[0];
        const py = vy + delta[1];
        const pz = vz + delta[2];
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
          const partnerRotation = plannedThere
            ? BlockRotation.encode(
                plannedThere.rotation ?? 0,
                plannedThere.yRotation ?? 0,
              )
            : view.getVoxelRotationAt(px, py, pz);
          if (!pointsBack(part.offset, partnerRotation, delta)) {
            rejection = "partner voxel occupied";
            break;
          }
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
        // `partnerId` already reflects the batch's own word for this cell
        // when one exists (line above): a planned write of air, or of a
        // waterlogging fluid the part can hold, is exactly as free as the
        // committed voxel would be. Treating "something is planned there"
        // as occupied on its own — regardless of what it plans — dropped a
        // click-placed coupled block whenever the same expansion pass had
        // already queued that cell (a re-expansion of its own prior output,
        // as `World.updateVoxels` does for a batch handed back to it).
        if (!isFreeFor(view, partnerId, part.id)) {
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
    const currentRotation = view.getVoxelRotationAt(vx, vy, vz);
    const nextRotation = BlockRotation.encode(
      update.rotation ?? 0,
      update.yRotation ?? 0,
    );
    if (
      currentBlock &&
      (update.type !== currentId ||
        currentRotation.value !== nextRotation.value ||
        currentRotation.yRotation !== nextRotation.yRotation)
    ) {
      for (const part of currentBlock.coupledParts ?? []) {
        const delta = rotateCoupledOffset(part.offset, currentRotation);
        if (!delta) continue;
        const px = vx + delta[0];
        const py = vy + delta[1];
        const pz = vz + delta[2];
        if (planned.has(voxelKey(px, py, pz))) continue;
        const stillUsed = updatedBlock?.coupledParts?.some((next) => {
          const offset = rotateCoupledOffset(next.offset, nextRotation);
          return next.id === part.id && offset?.every((v, i) => v === delta[i]);
        });
        if (
          !stillUsed &&
          view.getVoxelAt(px, py, pz) === part.id &&
          pointsBack(part.offset, view.getVoxelRotationAt(px, py, pz), delta)
        ) {
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
