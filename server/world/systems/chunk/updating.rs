use std::{cmp::Reverse, collections::VecDeque};

use hashbrown::{HashMap, HashSet};
use nanoid::nanoid;
use specs::{Entities, LazyUpdate, ReadExpect, System, WorldExt, WriteExpect, WriteStorage};

use crate::{
    beer_lambert_transmit, expand_coupled_updates, perf_toggle, record_profile,
    sample_random_ticks, BlockUtils, ChunkInterests, ChunkUtils, Chunks, ClientFilter,
    CurrentChunkComp, ETypeComp, EntityFlag, IDComp, JsonComp, LightColor, LightNode, Lights,
    Mesher, Message, MessageQueues, MessageType, MetadataComp, PerfToggle, RandomTickCatchUp,
    Registry, Stats, UpdateLane, UpdateProtocol, Vec2, Vec3, VoxelAccess, VoxelComp, VoxelPacker,
    WorldConfig, ROTATION_BYTE_MASK,
};

pub const VOXEL_NEIGHBORS: [[i32; 3]; 6] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
    [0, 1, 0],
    [0, -1, 0],
];

const VOXEL_NEIGHBORS_WITH_STAIRS: [[i32; 3]; 14] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
    [0, 1, 0],
    [0, -1, 0],
    [1, 1, 0],
    [1, -1, 0],
    [-1, 1, 0],
    [-1, -1, 0],
    [0, 1, 1],
    [0, -1, 1],
    [0, 1, -1],
    [0, -1, -1],
];

const RED: LightColor = LightColor::Red;
const GREEN: LightColor = LightColor::Green;
const BLUE: LightColor = LightColor::Blue;
const SUNLIGHT: LightColor = LightColor::Sunlight;
const ALL_TRANSPARENT: [bool; 6] = [true, true, true, true, true, true];

fn get_chest_adjacent_offsets(y_rot: u32) -> [(i32, i32, i32); 2] {
    let is_x_axis = y_rot == 0 || y_rot == 8;
    if is_x_axis {
        [(1, 0, 0), (-1, 0, 0)]
    } else {
        [(0, 0, 1), (0, 0, -1)]
    }
}

fn try_link_chest(
    chunks: &Chunks,
    json_storage: &mut WriteStorage<JsonComp>,
    new_entity: specs::Entity,
    voxel: &Vec3<i32>,
    y_rot: u32,
    registry: &Registry,
    default_json: &str,
) {
    let offsets = get_chest_adjacent_offsets(y_rot);

    for (dx, dy, dz) in &offsets {
        let nx = voxel.0 + dx;
        let ny = voxel.1 + dy;
        let nz = voxel.2 + dz;

        let neighbor_id = chunks.get_voxel(nx, ny, nz);
        let neighbor_type = registry.get_block_by_id(neighbor_id);
        if neighbor_type.name != "Chest" {
            continue;
        }

        let neighbor_raw = chunks.get_raw_voxel(nx, ny, nz);
        let neighbor_y_rot = (neighbor_raw >> 20) & 0xF;
        if neighbor_y_rot != y_rot {
            continue;
        }

        let neighbor_entity = match chunks.block_entities.get(&Vec3(nx, ny, nz)) {
            Some(&e) => e,
            None => continue,
        };

        let neighbor_json_str = match json_storage.get(neighbor_entity) {
            Some(j) => j.0.clone(),
            None => continue,
        };
        let neighbor_parsed: serde_json::Value = match serde_json::from_str(&neighbor_json_str) {
            Ok(v) => v,
            Err(_) => continue,
        };

        if neighbor_parsed.get("partner").is_some() && !neighbor_parsed["partner"].is_null() {
            continue;
        }

        let far_x = nx + dx;
        let far_y = ny + dy;
        let far_z = nz + dz;
        let far_id = chunks.get_voxel(far_x, far_y, far_z);
        let far_type = registry.get_block_by_id(far_id);
        if far_type.name == "Chest" {
            let far_raw = chunks.get_raw_voxel(far_x, far_y, far_z);
            let far_y_rot = (far_raw >> 20) & 0xF;
            if far_y_rot == y_rot {
                continue;
            }
        }

        let mut new_json: serde_json::Value =
            serde_json::from_str(default_json).unwrap_or_else(|_| serde_json::json!({}));
        new_json["partner"] = serde_json::json!([nx, ny, nz]);
        new_json["yRotation"] = serde_json::json!(y_rot);

        let new_json_str =
            serde_json::to_string(&new_json).unwrap_or_else(|_| default_json.to_string());
        json_storage
            .insert(new_entity, JsonComp::new(&new_json_str))
            .ok();

        let mut neighbor_obj: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(&neighbor_json_str).unwrap_or_default();
        neighbor_obj.insert(
            "partner".to_string(),
            serde_json::json!([voxel.0, voxel.1, voxel.2]),
        );
        neighbor_obj.insert("yRotation".to_string(), serde_json::json!(y_rot));
        let neighbor_new_str =
            serde_json::to_string(&neighbor_obj).unwrap_or_else(|_| neighbor_json_str.clone());
        if let Some(j) = json_storage.get_mut(neighbor_entity) {
            j.0 = neighbor_new_str;
        }

        return;
    }

    let mut new_json: serde_json::Value =
        serde_json::from_str(default_json).unwrap_or_else(|_| serde_json::json!({}));
    new_json["yRotation"] = serde_json::json!(y_rot);
    let new_json_str =
        serde_json::to_string(&new_json).unwrap_or_else(|_| default_json.to_string());
    json_storage
        .insert(new_entity, JsonComp::new(&new_json_str))
        .ok();
}

fn try_unlink_partner(
    chunks: &Chunks,
    json_storage: &mut WriteStorage<JsonComp>,
    entity: specs::Entity,
) {
    let json_str = match json_storage.get(entity) {
        Some(j) => j.0.clone(),
        None => return,
    };

    let parsed: serde_json::Value = match serde_json::from_str(&json_str) {
        Ok(v) => v,
        Err(_) => return,
    };

    let partner_arr = match parsed.get("partner") {
        Some(v) if v.is_array() => v.as_array().unwrap(),
        _ => return,
    };

    if partner_arr.len() != 3 {
        return;
    }

    let px = partner_arr[0].as_i64().unwrap_or(0) as i32;
    let py = partner_arr[1].as_i64().unwrap_or(0) as i32;
    let pz = partner_arr[2].as_i64().unwrap_or(0) as i32;

    let partner_entity = match chunks.block_entities.get(&Vec3(px, py, pz)) {
        Some(&e) => e,
        None => return,
    };

    let partner_json_str = match json_storage.get(partner_entity) {
        Some(j) => j.0.clone(),
        None => return,
    };

    let mut partner_obj: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&partner_json_str).unwrap_or_default();
    partner_obj.insert("partner".to_string(), serde_json::Value::Null);
    let partner_new_str =
        serde_json::to_string(&partner_obj).unwrap_or_else(|_| partner_json_str.clone());
    if let Some(j) = json_storage.get_mut(partner_entity) {
        j.0 = partner_new_str;
    }
}

/// Schedule `voxel` to run its active updater `delay` ticks from now.
///
/// A ticker returning `u64::MAX` means "never on my own": the voxel only
/// re-arms when a neighboring update consults its ticker again. Without this
/// guard the deadline arithmetic overflows — wrapping to "one tick ago" in
/// release (spurious immediate wake) and panicking in debug.
fn schedule_active(chunks: &mut Chunks, voxel: &Vec3<i32>, delay: u64, current_tick: u64) {
    if delay == u64::MAX {
        return;
    }
    chunks.mark_voxel_active(voxel, delay.saturating_add(current_tick));
}

/// The milliseconds a tick allows one kind of work, spent rather than
/// reserved: checked after each unit, because a unit cannot be split, so at
/// least one unit runs a tick and the carried work always drains. Only the
/// stretches it runs for are charged, so other work interleaved with it in
/// the same tick costs it nothing.
struct TickBudget {
    limit: std::time::Duration,
    spent: std::time::Duration,
    running_since: Option<std::time::Instant>,
    units: usize,
}

impl TickBudget {
    /// A budget charged from now.
    fn new(limit_ms: f64) -> Self {
        let mut budget = Self::paused(limit_ms);
        budget.resume();
        budget
    }

    /// A budget charged only while resumed.
    fn paused(limit_ms: f64) -> Self {
        // Past what a `Duration` holds, the budget never runs out.
        let limit = std::time::Duration::try_from_secs_f64(limit_ms.max(0.0) / 1000.0)
            .unwrap_or(std::time::Duration::MAX);
        Self {
            limit,
            spent: std::time::Duration::ZERO,
            running_since: None,
            units: 0,
        }
    }

    fn resume(&mut self) {
        self.running_since
            .get_or_insert_with(std::time::Instant::now);
    }

    fn pause(&mut self) {
        if let Some(since) = self.running_since.take() {
            self.spent += since.elapsed();
        }
    }

    /// Whether the next unit waits for a later tick.
    fn is_spent(&self) -> bool {
        let running = self
            .running_since
            .map_or(std::time::Duration::ZERO, |since| since.elapsed());
        self.units > 0 && self.spent + running >= self.limit
    }

    fn spend(&mut self) {
        self.units += 1;
    }
}

/// Whether `voxel`'s active ticker is asked, as a written voxel or as a
/// neighbor. A written voxel consults whatever it became, including active
/// air (destruction propagation). A neighbor only consults real blocks and
/// fluids, so plain air around an edit never schedules itself.
fn asks_ticker(chunks: &Chunks, registry: &Registry, voxel: &Vec3<i32>, is_written: bool) -> bool {
    let id = chunks.get_voxel(voxel.0, voxel.1, voxel.2);
    let block = registry.get_block_by_id(id);
    if is_written {
        block.is_active
    } else {
        block.is_active && (block.is_fluid || !registry.is_air(id))
    }
}

/// Whether consulting `voxel` would do anything as the world stands: ask its
/// ticker, or tick the fluid it holds. Only those queue; whatever later makes
/// another voxel worth consulting is a write of its own, which queues it.
fn wants_consult(
    chunks: &Chunks,
    registry: &Registry,
    voxel: &Vec3<i32>,
    is_written: bool,
) -> bool {
    asks_ticker(chunks, registry, voxel, is_written)
        || chunks.get_voxel_waterlogged(voxel.0, voxel.1, voxel.2)
}

