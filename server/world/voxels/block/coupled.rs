//! Coupled blocks: one object stored across several voxels.
//!
//! A door is a bottom leaf and a top leaf; a tall flower is a base and a
//! bloom. Each voxel holds its own block id, but the player sees one thing,
//! so the voxels have to agree: breaking any part takes the others with it,
//! placing the anchor brings the others along, and a part that finds itself
//! without its partners is an orphan that must not exist.
//!
//! The declaration is data on the block ([`Block::coupled_parts`]): every
//! part lists every other part of its unit as an offset and the id that
//! voxel must hold, and exactly one part is the anchor — the one that is
//! placed, picked and dropped. Because it is data, it ships to clients with
//! the rest of the block registry, and a client can predict a unit's fate
//! without a hand-mirrored table of ids.
//!
//! The consequences are applied at update intake by
//! [`expand_coupled_updates`], before anything commits, so a whole unit
//! changes in one committed batch: one light pass, one remesh, one `Update`
//! message. A peer never sees half a door.

use std::sync::Arc;

use hashbrown::HashMap;
use log::warn;
use serde::{Deserialize, Serialize};

use crate::{BlockUtils, Registry, Vec3, VoxelAccess, VoxelPacker, VoxelUpdate};

/// One other voxel a block is stored together with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoupledPart {
    /// Where the partner sits, relative to this voxel.
    pub offset: Vec3<i32>,
    /// The block the partner voxel must hold.
    pub id: u32,
}

/// Why an update to a coupled block cannot happen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoupledRejection {
    /// A partner voxel lies outside the world's height range.
    OutOfWorld { at: Vec3<i32> },
    /// The anchor would need a partner voxel that holds something else.
    Blocked { at: Vec3<i32>, holding: u32 },
    /// A non-anchor part was written where its anchor is not.
    Orphan { at: Vec3<i32>, missing: u32 },
}

impl CoupledRejection {
    fn reason(&self) -> &'static str {
        match self {
            Self::OutOfWorld { .. } => "partner outside the world",
            Self::Blocked { .. } => "partner voxel occupied",
            Self::Orphan { .. } => "written without its anchor",
        }
    }
}

/// Whether a coupled block at `pos` is missing any of its partners.
pub fn is_coupled_orphan(pos: &Vec3<i32>, parts: &[CoupledPart], space: &dyn VoxelAccess) -> bool {
    parts.iter().any(|part| {
        let partner = pos + &part.offset;
        space.get_voxel(partner.0, partner.1, partner.2) != part.id
    })
}

/// Whether a partner voxel holding `id` may be taken by a part of a unit
/// being placed: air always, and the waterlogging fluid when the part can
/// hold it (the commit then carries the water over as waterlogging).
fn is_free_for(registry: &Registry, id: u32, part_id: u32) -> bool {
    registry.is_air(id)
        || (registry.waterlogging_fluid_id() == Some(id) && registry.is_waterloggable(part_id))
}

/// The word a partner should hold to match `anchor_raw`: its own id, the
/// anchor's rotation and stage, and whatever water it already holds. A unit
/// shares its shape state, not its fluid state.
fn partner_word(part_id: u32, anchor_raw: u32, partner_raw: u32) -> u32 {
    let word = VoxelPacker::new()
        .with_id(part_id)
        .with_rotation(BlockUtils::extract_rotation(anchor_raw))
        .with_stage(BlockUtils::extract_stage(anchor_raw))
        .pack();
    let word = BlockUtils::insert_waterlogged(word, BlockUtils::extract_waterlogged(partner_raw));
    BlockUtils::insert_waterlog_level(word, BlockUtils::extract_waterlog_level(partner_raw))
}

