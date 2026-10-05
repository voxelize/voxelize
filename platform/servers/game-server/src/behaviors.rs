//! Block behaviours from content data, run by the engine's active-voxel and
//! random-tick machinery:
//!
//! | behaviour | when | effect |
//! | --- | --- | --- |
//! | `falls` | whenever the block below becomes empty | moves down one cell per update (sand, gravel) |
//! | `support` (field) | whenever the block below changes | breaks and drops when the block below is not one it can stand on |
//! | `spreads` | random tick | turf spreads to lit dirt nearby; turns to dirt when covered |
//! | `decays` | random tick | natural leaves with no log within 4 blocks fall apart and drop |
//! | `grows` | random tick, light ≥ 9 | crops advance a stage (faster on watered farmland); saplings grow into trees |
//! | `melts` | random tick | ice next to bright block light turns to water |
//! | `dries` | random tick | farmland with no water nearby and nothing planted turns back to dirt |
//! | `burns` | every 1-2 s | fire: burns flammable neighbours away, spreads to air beside flammable blocks, ages and dies out (never on cinderstone), goes out next to water or without fuel |
//!
//! Updaters only see the world and return voxel writes, so drops from
//! blocks broken here are queued in [`BrokenBlocks`] and spawned by the
//! gameplay system.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use platform_content::{BlockBehavior, BlockDef, Content, FluidKind, TreeDef};
use voxelize::{BlockRotation, BlockUtils, Registry, Vec3, VoxelAccess, VoxelUpdate};

pub const AIR: u32 = 0;
/// Stage bit marking player-placed leaves, which never decay.
pub const PERSISTENT_STAGE: u32 = 1;

/// A block broken by a behaviour, waiting for its drops to be spawned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Broken {
    pub voxel: [i32; 3],
    pub raw: u32,
}

/// The id of the land claim covering a column, if any.
pub type LandOf = Arc<dyn Fn(i32, i32) -> Option<String> + Send + Sync>;

#[derive(Default)]
pub struct BrokenBlocks(
    Mutex<Vec<Broken>>,
    Mutex<Vec<[i32; 3]>>,
    std::sync::atomic::AtomicBool,
    std::sync::RwLock<Option<LandOf>>,
);

impl std::fmt::Debug for BrokenBlocks {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BrokenBlocks").finish_non_exhaustive()
    }
}

impl BrokenBlocks {
    /// How behaviours see land claims (actuators keep to one claim).
    pub fn set_land_of(&self, land_of: LandOf) {
        if let Ok(mut slot) = self.3.write() {
            *slot = Some(land_of);
        }
    }

    /// Whether every cell lies in the same claim (or all unclaimed).
    pub fn same_land(&self, cells: &[&Vec3<i32>]) -> bool {
        let Ok(slot) = self.3.read() else {
            return false;
        };
        let Some(land_of) = slot.as_ref() else {
            return true;
        };
        let mut owners = cells.iter().map(|c| land_of(c.0, c.2));
        let first = owners.next().flatten();
        owners.all(|o| o == first)
    }

    /// Whether it rains in this world (set by the weather).
    pub fn set_raining(&self, raining: bool) {
        self.2.store(raining, Ordering::Relaxed);
    }

    pub fn raining(&self) -> bool {
        self.2.load(Ordering::Relaxed)
    }

    /// A blast charge set off by fire (its block is already gone).
    pub fn push_primed(&self, voxel: [i32; 3]) {
        if let Ok(mut q) = self.1.lock() {
            q.push(voxel);
        }
    }

    pub fn drain_primed(&self) -> Vec<[i32; 3]> {
        self.1
            .lock()
            .map(|mut q| std::mem::take(&mut *q))
            .unwrap_or_default()
    }

    pub fn push(&self, voxel: Vec3<i32>, raw: u32) {
        if let Ok(mut q) = self.0.lock() {
            q.push(Broken {
                voxel: [voxel.0, voxel.1, voxel.2],
                raw,
            });
        }
    }

    pub fn drain(&self) -> Vec<Broken> {
        self.0
            .lock()
            .map(|mut q| std::mem::take(&mut *q))
            .unwrap_or_default()
    }
}

/// How a block takes part in circuits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Logic {
    Conduit,
    Lever,
    Button,
    Plate,
    Clock,
    /// `partner`: the other half of a two-voxel consumer (doors), which
    /// shares its power and switches with it.
    Consumer {
        powered: bool,
        swap: u32,
        partner: Option<(i32, i32, i32)>,
    },
    Repeater,
    Inverter,
    Actuator,
    GripActuator,
    Watcher,
    Gauge,
}

/// Ticks a pressed button stays on.
pub const BUTTON_TICKS: u64 = 60;
/// Ticks between a fire's updates (plus up to as many again at random).
pub const FIRE_TICKS: u64 = 30;
/// A fire's age (stage) at which it dies out.
pub const FIRE_MAX_AGE: u32 = 15;
/// Pulse clock periods, selected by stage bits 1..=2.
pub const CLOCK_PERIODS: [u64; 4] = [30, 60, 120, 240];

/// Facts about the content pack that behaviours need, shared by every
/// block's closures.
pub struct BehaviorContext {
    pub logic: HashMap<u32, Logic>,
    /// Blocks an actuator may not push (containers, unbreakable blocks).
    immovable: HashSet<u32>,
    pub broken: Arc<BrokenBlocks>,
    dirt: Option<u32>,
    turf: Option<u32>,
    water: HashSet<u32>,
    logs: HashSet<u32>,
    opaque: HashSet<u32>,
    crops_on_farmland: HashSet<u32>,
    flammable: HashSet<u32>,
    /// Blocks fire burns on forever.
    eternal_fire: HashSet<u32>,
    fire: Option<u32>,
    blast: Option<u32>,
    /// Blocks a gauge reads (anything with a container window).
    containers: HashSet<u32>,
    /// What each watcher last saw in front of it.
    watched: Mutex<HashMap<(i32, i32, i32), u32>>,
    counter: AtomicU64,
}

impl BehaviorContext {
    pub fn new(content: &Content, broken: Arc<BrokenBlocks>) -> Self {
        let id = |key: &str| content.block(key).map(|b| b.id);
        let blocks = content.blocks();
        let mut logic = HashMap::new();
        for b in blocks {
            let has = |x: BlockBehavior| b.behaviors.contains(&x);
            let kind = if has(BlockBehavior::Conduit) {
                Some(Logic::Conduit)
            } else if has(BlockBehavior::Lever) {
                Some(Logic::Lever)
            } else if has(BlockBehavior::Button) {
                Some(Logic::Button)
            } else if has(BlockBehavior::Plate) {
                Some(Logic::Plate)
            } else if has(BlockBehavior::Clock) {
                Some(Logic::Clock)
            } else if has(BlockBehavior::Consumer) {
                b.power_swap
                    .as_ref()
                    .and_then(|k| content.block(k))
                    .map(|swap| Logic::Consumer {
                        powered: b.powered,
                        swap: swap.id,
                        partner: b
                            .coupled
                            .as_ref()
                            .map(|c| (c.offset[0], c.offset[1], c.offset[2])),
                    })
            } else if has(BlockBehavior::Repeater) {
                Some(Logic::Repeater)
            } else if has(BlockBehavior::Inverter) {
                Some(Logic::Inverter)
            } else if has(BlockBehavior::Actuator) {
                Some(Logic::Actuator)
            } else if has(BlockBehavior::GripActuator) {
                Some(Logic::GripActuator)
            } else if has(BlockBehavior::Watcher) {
                Some(Logic::Watcher)
            } else if has(BlockBehavior::Gauge) {
                Some(Logic::Gauge)
            } else {
                None
            };
            if let Some(kind) = kind {
                logic.insert(b.id, kind);
            }
        }
        let immovable = blocks
            .iter()
            .filter(|b| {
                b.hardness < 0.0
                    || crate::gameplay::containers::Container::for_block(content, &b.key).is_some()
                    || b.coupled.is_some()
                    || b.fluid.is_some()
            })
            .map(|b| b.id)
            .collect();
        Self {
            logic,
            immovable,
            broken,
            dirt: id("dirt"),
            turf: id("turf"),
            water: blocks
                .iter()
                .filter(|b| b.fluid == Some(FluidKind::Water))
                .map(|b| b.id)
                .collect(),
            logs: blocks
                .iter()
                .filter(|b| b.key.ends_with("_log"))
                .map(|b| b.id)
                .collect(),
            opaque: blocks
                .iter()
                .filter(|b| b.collision && !b.transparent && b.fluid.is_none())
                .map(|b| b.id)
                .collect(),
            crops_on_farmland: blocks
                .iter()
                .filter(|b| b.support.iter().any(|s| s == "farmland") && b.grows_into.is_none())
                .map(|b| b.id)
                .collect(),
            flammable: blocks
                .iter()
                .filter(|b| b.flammable)
                .map(|b| b.id)
                .collect(),
            eternal_fire: blocks
                .iter()
                .filter(|b| b.key == "cinderstone")
                .map(|b| b.id)
                .collect(),
            fire: id("fire"),
            blast: id("blast_charge"),
            containers: blocks
                .iter()
                .filter(|b| {
                    crate::gameplay::containers::Container::for_block(content, &b.key).is_some()
                })
                .map(|b| b.id)
                .collect(),
            watched: Mutex::new(HashMap::new()),
            counter: AtomicU64::new(0x5EED),
        }
    }