/// Ask `voxel`'s active ticker when it next wants to run, and schedule it.
fn consult_ticker(
    chunks: &mut Chunks,
    registry: &Registry,
    voxel: Vec3<i32>,
    is_written: bool,
    current_tick: u64,
) {
    let Vec3(vx, vy, vz) = voxel;
    if asks_ticker(chunks, registry, &voxel, is_written) {
        let block = registry.get_block_by_id(chunks.get_voxel(vx, vy, vz));
        let ticks = (block.active_ticker.as_ref().unwrap())(Vec3(vx, vy, vz), &*chunks, registry);
        schedule_active(chunks, &Vec3(vx, vy, vz), ticks, current_tick);
        return;
    }

    if chunks.get_voxel_waterlogged(vx, vy, vz) {
        mark_waterlogged_fluid_active(chunks, registry, Vec3(vx, vy, vz), current_tick);
    }
}

/// Consult queued tickers, oldest first, until `budget` is spent; the rest
/// wait for a later tick. Returns how many it consulted.
fn drain_ticker_consults(
    chunks: &mut Chunks,
    registry: &Registry,
    current_tick: u64,
    budget: &mut TickBudget,
) -> usize {
    let mut consulted = 0;
    while !budget.is_spent() {
        let Some((voxel, is_written)) = chunks.pop_ticker_consult() else {
            break;
        };
        consult_ticker(chunks, registry, voxel, is_written, current_tick);
        budget.spend();
        consulted += 1;
    }
    consulted
}

/// The writes one tick's worth of active updaters want to make, keyed by
/// target voxel. Every updater reads the *pre-tick* world and proposes into
/// this plan; nothing commits until the whole due list has run. See
/// [`offer_planned_update`] for how two proposals to one cell are settled.
type ActivePlan = HashMap<Vec3<i32>, u32>;

/// Run the active updater(s) of `voxel` against the committed world and
/// record what they propose.
///
/// Updaters used to read through an overlay of the tick's earlier writes,
/// so an updater's result depended on where its cell sorted in the due
/// list: a cell planned after its neighbor saw that neighbor's new level,
/// a cell planned before it did not. Water ran a half-step ahead along one
/// diagonal and behind along the other, and any bug reproduced only with
/// the exact same due order. Reading committed state makes every updater
/// in a tick see the same world, whatever order they run in.
fn plan_active_updates(
    chunks: &Chunks,
    plan: &mut ActivePlan,
    registry: &Registry,
    voxel: &Vec3<i32>,
) {
    let id = chunks.get_voxel(voxel.0, voxel.1, voxel.2);
    let block = registry.get_block_by_id(id);
    let mut updates = Vec::new();
    if let Some(updater) = &block.active_updater {
        updates.extend(updater(voxel.clone(), chunks, registry));
    }
    if chunks.get_voxel_waterlogged(voxel.0, voxel.1, voxel.2) {
        if let Some(fluid) = registry.waterlogging_fluid() {
            if fluid.id != id {
                if let Some(updater) = &fluid.active_updater {
                    updates.extend(updater(voxel.clone(), chunks, registry));
                }
            }
        }
    }

    for (position, raw) in updates {
        offer_planned_update(plan, registry, position, raw);
    }
}

/// Whether a voxel word carries fluid, either as a fluid block or as the
/// waterlogged state of another block.
fn holds_fluid(registry: &Registry, raw: u32) -> bool {
    BlockUtils::extract_waterlogged(raw)
        || registry
            .get_block_by_id(BlockUtils::extract_id(raw))
            .is_fluid
}

/// Settle a proposal against whatever the plan already holds for `position`.
///
/// Two updaters proposing into one cell in the same tick is the normal case
/// for fluids: every wet neighbor of an air cell offers to fill it. With an
/// overlay the last one in sort order silently won, so the fill level a cell
/// received depended on the sort key rather than the physics. Here fluid
/// keeps the fullest level offered (lowest stage: a source beside a trickle
/// wins), which is also what the cell would converge to a tick later, so the
/// commit is one step ahead instead of one step oscillated. Anything that is
/// not a fluid-versus-fluid disagreement keeps the first proposal, which in
/// (x, y, z) due order is deterministic.
fn offer_planned_update(plan: &mut ActivePlan, registry: &Registry, position: Vec3<i32>, raw: u32) {
    let Some(&existing) = plan.get(&position) else {
        plan.insert(position, raw);
        return;
    };

    if !holds_fluid(registry, existing) || !holds_fluid(registry, raw) {
        return;
    }
    if BlockUtils::extract_id(existing) != BlockUtils::extract_id(raw) {
        return;
    }

    if BlockUtils::extract_fluid_level(raw) < BlockUtils::extract_fluid_level(existing) {
        plan.insert(position, raw);
    }
}

/// Plan due voxels until `budget` is spent: first the ones an earlier tick's
/// budget did not reach, oldest first, then this tick's, in (x, y, z) order.
/// The ones it does not reach wait in `overdue_active_voxels`; none is
/// dropped. Returns how many it planned.
fn plan_due_active_voxels(
    chunks: &mut Chunks,
    plan: &mut ActivePlan,
    registry: &Registry,
    current_tick: u64,
    budget: &mut TickBudget,
) -> usize {
    let mut due = Vec::new();
    while let Some(Reverse(active)) = chunks.active_voxel_heap.peek() {
        if active.tick > current_tick {
            break;
        }
        let Reverse(active) = chunks.active_voxel_heap.pop().unwrap();
        match chunks.active_voxel_set.get(&active.voxel).copied() {
            Some(scheduled) if scheduled == active.tick => {
                chunks.active_voxel_set.remove(&active.voxel);
                due.push(active.voxel);
            }
            _ => {}
        }
    }
    due.sort_by(|a, b| (a.0, a.1, a.2).cmp(&(b.0, b.1, b.2)));
    for voxel in due {
        chunks.queue_overdue_active_voxel(voxel);
    }

    let mut planned = 0;
    while !budget.is_spent() {
        let Some(voxel) = chunks.pop_overdue_active_voxel() else {
            break;
        };
        plan_active_updates(chunks, plan, registry, &voxel);
        budget.spend();
        planned += 1;
    }
    planned
}

/// Schedule a waterlogged voxel to tick as the fluid it holds.
///
/// Its own block has no updater — a stair does nothing on its own — so without
/// this the water inside it would never spread or drain.
fn mark_waterlogged_fluid_active(
    chunks: &mut Chunks,
    registry: &Registry,
    voxel: Vec3<i32>,
    current_tick: u64,
) {
    let Some(fluid) = registry.waterlogging_fluid() else {
        return;
    };
    let Some(ticker) = &fluid.active_ticker else {
        return;
    };
    let ticks = ticker(voxel.clone(), &*chunks, registry);
    schedule_active(chunks, &voxel, ticks, current_tick);
}

/// The raw word an update should actually commit, once waterlogging has had
/// its say.
///
/// Placing a different block into water carries that water over when the block
/// can hold it, and removing a waterlogged block leaves the water behind.
/// Every other update is taken exactly as written — which is what lets the
/// fluid simulation drain a waterlogged voxel by clearing the bit. Any
/// disagreement heals on the next fluid tick, since waterloggable voxels are
/// themselves flow targets.
///
/// A word that would leave water in a branch voxel too full to hold it (a
/// waterlogged twig thickened to a full block) is invalid: it is committed
/// dry, and the water it carried is reported lost.
fn resolve_waterlogging(chunks: &Chunks, registry: &Registry, voxel: &Vec3<i32>, raw: u32) -> u32 {
    let resolved = carry_waterlogging(chunks, registry, voxel, raw);
    if !registry.is_overfull_waterlog(resolved) {
        return resolved;
    }
    log::error!(
        "{} at {:?} cannot hold water at stage {}: committed it dry, losing water at level {}",
        registry
            .get_block_by_id(BlockUtils::extract_id(resolved))
            .name,
        voxel,
        BlockUtils::extract_stage(resolved),
        BlockUtils::extract_waterlog_level(resolved),
    );
    BlockUtils::insert_waterlog_level(BlockUtils::insert_waterlogged(resolved, false), 0)
}

fn carry_waterlogging(chunks: &Chunks, registry: &Registry, voxel: &Vec3<i32>, raw: u32) -> u32 {
    let Some(fluid_id) = registry.waterlogging_fluid_id() else {
        return raw;
    };

    let Vec3(vx, vy, vz) = *voxel;
    let current_raw = chunks.get_raw_voxel(vx, vy, vz);
    let current_id = BlockUtils::extract_id(current_raw);
    let updated_id = BlockUtils::extract_id(raw);

    if updated_id == current_id {
        return raw;
    }

    let level = BlockUtils::extract_fluid_level(current_raw);
    let is_current_waterlogged = BlockUtils::extract_waterlogged(current_raw);

    if registry.is_air(updated_id) {
        if is_current_waterlogged {
            return VoxelPacker::new()
                .with_id(fluid_id)
                .with_stage(level)
                .pack();
        }
        return raw;
    }

    let holds_fluid = is_current_waterlogged || current_id == fluid_id;
    if holds_fluid && registry.is_waterloggable_voxel(raw) {
        return BlockUtils::insert_waterlog_level(BlockUtils::insert_waterlogged(raw, true), level);
    }

    raw
}

/// Pop up to `count` writes off `lane` onto `popped`, skipping any outside
/// the world's height or of no registered type. Returns how many it took off
/// the lane, skipped ones included.
fn pop_lane(
    chunks: &mut Chunks,
    registry: &Registry,
    max_height: i32,
    lane: UpdateLane,
    count: usize,
    popped: &mut Vec<(Vec3<i32>, u32, UpdateLane)>,
) -> usize {
    let count = count.min(chunks.lane_queue(lane).len());
    for _ in 0..count {
        let (voxel, raw) = chunks.lane_queue(lane).pop_front().unwrap();

        let updated_id = BlockUtils::extract_id(raw);
        if voxel.1 < 0 || voxel.1 >= max_height || !registry.has_type(updated_id) {
            continue;
        }

        popped.push((voxel, raw, lane));
    }
    count
}

/// What a tick's batches spent in each phase. Recorded once a tick, so the
/// profiler's averages stay per tick however many batches the tick took.
#[derive(Default)]
struct UpdatePhases {
    writes: std::time::Duration,
    consults: std::time::Duration,
    light: std::time::Duration,
}

/// What one tick's pass committed: every write, with the voxel and light
/// the whole tick left it, and whether the write budget stopped the external
/// lane with writes still queued.
struct UpdatePass {
    results: Vec<UpdateProtocol>,
    is_cut: bool,
}