/// The partner writes an update that puts a coupled block at `voxel` needs,
/// or why the update cannot happen at all.
///
/// `planned` is what the batch already intends to write; a voxel it covers
/// is read as its planned word so every rule sees the world the batch will
/// produce, whatever order the writes were popped in.
fn plan_unit_writes(
    space: &dyn VoxelAccess,
    registry: &Registry,
    max_height: i32,
    planned: &HashMap<Vec3<i32>, u32>,
    voxel: &Vec3<i32>,
    raw: u32,
    current_raw: u32,
) -> Result<Vec<VoxelUpdate>, CoupledRejection> {
    let block = registry.get_block_by_id(BlockUtils::extract_id(raw));
    let is_rewrite = BlockUtils::extract_id(raw) == BlockUtils::extract_id(current_raw);
    // The anchor dictates shape state to its parts. A part only pushes its
    // state back when it is the one being changed in place (a door toggled
    // from its top leaf); a part written fresh beside an existing anchor
    // takes the anchor's state, not the other way round.
    let dictates_shape = block.is_coupled_anchor || is_rewrite;

    let mut writes = Vec::new();
    for part in &block.coupled_parts {
        let partner = voxel + &part.offset;
        if partner.1 < 0 || partner.1 >= max_height {
            return Err(CoupledRejection::OutOfWorld { at: partner });
        }

        let is_planned = planned.contains_key(&partner);
        let partner_raw = planned
            .get(&partner)
            .copied()
            .unwrap_or_else(|| space.get_raw_voxel(partner.0, partner.1, partner.2));
        let partner_id = BlockUtils::extract_id(partner_raw);

        if partner_id == part.id {
            if is_planned || !dictates_shape {
                continue;
            }
            let word = partner_word(part.id, raw, partner_raw);
            if word != partner_raw {
                writes.push((partner, word));
            }
            continue;
        }

        if !block.is_coupled_anchor {
            return Err(CoupledRejection::Orphan {
                at: partner,
                missing: part.id,
            });
        }
        if is_planned || !is_free_for(registry, partner_id, part.id) {
            return Err(CoupledRejection::Blocked {
                at: partner,
                holding: partner_id,
            });
        }
        writes.push((
            partner,
            VoxelPacker::new()
                .with_id(part.id)
                .with_rotation(BlockUtils::extract_rotation(raw))
                .with_stage(BlockUtils::extract_stage(raw))
                .pack(),
        ));
    }
    Ok(writes)
}

