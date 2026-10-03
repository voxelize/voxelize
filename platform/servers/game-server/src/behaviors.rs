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
//!
//! Updaters only see the world and return voxel writes, so drops from
//! blocks broken here are queued in [`BrokenBlocks`] and spawned by the
//! gameplay system.

use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use platform_content::{BlockBehavior, BlockDef, Content, FluidKind, TreeDef};
use voxelize::{BlockUtils, Registry, Vec3, VoxelAccess, VoxelUpdate};

pub const AIR: u32 = 0;
/// Stage bit marking player-placed leaves, which never decay.
pub const PERSISTENT_STAGE: u32 = 1;

/// A block broken by a behaviour, waiting for its drops to be spawned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Broken {
    pub voxel: [i32; 3],
    pub raw: u32,
}

#[derive(Debug, Default)]
pub struct BrokenBlocks(Mutex<Vec<Broken>>);

impl BrokenBlocks {
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

/// Facts about the content pack that behaviours need, shared by every
/// block's closures.
pub struct BehaviorContext {
    pub broken: Arc<BrokenBlocks>,
    dirt: Option<u32>,
    turf: Option<u32>,
    water: HashSet<u32>,
    logs: HashSet<u32>,
    opaque: HashSet<u32>,
    crops_on_farmland: HashSet<u32>,
    counter: AtomicU64,
}

impl BehaviorContext {
    pub fn new(content: &Content, broken: Arc<BrokenBlocks>) -> Self {
        let id = |key: &str| content.block(key).map(|b| b.id);
        let blocks = content.blocks();
        Self {
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
}

impl BlockLogic {
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
        dries: has(BlockBehavior::Dries),
    };
    let random = logic.spreads || logic.decays || logic.grows || logic.melts || logic.dries;

    let ticker_logic = logic.clone();
    let updater_logic = logic;
    let ctx = ctx.clone();
    builder.is_random_tickable(random).active_fn(
        move |voxel, space, registry| {
            if !ticker_logic.supported(space, &voxel) {
                1
            } else if ticker_logic.can_fall(space, registry, &voxel) {
                2
            } else {
                u64::MAX
            }
        },
        move |voxel, space, registry| update(&updater_logic, &ctx, voxel, space, registry),
    )
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
        if !planted && !ctx.water_near(space, &voxel, 4) && ctx.roll(&voxel) % 4 == 0 {
            return ctx.dirt.map(|d| vec![(voxel, d)]).unwrap_or_default();
        }
    }
    Vec::new()
}

fn grow_tree(
    space: &dyn VoxelAccess,
    registry: &Registry,
    at: &Vec3<i32>,
    trunk: i32,
    log: u32,
    leaves: u32,
) -> Vec<VoxelUpdate> {
    let Vec3(x, y, z) = *at;
    // The trunk needs clear space; otherwise wait for a later tick.
    for dy in 1..=trunk + 1 {
        if !is_empty(registry, space.get_voxel(x, y + dy, z)) {
            return Vec::new();
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
                if space.get_voxel(x + dx, ly, z + dz) == AIR {
                    writes.push((Vec3(x + dx, ly, z + dz), leaves));
                }
            }
        }
    }
    if space.get_voxel(x, top + 1, z) == AIR {
        writes.push((Vec3(x, top + 1, z), leaves));
    }
    for ly in y..top {
        writes.push((Vec3(x, ly, z), log));
    }
    writes
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