fn process_pending_updates(
    chunks: &mut Chunks,
    mesher: &mut Mesher,
    lazy: &LazyUpdate,
    entities: &Entities,
    json_storage: &mut WriteStorage<JsonComp>,
    config: &WorldConfig,
    registry: &Registry,
    current_tick: u64,
    max_updates: usize,
    max_active_updates: usize,
) -> UpdatePass {
    let mut results = vec![];
    let max_height = config.max_height as i32;

    chunks.flush_staged_updates();
    chunks.readmit_parked_updates();

    // Consults carried from an earlier tick drain even when nothing is
    // written this one.
    if chunks.updates.is_empty()
        && chunks.active_updates.is_empty()
        && chunks.ticker_consults.is_empty()
    {
        return UpdatePass {
            results,
            is_cut: false,
        };
    }

    // Both lanes commit in batches until the tick's write budget is spent:
    // the simulation's first, then the external writes, so when a player and
    // the simulation both touch one voxel in the same tick, the player's word
    // is the one committed last and therefore kept. Each batch is lit in full
    // before the next pops, so the world between two batches is one a tick
    // could have ended on, and a bulk edit's or a felled tree's floods spread
    // over the ticks its writes do. Each lane commits at least one batch a
    // tick, so neither waits behind the other, and what a tick does not reach
    // stays at the head of its lane. Each budget is charged only for its own
    // work, consults across all the batches.
    let mut writes = TickBudget::paused(config.max_update_ms_per_tick);
    let mut consults = TickBudget::paused(config.max_ticker_consult_ms_per_tick);
    let mut phases = UpdatePhases::default();
    let per_batch = config.max_updates_per_batch.max(1);
    let mut batches = 0usize;
    let mut commit = |chunks: &mut Chunks,
                      popped: Vec<(Vec3<i32>, u32, UpdateLane)>,
                      results: &mut Vec<UpdateProtocol>,
                      writes: &mut TickBudget| {
        commit_batch(
            chunks,
            lazy,
            entities,
            json_storage,
            config,
            registry,
            current_tick,
            popped,
            results,
            writes,
            &mut consults,
            &mut phases,
        );
    };

    let mut active_left = max_active_updates;
    let mut is_active_cut = false;
    while active_left > 0 && !chunks.active_updates.is_empty() {
        if batches > 0 && writes.is_spent() {
            is_active_cut = true;
            break;
        }
        let mut popped = Vec::new();
        active_left -= pop_lane(
            chunks,
            registry,
            max_height,
            UpdateLane::Active,
            active_left.min(per_batch),
            &mut popped,
        );
        commit(chunks, popped, &mut results, &mut writes);
        batches += 1;
    }

    // A simulation write carried past this tick was planned from a world
    // without the external writes this tick commits after it: the one the
    // player made to its voxel supersedes it, as one staged after an
    // external write already is (`Chunks::flush_staged_updates`).
    let mut externally_written: HashSet<Vec3<i32>> = HashSet::new();
    let mut external_left = max_updates;
    let mut external_batches = 0usize;
    let mut is_cut = false;
    while external_left > 0 && !chunks.updates.is_empty() {
        if external_batches > 0 && writes.is_spent() {
            is_cut = true;
            break;
        }
        let mut popped = Vec::new();
        external_left -= pop_lane(
            chunks,
            registry,
            max_height,
            UpdateLane::External,
            external_left.min(per_batch),
            &mut popped,
        );
        if is_active_cut {
            externally_written.extend(popped.iter().map(|(voxel, _, _)| voxel.clone()));
        }
        commit(chunks, popped, &mut results, &mut writes);
        batches += 1;
        external_batches += 1;
    }
    if !externally_written.is_empty() {
        chunks.supersede_active_updates(&externally_written);
    }

    // Consults carried from an earlier tick drain in a tick that writes
    // nothing too.
    if batches == 0 {
        commit(chunks, Vec::new(), &mut results, &mut writes);
    }
    drop(commit);

    // Phase timings land in the generation profiler's 30s summary so a slow
    // tick can be read off the log instead of guessed at.
    record_profile("update: writes", phases.writes);
    record_profile("update: ticker consults", phases.consults);
    record_profile("update: light", phases.light);
    let phase_started = std::time::Instant::now();

    if !chunks.cache.is_empty() {
        let cache = chunks.cache.drain().collect::<Vec<Vec2<i32>>>();

        // Every chunk the pass borrowed needs a remesh, because light moved
        // through it. Only the ones whose voxels or height map actually
        // changed need a save.
        for coords in &cache {
            if chunks.is_chunk_save_dirty(coords) {
                chunks.add_chunk_to_save(coords, true);
            }
        }

        // Under client-only meshing the remesh job would only clear meshes
        // that are already empty and hand the chunk back a tick later, so the
        // chunk goes straight onto this tick's send queue instead.
        let is_sending_directly = config.client_only_meshing
            && perf_toggle(PerfToggle::SkipNoopRemesh);
        let mut processes = Vec::new();
        for coords in cache {
            if !chunks.is_chunk_ready(&coords) {
                continue;
            }
            if mesher.has_chunk(&coords) {
                mesher.mark_for_remesh(&coords);
                continue;
            }
            if is_sending_directly {
                chunks.add_chunk_to_send(&coords, &MessageType::Update, false);
                continue;
            }
            let space = chunks
                .make_space(&coords, config.max_light_level as usize)
                .needs_height_maps()
                .needs_voxels()
                .needs_lights()
                .build();
            let chunk = chunks.raw(&coords).unwrap().to_owned();
            processes.push((chunk, space));
        }
        if is_sending_directly {
            record_profile("update: direct send", phase_started.elapsed());
        } else {
            record_profile("update: build spaces", phase_started.elapsed());
        }

        if !processes.is_empty() {
            let phase_started = std::time::Instant::now();
            mesher.process(processes, &MessageType::Update, registry, config);
            record_profile("update: mesher.process", phase_started.elapsed());
        }
    }

    let results = results
        .into_iter()
        .map(|mut update| {
            update.voxel = chunks.get_raw_voxel(update.vx, update.vy, update.vz);
            update.light = chunks.get_raw_light(update.vx, update.vy, update.vz);
            update
        })
        .collect();
    UpdatePass { results, is_cut }
}