/// Expand one intake batch so every coupled unit it touches changes whole.
///
/// For each update, in order:
/// - a coupled block being written brings its unit along: the anchor
///   materialises its parts into free voxels (or the write is refused when
///   one is occupied), and shape state — rotation and stage — flows to the
///   partners; a non-anchor part written without its anchor is refused;
/// - a coupled block being replaced by a different id takes its remaining
///   partners with it, so no half of a unit is ever left standing.
///
/// Refused writes are dropped and reported once per block and reason, with
/// a count and the first voxel, so a bulk fill of mis-shaped units is one
/// log line rather than silence or a thousand.
///
/// A voxel the batch already writes is never second-guessed: the batch's own
/// word for it wins over anything this expansion would have proposed, which
/// is what lets a client send both halves of a door in one packet and have
/// them commit exactly as sent.
pub fn expand_coupled_updates<L: Copy>(
    space: &dyn VoxelAccess,
    registry: &Registry,
    max_height: i32,
    updates: Vec<(Vec3<i32>, u32, L)>,
) -> Vec<(Vec3<i32>, u32, L)> {
    if !registry.has_coupled_blocks() {
        return updates;
    }

    // Last write to a voxel wins, matching commit order.
    let mut planned: HashMap<Vec3<i32>, u32> = HashMap::with_capacity(updates.len());
    for (voxel, raw, _) in &updates {
        planned.insert(voxel.clone(), *raw);
    }

    let mut rejections: HashMap<(u32, &'static str), (usize, Vec3<i32>)> = HashMap::new();
    let mut expanded = Vec::with_capacity(updates.len());

    for (voxel, raw, lane) in updates {
        let updated_id = BlockUtils::extract_id(raw);
        let current_raw = space.get_raw_voxel(voxel.0, voxel.1, voxel.2);
        let current_id = BlockUtils::extract_id(current_raw);

        let mut partner_writes = Vec::new();
        if !registry
            .get_block_by_id(updated_id)
            .coupled_parts
            .is_empty()
        {
            match plan_unit_writes(
                space,
                registry,
                max_height,
                &planned,
                &voxel,
                raw,
                current_raw,
            ) {
                Ok(writes) => partner_writes = writes,
                Err(rejection) => {
                    let entry = rejections
                        .entry((updated_id, rejection.reason()))
                        .or_insert((0, voxel.clone()));
                    entry.0 += 1;
                    continue;
                }
            }
        }

        let current = registry.get_block_by_id(current_id);
        if updated_id != current_id {
            for part in &current.coupled_parts {
                let partner = &voxel + &part.offset;
                if planned.contains_key(&partner) {
                    continue;
                }
                if space.get_voxel(partner.0, partner.1, partner.2) == part.id {
                    partner_writes.push((partner, 0));
                }
            }
        }

        expanded.push((voxel, raw, lane));
        for (partner, word) in partner_writes {
            planned.insert(partner.clone(), word);
            expanded.push((partner, word, lane));
        }
    }

    for ((id, reason), (count, first)) in rejections {
        warn!(
            "Dropped {count} write(s) of coupled block {} (id {id}): {reason}; first at {:?}",
            registry.get_block_by_id(id).name,
            first
        );
    }

    expanded
}

type ActiveTicker = Arc<dyn Fn(Vec3<i32>, &dyn VoxelAccess, &Registry) -> u64 + Send + Sync>;
type ActiveUpdater =
    Arc<dyn Fn(Vec3<i32>, &dyn VoxelAccess, &Registry) -> Vec<VoxelUpdate> + Send + Sync>;

/// The active-voxel pair for a coupled block: an orphan guard wrapped around
/// whatever the block declared for itself.
///
/// Intake expansion keeps units whole for every write that goes through the
/// update queue, so in play this guard rarely fires. It is the safety net
/// for state that arrived another way — a saved chunk from before the block
/// was coupled, a generator that wrote one half — and clears the orphan the
/// next time a neighbouring write consults it. When the unit is whole, the
/// block's own ticker and updater run untouched; a block with none of its
/// own simply never wakes on its own (`u64::MAX`).
pub(super) fn coupled_guard_fns(
    parts: Vec<CoupledPart>,
    inner_ticker: Option<ActiveTicker>,
    inner_updater: Option<ActiveUpdater>,
) -> (ActiveTicker, ActiveUpdater) {
    let ticker_parts = parts.clone();
    let ticker: ActiveTicker = Arc::new(move |pos, space, registry| {
        if is_coupled_orphan(&pos, &ticker_parts, space) {
            return 0;
        }
        inner_ticker
            .as_ref()
            .map_or(u64::MAX, |ticker| ticker(pos, space, registry))
    });
    let updater: ActiveUpdater = Arc::new(move |pos, space, registry| {
        if is_coupled_orphan(&pos, &parts, space) {
            return vec![(pos, 0)];
        }
        inner_updater
            .as_ref()
            .map_or_else(Vec::new, |updater| updater(pos, space, registry))
    });
    (ticker, updater)
}

/// Check every coupled declaration in `registry` for the shape the engine
/// relies on, panicking with the offending block named. Run once at startup
/// (`Registry::generate`), so a mis-declared unit fails the server before it
/// can fail a player.
///
/// A unit is well-formed when every part names registered blocks, every
/// pair of parts names each other with inverse offsets (so the intake
/// expansion never has to walk a chain), no offset is zero, and exactly one
/// part is the anchor.
pub fn assert_coupled_blocks_consistent(registry: &Registry) {
    for block in registry.blocks_by_id.values() {
        if block.coupled_parts.is_empty() {
            assert!(
                !block.is_coupled_anchor,
                "block {} (id {}) is a coupled anchor with no coupled parts",
                block.name, block.id
            );
            continue;
        }

        let mut anchors = usize::from(block.is_coupled_anchor);
        for part in &block.coupled_parts {
            assert!(
                part.offset != Vec3(0, 0, 0),
                "block {} (id {}) couples to itself at offset zero",
                block.name,
                block.id
            );
            let partner = registry.blocks_by_id.get(&part.id).unwrap_or_else(|| {
                panic!(
                    "block {} (id {}) couples to unregistered block id {} at {:?}",
                    block.name, block.id, part.id, part.offset
                )
            });
            anchors += usize::from(partner.is_coupled_anchor);

            let inverse = Vec3(-part.offset.0, -part.offset.1, -part.offset.2);
            assert!(
                partner
                    .coupled_parts
                    .iter()
                    .any(|back| back.id == block.id && back.offset == inverse),
                "block {} (id {}) couples to {} (id {}) at {:?}, but {} does not couple back at {:?}",
                block.name,
                block.id,
                partner.name,
                partner.id,
                part.offset,
                partner.name,
                inverse
            );

            for other in &block.coupled_parts {
                if other.id == part.id && other.offset == part.offset {
                    continue;
                }
                let relative = &other.offset - &part.offset;
                assert!(
                    partner
                        .coupled_parts
                        .iter()
                        .any(|sibling| sibling.id == other.id && sibling.offset == relative),
                    "block {} (id {}) couples to both {} at {:?} and id {} at {:?}, but {} does not list id {} at {:?}",
                    block.name,
                    block.id,
                    partner.name,
                    part.offset,
                    other.id,
                    other.offset,
                    partner.name,
                    other.id,
                    relative
                );
            }
        }

        assert_eq!(
            anchors, 1,
            "the unit containing block {} (id {}) has {} anchors; exactly one part must be the anchor",
            block.name, block.id, anchors
        );
    }
}

#[cfg(test)]
mod tests {
    use hashbrown::HashMap;

    use super::*;
    use crate::{Block, BlockRotation, Registry};

    const WATER_ID: u32 = 10;
    const STONE_ID: u32 = 20;
    const DOOR_ID: u32 = 700;
    const DOOR_TOP_ID: u32 = 701;
    const BUSH_ID: u32 = 1004;
    const BUSH_TOP_ID: u32 = 1005;

    const MAX_HEIGHT: i32 = 64;

    /// A sparse world: anything not written is air.
    #[derive(Default)]
    struct SparseSpace {
        voxels: HashMap<Vec3<i32>, u32>,
    }

    impl SparseSpace {
        fn with(mut self, voxel: Vec3<i32>, raw: u32) -> Self {
            self.voxels.insert(voxel, raw);
            self
        }
    }

    impl VoxelAccess for SparseSpace {
        fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
            self.voxels.get(&Vec3(vx, vy, vz)).copied().unwrap_or(0)
        }

        fn set_raw_voxel(&mut self, vx: i32, vy: i32, vz: i32, voxel: u32) -> bool {
            self.voxels.insert(Vec3(vx, vy, vz), voxel);
            true
        }

        fn contains(&self, _vx: i32, vy: i32, _vz: i32) -> bool {
            (0..MAX_HEIGHT).contains(&vy)
        }
    }

    fn registry() -> Registry {
        let mut registry = Registry::new();
        registry.register_blocks(&[
            Block::new("Water")
                .id(WATER_ID)
                .is_fluid(true)
                .is_waterlogging_fluid(true)
                .build(),
            Block::new("Stone").id(STONE_ID).build(),
            Block::new("Door")
                .id(DOOR_ID)
                .is_waterloggable(true)
                .y_rotatable(true)
                .coupled_with(Vec3(0, 1, 0), DOOR_TOP_ID)
                .coupled_anchor(true)
                .build(),
            Block::new("Door Top")
                .id(DOOR_TOP_ID)
                .is_waterloggable(true)
                .y_rotatable(true)
                .coupled_with(Vec3(0, -1, 0), DOOR_ID)
                .build(),
            Block::new("Bush")
                .id(BUSH_ID)
                .coupled_with(Vec3(0, 1, 0), BUSH_TOP_ID)
                .coupled_anchor(true)
                .build(),
            Block::new("Bush Top")
                .id(BUSH_TOP_ID)
                .coupled_with(Vec3(0, -1, 0), BUSH_ID)
                .build(),
        ]);
        registry
    }

    fn packed(id: u32, rotation: BlockRotation, stage: u32) -> u32 {
        VoxelPacker::new()
            .with_id(id)
            .with_rotation(rotation)
            .with_stage(stage)
            .pack()
    }

    fn expand(
        space: &SparseSpace,
        registry: &Registry,
        updates: Vec<(Vec3<i32>, u32)>,
    ) -> Vec<(Vec3<i32>, u32)> {
        expand_coupled_updates(
            space,
            registry,
            MAX_HEIGHT,
            updates.into_iter().map(|(v, r)| (v, r, ())).collect(),
        )
        .into_iter()
        .map(|(v, r, _)| (v, r))
        .collect()
    }

    const BASE: Vec3<i32> = Vec3(4, 10, 4);
    const ABOVE: Vec3<i32> = Vec3(4, 11, 4);

    #[test]
    fn breaking_the_anchor_clears_the_partner_in_the_same_batch() {
        let registry = registry();
        let space = SparseSpace::default()
            .with(BASE.clone(), BUSH_ID)
            .with(ABOVE.clone(), BUSH_TOP_ID);

        let out = expand(&space, &registry, vec![(BASE.clone(), 0)]);

        assert_eq!(out, vec![(BASE.clone(), 0), (ABOVE.clone(), 0)]);
    }

    #[test]
    fn breaking_the_part_clears_the_anchor_in_the_same_batch() {
        let registry = registry();
        let space = SparseSpace::default()
            .with(BASE.clone(), BUSH_ID)
            .with(ABOVE.clone(), BUSH_TOP_ID);

        let out = expand(&space, &registry, vec![(ABOVE.clone(), 0)]);

        assert_eq!(out, vec![(ABOVE.clone(), 0), (BASE.clone(), 0)]);
    }

    #[test]
    fn replacing_a_part_with_another_block_still_clears_the_rest() {
        let registry = registry();
        let space = SparseSpace::default()
            .with(BASE.clone(), DOOR_ID)
            .with(ABOVE.clone(), DOOR_TOP_ID);

        let out = expand(&space, &registry, vec![(BASE.clone(), STONE_ID)]);

        assert_eq!(out, vec![(BASE.clone(), STONE_ID), (ABOVE.clone(), 0)]);
    }

    #[test]
    fn a_cascade_never_touches_a_voxel_that_is_not_the_partner() {
        // The block above a door top is a frame, not a leaf; a top standing
        // over a stone floor is not this door's partner either.
        let registry = registry();
        let space = SparseSpace::default()
            .with(BASE.clone(), STONE_ID)
            .with(ABOVE.clone(), DOOR_TOP_ID)
            .with(Vec3(4, 12, 4), STONE_ID);

        let out = expand(&space, &registry, vec![(ABOVE.clone(), 0)]);

        assert_eq!(out, vec![(ABOVE.clone(), 0)]);
    }

    #[test]
    fn placing_the_anchor_materialises_its_parts_with_its_shape_state() {
        let registry = registry();
        let space = SparseSpace::default();
        let leaf = packed(DOOR_ID, BlockRotation::PY(0.0), 1);

        let out = expand(&space, &registry, vec![(BASE.clone(), leaf)]);

        assert_eq!(
            out,
            vec![
                (BASE.clone(), leaf),
                (
                    ABOVE.clone(),
                    packed(DOOR_TOP_ID, BlockRotation::PY(0.0), 1)
                ),
            ]
        );
    }

    #[test]
    fn an_anchor_whose_part_voxel_is_occupied_is_refused_whole() {
        let registry = registry();
        let space = SparseSpace::default().with(ABOVE.clone(), STONE_ID);

        let out = expand(&space, &registry, vec![(BASE.clone(), DOOR_ID)]);

        assert!(out.is_empty(), "a half door must never be written: {out:?}");
    }

    #[test]
    fn an_anchor_may_take_water_when_its_part_can_hold_it() {
        let registry = registry();
        let space = SparseSpace::default().with(ABOVE.clone(), WATER_ID);

        let door = expand(&space, &registry, vec![(BASE.clone(), DOOR_ID)]);
        assert_eq!(door.len(), 2, "a waterloggable top takes the water voxel");

        let bush = expand(&space, &registry, vec![(BASE.clone(), BUSH_ID)]);
        assert!(bush.is_empty(), "a dry plant cannot grow into water");
    }

    #[test]
    fn a_part_written_without_its_anchor_is_refused() {
        let registry = registry();
        let space = SparseSpace::default();

        let out = expand(&space, &registry, vec![(ABOVE.clone(), DOOR_TOP_ID)]);

        assert!(
            out.is_empty(),
            "an orphan top must never be written: {out:?}"
        );
    }

    #[test]
    fn a_batch_carrying_the_whole_unit_commits_exactly_as_sent() {
        let registry = registry();
        let space = SparseSpace::default();
        let bottom = packed(DOOR_ID, BlockRotation::PY(0.0), 0);
        let top = packed(DOOR_TOP_ID, BlockRotation::PY(0.0), 0);

        // Top first: the batch's own word for a voxel is never second-guessed.
        let out = expand(
            &space,
            &registry,
            vec![(ABOVE.clone(), top), (BASE.clone(), bottom)],
        );

        assert_eq!(out, vec![(ABOVE.clone(), top), (BASE.clone(), bottom)]);
    }

    #[test]
    fn a_batch_breaking_both_halves_adds_nothing() {
        let registry = registry();
        let space = SparseSpace::default()
            .with(BASE.clone(), DOOR_ID)
            .with(ABOVE.clone(), DOOR_TOP_ID);

        let out = expand(
            &space,
            &registry,
            vec![(BASE.clone(), 0), (ABOVE.clone(), 0)],
        );

        assert_eq!(out, vec![(BASE.clone(), 0), (ABOVE.clone(), 0)]);
    }

    #[test]
    fn toggling_either_leaf_carries_the_stage_to_the_other() {
        let registry = registry();
        let closed_bottom = packed(DOOR_ID, BlockRotation::PY(0.0), 0);
        let closed_top = packed(DOOR_TOP_ID, BlockRotation::PY(0.0), 0);
        let space = SparseSpace::default()
            .with(BASE.clone(), closed_bottom)
            .with(ABOVE.clone(), closed_top);

        let open_bottom = packed(DOOR_ID, BlockRotation::PY(0.0), 1);
        let open_top = packed(DOOR_TOP_ID, BlockRotation::PY(0.0), 1);

        let from_bottom = expand(&space, &registry, vec![(BASE.clone(), open_bottom)]);
        assert_eq!(
            from_bottom,
            vec![(BASE.clone(), open_bottom), (ABOVE.clone(), open_top)]
        );

        let from_top = expand(&space, &registry, vec![(ABOVE.clone(), open_top)]);
        assert_eq!(
            from_top,
            vec![(ABOVE.clone(), open_top), (BASE.clone(), open_bottom)]
        );
    }

    #[test]
    fn a_rewrite_that_changes_no_shape_state_writes_no_partner() {
        let registry = registry();
        let bottom = packed(DOOR_ID, BlockRotation::PY(0.0), 0);
        let top = packed(DOOR_TOP_ID, BlockRotation::PY(0.0), 0);
        let space = SparseSpace::default()
            .with(BASE.clone(), bottom)
            .with(ABOVE.clone(), top);

        // Waterlogging the bottom is fluid state, which the unit does not share.
        let wet_bottom = BlockUtils::insert_waterlogged(bottom, true);
        let out = expand(&space, &registry, vec![(BASE.clone(), wet_bottom)]);

        assert_eq!(out, vec![(BASE.clone(), wet_bottom)]);
    }

    #[test]
    fn shape_state_flowing_to_a_partner_keeps_the_partner_s_water() {
        let registry = registry();
        let bottom = packed(DOOR_ID, BlockRotation::PY(0.0), 0);
        let wet_top = BlockUtils::insert_waterlog_level(
            BlockUtils::insert_waterlogged(packed(DOOR_TOP_ID, BlockRotation::PY(0.0), 0), true),
            5,
        );
        let space = SparseSpace::default()
            .with(BASE.clone(), bottom)
            .with(ABOVE.clone(), wet_top);

        let open_bottom = packed(DOOR_ID, BlockRotation::PY(0.0), 1);
        let out = expand(&space, &registry, vec![(BASE.clone(), open_bottom)]);

        let (_, top_word) = out
            .iter()
            .find(|(voxel, _)| *voxel == ABOVE)
            .expect("the top leaf follows the toggle");
        assert_eq!(BlockUtils::extract_stage(*top_word), 1);
        assert!(BlockUtils::extract_waterlogged(*top_word));
        assert_eq!(BlockUtils::extract_waterlog_level(*top_word), 5);
    }

    #[test]
    fn a_fresh_part_beside_an_existing_anchor_takes_the_anchor_s_state() {
        // Healing a lone bottom by writing a top over it: the top must not
        // push its own (default) stage down onto the open leaf below.
        let registry = registry();
        let open_bottom = packed(DOOR_ID, BlockRotation::PY(0.0), 1);
        let space = SparseSpace::default().with(BASE.clone(), open_bottom);

        let closed_top = packed(DOOR_TOP_ID, BlockRotation::PY(0.0), 0);
        let out = expand(&space, &registry, vec![(ABOVE.clone(), closed_top)]);

        assert_eq!(out, vec![(ABOVE.clone(), closed_top)]);
    }

    #[test]
    fn a_partner_above_the_world_ceiling_refuses_the_anchor() {
        let registry = registry();
        let space = SparseSpace::default();
        let roof = Vec3(4, MAX_HEIGHT - 1, 4);

        let out = expand(&space, &registry, vec![(roof, DOOR_ID)]);

        assert!(out.is_empty());
    }

    #[test]
    fn uncoupled_blocks_pass_through_untouched() {
        let registry = registry();
        let space = SparseSpace::default().with(BASE.clone(), STONE_ID);

        let out = expand(
            &space,
            &registry,
            vec![(BASE.clone(), 0), (ABOVE.clone(), STONE_ID)],
        );

        assert_eq!(out, vec![(BASE.clone(), 0), (ABOVE.clone(), STONE_ID)]);
    }

    #[test]
    fn a_registry_without_coupled_blocks_skips_the_pass() {
        let mut registry = Registry::new();
        registry.register_block(&Block::new("Stone").id(STONE_ID).build());
        assert!(!registry.has_coupled_blocks());

        let space = SparseSpace::default();
        let out = expand(&space, &registry, vec![(BASE.clone(), STONE_ID)]);
        assert_eq!(out, vec![(BASE.clone(), STONE_ID)]);
    }

    #[test]
    fn the_orphan_guard_clears_only_a_part_missing_its_partner() {
        let registry = registry();
        let top = registry.get_block_by_id(DOOR_TOP_ID);
        let ticker = top.active_ticker.as_ref().unwrap();
        let updater = top.active_updater.as_ref().unwrap();

        let whole = SparseSpace::default()
            .with(BASE.clone(), DOOR_ID)
            .with(ABOVE.clone(), DOOR_TOP_ID);
        assert_eq!(ticker(ABOVE.clone(), &whole, &registry), u64::MAX);
        assert!(updater(ABOVE.clone(), &whole, &registry).is_empty());

        let orphaned = SparseSpace::default().with(ABOVE.clone(), DOOR_TOP_ID);
        assert_eq!(ticker(ABOVE.clone(), &orphaned, &registry), 0);
        assert_eq!(
            updater(ABOVE.clone(), &orphaned, &registry),
            vec![(ABOVE.clone(), 0)]
        );
    }

    #[test]
    fn the_orphan_guard_defers_to_the_block_s_own_active_fn_when_whole() {
        let mut registry = Registry::new();
        registry.register_blocks(&[
            Block::new("Timed")
                .id(DOOR_ID)
                .active_fn(|_, _, _| 42, |pos, _, _| vec![(pos, STONE_ID)])
                .coupled_with(Vec3(0, 1, 0), DOOR_TOP_ID)
                .coupled_anchor(true)
                .build(),
            Block::new("Timed Top")
                .id(DOOR_TOP_ID)
                .coupled_with(Vec3(0, -1, 0), DOOR_ID)
                .build(),
            Block::new("Stone").id(STONE_ID).build(),
        ]);
        let timed = registry.get_block_by_id(DOOR_ID);
        let ticker = timed.active_ticker.as_ref().unwrap();
        let updater = timed.active_updater.as_ref().unwrap();

        let whole = SparseSpace::default()
            .with(BASE.clone(), DOOR_ID)
            .with(ABOVE.clone(), DOOR_TOP_ID);
        assert_eq!(ticker(BASE.clone(), &whole, &registry), 42);
        assert_eq!(
            updater(BASE.clone(), &whole, &registry),
            vec![(BASE.clone(), STONE_ID)]
        );
    }

    #[test]
    fn the_anchor_of_a_unit_resolves_from_any_part() {
        let registry = registry();
        assert_eq!(registry.coupled_anchor_id(DOOR_TOP_ID), DOOR_ID);
        assert_eq!(registry.coupled_anchor_id(DOOR_ID), DOOR_ID);
        assert_eq!(registry.coupled_anchor_id(STONE_ID), STONE_ID);
    }

    #[test]
    fn a_consistent_registry_passes_validation() {
        assert_coupled_blocks_consistent(&registry());
    }

    #[test]
    #[should_panic(expected = "does not couple back")]
    fn a_one_sided_coupling_fails_validation() {
        let mut registry = Registry::new();
        registry.register_blocks(&[
            Block::new("Lonely")
                .id(DOOR_ID)
                .coupled_with(Vec3(0, 1, 0), DOOR_TOP_ID)
                .coupled_anchor(true)
                .build(),
            Block::new("Deaf").id(DOOR_TOP_ID).build(),
        ]);
        assert_coupled_blocks_consistent(&registry);
    }

    #[test]
    #[should_panic(expected = "has 0 anchors")]
    fn a_unit_without_an_anchor_fails_validation() {
        let mut registry = Registry::new();
        registry.register_blocks(&[
            Block::new("A")
                .id(DOOR_ID)
                .coupled_with(Vec3(0, 1, 0), DOOR_TOP_ID)
                .build(),
            Block::new("B")
                .id(DOOR_TOP_ID)
                .coupled_with(Vec3(0, -1, 0), DOOR_ID)
                .build(),
        ]);
        assert_coupled_blocks_consistent(&registry);
    }

    #[test]
    #[should_panic(expected = "unregistered block id")]
    fn a_coupling_to_an_unknown_block_fails_validation() {
        let mut registry = Registry::new();
        registry.register_block(
            &Block::new("A")
                .id(DOOR_ID)
                .coupled_with(Vec3(0, 1, 0), 9999)
                .coupled_anchor(true)
                .build(),
        );
        assert_coupled_blocks_consistent(&registry);
    }

    #[test]
    #[should_panic(expected = "does not list")]
    fn a_three_part_unit_must_be_fully_connected() {
        // Bottom lists mid and top; mid lists bottom only: top is unreachable
        // from mid, so a break at mid would leave the top standing.
        let mut registry = Registry::new();
        registry.register_blocks(&[
            Block::new("Bottom")
                .id(1)
                .coupled_with(Vec3(0, 1, 0), 2)
                .coupled_with(Vec3(0, 2, 0), 3)
                .coupled_anchor(true)
                .build(),
            Block::new("Mid")
                .id(2)
                .coupled_with(Vec3(0, -1, 0), 1)
                .build(),
            Block::new("Top")
                .id(3)
                .coupled_with(Vec3(0, -2, 0), 1)
                .build(),
        ]);
        assert_coupled_blocks_consistent(&registry);
    }
}