    /// A pseudo-random number for a position; varies between calls.
    fn roll(&self, v: &Vec3<i32>) -> u64 {
        let n = self
            .counter
            .fetch_add(0x9E37_79B9_7F4A_7C15, Ordering::Relaxed);
        let mut z = n ^ (v.0 as u64).rotate_left(21) ^ (v.1 as u64).rotate_left(42) ^ v.2 as u64;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn water_near(&self, space: &dyn VoxelAccess, Vec3(x, y, z): &Vec3<i32>, radius: i32) -> bool {
        for dx in -radius..=radius {
            for dz in -radius..=radius {
                for dy in 0..=1 {
                    if self
                        .water
                        .contains(&space.get_voxel(x + dx, y + dy, z + dz))
                    {
                        return true;
                    }
                }
            }
        }
        false
    }
}

fn light(space: &dyn VoxelAccess, Vec3(x, y, z): &Vec3<i32>) -> u32 {
    space
        .get_sunlight(*x, *y, *z)
        .max(space.get_red_light(*x, *y, *z))
        .max(space.get_green_light(*x, *y, *z))
        .max(space.get_blue_light(*x, *y, *z))
}

/// Whether falling blocks and liquids may move into a cell.
fn is_empty(registry: &Registry, id: u32) -> bool {
    if id == AIR {
        return true;
    }
    let block = registry.get_block_by_id(id);
    block.is_fluid || block.is_passable
}

/// Everything a block's behaviour closures need, resolved once.
#[derive(Clone)]
struct BlockLogic {
    id: u32,
    falls: bool,
    support: HashSet<u32>,
    spreads: bool,
    decays: bool,
    grows: bool,
    stages: u32,
    tree: Option<TreeDef>,
    tree_ids: Option<(u32, u32)>,
    melts: bool,
    dries: bool,
    burns: bool,
    /// Rifts: the portal blocks whose frame they need.
    rift: Option<crate::portals::PortalBlocks>,
}

impl BlockLogic {
    fn rift_broken(&self, space: &dyn VoxelAccess, Vec3(x, y, z): &Vec3<i32>) -> bool {
        self.rift.is_some_and(|blocks| {
            let raw = space.get_raw_voxel(*x, *y, *z);
            !crate::portals::rift_intact(&blocks, raw, [*x, *y, *z], |[a, b, c]| {
                space.get_voxel(a, b, c)
            })
        })
    }

    fn supported(&self, space: &dyn VoxelAccess, Vec3(x, y, z): &Vec3<i32>) -> bool {
        self.support.is_empty() || self.support.contains(&space.get_voxel(*x, y - 1, *z))
    }