/// Commit one batch of popped writes, consult the tickers they touched as
/// far as `consults` allows, and light the batch in full. Each write it
/// commits goes onto `results`, whose voxel and light are read once the
/// whole tick is done. `writes` is charged for the commit and the light.
#[allow(clippy::too_many_arguments)]
fn commit_batch(
    chunks: &mut Chunks,
    lazy: &LazyUpdate,
    entities: &Entities,
    json_storage: &mut WriteStorage<JsonComp>,
    config: &WorldConfig,
    registry: &Registry,
    current_tick: u64,
    popped: Vec<(Vec3<i32>, u32, UpdateLane)>,
    results: &mut Vec<UpdateProtocol>,
    writes: &mut TickBudget,
    consults: &mut TickBudget,
    phases: &mut UpdatePhases,
) {
    let max_height = config.max_height as i32;
    let max_light_level = config.max_light_level;
    let phase_started = std::time::Instant::now();
    writes.resume();

    // Coupled units (doors, tall plants) change whole: a write to any part
    // brings the rest of its unit into this same batch, so the pair commits,
    // relights, remeshes, and replicates as one. The partner writes ride
    // outside the lane budgets — bounded by a unit's part count — because
    // half a unit is not a state the world may be left in between ticks.
    let popped = expand_coupled_updates(&*chunks, registry, max_height, popped);

    let mut updates_by_chunk: HashMap<Vec2<i32>, Vec<(Vec3<i32>, u32, UpdateLane)>> =
        HashMap::new();
    for (voxel, raw, lane) in popped {
        let coords = ChunkUtils::map_voxel_to_chunk(voxel.0, voxel.1, voxel.2, config.chunk_size);
        updates_by_chunk
            .entry(coords)
            .or_insert_with(Vec::new)
            .push((voxel, raw, lane));
    }

    let mut removed_light_sources = Vec::new();
    let mut processed_updates = Vec::new();

    // Voxels whose active tickers must be consulted once every write in this
    // call has committed. Written voxels and their neighbors are kept apart
    // because they consult under different rules (a written voxel may be
    // active air, a neighbor may not).
    let mut written_voxels: HashSet<Vec3<i32>> = HashSet::new();
    let mut neighbor_voxels: HashSet<Vec3<i32>> = HashSet::new();

    for (coords, chunk_updates) in updates_by_chunk {
        if !chunks.is_update_footprint_ready(&coords) {
            // Parked, not pushed back to the head of the lane: a chunk that
            // is still loading keeps its writes (in order, on their lane)
            // without letting them eat the budget every tick and starve
            // every write behind them. `readmit_parked_updates` at the top
            // of this pass returns them the tick the footprint is ready.
            chunks.park_updates(coords, chunk_updates);
            continue;
        }

        for (voxel, raw, _lane) in chunk_updates {
            let Vec3(vx, vy, vz) = voxel;
            let raw = resolve_waterlogging(&*chunks, registry, &voxel, raw);
            let updated_id = BlockUtils::extract_id(raw);
            let current_raw = chunks.get_raw_voxel(vx, vy, vz);
            if raw == current_raw {
                continue;
            }
            let current_id = BlockUtils::extract_id(current_raw);

            if registry.is_air(updated_id) && registry.is_air(current_id) {
                continue;
            }

            let current_type = registry.get_block_by_id(current_id);
            let updated_type = registry.get_block_by_id(updated_id);
            let voxel_pos = voxel.clone();

            let current_is_light = current_type.is_light_at(&voxel_pos, &*chunks);
            let updated_is_light = updated_type.is_light_at(&voxel_pos, &*chunks);

            if current_is_light && !updated_is_light {
                removed_light_sources.push((voxel.clone(), current_type.clone()));
            }

            processed_updates.push((voxel.clone(), raw, current_raw, current_id, updated_id));
            chunks.watch.note_write(&voxel, current_id, updated_id);

            let rotation = BlockUtils::extract_rotation(raw);
            let stage = BlockUtils::extract_stage(raw);
            let is_waterlogged = BlockUtils::extract_waterlogged(raw);
            let waterlog_level = BlockUtils::extract_waterlog_level(raw);
            let height = chunks.get_max_height(vx, vz);

            // State-only updates (fill level, lit state, waterlogging) must
            // preserve the block entity and its contents. A real replacement
            // or reorientation still follows the unlink/recreate lifecycle.
            let preserve_entity = current_id == updated_id
                && BlockUtils::extract_rotation(current_raw) == rotation
                && chunks.block_entities.contains_key(&voxel);
            let existing_entity = if preserve_entity {
                None
            } else {
                chunks.block_entities.remove(&voxel)
            };
            if let Some(existing_entity) = existing_entity {
                if current_type.name == "Chest" {
                    try_unlink_partner(&*chunks, json_storage, existing_entity);
                }
                lazy.exec_mut(move |world| {
                    world
                        .delete_entity(existing_entity)
                        .expect("Failed to delete entity");
                });
            }

            if updated_type.is_entity && !preserve_entity {
                let entity = entities.create();
                chunks.block_entities.insert(voxel.clone(), entity);
                lazy.insert(entity, IDComp::new(&nanoid!()));
                lazy.insert(entity, EntityFlag::default());
                lazy.insert(
                    entity,
                    ETypeComp::new(
                        &format!(
                            "block::{}",
                            &updated_type
                                .name
                                .to_lowercase()
                                .trim_start_matches("block::")
                        ),
                        true,
                    ),
                );
                lazy.insert(entity, MetadataComp::new());
                lazy.insert(entity, VoxelComp::new(voxel.0, voxel.1, voxel.2));
                lazy.insert(entity, CurrentChunkComp::default());
                let default_json = updated_type.default_entity_json.as_deref().unwrap_or("{}");

                if updated_type.name == "Chest" {
                    let y_rot = (raw >> 20) & 0xF;
                    try_link_chest(
                        &*chunks,
                        json_storage,
                        entity,
                        &voxel,
                        y_rot,
                        registry,
                        default_json,
                    );
                } else {
                    lazy.insert(entity, JsonComp::new(default_json));
                }
            }

            // resolve_waterlogging already chose id, stage, and waterlog fields.
            chunks.set_voxel_hard(vx, vy, vz, updated_id);
            chunks.set_voxel_stage(vx, vy, vz, stage);
            chunks.set_voxel_waterlogged(vx, vy, vz, is_waterlogged);
            chunks.set_voxel_waterlog_level(vx, vy, vz, waterlog_level);

            written_voxels.insert(voxel.clone());
            for [ox, oy, oz] in VOXEL_NEIGHBORS_WITH_STAIRS {
                neighbor_voxels.insert(Vec3(vx + ox, vy + oy, vz + oz));
            }

            if updated_type.rotation_bits_are_state {
                // Written as they came: decoding them as a rotation would fold
                // most values to "up".
                let written = chunks.get_raw_voxel(vx, vy, vz);
                chunks.set_raw_voxel(
                    vx,
                    vy,
                    vz,
                    (written & !ROTATION_BYTE_MASK) | (raw & ROTATION_BYTE_MASK),
                );
            } else if updated_type.rotatable || updated_type.y_rotatable {
                chunks.set_voxel_rotation(vx, vy, vz, &rotation);
            }

            if registry.is_air(updated_id) {
                if vy == height as i32 {
                    for y in (0..vy).rev() {
                        if y == 0 || registry.check_height(chunks.get_voxel(vx, y, vz)) {
                            chunks.set_max_height(vx, vz, y as u32);
                            break;
                        }
                    }
                }
            } else if height < vy as u32 {
                chunks.set_max_height(vx, vz, vy as u32);
            }

            chunks
                .voxel_affected_chunks(vx, vy, vz)
                .into_iter()
                .for_each(|c| {
                    chunks.cache.insert(c);
                });

            results.push(UpdateProtocol {
                vx,
                vy,
                vz,
                voxel: 0,
                light: 0,
            });
        }
    }

    phases.writes += phase_started.elapsed();
    let phase_started = std::time::Instant::now();

    // Ticker consults run only after every write in this batch has committed.
    // Consulting inline read half-applied state: when a door pair committed in
    // one batch, the top's write consulted the bottom's ticker while the
    // bottom still read closed, scheduling a zero-delay wake — and since
    // `mark_voxel_active` keeps the earliest deadline, the correct dwell
    // scheduled a moment later could never override it, so the door slammed
    // shut in the tick a button opened it. Post-commit, a ticker always sees
    // the state the tick actually produced.
    //
    // They queue rather than run outright, and drain under the tick's consult
    // budget: costly tickers beside a bulk edit (blocks whose ticker searches
    // their surroundings, woken by every write next to them) wake over a few
    // ticks instead of holding one for a tenth of a second. What a tick does
    // not reach waits at the head of the queue and runs after the next tick's
    // writes, so a carried consult still reads committed state; none is
    // dropped.
    neighbor_voxels.retain(|voxel| !written_voxels.contains(voxel));
    let mut touched: Vec<(Vec3<i32>, bool)> = written_voxels
        .into_iter()
        .map(|voxel| (voxel, true))
        .chain(neighbor_voxels.into_iter().map(|voxel| (voxel, false)))
        .collect();
    touched.sort_by_key(|(voxel, _)| (voxel.1, voxel.0, voxel.2));
    for (voxel, is_written) in touched {
        if wants_consult(chunks, registry, &voxel, is_written) {
            chunks.queue_ticker_consult(voxel, is_written);
        }
    }

    writes.pause();

    consults.resume();
    drain_ticker_consults(chunks, registry, current_tick, consults);
    consults.pause();

    phases.consults += phase_started.elapsed();
    let phase_started = std::time::Instant::now();
    writes.resume();

    // Removals across the whole batch are collected first and executed as one
    // BFS per color. Removing per voxel re-floods each removal from neighbors
    // whose light is stale (they are later updates in the same batch), which
    // leaks pre-update sunlight back into bulk-placed attenuating blocks such
    // as water. Batching zeroes every removal seed up front, so the re-flood
    // only draws from genuinely lit fringe voxels — matching the client's
    // light worker and the generation-time behavior.
    let mut sunlight_removals = Vec::new();
    let mut red_removals = Vec::new();
    let mut green_removals = Vec::new();
    let mut blue_removals = Vec::new();

    for (voxel, light_block) in &removed_light_sources {
        let voxel_pos = voxel.clone();
        let red_level = light_block.get_torch_light_level_at(&voxel_pos, &*chunks, &RED);
        let green_level = light_block.get_torch_light_level_at(&voxel_pos, &*chunks, &GREEN);
        let blue_level = light_block.get_torch_light_level_at(&voxel_pos, &*chunks, &BLUE);

        if red_level > 0 {
            red_removals.push(voxel.clone());
        }
        if green_level > 0 {
            green_removals.push(voxel.clone());
        }
        if blue_level > 0 {
            blue_removals.push(voxel.clone());
        }

        let Vec3(vx, vy, vz) = voxel;
        if light_block.is_opaque && chunks.get_sunlight(*vx, *vy, *vz) != 0 {
            sunlight_removals.push(voxel.clone());
        }
    }

    let mut torch_emissions: Vec<(Vec3<i32>, u32, LightColor)> = Vec::new();

    let mut red_flood = VecDeque::new();
    let mut green_flood = VecDeque::new();
    let mut blue_flood = VecDeque::new();
    let mut sun_flood = VecDeque::new();

    for (voxel, raw, current_raw, current_id, updated_id) in processed_updates {
        let Vec3(vx, vy, vz) = voxel;

        let current_type = registry.get_block_by_id(current_id);
        let updated_type = registry.get_block_by_id(updated_id);
        let voxel_pos = voxel.clone();

        let current_is_light = current_type.is_light_at(&voxel_pos, &*chunks);
        let updated_is_light = updated_type.is_light_at(&voxel_pos, &*chunks);
        let is_removed_light_source = current_is_light && !updated_is_light;

        if is_removed_light_source && !current_type.is_opaque {
            continue;
        }

        let rotation = BlockUtils::extract_rotation(raw);
        let current_rotation = BlockUtils::extract_rotation(current_raw);
        let current_transparency = current_type.get_rotated_transparency(&current_rotation);
        let updated_transparency = if updated_type.rotatable || updated_type.y_rotatable {
            updated_type.get_rotated_transparency(&rotation)
        } else {
            updated_type.is_transparent
        };

        // Light only ever reads four things about a voxel: whether it is
        // opaque, which faces let light through, how much it attenuates, and
        // what it emits. When none of those changed, the light field is
        // already exactly what a removal and reflood would recompute, so
        // skip both. This is what makes fluids cheap: a level change, or
        // air becoming non-attenuating water, used to tear down the cell's
        // whole sunlight column and flood it back to the same values — one
        // BFS per cell per step, the dominant cost of a spreading lake.
        // The client light analysis (`analyzeLightOperations`) mirrors this.
        let light_invariant = current_type.is_opaque == updated_type.is_opaque
            && current_type.light_attenuation == updated_type.light_attenuation
            && current_transparency == updated_transparency
            && !current_is_light
            && !updated_is_light;
        if light_invariant {
            continue;
        }

        if updated_type.is_opaque || updated_type.light_attenuation > 0 {
            if chunks.get_sunlight(vx, vy, vz) != 0 {
                sunlight_removals.push(voxel.clone());
            }
            if chunks.get_torch_light(vx, vy, vz, &RED) != 0 {
                red_removals.push(voxel.clone());
            }
            if chunks.get_torch_light(vx, vy, vz, &GREEN) != 0 {
                green_removals.push(voxel.clone());
            }
            if chunks.get_torch_light(vx, vy, vz, &BLUE) != 0 {
                blue_removals.push(voxel.clone());
            }
        } else {
            let mut remove_counts = 0;

            let light_data = [
                (&SUNLIGHT, chunks.get_sunlight(vx, vy, vz)),
                (&RED, chunks.get_red_light(vx, vy, vz)),
                (&GREEN, chunks.get_green_light(vx, vy, vz)),
                (&BLUE, chunks.get_blue_light(vx, vy, vz)),
            ];

            VOXEL_NEIGHBORS.iter().for_each(|&[ox, oy, oz]| {
                let nvy = vy + oy;
                if nvy < 0 || nvy >= max_height {
                    return;
                }

                let nvx = vx + ox;
                let nvz = vz + oz;

                let n_block = registry.get_block_by_id(chunks.get_voxel(nvx, nvy, nvz));
                let n_transparency =
                    n_block.get_rotated_transparency(&chunks.get_voxel_rotation(nvx, nvy, nvz));

                if !(Lights::can_enter(&current_transparency, &n_transparency, ox, oy, oz)
                    && !Lights::can_enter(&updated_transparency, &n_transparency, ox, oy, oz))
                {
                    return;
                }

                light_data.iter().for_each(|&(color, source_level)| {
                    let is_sunlight = *color == LightColor::Sunlight;

                    let n_level = if is_sunlight {
                        chunks.get_sunlight(nvx, nvy, nvz)
                    } else {
                        chunks.get_torch_light(nvx, nvy, nvz, color)
                    };

                    if n_level < source_level
                        || (oy == -1
                            && is_sunlight
                            && n_level == max_light_level
                            && source_level == max_light_level)
                    {
                        remove_counts += 1;
                        match color {
                            LightColor::Sunlight => sunlight_removals.push(Vec3(nvx, nvy, nvz)),
                            LightColor::Red => red_removals.push(Vec3(nvx, nvy, nvz)),
                            LightColor::Green => green_removals.push(Vec3(nvx, nvy, nvz)),
                            LightColor::Blue => blue_removals.push(Vec3(nvx, nvy, nvz)),
                        }
                    }
                });
            });

            if remove_counts == 0 {
                if chunks.get_sunlight(vx, vy, vz) != 0 {
                    sunlight_removals.push(voxel.clone());
                }
                if chunks.get_torch_light(vx, vy, vz, &RED) != 0 {
                    red_removals.push(voxel.clone());
                }
                if chunks.get_torch_light(vx, vy, vz, &GREEN) != 0 {
                    green_removals.push(voxel.clone());
                }
                if chunks.get_torch_light(vx, vy, vz, &BLUE) != 0 {
                    blue_removals.push(voxel.clone());
                }
            }
        }

        if updated_is_light {
            let red_level = updated_type.get_torch_light_level_at(&voxel_pos, &*chunks, &RED);
            let green_level = updated_type.get_torch_light_level_at(&voxel_pos, &*chunks, &GREEN);
            let blue_level = updated_type.get_torch_light_level_at(&voxel_pos, &*chunks, &BLUE);

            if red_level > 0 {
                chunks.set_torch_light(vx, vy, vz, red_level, &RED);
                torch_emissions.push((voxel.clone(), red_level, RED));
                red_flood.push_back(LightNode {
                    voxel: [voxel.0, voxel.1, voxel.2],
                    level: red_level,
                });
            }
            if green_level > 0 {
                chunks.set_torch_light(vx, vy, vz, green_level, &GREEN);
                torch_emissions.push((voxel.clone(), green_level, GREEN));
                green_flood.push_back(LightNode {
                    voxel: [voxel.0, voxel.1, voxel.2],
                    level: green_level,
                });
            }
            if blue_level > 0 {
                chunks.set_torch_light(vx, vy, vz, blue_level, &BLUE);
                torch_emissions.push((voxel.clone(), blue_level, BLUE));
                blue_flood.push_back(LightNode {
                    voxel: [voxel.0, voxel.1, voxel.2],
                    level: blue_level,
                });
            }
        } else if current_type.is_opaque && !updated_type.is_opaque {
            VOXEL_NEIGHBORS.iter().for_each(|&[ox, oy, oz]| {
                let nvy = vy + oy;

                if nvy < 0 {
                    return;
                }

                if nvy >= max_height {
                    if Lights::can_enter(&ALL_TRANSPARENT, &updated_transparency, ox, -1, oz) {
                        sun_flood.push_back(LightNode {
                            voxel: [vx + ox, vy, vz + oz],
                            level: max_light_level,
                        })
                    }
                    return;
                }

                let nvx = vx + ox;
                let nvz = vz + oz;

                let n_block = registry.get_block_by_id(chunks.get_voxel(nvx, nvy, nvz));
                let n_transparency =
                    n_block.get_rotated_transparency(&chunks.get_voxel_rotation(nvx, nvy, nvz));

                let n_voxel = [nvx, nvy, nvz];

                if !Lights::can_enter(&current_transparency, &n_transparency, ox, oy, oz)
                    && Lights::can_enter(&updated_transparency, &n_transparency, ox, oy, oz)
                {
                    let sun_val = chunks.get_sunlight(nvx, nvy, nvz);
                    let sun_level = beer_lambert_transmit(sun_val, updated_type.light_attenuation);
                    if sun_level > 0 {
                        sun_flood.push_back(LightNode {
                            voxel: n_voxel,
                            level: sun_level,
                        })
                    }

                    if !is_removed_light_source {
                        let red_val = chunks.get_torch_light(nvx, nvy, nvz, &RED);
                        let red_level =
                            beer_lambert_transmit(red_val, updated_type.light_attenuation);
                        if red_level > 0 {
                            red_flood.push_back(LightNode {
                                voxel: n_voxel,
                                level: red_level,
                            })
                        }

                        let green_val = chunks.get_torch_light(nvx, nvy, nvz, &GREEN);
                        let green_level =
                            beer_lambert_transmit(green_val, updated_type.light_attenuation);
                        if green_level > 0 {
                            green_flood.push_back(LightNode {
                                voxel: n_voxel,
                                level: green_level,
                            })
                        }

                        let blue_val = chunks.get_torch_light(nvx, nvy, nvz, &BLUE);
                        let blue_level =
                            beer_lambert_transmit(blue_val, updated_type.light_attenuation);
                        if blue_level > 0 {
                            blue_flood.push_back(LightNode {
                                voxel: n_voxel,
                                level: blue_level,
                            })
                        }
                    }
                }
            });
        }
    }

    let compute_bounds = |queue: &VecDeque<LightNode>| -> Option<(Vec3<i32>, Vec3<usize>)> {
        if queue.is_empty() {
            return None;
        }

        let mut min_x = queue[0].voxel[0];
        let mut min_y = queue[0].voxel[1];
        let mut min_z = queue[0].voxel[2];
        let mut max_x = min_x;
        let mut max_y = min_y;
        let mut max_z = min_z;

        for node in queue.iter() {
            let [x, y, z] = node.voxel;
            if x < min_x {
                min_x = x;
            }
            if y < min_y {
                min_y = y;
            }
            if z < min_z {
                min_z = z;
            }
            if x > max_x {
                max_x = x;
            }
            if y > max_y {
                max_y = y;
            }
            if z > max_z {
                max_z = z;
            }
        }

        let expand = max_light_level as i32;
        min_x -= expand;
        min_z -= expand;
        max_x += expand;
        max_z += expand;

        let shape_x = (max_x - min_x + 1) as usize;
        let shape_y = (max_y - min_y + 1) as usize;
        let shape_z = (max_z - min_z + 1) as usize;

        Some((Vec3(min_x, min_y, min_z), Vec3(shape_x, shape_y, shape_z)))
    };

    if !sunlight_removals.is_empty() {
        Lights::remove_lights(
            &mut *chunks,
            &sunlight_removals,
            &SUNLIGHT,
            config,
            registry,
        );
    }
    if !red_removals.is_empty() {
        Lights::remove_lights(&mut *chunks, &red_removals, &RED, config, registry);
    }
    if !green_removals.is_empty() {
        Lights::remove_lights(&mut *chunks, &green_removals, &GREEN, config, registry);
    }
    if !blue_removals.is_empty() {
        Lights::remove_lights(&mut *chunks, &blue_removals, &BLUE, config, registry);
    }

    // A removal can zero a torch level that a newly placed light source set
    // during this batch, so re-assert emissions before flooding from them.
    for (voxel, level, color) in &torch_emissions {
        let Vec3(vx, vy, vz) = *voxel;
        if chunks.get_torch_light(vx, vy, vz, color) < *level {
            chunks.set_torch_light(vx, vy, vz, *level, color);
        }
    }

    if !red_flood.is_empty() {
        let bounds = compute_bounds(&red_flood);
        Lights::flood_light(
            &mut *chunks,
            red_flood,
            &RED,
            registry,
            config,
            bounds.as_ref().map(|b| &b.0),
            bounds.as_ref().map(|b| &b.1),
        );
    }

    if !green_flood.is_empty() {
        let bounds = compute_bounds(&green_flood);
        Lights::flood_light(
            &mut *chunks,
            green_flood,
            &GREEN,
            registry,
            config,
            bounds.as_ref().map(|b| &b.0),
            bounds.as_ref().map(|b| &b.1),
        );
    }

    if !blue_flood.is_empty() {
        let bounds = compute_bounds(&blue_flood);
        Lights::flood_light(
            &mut *chunks,
            blue_flood,
            &BLUE,
            registry,
            config,
            bounds.as_ref().map(|b| &b.0),
            bounds.as_ref().map(|b| &b.1),
        );
    }

    if !sun_flood.is_empty() {
        let bounds = compute_bounds(&sun_flood);
        Lights::flood_light(
            &mut *chunks,
            sun_flood,
            &SUNLIGHT,
            registry,
            config,
            bounds.as_ref().map(|b| &b.0),
            bounds.as_ref().map(|b| &b.1),
        );
    }

    writes.pause();
    writes.spend();
    phases.light += phase_started.elapsed();
}

pub struct ChunkUpdatingSystem;

impl<'a> System<'a> for ChunkUpdatingSystem {
    type SystemData = (
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, Registry>,
        ReadExpect<'a, Stats>,
        ReadExpect<'a, ChunkInterests>,
        WriteExpect<'a, MessageQueues>,
        WriteExpect<'a, Chunks>,
        WriteExpect<'a, Mesher>,
        ReadExpect<'a, LazyUpdate>,
        Entities<'a>,
        WriteStorage<'a, JsonComp>,
        WriteExpect<'a, RandomTickCatchUp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (
            config,
            registry,
            stats,
            interests,
            mut message_queue,
            mut chunks,
            mut mesher,
            lazy,
            entities,
            mut json_storage,
            mut random_catch_up,
        ) = data;

        let current_tick = stats.tick as u64;
        let max_updates_per_tick = config.max_updates_per_tick;
        let max_active_updates_per_tick = config.max_active_updates_per_tick;

        chunks.clear_cache();

        // Plan, then commit. Every due updater reads the committed world and
        // proposes into one plan; the plan is queued on the simulation lane
        // and commits below, so lighting, persistence, replication, and
        // remeshing still flush once per tick. Planning stops when the tick's
        // plan budget is spent, and the due voxels it did not reach plan
        // first next tick.
        let plan_started = std::time::Instant::now();
        let mut plan = ActivePlan::new();
        let mut plan_budget = TickBudget::new(config.max_active_plan_ms_per_tick);
        let planned = plan_due_active_voxels(
            &mut chunks,
            &mut plan,
            &registry,
            current_tick,
            &mut plan_budget,
        );
        if planned > 0 {
            record_profile("update: plan active", plan_started.elapsed());
        }

        // Subchunk random-tick sampler (plants). Runs AFTER the
        // scheduled active queue so copper/neighbor wakes are never starved.
        // Newly marked voxels are popped immediately below so growth can
        // advance on the same world tick when budget allows.
        let _random_samples =
            sample_random_ticks(&mut chunks, &registry, &interests, &config, current_tick);
        // What the sampler missed: the extra world steps of a slow dispatch,
        // and chunks players came back to (see `random_tick_catch_up.rs`).
        if perf_toggle(PerfToggle::CatchUpWorldTime) {
            random_catch_up.observe(
                &interests,
                current_tick,
                config.max_random_tick_catch_up_ticks,
            );
            random_catch_up.pay(
                &mut chunks,
                &registry,
                &interests,
                &config,
                current_tick,
                stats.steps.saturating_sub(1),
                config.max_random_tick_catch_up_per_tick,
            );
        }