    fn can_fall(
        &self,
        space: &dyn VoxelAccess,
        registry: &Registry,
        Vec3(x, y, z): &Vec3<i32>,
    ) -> bool {
        self.falls && *y > 0 && is_empty(registry, space.get_voxel(*x, y - 1, *z))
    }
}

/// The raw voxel for a block placed with an orientation (validated ranges).
pub fn oriented(
    id: u32,
    orientation: platform_content::Orientation,
    rotation: u32,
    y_rotation: u32,
) -> u32 {
    use platform_content::Orientation;
    let y_rotation = y_rotation % 16;
    match orientation {
        Orientation::None => id,
        Orientation::Horizontal => {
            BlockUtils::insert_rotation(id, &BlockRotation::encode(0, y_rotation))
        }
        Orientation::Full => {
            BlockUtils::insert_rotation(id, &BlockRotation::encode(rotation.min(5), y_rotation))
        }
    }
}

/// What using (right-clicking) a circuit block does to its raw voxel:
/// levers toggle, buttons press, clocks step to the next period and usable
/// consumers (gates) swap form. `None` when the block has no such use.
pub fn use_circuit(content: &Content, raw: u32) -> Option<u32> {
    let def = content.block_by_id(BlockUtils::extract_id(raw))?;
    let stage = BlockUtils::extract_stage(raw);
    let has = |b: BlockBehavior| def.behaviors.contains(&b);
    if has(BlockBehavior::Lever) {
        Some(BlockUtils::insert_stage(raw, stage ^ 1))
    } else if has(BlockBehavior::Button) {
        Some(BlockUtils::insert_stage(raw, 1))
    } else if has(BlockBehavior::Clock) {
        let period = ((stage >> 1) + 1) & 3;
        Some(BlockUtils::insert_stage(raw, (period << 1) | (stage & 1)))
    } else if has(BlockBehavior::Consumer) && def.usable {
        let swap = content.block(def.power_swap.as_deref()?)?.id;
        Some((raw & !0xFFFF) | swap)
    } else {
        None
    }
}

pub fn has_behaviors(def: &BlockDef) -> bool {
    !def.support.is_empty() || !def.behaviors.is_empty()
}

/// Attach the behaviours `def` asks for to an engine block builder.
pub fn attach(
    builder: voxelize::BlockBuilder,
    def: &BlockDef,
    content: &Content,
    ctx: &Arc<BehaviorContext>,
) -> voxelize::BlockBuilder {
    if !has_behaviors(def) {
        return builder;
    }
    let has = |b: BlockBehavior| def.behaviors.contains(&b);
    let logic = BlockLogic {
        id: def.id,
        falls: has(BlockBehavior::Falls),
        support: def
            .support
            .iter()
            .filter_map(|k| content.block(k).map(|b| b.id))
            .collect(),
        spreads: has(BlockBehavior::Spreads),
        decays: has(BlockBehavior::Decays),
        grows: has(BlockBehavior::Grows),
        stages: def.stages,
        tree: def.grows_into.clone(),
        tree_ids: def
            .grows_into
            .as_ref()
            .and_then(|t| Some((content.block(&t.log)?.id, content.block(&t.leaves)?.id))),
        melts: has(BlockBehavior::Melts),
        burns: has(BlockBehavior::Burns),
        dries: has(BlockBehavior::Dries),
        rift: has(BlockBehavior::Rift)
            .then(|| crate::portals::PortalBlocks::by_rift(content, def.id))
            .flatten(),
    };
    let random = logic.spreads || logic.decays || logic.grows || logic.melts || logic.dries;

    let ticker_logic = logic.clone();
    let updater_logic = logic;
    let ticker_ctx = ctx.clone();
    let ctx = ctx.clone();
    builder.is_random_tickable(random).active_fn(
        move |voxel, space, registry| {
            if !ticker_logic.supported(space, &voxel) || ticker_logic.rift_broken(space, &voxel) {
                1
            } else if ticker_logic.can_fall(space, registry, &voxel) {
                2
            } else if let Some(delay) = circuit_delay(&ticker_ctx, &voxel, space) {
                delay
            } else if ticker_logic.burns {
                FIRE_TICKS + ticker_ctx.roll(&voxel) % FIRE_TICKS
            } else {
                u64::MAX
            }
        },
        move |voxel, space, registry| update(&updater_logic, &ctx, voxel, space, registry),
    )
}

const SIDES: [(i32, i32, i32); 6] = [
    (1, 0, 0),
    (-1, 0, 0),
    (0, 1, 0),
    (0, -1, 0),
    (0, 0, 1),
    (0, 0, -1),
];

/// The direction a directional block faces, from its stored rotation (the
/// same rotation the mesher uses, so logic matches what players see).
pub fn front(raw: u32) -> (i32, i32, i32) {
    let mut d = [0.0f32, 0.0, 1.0];
    BlockUtils::extract_rotation(raw).rotate_direction(&mut d, true);
    (
        d[0].round() as i32,
        d[1].round() as i32,
        d[2].round() as i32,
    )
}

/// Power the block at `from` delivers to its neighbour `to`, 0..=15.
fn emitted(
    ctx: &BehaviorContext,
    space: &dyn VoxelAccess,
    from: &Vec3<i32>,
    to: &Vec3<i32>,
) -> u32 {
    let raw = space.get_raw_voxel(from.0, from.1, from.2);
    let stage = BlockUtils::extract_stage(raw);
    match ctx.logic.get(&BlockUtils::extract_id(raw)) {
        Some(Logic::Conduit) => stage,
        Some(Logic::Lever | Logic::Button | Logic::Plate) => {
            if stage > 0 {
                15
            } else {
                0
            }
        }
        Some(Logic::Clock) => {
            if stage & 1 == 1 {
                15
            } else {
                0
            }
        }
        Some(Logic::Repeater | Logic::Inverter) => {
            let (dx, dy, dz) = front(raw);
            if stage > 0 && (from.0 + dx, from.1 + dy, from.2 + dz) == (to.0, to.1, to.2) {
                15
            } else {
                0
            }
        }
        Some(Logic::Watcher) => {
            // Out of its back, away from what it watches.
            let (dx, dy, dz) = front(raw);
            if stage & 1 == 1 && (from.0 - dx, from.1 - dy, from.2 - dz) == (to.0, to.1, to.2) {
                15
            } else {
                0
            }
        }
        Some(Logic::Gauge) => {
            let (dx, dy, dz) = front(raw);
            if (from.0 + dx, from.1 + dy, from.2 + dz) == (to.0, to.1, to.2) {
                stage
            } else {
                0
            }
        }
        _ => 0,
    }
}

/// Strongest power arriving at `at` from any side; power entering a
/// conduit loses one level, so a line of conduits fades out after 15.
fn incoming(
    ctx: &BehaviorContext,
    space: &dyn VoxelAccess,
    at: &Vec3<i32>,
    into_conduit: bool,
) -> u32 {
    SIDES
        .iter()
        .map(|(dx, dy, dz)| {
            let n = Vec3(at.0 + dx, at.1 + dy, at.2 + dz);
            let p = emitted(ctx, space, &n, at);
            if into_conduit {
                p.saturating_sub(1)
            } else {
                p
            }
        })
        .max()
        .unwrap_or(0)
}

/// The circuit state a block should be in, as its new raw voxel, or `None`
/// when it is already right (or is no circuit block).
fn circuit_target(
    ctx: &BehaviorContext,
    at: &Vec3<i32>,
    space: &dyn VoxelAccess,
) -> Option<(u32, u64)> {
    let raw = space.get_raw_voxel(at.0, at.1, at.2);
    let id = BlockUtils::extract_id(raw);
    let stage = BlockUtils::extract_stage(raw);
    let logic = *ctx.logic.get(&id)?;
    let want = |s: u32, delay: u64| (s != stage).then(|| (BlockUtils::insert_stage(raw, s), delay));
    match logic {
        Logic::Conduit => want(incoming(ctx, space, at, true), 1),
        Logic::Button => (stage > 0).then(|| (BlockUtils::insert_stage(raw, 0), BUTTON_TICKS)),
        Logic::Clock => {
            let period = CLOCK_PERIODS[((stage >> 1) & 3) as usize];
            Some((BlockUtils::insert_stage(raw, stage ^ 1), period))
        }
        Logic::Consumer {
            powered,
            swap,
            partner,
        } => {
            // Stage bit 0 remembers the last power seen, so consumers react
            // to changes only and a gate opened by hand stays open. The
            // halves of a door feel power at either half.
            let other = partner.map(|(dx, dy, dz)| Vec3(at.0 + dx, at.1 + dy, at.2 + dz));
            let on = incoming(ctx, space, at, false) > 0
                || other.is_some_and(|o| incoming(ctx, space, &o, false) > 0);
            if on == (stage & 1 == 1) {
                return None;
            }
            let id = if on == powered { id } else { swap };
            Some((
                BlockUtils::insert_stage((raw & !0xFFFF) | id, u32::from(on)),
                1,
            ))
        }
        Logic::Repeater => {
            let (dx, dy, dz) = front(raw);
            let back = Vec3(at.0 - dx, at.1 - dy, at.2 - dz);
            want(u32::from(emitted(ctx, space, &back, at) > 0), 2)
        }
        Logic::Inverter => {
            let (dx, dy, dz) = front(raw);
            let back = Vec3(at.0 - dx, at.1 - dy, at.2 - dz);
            want(u32::from(emitted(ctx, space, &back, at) == 0), 1)
        }
        Logic::Actuator | Logic::GripActuator => {
            want(u32::from(incoming(ctx, space, at, false) > 0), 1)
        }
        Logic::Watcher => {
            if stage & 1 == 1 {
                return Some((BlockUtils::insert_stage(raw, 0), 2)); // end of the pulse
            }
            let (dx, dy, dz) = front(raw);
            let seen = space.get_raw_voxel(at.0 + dx, at.1 + dy, at.2 + dz);
            let mut watched = ctx.watched.lock().unwrap_or_else(|e| e.into_inner());
            match watched.get(&(at.0, at.1, at.2)) {
                Some(&before) if before != seen => Some((BlockUtils::insert_stage(raw, 1), 1)),
                Some(_) => None,
                None => {
                    // Newly placed (or the server restarted): remember.
                    watched.insert((at.0, at.1, at.2), seen);
                    None
                }
            }
        }
        Logic::Gauge => {
            // The game sets the level from the container's contents; with
            // no container behind it the gauge falls silent.
            let (dx, dy, dz) = front(raw);
            let behind = space.get_voxel(at.0 - dx, at.1 - dy, at.2 - dz);
            if ctx.containers.contains(&behind) {
                None
            } else {
                want(0, 1)
            }
        }
        Logic::Lever | Logic::Plate => None,
    }
}

fn circuit_delay(ctx: &BehaviorContext, at: &Vec3<i32>, space: &dyn VoxelAccess) -> Option<u64> {
    circuit_target(ctx, at, space).map(|(_, delay)| delay)
}

fn circuit_update(
    ctx: &BehaviorContext,
    at: Vec3<i32>,
    space: &dyn VoxelAccess,
    registry: &Registry,
) -> Option<Vec<VoxelUpdate>> {
    let raw = space.get_raw_voxel(at.0, at.1, at.2);
    let logic = *ctx.logic.get(&BlockUtils::extract_id(raw))?;
    let (next, _) = circuit_target(ctx, &at, space)?;
    let mut writes = vec![(at.clone(), next)];
    if let Logic::Consumer {
        partner: Some((dx, dy, dz)),
        ..
    } = logic
    {
        // The other half switches with this one, in the same batch.
        let other = Vec3(at.0 + dx, at.1 + dy, at.2 + dz);
        let other_raw = space.get_raw_voxel(other.0, other.1, other.2);
        if let Some(Logic::Consumer { swap, .. }) =
            ctx.logic.get(&BlockUtils::extract_id(other_raw))
        {
            let id = if BlockUtils::extract_id(next) == BlockUtils::extract_id(raw) {
                BlockUtils::extract_id(other_raw)
            } else {
                *swap
            };
            let stage = BlockUtils::extract_stage(next);
            writes.push((
                other,
                BlockUtils::insert_stage((other_raw & !0xFFFF) | id, stage),
            ));
        }
    }
    if logic == Logic::Watcher {
        let (dx, dy, dz) = front(raw);
        let seen = space.get_raw_voxel(at.0 + dx, at.1 + dy, at.2 + dz);
        ctx.watched
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert((at.0, at.1, at.2), seen);
    }
    if logic == Logic::GripActuator && BlockUtils::extract_stage(next) == 0 {
        // Falling edge: pull the block two cells ahead back next to it.
        let (dx, dy, dz) = front(raw);
        let target = Vec3(at.0 + dx, at.1 + dy, at.2 + dz);
        let beyond = Vec3(at.0 + 2 * dx, at.1 + 2 * dy, at.2 + 2 * dz);
        let moving = space.get_raw_voxel(beyond.0, beyond.1, beyond.2);
        let moving_id = BlockUtils::extract_id(moving);
        if moving_id != AIR
            && !ctx.immovable.contains(&moving_id)
            && ctx.broken.same_land(&[&at, &target, &beyond])
            && space.get_voxel(target.0, target.1, target.2) == AIR
            && !registry.get_block_by_id(moving_id).is_passable
            && !registry.get_block_by_id(moving_id).is_fluid
        {
            writes.push((beyond, AIR));
            writes.push((target, moving));
        }
    }
    if matches!(logic, Logic::Actuator | Logic::GripActuator)
        && BlockUtils::extract_stage(next) == 1
    {
        // Rising edge: push the block in front one cell, if it can move.
        let (dx, dy, dz) = front(raw);
        let target = Vec3(at.0 + dx, at.1 + dy, at.2 + dz);
        let beyond = Vec3(at.0 + 2 * dx, at.1 + 2 * dy, at.2 + 2 * dz);
        let moving = space.get_raw_voxel(target.0, target.1, target.2);
        let moving_id = BlockUtils::extract_id(moving);
        let free = is_empty(registry, space.get_voxel(beyond.0, beyond.1, beyond.2));
        if moving_id != AIR
            && !ctx.immovable.contains(&moving_id)
            && free
            && ctx.broken.same_land(&[&at, &target, &beyond])
            && !registry.get_block_by_id(moving_id).is_passable
        {
            writes.push((target, AIR));
            writes.push((beyond, moving));
        }
    }
    Some(writes)
}

fn update(
    logic: &BlockLogic,
    ctx: &BehaviorContext,
    voxel: Vec3<i32>,
    space: &dyn VoxelAccess,
    registry: &Registry,
) -> Vec<VoxelUpdate> {
    let Vec3(x, y, z) = voxel;
    let raw = space.get_raw_voxel(x, y, z);
    if BlockUtils::extract_id(raw) != logic.id {
        return Vec::new(); // replaced since it was scheduled
    }

    if logic.supported(space, &voxel) {
        if let Some(writes) = circuit_update(ctx, voxel.clone(), space, registry) {
            return writes;
        }
    }

    if logic.rift_broken(space, &voxel) {
        return vec![(voxel, AIR)]; // a portal collapses without a drop
    }

    if !logic.supported(space, &voxel) {
        ctx.broken.push(voxel.clone(), raw);
        return vec![(voxel, AIR)];
    }

    if logic.can_fall(space, registry, &voxel) {
        let below = Vec3(x, y - 1, z);
        let displaced = space.get_raw_voxel(x, y - 1, z);
        let displaced_id = BlockUtils::extract_id(displaced);
        if displaced_id != AIR && !registry.get_block_by_id(displaced_id).is_fluid {
            ctx.broken.push(below.clone(), displaced); // a plant crushed by sand
        }
        return vec![(voxel, AIR), (below, raw)];
    }

    if logic.burns {
        return burn(ctx, voxel, raw, space);
    }

    if logic.spreads {
        let above = space.get_voxel(x, y + 1, z);
        if ctx.opaque.contains(&above) {
            return ctx.dirt.map(|d| vec![(voxel, d)]).unwrap_or_default();
        }
        if light(space, &Vec3(x, y + 1, z)) >= 9 {
            let r = ctx.roll(&voxel);
            let (dx, dy, dz) = (
                (r % 3) as i32 - 1,
                ((r >> 8) % 3) as i32 - 1,
                ((r >> 16) % 3) as i32 - 1,
            );
            let target = Vec3(x + dx, y + dy, z + dz);
            let covered = ctx
                .opaque
                .contains(&space.get_voxel(target.0, target.1 + 1, target.2));
            if Some(space.get_voxel(target.0, target.1, target.2)) == ctx.dirt && !covered {
                if let Some(turf) = ctx.turf {
                    return vec![(target, turf)];
                }
            }
        }
        return Vec::new();
    }

    if logic.decays {
        if BlockUtils::extract_stage(raw) == PERSISTENT_STAGE {
            return Vec::new();
        }
        for dx in -4..=4 {
            for dy in -4..=4 {
                for dz in -4..=4 {
                    if ctx.logs.contains(&space.get_voxel(x + dx, y + dy, z + dz)) {
                        return Vec::new();
                    }
                }
            }
        }
        ctx.broken.push(voxel.clone(), raw);
        return vec![(voxel, AIR)];
    }

    if logic.grows {
        if light(space, &voxel) < 9 {
            return Vec::new();
        }
        let stage = BlockUtils::extract_stage(raw);
        let r = ctx.roll(&voxel);
        if let (Some(tree), Some((log, leaves))) = (&logic.tree, logic.tree_ids) {
            // Saplings: one stage of waiting, then a tree if there is room.
            if r % 7 != 0 {
                return Vec::new();
            }
            if stage + 1 < logic.stages {
                return vec![(voxel, BlockUtils::insert_stage(raw, stage + 1))];
            }
            let span = (tree.max_height - tree.min_height + 1) as u64;
            let trunk = (tree.min_height + ((r >> 8) % span) as u32) as i32;
            return grow_tree(space, registry, &voxel, trunk, log, leaves);
        }
        if stage + 1 >= logic.stages {
            return Vec::new();
        }
        let wet = ctx.water_near(space, &Vec3(x, y - 1, z), 4);
        let chance = if wet { 2 } else { 4 };
        if r % chance == 0 {
            return vec![(voxel, BlockUtils::insert_stage(raw, stage + 1))];
        }
        return Vec::new();
    }

    if logic.melts {
        let bright = [
            (0, 0, 0),
            (1, 0, 0),
            (-1, 0, 0),
            (0, 1, 0),
            (0, -1, 0),
            (0, 0, 1),
            (0, 0, -1),
        ]
        .iter()
        .any(|(dx, dy, dz)| {
            let p = Vec3(x + dx, y + dy, z + dz);
            space.get_red_light(p.0, p.1, p.2) > 11
                || space.get_green_light(p.0, p.1, p.2) > 11
                || space.get_blue_light(p.0, p.1, p.2) > 11
        });
        if bright {
            if let Some(&water) = ctx.water.iter().next() {
                return vec![(voxel, water)];
            }
        }
        return Vec::new();
    }

    if logic.dries {
        let planted = ctx
            .crops_on_farmland
            .contains(&space.get_voxel(x, y + 1, z));
        let rained_on = ctx.broken.raining() && space.get_sunlight(x, y + 1, z) >= 15;
        if !planted && !rained_on && !ctx.water_near(space, &voxel, 4) && ctx.roll(&voxel) % 4 == 0
        {
            return ctx.dirt.map(|d| vec![(voxel, d)]).unwrap_or_default();
        }
    }
    Vec::new()
}

/// One step of a fire at `voxel`: put out by water or a lack of fuel; else
/// it may burn a flammable neighbour away (into fire), spread to an empty
/// cell beside fuel, and ages (dying out at the end, except on cinderstone).
fn burn(
    ctx: &BehaviorContext,
    voxel: Vec3<i32>,
    raw: u32,
    space: &dyn VoxelAccess,
) -> Vec<VoxelUpdate> {
    let Vec3(x, y, z) = voxel;
    let Some(fire) = ctx.fire else {
        return vec![(voxel, AIR)];
    };
    let at = |(dx, dy, dz): (i32, i32, i32)| space.get_voxel(x + dx, y + dy, z + dz);
    // Water beside it, or rain falling on it, puts it out.
    if SIDES.iter().any(|s| ctx.water.contains(&at(*s)))
        || (ctx.broken.raining() && space.get_sunlight(x, y, z) >= 15)
    {
        return vec![(voxel, AIR)];
    }
    let below = at((0, -1, 0));
    let eternal = ctx.eternal_fire.contains(&below);
    let fuel: Vec<(i32, i32, i32)> = SIDES
        .iter()
        .copied()
        .filter(|s| ctx.flammable.contains(&at(*s)))
        .collect();
    let age = BlockUtils::extract_stage(raw);
    let grounded = ctx.opaque.contains(&below);
    if !eternal && fuel.is_empty() && (!grounded || age >= 3) {
        return vec![(voxel, AIR)];
    }
    let r = ctx.roll(&voxel);
    let mut writes = Vec::new();
    // Burn one flammable neighbour away (it turns into fire, no drop).
    if !fuel.is_empty() && r % 3 == 0 {
        let (dx, dy, dz) = fuel[((r >> 4) % fuel.len() as u64) as usize];
        let target = Vec3(x + dx, y + dy, z + dz);
        if Some(at((dx, dy, dz))) == ctx.blast {
            // A blast charge catches: it is primed, not burned.
            ctx.broken.push_primed([target.0, target.1, target.2]);
            writes.push((target, AIR));
        } else {
            writes.push((target, fire));
        }
    }
    // Spread to an empty cell nearby that touches fuel.
    let (dx, dy, dz) = (
        ((r >> 12) % 3) as i32 - 1,
        ((r >> 16) % 4) as i32 - 1,
        ((r >> 20) % 3) as i32 - 1,
    );
    let (tx, ty, tz) = (x + dx, y + dy, z + dz);
    if (r >> 24) % 2 == 0
        && space.get_voxel(tx, ty, tz) == AIR
        && SIDES.iter().any(|(sx, sy, sz)| {
            ctx.flammable
                .contains(&space.get_voxel(tx + sx, ty + sy, tz + sz))
        })
    {
        writes.push((Vec3(tx, ty, tz), fire));
    }
    // Age; an eternal fire just toggles to stay scheduled.
    let next = if eternal {
        age ^ 1
    } else {
        age + 1 + (r >> 28) as u32 % 2
    };
    if !eternal && next >= FIRE_MAX_AGE {
        writes.push((voxel, AIR));
    } else {
        writes.push((voxel, BlockUtils::insert_stage(raw, next)));
    }
    writes
}

fn grow_tree(
    space: &dyn VoxelAccess,
    registry: &Registry,
    at: &Vec3<i32>,
    trunk: i32,
    log: u32,
    leaves: u32,
) -> Vec<VoxelUpdate> {
    tree_cells(
        [at.0, at.1, at.2],
        trunk,
        log,
        leaves,
        |[x, y, z]| space.get_voxel(x, y, z),
        |id| is_empty(registry, id),
    )
    .unwrap_or_default()
    .into_iter()
    .map(|([x, y, z], id)| (Vec3(x, y, z), id))
    .collect()
}

/// The cells a tree with a `trunk`-tall trunk writes when a sapling at `at`
/// grows: `None` while something (`empty` says what does not) blocks the
/// trunk. Leaves only fill air (`get` reads block ids).
pub fn tree_cells(
    at: [i32; 3],
    trunk: i32,
    log: u32,
    leaves: u32,
    get: impl Fn([i32; 3]) -> u32,
    empty: impl Fn(u32) -> bool,
) -> Option<Vec<([i32; 3], u32)>> {
    let [x, y, z] = at;
    for dy in 1..=trunk + 1 {
        if !empty(get([x, y + dy, z])) {
            return None;
        }
    }
    let mut writes = Vec::new();
    let top = y + trunk;
    for dy in 0..3 {
        let ly = top - 2 + dy;
        let radius: i32 = if dy == 2 { 1 } else { 2 };
        for dx in -radius..=radius {
            for dz in -radius..=radius {
                if radius == 2 && dx.abs() == 2 && dz.abs() == 2 {
                    continue;
                }
                if get([x + dx, ly, z + dz]) == AIR {
                    writes.push(([x + dx, ly, z + dz], leaves));
                }
            }
        }
    }
    if get([x, top + 1, z]) == AIR {
        writes.push(([x, top + 1, z], leaves));
    }
    for ly in y..top {
        writes.push(([x, ly, z], log));
    }
    Some(writes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// A tiny voxel world for behaviour tests.
    #[derive(Default)]
    struct Space {
        voxels: HashMap<(i32, i32, i32), u32>,
        light: u32,
        torch: u32,
    }

    impl VoxelAccess for Space {
        fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
            *self.voxels.get(&(vx, vy, vz)).unwrap_or(&0)
        }
        fn set_raw_voxel(&mut self, vx: i32, vy: i32, vz: i32, voxel: u32) -> bool {
            self.voxels.insert((vx, vy, vz), voxel);
            true
        }
        fn get_raw_light(&self, _: i32, _: i32, _: i32) -> u32 {
            (self.light << 12) | (self.torch << 8)
        }
        fn set_raw_light(&mut self, _: i32, _: i32, _: i32, _: u32) -> bool {
            true
        }
        fn get_max_height(&self, _: i32, _: i32) -> u32 {
            0
        }
        fn contains(&self, _: i32, _: i32, _: i32) -> bool {
            true
        }
    }

    struct Env {
        content: Content,
        registry: Registry,
        ctx: Arc<BehaviorContext>,
    }

    fn env() -> Env {
        let content = Content::load(platform_content::default_pack_dir()).unwrap();
        let broken = Arc::new(BrokenBlocks::default());
        let ctx = Arc::new(BehaviorContext::new(&content, broken));
        let registry = crate::registry::build_registry_with(&content, &ctx);
        Env {
            content,
            registry,
            ctx,
        }
    }

    impl Env {
        fn id(&self, key: &str) -> u32 {
            self.content.block(key).unwrap().id
        }
        /// Run a block's updater once.
        fn run(&self, space: &mut Space, at: (i32, i32, i32)) -> Vec<VoxelUpdate> {
            let id = BlockUtils::extract_id(space.get_raw_voxel(at.0, at.1, at.2));
            let block = self.registry.get_block_by_id(id);
            let updater = block.active_updater.as_ref().expect("block has behaviours");
            let writes = updater(Vec3(at.0, at.1, at.2), space, &self.registry);
            for (Vec3(x, y, z), raw) in &writes {
                space.set_raw_voxel(*x, *y, *z, *raw);
            }
            writes
        }
        fn ticker(&self, space: &Space, at: (i32, i32, i32)) -> u64 {
            let block = self
                .registry
                .get_block_by_id(space.get_voxel(at.0, at.1, at.2));
            (block.active_ticker.as_ref().unwrap())(Vec3(at.0, at.1, at.2), space, &self.registry)
        }
    }

    #[test]
    fn sand_falls_until_it_lands() {
        let e = env();
        let mut s = Space {
            light: 15,
            ..Default::default()
        };
        s.voxels.insert((0, 60, 0), e.id("stone"));
        s.voxels.insert((0, 64, 0), e.id("sand"));
        assert_eq!(e.ticker(&s, (0, 64, 0)), 2);
        for y in (61..=64).rev() {
            e.run(&mut s, (0, y, 0));
        }
        assert_eq!(s.get_voxel(0, 61, 0), e.id("sand"));
        assert_eq!(s.get_voxel(0, 64, 0), AIR);
        assert_eq!(e.ticker(&s, (0, 61, 0)), u64::MAX, "resting on stone");
    }

    #[test]
    fn unsupported_plants_break_and_drop() {
        let e = env();
        let mut s = Space {
            light: 15,
            ..Default::default()
        };
        s.voxels.insert((0, 64, 0), e.id("tall_grass"));
        assert_eq!(e.ticker(&s, (0, 64, 0)), 1);
        e.run(&mut s, (0, 64, 0));
        assert_eq!(s.get_voxel(0, 64, 0), AIR);
        assert_eq!(e.ctx.broken.drain().len(), 1);
        s.voxels.insert((0, 63, 0), e.id("turf"));
        s.voxels.insert((0, 64, 0), e.id("tall_grass"));
        assert_eq!(e.ticker(&s, (0, 64, 0)), u64::MAX);
    }

    #[test]
    fn crops_grow_in_light_on_farmland_and_stop_at_the_last_stage() {
        let e = env();
        let mut s = Space {
            light: 15,
            ..Default::default()
        };
        s.voxels.insert((0, 63, 0), e.id("farmland"));
        s.voxels.insert((0, 64, 0), e.id("wheat_crop"));
        for _ in 0..400 {
            e.run(&mut s, (0, 64, 0));
        }
        assert_eq!(s.get_voxel_stage(0, 64, 0), 7);
        let mut dark = Space::default();
        dark.voxels.insert((0, 63, 0), e.id("farmland"));
        dark.voxels.insert((0, 64, 0), e.id("wheat_crop"));
        for _ in 0..400 {
            e.run(&mut dark, (0, 64, 0));
        }
        assert_eq!(dark.get_voxel_stage(0, 64, 0), 0, "no growth in the dark");
    }

    #[test]
    fn saplings_grow_into_trees_when_there_is_room() {
        let e = env();
        let mut s = Space {
            light: 15,
            ..Default::default()
        };
        s.voxels.insert((0, 63, 0), e.id("turf"));
        s.voxels.insert((0, 64, 0), e.id("oak_sapling"));
        for _ in 0..500 {
            if s.get_voxel(0, 64, 0) != e.id("oak_sapling") {
                break;
            }
            e.run(&mut s, (0, 64, 0));
        }
        assert_eq!(s.get_voxel(0, 64, 0), e.id("oak_log"));
        assert_eq!(s.get_voxel(0, 67, 0), e.id("oak_log"));
        assert!(s.voxels.values().any(|&v| v == e.id("oak_leaves")));
    }

    #[test]
    fn leaves_decay_without_logs_unless_placed_by_a_player() {
        let e = env();
        let mut s = Space {
            light: 15,
            ..Default::default()
        };
        let leaves = e.id("oak_leaves");
        s.voxels.insert((0, 70, 0), leaves);
        s.voxels.insert(
            (5, 70, 0),
            BlockUtils::insert_stage(leaves, PERSISTENT_STAGE),
        );
        s.voxels.insert((10, 70, 0), leaves);
        s.voxels.insert((10, 67, 0), e.id("oak_log"));
        e.run(&mut s, (0, 70, 0));
        e.run(&mut s, (5, 70, 0));
        e.run(&mut s, (10, 70, 0));
        assert_eq!(s.get_voxel(0, 70, 0), AIR);
        assert_eq!(s.get_voxel(5, 70, 0), leaves);
        assert_eq!(s.get_voxel(10, 70, 0), leaves);
    }

    #[test]
    fn turf_spreads_to_lit_dirt_and_dies_when_covered() {
        let e = env();
        let mut s = Space {
            light: 15,
            ..Default::default()
        };
        for x in -1..=1 {
            for z in -1..=1 {
                s.voxels.insert((x, 63, z), e.id("dirt"));
            }
        }
        s.voxels.insert((0, 63, 0), e.id("turf"));
        for _ in 0..300 {
            e.run(&mut s, (0, 63, 0));
        }
        let turf = s.voxels.values().filter(|&&v| v == e.id("turf")).count();
        assert!(turf >= 5, "spread to {turf} cells");
        s.voxels.insert((0, 64, 0), e.id("stone"));
        e.run(&mut s, (0, 63, 0));
        assert_eq!(s.get_voxel(0, 63, 0), e.id("dirt"));
    }

    #[test]
    fn fire_burns_wood_away_spreads_and_dies_out() {
        let e = env();
        let (fire, log, stone, water) =
            (e.id("fire"), e.id("oak_log"), e.id("stone"), e.id("water"));
        let is_fire = |v: u32| BlockUtils::extract_id(v) == fire;
        // A wooden wall beside a fire on stone.
        let mut s = Space::default();
        for y in 63..=66 {
            s.voxels.insert((1, y, 0), log);
        }
        s.voxels.insert((0, 62, 0), stone);
        s.voxels.insert((0, 63, 0), fire);
        for _ in 0..200 {
            let fires: Vec<(i32, i32, i32)> = s
                .voxels
                .iter()
                .filter(|(_, v)| is_fire(**v))
                .map(|(p, _)| *p)
                .collect();
            for p in fires {
                e.run(&mut s, p);
            }
        }
        let logs = s.voxels.values().filter(|&&v| v == log).count();
        assert!(logs < 4, "the wall burned: {logs} logs left");
        assert!(
            !s.voxels.values().any(|&v| is_fire(v)),
            "and the fire died out"
        );

        // On bare stone a fire dies out quickly; beside water it goes out at once.
        let mut bare = Space::default();
        bare.voxels.insert((0, 62, 0), stone);
        bare.voxels
            .insert((0, 63, 0), BlockUtils::insert_stage(fire, 3));
        e.run(&mut bare, (0, 63, 0));
        assert_eq!(bare.get_voxel(0, 63, 0), 0);
        let mut wet = Space::default();
        wet.voxels.insert((0, 62, 0), stone);
        wet.voxels.insert((0, 63, 0), fire);
        wet.voxels.insert((1, 63, 0), water);
        e.run(&mut wet, (0, 63, 0));
        assert_eq!(wet.get_voxel(0, 63, 0), 0);

        // Cinderstone burns forever.
        let mut eternal = Space::default();
        eternal.voxels.insert((0, 62, 0), e.id("cinderstone"));
        eternal.voxels.insert((0, 63, 0), fire);
        for _ in 0..100 {
            e.run(&mut eternal, (0, 63, 0));
        }
        assert!(is_fire(eternal.get_raw_voxel(0, 63, 0)));
    }

    /// Run every circuit block's updater repeatedly until nothing changes.
    fn settle(e: &Env, s: &mut Space) {
        for _ in 0..200 {
            let positions: Vec<(i32, i32, i32)> = s
                .voxels
                .iter()
                .filter(|(_, v)| e.ctx.logic.contains_key(&BlockUtils::extract_id(**v)))
                .map(|(p, _)| *p)
                .collect();
            let mut changed = false;
            for p in positions {
                let before = s.get_raw_voxel(p.0, p.1, p.2);
                if e.ticker(s, p) != u64::MAX {
                    e.run(s, p);
                }
                changed |= before != s.get_raw_voxel(p.0, p.1, p.2);
            }
            if !changed {
                return;
            }
        }
        panic!("circuit did not settle");
    }

    fn facing_east(e: &Env, key: &str) -> u32 {
        // Find the y rotation whose front is +x.
        let id = e.id(key);
        (0..16)
            .map(|r| oriented(id, platform_content::Orientation::Horizontal, 0, r))
            .find(|raw| front(*raw) == (1, 0, 0))
            .expect("some rotation faces +x")
    }

    #[test]
    fn a_lever_lights_a_lamp_through_conduits_and_power_fades_with_distance() {
        let e = env();
        let mut s = Space::default();
        let (lever, conduit, lamp) = (e.id("lever"), e.id("conduit"), e.id("volt_lamp"));
        s.voxels
            .insert((0, 64, 0), BlockUtils::insert_stage(lever, 1));
        for x in 1..=5 {
            s.voxels.insert((x, 64, 0), conduit);
        }
        s.voxels.insert((6, 64, 0), lamp);
        settle(&e, &mut s);
        assert_eq!(s.get_voxel_stage(1, 64, 0), 14);
        assert_eq!(s.get_voxel_stage(5, 64, 0), 10);
        assert_eq!(s.get_voxel(6, 64, 0), e.id("volt_lamp_lit"));
        // Lever off: everything goes dark.
        s.voxels.insert((0, 64, 0), lever);
        settle(&e, &mut s);
        assert_eq!(s.get_voxel_stage(3, 64, 0), 0);
        assert_eq!(s.get_voxel(6, 64, 0), lamp);
    }

    #[test]
    fn power_runs_out_after_fifteen_conduits() {
        let e = env();
        let mut s = Space::default();
        s.voxels
            .insert((0, 64, 0), BlockUtils::insert_stage(e.id("lever"), 1));
        for x in 1..=20 {
            s.voxels.insert((x, 64, 0), e.id("conduit"));
        }
        settle(&e, &mut s);
        assert_eq!(s.get_voxel_stage(15, 64, 0), 0);
        assert_eq!(s.get_voxel_stage(14, 64, 0), 1);
    }

    #[test]
    fn repeaters_restore_power_one_way_and_inverters_invert() {
        let e = env();
        let mut s = Space::default();
        let conduit = e.id("conduit");
        s.voxels
            .insert((0, 64, 0), BlockUtils::insert_stage(e.id("lever"), 1));
        for x in 1..=14 {
            s.voxels.insert((x, 64, 0), conduit);
        }
        s.voxels.insert((15, 64, 0), facing_east(&e, "repeater"));
        s.voxels.insert((16, 64, 0), conduit);
        settle(&e, &mut s);
        assert_eq!(s.get_voxel_stage(14, 64, 0), 1);
        assert_eq!(
            s.get_voxel_stage(16, 64, 0),
            14,
            "repeated to full strength"
        );

        // An inverter turns a powered input into no output and back.
        let mut t = Space::default();
        t.voxels
            .insert((0, 64, 0), BlockUtils::insert_stage(e.id("lever"), 1));
        t.voxels.insert((1, 64, 0), facing_east(&e, "inverter"));
        t.voxels.insert((2, 64, 0), e.id("volt_lamp"));
        settle(&e, &mut t);
        assert_eq!(t.get_voxel(2, 64, 0), e.id("volt_lamp"));
        t.voxels.insert((0, 64, 0), e.id("lever"));
        settle(&e, &mut t);
        assert_eq!(t.get_voxel(2, 64, 0), e.id("volt_lamp_lit"));
    }

    #[test]
    fn powered_actuators_push_one_block_and_gates_open() {
        let e = env();
        let mut s = Space::default();
        s.voxels
            .insert((0, 64, 0), BlockUtils::insert_stage(e.id("lever"), 1));
        s.voxels.insert((1, 64, 0), facing_east(&e, "actuator"));
        s.voxels.insert((2, 64, 0), e.id("dirt"));
        settle(&e, &mut s);
        assert_eq!(s.get_voxel(2, 64, 0), AIR);
        assert_eq!(s.get_voxel(3, 64, 0), e.id("dirt"));

        let mut g = Space::default();
        g.voxels
            .insert((0, 64, 0), BlockUtils::insert_stage(e.id("lever"), 1));
        g.voxels.insert((1, 64, 0), e.id("gate"));
        settle(&e, &mut g);
        assert_eq!(g.get_voxel(1, 64, 0), e.id("gate_open"));
    }

    fn full_facing_east(e: &Env, key: &str) -> u32 {
        let id = e.id(key);
        (0..6)
            .flat_map(|r| (0..16).map(move |y| (r, y)))
            .map(|(r, y)| oriented(id, platform_content::Orientation::Full, r, y))
            .find(|raw| front(*raw) == (1, 0, 0))
            .expect("some rotation faces +x")
    }

    #[test]
    fn grip_actuators_push_when_powered_and_pull_back_when_not() {
        let e = env();
        let mut s = Space::default();
        let lever = e.id("lever");
        s.voxels
            .insert((0, 64, 0), BlockUtils::insert_stage(lever, 1));
        s.voxels
            .insert((1, 64, 0), full_facing_east(&e, "grip_actuator"));
        s.voxels.insert((2, 64, 0), e.id("dirt"));
        settle(&e, &mut s);
        assert_eq!(s.get_voxel(2, 64, 0), AIR);
        assert_eq!(s.get_voxel(3, 64, 0), e.id("dirt"));
        s.voxels.insert((0, 64, 0), lever);
        settle(&e, &mut s);
        assert_eq!(s.get_voxel(2, 64, 0), e.id("dirt"), "pulled back");
        assert_eq!(s.get_voxel(3, 64, 0), AIR);
        // A plain actuator leaves it.
        let mut p = Space::default();
        p.voxels
            .insert((0, 64, 0), BlockUtils::insert_stage(lever, 1));
        p.voxels
            .insert((1, 64, 0), full_facing_east(&e, "actuator"));
        p.voxels.insert((2, 64, 0), e.id("dirt"));
        settle(&e, &mut p);
        p.voxels.insert((0, 64, 0), lever);
        settle(&e, &mut p);
        assert_eq!(p.get_voxel(3, 64, 0), e.id("dirt"));
    }

    #[test]
    fn actuators_do_not_move_blocks_across_claim_borders() {
        let e = env();
        // Columns x >= 3 belong to another claim.
        e.ctx
            .broken
            .set_land_of(Arc::new(|x, _| (x >= 3).then(|| "L2".to_owned())));
        let mut s = Space::default();
        s.voxels
            .insert((0, 64, 0), BlockUtils::insert_stage(e.id("lever"), 1));
        s.voxels
            .insert((1, 64, 0), full_facing_east(&e, "actuator"));
        s.voxels.insert((2, 64, 0), e.id("dirt"));
        settle(&e, &mut s);
        assert_eq!(
            s.get_voxel(2, 64, 0),
            e.id("dirt"),
            "stays on its own claim"
        );
        assert_eq!(s.get_voxel(3, 64, 0), AIR);
        e.ctx.broken.set_land_of(Arc::new(|_, _| None));
        s.voxels.insert((0, 64, 0), e.id("lever"));
        settle(&e, &mut s);
        s.voxels
            .insert((0, 64, 0), BlockUtils::insert_stage(e.id("lever"), 1));
        settle(&e, &mut s);
        assert_eq!(
            s.get_voxel(3, 64, 0),
            e.id("dirt"),
            "pushed where no border lies"
        );
    }

    #[test]
    fn watchers_pulse_out_of_their_back_when_the_block_in_front_changes() {
        let e = env();
        let mut s = Space::default();
        // Watching +x; a conduit behind it at x = -1.
        s.voxels.insert((0, 64, 0), full_facing_east(&e, "watcher"));
        s.voxels.insert((-1, 64, 0), e.id("conduit"));
        s.voxels.insert((1, 64, 0), e.id("stone"));
        assert_eq!(e.ticker(&s, (0, 64, 0)), u64::MAX, "first look: remembers");
        assert_eq!(e.ticker(&s, (0, 64, 0)), u64::MAX, "nothing changed");
        s.voxels.remove(&(1, 64, 0));
        assert_eq!(e.ticker(&s, (0, 64, 0)), 1);
        e.run(&mut s, (0, 64, 0));
        assert_eq!(s.get_voxel_stage(0, 64, 0), 1);
        e.run(&mut s, (-1, 64, 0));
        assert_eq!(s.get_voxel_stage(-1, 64, 0), 14, "powered from its back");
        assert_eq!(e.ticker(&s, (0, 64, 0)), 2);
        e.run(&mut s, (0, 64, 0));
        assert_eq!(s.get_voxel_stage(0, 64, 0), 0, "the pulse ends");
        assert_eq!(e.ticker(&s, (0, 64, 0)), u64::MAX);
    }

    #[test]
    fn doors_open_with_power_at_either_half_and_gauges_need_a_container() {
        let e = env();
        let mut s = Space::default();
        let lever = e.id("lever");
        s.voxels.insert((1, 64, 0), e.id("door"));
        s.voxels.insert((1, 65, 0), e.id("door_top"));
        // A lever beside the top half.
        s.voxels
            .insert((0, 65, 0), BlockUtils::insert_stage(lever, 1));
        settle(&e, &mut s);
        assert_eq!(s.get_voxel(1, 64, 0), e.id("door_open"));
        assert_eq!(s.get_voxel(1, 65, 0), e.id("door_top_open"));
        s.voxels.insert((0, 65, 0), lever);
        settle(&e, &mut s);
        assert_eq!(s.get_voxel(1, 64, 0), e.id("door"));
        assert_eq!(s.get_voxel(1, 65, 0), e.id("door_top"));

        // A gauge with a level but no container behind it goes quiet.
        let mut g = Space::default();
        let gauge = facing_east(&e, "gauge");
        g.voxels
            .insert((1, 64, 0), BlockUtils::insert_stage(gauge, 9));
        g.voxels.insert((2, 64, 0), e.id("conduit"));
        settle(&e, &mut g);
        assert_eq!(g.get_voxel_stage(1, 64, 0), 0);
        g.voxels.insert((0, 64, 0), e.id("chest"));
        g.voxels
            .insert((1, 64, 0), BlockUtils::insert_stage(gauge, 9));
        settle(&e, &mut g);
        assert_eq!(
            g.get_voxel_stage(1, 64, 0),
            9,
            "kept while a chest is behind it"
        );
        assert_eq!(
            g.get_voxel_stage(2, 64, 0),
            8,
            "its front carries the level"
        );
    }

    #[test]
    fn using_circuit_blocks_toggles_them_and_hand_opened_gates_stay_open() {
        let e = env();
        let c = &e.content;
        let lever = e.id("lever");
        let on = use_circuit(c, lever).unwrap();
        assert_eq!(BlockUtils::extract_stage(on), 1);
        assert_eq!(use_circuit(c, on), Some(lever));
        let pressed = use_circuit(c, e.id("push_button")).unwrap();
        assert_eq!(BlockUtils::extract_stage(pressed), 1);
        let mut clock = e.id("pulse_clock");
        for expected in [1u32, 2, 3, 0] {
            clock = use_circuit(c, clock).unwrap();
            assert_eq!(BlockUtils::extract_stage(clock) >> 1, expected);
        }
        assert_eq!(
            use_circuit(c, e.id("volt_lamp")),
            None,
            "lamps are not usable"
        );
        assert_eq!(use_circuit(c, e.id("stone")), None);

        // A gate opened by hand stays open without power...
        let mut g = Space::default();
        g.voxels
            .insert((1, 64, 0), use_circuit(c, e.id("gate")).unwrap());
        g.voxels.insert((0, 64, 0), e.id("lever"));
        settle(&e, &mut g);
        assert_eq!(g.get_voxel(1, 64, 0), e.id("gate_open"));
        // ...and follows power changes afterwards.
        g.voxels
            .insert((0, 64, 0), use_circuit(c, e.id("lever")).unwrap());
        settle(&e, &mut g);
        assert_eq!(g.get_voxel(1, 64, 0), e.id("gate_open"));
        g.voxels.insert((0, 64, 0), e.id("lever"));
        settle(&e, &mut g);
        assert_eq!(g.get_voxel(1, 64, 0), e.id("gate"));
    }

    #[test]
    fn a_portal_collapses_when_its_frame_breaks() {
        let e = env();
        let blocks = crate::portals::PortalBlocks::leading_to(
            &e.content,
            platform_content::Dimension::Underworld,
        )
        .unwrap();
        let mut s = Space::default();
        let (writes, stand) = crate::portals::build(&blocks, 0, 64, 0);
        for ([x, y, z], v) in writes {
            if v != AIR {
                s.voxels.insert((x, y, z), v);
            }
        }
        let rifts = |s: &Space| {
            s.voxels
                .values()
                .filter(|v| BlockUtils::extract_id(**v) == blocks.rift)
                .count()
        };
        assert_eq!(rifts(&s), 6);
        let p = (stand[0], stand[1], stand[2]);
        assert_eq!(e.ticker(&s, p), u64::MAX, "a framed rift stays");
        s.voxels.remove(&(0, 65, 0));
        for _ in 0..10 {
            let cells: Vec<_> = s.voxels.keys().copied().collect();
            for c in cells {
                if BlockUtils::extract_id(s.get_raw_voxel(c.0, c.1, c.2)) == blocks.rift
                    && e.ticker(&s, c) != u64::MAX
                {
                    e.run(&mut s, c);
                }
            }
        }
        assert_eq!(rifts(&s), 0, "the whole portal goes out");
    }

    #[test]
    fn clocks_pulse_and_buttons_release() {
        let e = env();
        let mut s = Space::default();
        let clock = e.id("pulse_clock");
        s.voxels.insert((0, 64, 0), clock);
        assert_eq!(e.ticker(&s, (0, 64, 0)), CLOCK_PERIODS[0]);
        e.run(&mut s, (0, 64, 0));
        assert_eq!(s.get_voxel_stage(0, 64, 0) & 1, 1);
        e.run(&mut s, (0, 64, 0));
        assert_eq!(s.get_voxel_stage(0, 64, 0) & 1, 0);

        let mut b = Space::default();
        b.voxels
            .insert((0, 64, 0), BlockUtils::insert_stage(e.id("push_button"), 1));
        assert_eq!(e.ticker(&b, (0, 64, 0)), BUTTON_TICKS);
        e.run(&mut b, (0, 64, 0));
        assert_eq!(b.get_voxel_stage(0, 64, 0), 0);
    }

    #[test]
    fn ice_melts_next_to_torches_and_dry_farmland_reverts() {
        let e = env();
        let mut lit = Space {
            light: 0,
            torch: 14,
            ..Default::default()
        };
        lit.voxels.insert((0, 64, 0), e.id("ice"));
        e.run(&mut lit, (0, 64, 0));
        assert_eq!(lit.get_voxel(0, 64, 0), e.id("water"));

        let mut dry = Space {
            light: 15,
            ..Default::default()
        };
        dry.voxels.insert((0, 63, 0), e.id("farmland"));
        for _ in 0..50 {
            e.run(&mut dry, (0, 63, 0));
            if dry.get_voxel(0, 63, 0) != e.id("farmland") {
                break;
            }
        }
        assert_eq!(dry.get_voxel(0, 63, 0), e.id("dirt"));

        let mut wet = Space {
            light: 15,
            ..Default::default()
        };
        wet.voxels.insert((0, 63, 0), e.id("farmland"));
        wet.voxels.insert((2, 63, 0), e.id("water"));
        for _ in 0..50 {
            e.run(&mut wet, (0, 63, 0));
        }
        assert_eq!(wet.get_voxel(0, 63, 0), e.id("farmland"));
    }
}