        plan_due_active_voxels(
            &mut chunks,
            &mut plan,
            &registry,
            current_tick,
            &mut plan_budget,
        );

        let mut active_updates = plan.into_iter().collect::<Vec<_>>();
        active_updates.sort_by_key(|(voxel, _)| (voxel.0, voxel.1, voxel.2));
        chunks.update_active_voxels(&active_updates);

        let UpdatePass {
            results: all_results,
            is_cut,
        } = process_pending_updates(
            &mut chunks,
            &mut mesher,
            &lazy,
            &entities,
            &mut json_storage,
            &config,
            &registry,
            current_tick,
            max_updates_per_tick,
            max_active_updates_per_tick,
        );

        if !all_results.is_empty() {
            let mut coalesced = HashMap::new();
            for update in all_results {
                coalesced.insert((update.vx, update.vy, update.vz), update);
            }
            let mut all_results = coalesced.into_values().collect::<Vec<_>>();
            all_results.sort_by(|a, b| (a.vx, a.vy, a.vz).cmp(&(b.vx, b.vy, b.vz)));

            // Route each update only to clients whose chunk interest covers a
            // chunk the update can affect: the updated chunk itself or any
            // chunk within the light-spill ring, since an edge update can
            // change light and ambient occlusion in neighbor-chunk meshes.
            // Everyone else receives the state baked into the chunk snapshot
            // they request when they approach or rejoin.
            let mut updates_by_chunk: HashMap<Vec2<i32>, Vec<UpdateProtocol>> = HashMap::new();
            for update in all_results {
                let coords = ChunkUtils::map_voxel_to_chunk(
                    update.vx,
                    update.vy,
                    update.vz,
                    config.chunk_size,
                );
                updates_by_chunk.entry(coords).or_default().push(update);
            }

            let mut updates_by_client: HashMap<String, Vec<UpdateProtocol>> = HashMap::new();
            for (coords, chunk_updates) in updates_by_chunk {
                let mut recipients: HashSet<String> = HashSet::new();
                for spill_coords in chunks.light_traversed_chunks(&coords) {
                    if let Some(interested) = interests.get_interests(&spill_coords) {
                        recipients.extend(interested.iter().cloned());
                    }
                }

                for client_id in recipients {
                    updates_by_client
                        .entry(client_id)
                        .or_default()
                        .extend(chunk_updates.iter().cloned());
                }
            }

            for (client_id, updates) in updates_by_client {
                let new_message = Message::new(&MessageType::Update).updates(&updates).build();
                message_queue.push((new_message, ClientFilter::Direct(client_id)));
            }
        }
        if let Some((ticks, peak)) = chunks.note_wake_backlog(current_tick) {
            log::info!(
                "[chunk-updating] caught up on wake work carried for {ticks} tick(s): at most {peak} ticker consults and due voxels waited past their tick's budget"
            );
        }
        if let Some((ticks, peak)) = chunks.note_write_backlog(current_tick, is_cut) {
            log::info!(
                "[chunk-updating] caught up on external writes carried past the write budget for {ticks} tick(s): at most {peak} waited"
            );
        }
    }
}

#[cfg(test)]
mod wake_budget_tests {
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use super::*;
    use crate::world::generators::FlatlandStage;
    use crate::{Block, Chunk, ChunkOptions, ChunkStatus, World};

    const WAKER: u32 = 7;
    const STONE: u32 = 8;

    type Calls = Arc<Mutex<Vec<Vec3<i32>>>>;

    /// An active block that never schedules itself and writes nothing,
    /// recording every consult of its ticker and every run of its updater.
    fn registry(consulted: &Calls, planned: &Calls) -> Registry {
        let (consulted, planned) = (consulted.clone(), planned.clone());
        let mut registry = Registry::new();
        registry.register_block(
            &Block::new("Waker")
                .id(WAKER)
                .active_fn(
                    move |voxel, _, _| {
                        consulted.lock().unwrap().push(voxel);
                        u64::MAX
                    },
                    move |voxel, _, _| {
                        planned.lock().unwrap().push(voxel);
                        vec![]
                    },
                )
                .build(),
        );
        registry.register_block(&Block::new("Stone").id(STONE).build());
        registry
    }

    /// One ready chunk at the origin, a waker at each of `wakers`.
    fn chunks_with(wakers: &[Vec3<i32>]) -> Chunks {
        let config = WorldConfig::new()
            .chunk_size(16)
            .max_height(16)
            .sub_chunks(1)
            .build();
        let mut chunks = Chunks::new(&config);
        let mut chunk = Chunk::new(
            "test",
            0,
            0,
            &ChunkOptions {
                size: 16,
                max_height: 16,
                sub_chunks: 1,
            },
        );
        chunk.status = ChunkStatus::Ready;
        for Vec3(x, y, z) in wakers {
            chunk.set_raw_voxel(*x, *y, *z, BlockUtils::insert_id(0, WAKER));
        }
        chunks.add(chunk);
        chunks
    }

    fn calls(calls: &Calls) -> Vec<Vec3<i32>> {
        calls.lock().unwrap().clone()
    }

    /// A budget spent before it starts: one unit a tick.
    fn one_unit() -> TickBudget {
        TickBudget::new(0.0)
    }

    #[test]
    fn due_voxels_past_the_plan_budget_plan_first_the_next_tick() {
        let (consulted, planned) = (Calls::default(), Calls::default());
        let registry = registry(&consulted, &planned);
        let (a, b, c, late) = (Vec3(1, 1, 1), Vec3(2, 1, 1), Vec3(3, 1, 1), Vec3(0, 1, 1));
        let mut chunks = chunks_with(&[a.clone(), b.clone(), c.clone(), late.clone()]);
        for voxel in [&a, &b, &c] {
            chunks.mark_voxel_active(voxel, 5);
        }
        chunks.mark_voxel_active(&late, 6);

        let mut plan = ActivePlan::new();
        for tick in 5..=9 {
            plan_due_active_voxels(&mut chunks, &mut plan, &registry, tick, &mut one_unit());
        }
        // `late` comes due at 6 and sorts first, but tick 5's leftovers go
        // ahead of it.
        assert_eq!(calls(&planned), vec![a, b, c, late]);
        assert_eq!(chunks.overdue_active_voxel_count(), 0);
        assert_eq!(chunks.active_voxel_count(), 0);
    }

    #[test]
    fn a_voxel_woken_while_overdue_runs_again_as_after_an_on_time_run() {
        let (consulted, planned) = (Calls::default(), Calls::default());
        let registry = registry(&consulted, &planned);
        let (a, b) = (Vec3(1, 1, 1), Vec3(2, 1, 1));
        let mut chunks = chunks_with(&[a.clone(), b.clone()]);
        chunks.mark_voxel_active(&a, 5);
        chunks.mark_voxel_active(&b, 5);

        let mut plan = ActivePlan::new();
        plan_due_active_voxels(&mut chunks, &mut plan, &registry, 5, &mut one_unit());
        assert_eq!(chunks.overdue_active_voxel_count(), 1);
        chunks.mark_voxel_active(&b, 8);
        for tick in 6..=9 {
            plan_due_active_voxels(&mut chunks, &mut plan, &registry, tick, &mut one_unit());
        }
        assert_eq!(calls(&planned), vec![a, b.clone(), b]);
    }

    #[test]
    fn a_voxel_due_again_while_it_waits_runs_once() {
        let (consulted, planned) = (Calls::default(), Calls::default());
        let registry = registry(&consulted, &planned);
        let (a, b, c) = (Vec3(1, 1, 1), Vec3(2, 1, 1), Vec3(3, 1, 1));
        let mut chunks = chunks_with(&[a.clone(), b.clone(), c.clone()]);
        for voxel in [&a, &b, &c] {
            chunks.mark_voxel_active(voxel, 5);
        }

        let mut plan = ActivePlan::new();
        plan_due_active_voxels(&mut chunks, &mut plan, &registry, 5, &mut one_unit());
        chunks.mark_voxel_active(&c, 6);
        for tick in 6..=9 {
            plan_due_active_voxels(&mut chunks, &mut plan, &registry, tick, &mut one_unit());
        }
        assert_eq!(calls(&planned), vec![a, b, c]);
    }

    #[test]
    fn ticker_consults_past_the_budget_wait_in_order_and_none_is_dropped() {
        let (consulted, planned) = (Calls::default(), Calls::default());
        let registry = registry(&consulted, &planned);
        let wakers = [Vec3(1, 1, 1), Vec3(2, 1, 1), Vec3(3, 1, 1)];
        let mut chunks = chunks_with(&wakers);
        for voxel in &wakers {
            chunks.queue_ticker_consult(voxel.clone(), true);
        }

        assert_eq!(
            drain_ticker_consults(&mut chunks, &registry, 5, &mut one_unit()),
            1
        );
        assert_eq!(chunks.pending_ticker_consults(), 2);
        let mut tick = 6;
        while drain_ticker_consults(&mut chunks, &registry, tick, &mut one_unit()) > 0 {
            tick += 1;
        }
        assert_eq!(calls(&consulted), wakers.to_vec());
        assert_eq!(chunks.pending_ticker_consults(), 0);
    }

    #[test]
    fn a_carried_consult_reads_the_world_it_runs_in() {
        let (consulted, planned) = (Calls::default(), Calls::default());
        let registry = registry(&consulted, &planned);
        let waker = Vec3(1, 1, 1);
        let mut chunks = chunks_with(&[waker.clone()]);
        chunks.queue_ticker_consult(waker.clone(), false);
        chunks.set_voxel_hard(1, 1, 1, STONE);

        assert_eq!(
            drain_ticker_consults(&mut chunks, &registry, 5, &mut one_unit()),
            1
        );
        assert!(calls(&consulted).is_empty());
    }

    #[test]
    fn a_voxel_queued_as_neighbor_and_written_consults_once_as_written() {
        let mut chunks = chunks_with(&[]);
        let voxel = Vec3(1, 1, 1);
        chunks.queue_ticker_consult(voxel.clone(), false);
        chunks.queue_ticker_consult(voxel.clone(), true);
        chunks.queue_ticker_consult(voxel.clone(), false);

        assert_eq!(chunks.pending_ticker_consults(), 1);
        assert_eq!(chunks.pop_ticker_consult(), Some((voxel, true)));
        assert_eq!(chunks.pop_ticker_consult(), None);
    }

    /// The whole pass, through real ticks: a write's consults past the
    /// budget run on the ticks after it, which write nothing at all.
    #[test]
    fn a_bulk_edit_wakes_its_wakers_over_the_ticks_after_it() {
        actix::System::new().block_on(async {
            let (consulted, planned) = (Calls::default(), Calls::default());
            let config = WorldConfig::new()
                .saving(false)
                .min_chunk([-3, -3])
                .max_chunk([3, 3])
                .max_ticker_consult_ms_per_tick(0.0)
                .build();
            let mut world = World::new("wake-budget", &config);
            world.ecs_mut().insert(registry(&consulted, &planned));
            world.pipeline_mut().add_stage(FlatlandStage::new());
            world.prepare();
            for x in -1..=1 {
                for z in -1..=1 {
                    world.pipeline_mut().add_chunk(&Vec2(x, z), false);
                }
            }
            let deadline = Instant::now() + Duration::from_secs(60);
            while !world.chunks().is_update_footprint_ready(&Vec2(0, 0)) {
                world.tick();
                assert!(Instant::now() < deadline, "the chunks never got ready");
                std::thread::sleep(Duration::from_millis(1));
            }

            let wakers: Vec<Vec3<i32>> = (1..=3).map(|x| Vec3(x, 1, 1)).collect();
            let writes: Vec<(Vec3<i32>, u32)> = wakers
                .iter()
                .map(|voxel| (voxel.clone(), BlockUtils::insert_id(0, WAKER)))
                .collect();
            world.chunks_mut().update_voxels(&writes);
            world.tick();
            assert_eq!(
                world.chunks().get_voxel(1, 1, 1),
                WAKER,
                "the write committed"
            );
            assert!(
                calls(&consulted).len() <= 1,
                "a spent budget consults one voxel a tick"
            );
            assert_eq!(
                world.chunks().pending_ticker_consults(),
                wakers.len() - calls(&consulted).len(),
                "only the wakers queue: the plain air round them has no ticker to ask"
            );

            while world.chunks().pending_ticker_consults() > 0 {
                world.tick();
                assert!(
                    Instant::now() < deadline,
                    "the carried consults never drained"
                );
            }
            assert_eq!(calls(&consulted), wakers);
            assert!(calls(&planned).is_empty());
        });
    }
}

#[cfg(test)]
mod write_budget_tests {
    use std::time::{Duration, Instant};

    use super::*;
    use crate::world::generators::FlatlandStage;
    use crate::{Block, LightUtils, World, WorldConfigBuilder};

    const STONE: u32 = 5;
    const GLASS: u32 = 6;
    const LAMP: u32 = 7;

    fn registry() -> Registry {
        let mut registry = Registry::new();
        registry.register_block(&Block::new("Stone").id(STONE).build());
        registry.register_block(&Block::new("Glass").id(GLASS).is_transparent(true).build());
        registry.register_block(
            &Block::new("Lamp")
                .id(LAMP)
                .is_transparent(true)
                .red_light_level(12)
                .build(),
        );
        registry
    }

    /// Ready chunks round the origin, open to the sky, under `config`.
    fn world(name: &str, config: impl FnOnce(WorldConfigBuilder) -> WorldConfigBuilder) -> World {
        let config = config(
            WorldConfig::new()
                .saving(false)
                .min_chunk([-3, -3])
                .max_chunk([3, 3]),
        )
        .build();
        let mut world = World::new(name, &config);
        world.ecs_mut().insert(registry());
        world.pipeline_mut().add_stage(FlatlandStage::new());
        world.prepare();
        for x in -1..=1 {
            for z in -1..=1 {
                world.pipeline_mut().add_chunk(&Vec2(x, z), false);
            }
        }
        let deadline = Instant::now() + Duration::from_secs(60);
        while !world.chunks().is_update_footprint_ready(&Vec2(0, 0)) {
            world.tick();
            assert!(Instant::now() < deadline, "the chunks never got ready");
            std::thread::sleep(Duration::from_millis(1));
        }
        world
    }

    /// Ticks until every queued write has landed.
    fn settle(world: &mut World) {
        let deadline = Instant::now() + Duration::from_secs(60);
        while world.chunks().pending_updates_count() > 0 {
            world.tick();
            assert!(Instant::now() < deadline, "the writes never all landed");
        }
    }

    /// The voxels written, in the order the external lane commits them.
    fn lane_order(writes: &[(Vec3<i32>, u32)]) -> Vec<Vec3<i32>> {
        let mut order: Vec<Vec3<i32>> = writes.iter().map(|(voxel, _)| voxel.clone()).collect();
        order.sort_by_key(|voxel| (voxel.1, voxel.0, voxel.2));
        order
    }

    /// A budget the first batch spends: each tick commits one batch, the next
    /// writes in lane order, until the last commits what is left.
    #[test]
    fn writes_past_the_budget_land_a_batch_a_tick_in_order_and_none_is_dropped() {
        actix::System::new().block_on(async {
            let mut world = world("write-budget-order", |config| {
                config.max_updates_per_batch(37).max_update_ms_per_tick(0.0)
            });
            let writes: Vec<(Vec3<i32>, u32)> = (0..10)
                .flat_map(|x| (0..10).map(move |z| (Vec3(x, 3, z), STONE)))
                .collect();
            let order = lane_order(&writes);
            world.chunks_mut().update_voxels(&writes);
            for tick in 1..=3 {
                world.tick();
                let landed = (37 * tick).min(writes.len());
                let chunks = world.chunks();
                for (index, voxel) in order.iter().enumerate() {
                    assert_eq!(
                        chunks.get_voxel(voxel.0, voxel.1, voxel.2) == STONE,
                        index < landed,
                        "after tick {tick}: write {index} of {} in lane order, at {voxel:?}",
                        order.len()
                    );
                }
            }
            assert_eq!(world.chunks().pending_updates_count(), 0);
        });
    }

    /// With time to spare, a tick takes batch after batch up to its count
    /// cap, and the next tick picks up where it stopped.
    #[test]
    fn a_tick_with_time_to_spare_takes_batches_up_to_its_count() {
        actix::System::new().block_on(async {
            let mut world = world("write-budget-count", |config| {
                config
                    .max_updates_per_batch(7)
                    .max_update_ms_per_tick(f64::MAX)
                    .max_updates_per_tick(30)
            });
            let writes: Vec<(Vec3<i32>, u32)> = (0..50)
                .map(|index| (Vec3(index % 10, 3 + index / 10, 1), STONE))
                .collect();
            let order = lane_order(&writes);
            world.chunks_mut().update_voxels(&writes);
            for (tick, landed) in [(1, 30), (2, 50)] {
                world.tick();
                let chunks = world.chunks();
                let is_stone =
                    |voxel: &Vec3<i32>| chunks.get_voxel(voxel.0, voxel.1, voxel.2) == STONE;
                let leading = order.iter().take_while(|voxel| is_stone(voxel)).count();
                let total = order.iter().filter(|voxel| is_stone(voxel)).count();
                assert_eq!((leading, total), (landed, landed), "after tick {tick}");
            }
        });
    }

    /// A stone room with one hole in its roof and a lamp in a wall, full of
    /// stone inside: what `hollow` then empties.
    fn room() -> Vec<(Vec3<i32>, u32)> {
        let mut writes = Vec::new();
        for x in 2..=12 {
            for y in 0..=10 {
                for z in 2..=12 {
                    let block = match (x, y, z) {
                        (7, 10, 7) => continue,
                        (2, 5, 7) => LAMP,
                        _ => STONE,
                    };
                    writes.push((Vec3(x, y, z), block));
                }
            }
        }
        writes
    }

    /// The room's inside, emptied.
    fn hollow() -> Vec<(Vec3<i32>, u32)> {
        (3..=11)
            .flat_map(|x| (1..=9).flat_map(move |y| (3..=11).map(move |z| (Vec3(x, y, z), 0))))
            .collect()
    }

    /// Every voxel and light word in and round the room.
    fn field(world: &World) -> Vec<(Vec3<i32>, u32, u32)> {
        let chunks = world.chunks();
        let mut field = Vec::new();
        for x in 0..=14 {
            for y in 0..=12 {
                for z in 0..=14 {
                    field.push((
                        Vec3(x, y, z),
                        chunks.get_raw_voxel(x, y, z),
                        chunks.get_raw_light(x, y, z),
                    ));
                }
            }
        }
        field
    }

    /// The lane splits a bulk edit wherever its budget falls, and lights each
    /// batch in full before the next: the room ends up lit exactly as one
    /// batch lights it, split within a tick or across ticks.
    #[test]
    fn a_split_bulk_edit_lights_the_world_as_one_batch_does() {
        actix::System::new().block_on(async {
            let lit = |name: &str, per_batch: usize, budget_ms: f64| {
                let mut world = world(name, |config| {
                    config
                        .max_updates_per_batch(per_batch)
                        .max_update_ms_per_tick(budget_ms)
                });
                world.chunks_mut().update_voxels(&room());
                settle(&mut world);
                world.chunks_mut().update_voxels(&hollow());
                settle(&mut world);
                field(&world)
            };
            let whole = lit("write-budget-whole", usize::MAX, f64::MAX);
            let light_at = |at: Vec3<i32>| {
                whole
                    .iter()
                    .find(|(voxel, _, _)| *voxel == at)
                    .map(|(_, _, light)| *light)
                    .unwrap()
            };
            assert_eq!(
                LightUtils::extract_sunlight(light_at(Vec3(7, 1, 7))),
                15,
                "sunlight falls through the hole to the floor"
            );
            let corner = LightUtils::extract_sunlight(light_at(Vec3(3, 1, 3)));
            assert!(corner > 0 && corner < 15, "the far corner is dim, not {corner}");
            assert_eq!(
                LightUtils::extract_red_light(light_at(Vec3(3, 5, 7))),
                11,
                "the lamp lights the room"
            );

            for (name, per_batch, budget_ms, how) in [
                ("write-budget-batches", 37, f64::MAX, "37-write batches in one tick"),
                ("write-budget-ticks", 37, 0.0, "one 37-write batch a tick"),
            ] {
                let split = lit(name, per_batch, budget_ms);
                if let Some(((voxel, raw, light), (_, split_raw, split_light))) =
                    whole.iter().zip(&split).find(|(one, other)| one != other)
                {
                    panic!(
                        "{how}: {voxel:?} holds voxel {split_raw} light {split_light:#x}, where one batch leaves voxel {raw} light {light:#x}"
                    );
                }
            }
        });
    }

    /// A write from an early batch goes out with the light the tick's later
    /// batches gave it: glass set on the floor of a sealed box, with the
    /// roof above it opened a batch later, replicates in full sunlight.
    #[test]
    fn an_early_batch_replicates_with_the_light_a_later_batch_let_in() {
        actix::System::new().block_on(async {
            let mut world = world("write-budget-replicate", |config| {
                config
                    .max_updates_per_batch(1)
                    .max_update_ms_per_tick(f64::MAX)
            });
            let shell: Vec<(Vec3<i32>, u32)> = (2..=6)
                .flat_map(|x| (0..=6).flat_map(move |y| (2..=6).map(move |z| (x, y, z))))
                .filter(|&(x, y, z)| x == 2 || x == 6 || y == 0 || y == 6 || z == 2 || z == 6)
                .map(|(x, y, z)| (Vec3(x, y, z), STONE))
                .collect();
            world.chunks_mut().update_voxels(&shell);
            settle(&mut world);
            assert_eq!(world.chunks().get_sunlight(4, 1, 4), 0, "the box is sealed");

            world
                .chunks_mut()
                .update_voxels(&[(Vec3(4, 1, 4), GLASS), (Vec3(4, 6, 4), 0)]);
            let pass = {
                let ecs = world.ecs();
                let mut chunks = ecs.write_resource::<Chunks>();
                let mut mesher = ecs.write_resource::<Mesher>();
                let lazy = ecs.read_resource::<LazyUpdate>();
                let entities = ecs.entities();
                let mut json_storage = ecs.write_storage::<JsonComp>();
                let config = ecs.read_resource::<WorldConfig>();
                let registry = ecs.read_resource::<Registry>();
                process_pending_updates(
                    &mut chunks,
                    &mut mesher,
                    &lazy,
                    &entities,
                    &mut json_storage,
                    &config,
                    &registry,
                    0,
                    config.max_updates_per_tick,
                    config.max_active_updates_per_tick,
                )
            };
            assert!(!pass.is_cut, "a budget this size never cuts the lane");
            let glass = pass
                .results
                .iter()
                .find(|update| (update.vx, update.vy, update.vz) == (4, 1, 4))
                .expect("the glass is among the tick's writes");
            assert_eq!(BlockUtils::extract_id(glass.voxel), GLASS);
            assert_eq!(
                LightUtils::extract_sunlight(glass.light),
                15,
                "the glass goes out lit by the hole its tick opened"
            );
        });
    }

    /// Only the stretches a budget runs for are charged, and its first unit
    /// always runs.
    #[test]
    fn a_budget_charges_only_its_own_stretches() {
        let mut budget = TickBudget::paused(40.0);
        budget.resume();
        budget.spend();
        budget.pause();
        std::thread::sleep(Duration::from_millis(80));
        assert!(!budget.is_spent(), "the pause was charged");
        budget.resume();
        std::thread::sleep(Duration::from_millis(50));
        assert!(budget.is_spent(), "running past the limit spends it");

        let mut spent = TickBudget::paused(0.0);
        assert!(!spent.is_spent(), "the first unit always runs");
        spent.spend();
        assert!(spent.is_spent());
    }

    /// The simulation's writes keep to the budget too: a felled tree's
    /// removal or a lake's spill lands a batch a tick, in lane order.
    #[test]
    fn simulation_writes_past_the_budget_land_a_batch_a_tick_in_order_and_none_is_dropped() {
        actix::System::new().block_on(async {
            let mut world = world("write-budget-simulation", |config| {
                config.max_updates_per_batch(37).max_update_ms_per_tick(0.0)
            });
            let writes: Vec<(Vec3<i32>, u32)> = (0..10)
                .flat_map(|x| (0..10).map(move |z| (Vec3(x, 3, z), STONE)))
                .collect();
            let order = lane_order(&writes);
            world.chunks_mut().update_active_voxels(&writes);
            for tick in 1..=3 {
                world.tick();
                let landed = (37 * tick).min(writes.len());
                let chunks = world.chunks();
                for (index, voxel) in order.iter().enumerate() {
                    assert_eq!(
                        chunks.get_voxel(voxel.0, voxel.1, voxel.2) == STONE,
                        index < landed,
                        "after tick {tick}: simulation write {index} of {} in lane order, at {voxel:?}",
                        order.len()
                    );
                }
            }
            assert_eq!(world.chunks().pending_updates_count(), 0);
        });
    }

    /// Neither lane waits behind the other: with the budget spent by the
    /// first batch, each still commits a batch every tick.
    #[test]
    fn each_lane_commits_a_batch_a_tick_whatever_the_other_spent() {
        actix::System::new().block_on(async {
            let mut world = world("write-budget-lanes", |config| {
                config.max_updates_per_batch(10).max_update_ms_per_tick(0.0)
            });
            let simulated: Vec<(Vec3<i32>, u32)> =
                (0..30).map(|index| (Vec3(index % 10, 3, index / 10), STONE)).collect();
            let edited: Vec<(Vec3<i32>, u32)> =
                (0..30).map(|index| (Vec3(index % 10, 5, index / 10), GLASS)).collect();
            world.chunks_mut().update_active_voxels(&simulated);
            world.chunks_mut().update_voxels(&edited);
            for tick in 1..=3 {
                world.tick();
                let chunks = world.chunks();
                let landed = |writes: &[(Vec3<i32>, u32)]| {
                    writes
                        .iter()
                        .filter(|(voxel, id)| chunks.get_voxel(voxel.0, voxel.1, voxel.2) == *id)
                        .count()
                };
                assert_eq!(
                    (landed(&simulated), landed(&edited)),
                    (10 * tick, 10 * tick),
                    "after tick {tick}: (simulation, external) writes landed"
                );
            }
        });
    }

    /// A simulation write carried past a tick in which the player's write to
    /// its voxel commits is superseded by it, as one staged after it is: the
    /// player's word stays.
    #[test]
    fn a_carried_simulation_write_yields_to_the_player_write_committed_before_it() {
        actix::System::new().block_on(async {
            let mut world = world("write-budget-supersede", |config| {
                config.max_updates_per_batch(2).max_update_ms_per_tick(0.0)
            });
            let contested = Vec3(5, 6, 5);
            world.chunks_mut().update_voxels(&[
                (Vec3(1, 2, 1), STONE),
                (Vec3(2, 2, 1), STONE),
                (contested.clone(), GLASS),
            ]);
            world.tick();
            assert_eq!(
                world.chunks().get_voxel(5, 6, 5),
                0,
                "the player's write to the contested voxel is carried"
            );
            let simulated = [
                (Vec3(1, 3, 1), STONE),
                (Vec3(2, 3, 1), STONE),
                (Vec3(3, 3, 1), STONE),
                (contested.clone(), STONE),
            ];
            world.chunks_mut().update_active_voxels(&simulated);
            settle(&mut world);
            let chunks = world.chunks();
            assert_eq!(
                chunks.get_voxel(5, 6, 5),
                GLASS,
                "the player's word is kept over the simulation write planned before it landed"
            );
            assert_eq!(
                chunks.superseded_active_updates(),
                1,
                "the simulation write it superseded is counted"
            );
            for (voxel, _) in &simulated[..3] {
                assert_eq!(
                    chunks.get_voxel(voxel.0, voxel.1, voxel.2),
                    STONE,
                    "the simulation's other writes all landed, at {voxel:?}"
                );
            }
        });
    }

    /// A removal the simulation carries past a tick (a felled tree's wood
    /// going to air under the budget) and a player's block placed where it
    /// was still to go: the block stays, and the removal it superseded is
    /// counted, not lost without a trace.
    #[test]
    fn a_player_write_over_a_carried_removal_wins_and_is_counted() {
        actix::System::new().block_on(async {
            let mut world = world("write-budget-carried-removal", |config| {
                config.max_updates_per_batch(2).max_update_ms_per_tick(0.0)
            });
            let wood: Vec<(Vec3<i32>, u32)> = (1..=4).map(|x| (Vec3(x, 3, 1), STONE)).collect();
            world.chunks_mut().update_voxels(&wood);
            settle(&mut world);
            let removal: Vec<(Vec3<i32>, u32)> =
                wood.iter().map(|(voxel, _)| (voxel.clone(), 0)).collect();
            world.chunks_mut().update_active_voxels(&removal);
            world.tick();
            let placed = Vec3(4, 3, 1);
            assert_eq!(
                world.chunks().get_voxel(placed.0, placed.1, placed.2),
                STONE,
                "the last of the removal is carried past the first tick"
            );
            let before = world.chunks().superseded_active_updates();

            world.chunks_mut().update_voxel(&placed, GLASS);
            settle(&mut world);
            let chunks = world.chunks();
            assert_eq!(
                chunks.get_voxel(placed.0, placed.1, placed.2),
                GLASS,
                "the player's block stays where the removal was still to go"
            );
            assert_eq!(chunks.superseded_active_updates(), before + 1);
            for x in 1..=3 {
                assert_eq!(chunks.get_voxel(x, 3, 1), 0, "the rest of the removal landed at x {x}");
            }
        });
    }

    /// The simulation lane splits its writes wherever the budget falls and
    /// lights each batch in full before the next, as the external lane does:
    /// a room emptied by the simulation ends up lit exactly as one batch
    /// lights it.
    #[test]
    fn a_split_simulation_lane_lights_the_world_as_one_batch_does() {
        actix::System::new().block_on(async {
            let lit = |name: &str, per_batch: usize, budget_ms: f64| {
                let mut world = world(name, |config| {
                    config
                        .max_updates_per_batch(per_batch)
                        .max_update_ms_per_tick(budget_ms)
                });
                world.chunks_mut().update_voxels(&room());
                settle(&mut world);
                world.chunks_mut().update_active_voxels(&hollow());
                settle(&mut world);
                field(&world)
            };
            let whole = lit("simulation-budget-whole", usize::MAX, f64::MAX);
            for (name, per_batch, budget_ms, how) in [
                ("simulation-budget-batches", 37, f64::MAX, "37-write batches in one tick"),
                ("simulation-budget-ticks", 37, 0.0, "one 37-write batch a tick"),
            ] {
                let split = lit(name, per_batch, budget_ms);
                if let Some(((voxel, raw, light), (_, split_raw, split_light))) =
                    whole.iter().zip(&split).find(|(one, other)| one != other)
                {
                    panic!(
                        "{how}: {voxel:?} holds voxel {split_raw} light {split_light:#x}, where one batch leaves voxel {raw} light {light:#x}"
                    );
                }
            }
        });
    }
}
