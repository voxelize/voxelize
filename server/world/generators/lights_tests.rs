//! Removal and reflood against a from-scratch relight. A BFS light field is a
//! pure function of the blocks and their emitters, so after any edit every
//! voxel must read exactly what flooding the finished world from nothing
//! gives. These mirror the client's `light-seams.test.ts` so the two light
//! engines stay in step.

use std::collections::VecDeque;

use super::*;
use crate::{
    Block, BlockConditionalPart, BlockDynamicPattern, BlockRule, BlockSimpleRule, Chunk,
    ChunkOptions, Chunks, Registry, Vec2, Vec3, VoxelAccess, WorldConfig,
};

const AIR: u32 = 0;
const STONE: u32 = 1;
const TORCH: u32 = 2;
const DIM_LAMP: u32 = 3;
const SWITCH_LAMP: u32 = 4;
const WARM_LAMP: u32 = 5;

const TORCH_LEVEL: u32 = 15;
const DIM_LEVEL: u32 = 6;

const FLOOR_Y: i32 = 4;
const Y: i32 = FLOOR_Y + 1;
const MAX_HEIGHT: usize = 16;
const MIN_CHUNK: [i32; 2] = [-3, -2];
const MAX_CHUNK: [i32; 2] = [3, 2];

const COLORS: [LightColor; 3] = [RED, GREEN, BLUE];

fn lamp(name: &str, id: u32, r: u32, g: u32, b: u32) -> Block {
    Block::new(name)
        .id(id)
        .is_passable(true)
        .is_transparent(true)
        .red_light_level(r)
        .green_light_level(g)
        .blue_light_level(b)
        .build()
}

/// Lit at stage 1, dark otherwise: a lamp its owner switches.
fn switch_lamp() -> Block {
    let part = |rule: BlockRule, level: u32| BlockConditionalPart {
        rule,
        is_transparent: [true; 6],
        red_light_level: Some(level),
        green_light_level: Some(level),
        blue_light_level: Some(level),
        ..Default::default()
    };
    Block::new("Switch Lamp")
        .id(SWITCH_LAMP)
        .is_passable(true)
        .is_transparent(true)
        .dynamic_patterns(&[BlockDynamicPattern {
            parts: vec![
                part(
                    BlockRule::Simple(BlockSimpleRule {
                        offset: Vec3(0, 0, 0),
                        id: None,
                        rotation: None,
                        stage: Some(1),
                    }),
                    TORCH_LEVEL,
                ),
                part(BlockRule::None, 0),
            ],
        }])
        .build()
}

fn registry() -> Registry {
    let mut registry = Registry::new();
    registry.register_block(&Block::new("Stone").id(STONE).build());
    registry.register_block(&lamp(
        "Torch",
        TORCH,
        TORCH_LEVEL,
        TORCH_LEVEL - 1,
        TORCH_LEVEL - 4,
    ));
    registry.register_block(&lamp("Dim Lamp", DIM_LAMP, DIM_LEVEL, DIM_LEVEL, DIM_LEVEL));
    registry.register_block(&switch_lamp());
    registry.register_block(&lamp("Warm Lamp", WARM_LAMP, 12, 7, 2));
    registry
}

fn config() -> WorldConfig {
    WorldConfig::new()
        .chunk_size(16)
        .max_height(MAX_HEIGHT)
        .sub_chunks(2)
        .max_light_level(15)
        .min_chunk(MIN_CHUNK)
        .max_chunk(MAX_CHUNK)
        .build()
}

struct World {
    chunks: Chunks,
    registry: Registry,
    config: WorldConfig,
}

impl World {
    /// A slab of chunks: a stone floor, air above, no sunlight.
    fn new() -> Self {
        let config = config();
        let mut chunks = Chunks::new(&config);
        for cx in MIN_CHUNK[0]..=MAX_CHUNK[0] {
            for cz in MIN_CHUNK[1]..=MAX_CHUNK[1] {
                let mut chunk = Chunk::new(
                    "light-test",
                    cx,
                    cz,
                    &ChunkOptions {
                        size: 16,
                        max_height: MAX_HEIGHT,
                        sub_chunks: 2,
                    },
                );
                for x in 0..16 {
                    for z in 0..16 {
                        chunk.set_voxel(cx * 16 + x, FLOOR_Y, cz * 16 + z, STONE);
                    }
                }
                chunks.add(chunk);
            }
        }
        Self {
            chunks,
            registry: registry(),
            config,
        }
    }

    fn emission(&self, id: u32, pos: [i32; 3], color: &LightColor) -> u32 {
        self.registry.get_block_by_id(id).get_torch_light_level_at(
            &Vec3(pos[0], pos[1], pos[2]),
            &self.chunks,
            color,
        )
    }

    fn light(&self, pos: [i32; 3], color: &LightColor) -> u32 {
        self.chunks.get_torch_light(pos[0], pos[1], pos[2], color)
    }

    /// One batch of edits, lit the way `process_pending_updates` lights it:
    /// removals for every lit cell that changed, then floods from the new
    /// emitters and from the neighbours of any cell that opened up.
    fn edit(&mut self, edits: &[([i32; 3], u32, u32)]) {
        let mut removals: Vec<Vec<Vec3<i32>>> = vec![vec![]; 3];
        let mut opened = vec![];
        for &([x, y, z], id, stage) in edits {
            let was_opaque = self
                .registry
                .get_block_by_id(self.chunks.get_voxel(x, y, z))
                .is_opaque;
            for (index, color) in COLORS.iter().enumerate() {
                if self.chunks.get_torch_light(x, y, z, color) > 0 {
                    removals[index].push(Vec3(x, y, z));
                }
            }
            self.chunks.set_voxel(x, y, z, id);
            self.chunks.set_voxel_stage(x, y, z, stage);
            if was_opaque && !self.registry.get_block_by_id(id).is_opaque {
                opened.push([x, y, z]);
            }
        }

        for (index, color) in COLORS.iter().enumerate() {
            Lights::remove_lights(
                &mut self.chunks,
                &removals[index],
                color,
                &self.config,
                &self.registry,
            );
        }

        for color in COLORS.iter() {
            let mut queue = VecDeque::new();
            for &([x, y, z], id, _) in edits {
                let level = self.emission(id, [x, y, z], color);
                if level > 0 {
                    if self.chunks.get_torch_light(x, y, z, color) < level {
                        self.chunks.set_torch_light(x, y, z, level, color);
                    }
                    queue.push_back(LightNode {
                        voxel: [x, y, z],
                        level,
                    });
                }
            }
            for &[x, y, z] in &opened {
                for [ox, oy, oz] in VOXEL_NEIGHBORS {
                    let n = [x + ox, y + oy, z + oz];
                    let level = self.light(n, color);
                    if level > 0 {
                        queue.push_back(LightNode { voxel: n, level });
                    }
                }
            }
            Lights::flood_light(
                &mut self.chunks,
                queue,
                color,
                &self.registry,
                &self.config,
                None,
                None,
            );
        }
    }

    fn voxels(&self) -> impl Iterator<Item = [i32; 3]> {
        let (x0, x1) = (MIN_CHUNK[0] * 16, (MAX_CHUNK[0] + 1) * 16);
        let (z0, z1) = (MIN_CHUNK[1] * 16, (MAX_CHUNK[1] + 1) * 16);
        (x0..x1).flat_map(move |x| {
            (0..MAX_HEIGHT as i32).flat_map(move |y| (z0..z1).map(move |z| [x, y, z]))
        })
    }

    /// The same blocks, lit from nothing but their emitters.
    fn relit_from_scratch(&self) -> World {
        let mut fresh = World::new();
        for pos in self.voxels() {
            let [x, y, z] = pos;
            let id = self.chunks.get_voxel(x, y, z);
            if id != AIR || fresh.chunks.get_voxel(x, y, z) != AIR {
                fresh.chunks.set_voxel(x, y, z, id);
                fresh
                    .chunks
                    .set_voxel_stage(x, y, z, self.chunks.get_voxel_stage(x, y, z));
            }
        }
        for color in COLORS.iter() {
            let mut queue = VecDeque::new();
            for pos in fresh.voxels().collect::<Vec<_>>() {
                let [x, y, z] = pos;
                let level = fresh.emission(fresh.chunks.get_voxel(x, y, z), pos, color);
                if level > 0 {
                    fresh.chunks.set_torch_light(x, y, z, level, color);
                    queue.push_back(LightNode { voxel: pos, level });
                }
            }
            Lights::flood_light(
                &mut fresh.chunks,
                queue,
                color,
                &fresh.registry,
                &fresh.config,
                None,
                None,
            );
        }
        fresh
    }

    fn seams(&self) -> Vec<String> {
        let truth = self.relit_from_scratch();
        let mut seams = vec![];
        for pos in self.voxels() {
            for color in COLORS.iter() {
                let (got, want) = (self.light(pos, color), truth.light(pos, color));
                if got != want {
                    seams.push(format!("{color:?} {pos:?} {got}≠{want}"));
                }
            }
        }
        seams
    }
}

/// Lights one chunk the way a Load pass does: from a space built around it
/// with voxels and height maps in and lights out, then installs the result
/// as the chunk's lights.
fn load_light(world: &mut World, cx: i32, cz: i32) {
    for chunk in world.chunks.map.values_mut() {
        chunk.calculate_max_height(&world.registry);
    }
    let coords = Vec2(cx, cz);
    let mut space = world
        .chunks
        .make_space(&coords, world.config.max_light_level as usize)
        .needs_height_maps()
        .needs_voxels()
        .strict()
        .build();
    Lights::light_fresh_chunk(&mut space, &world.registry, &world.config);
    let lights = space.get_lights(cx, cz).unwrap().clone();
    world.chunks.map.get_mut(&coords).unwrap().lights = std::sync::Arc::new(lights);
}

fn assert_no_seams(world: &World) {
    let seams = world.seams();
    assert!(
        seams.is_empty(),
        "{} voxel(s) off a from-scratch relight, first: {:?}",
        seams.len(),
        &seams[..seams.len().min(6)]
    );
}

#[test]
fn breaking_one_of_two_torches_17_apart_leaves_the_other_whole() {
    let mut world = World::new();
    world.edit(&[([-1, Y, 0], TORCH, 0)]);
    world.edit(&[([16, Y, 0], TORCH, 0)]);
    assert_no_seams(&world);

    world.edit(&[([16, Y, 0], AIR, 0)]);
    assert_no_seams(&world);
    assert_eq!(world.light([1, Y, 0], &RED), TORCH_LEVEL - 2);
}

#[test]
fn a_dim_lamp_beside_a_bright_one_keeps_shining_when_the_bright_one_goes() {
    // The dim lamp stores the torch's light, brighter than its own; the
    // removal front zeroes it like any cell and must light it again.
    let mut world = World::new();
    world.edit(&[([15, Y, 15], DIM_LAMP, 0)]);
    world.edit(&[([16, Y, 15], TORCH, 0)]);
    assert_eq!(world.light([15, Y, 15], &RED), TORCH_LEVEL - 1);

    world.edit(&[([16, Y, 15], AIR, 0)]);
    assert_eq!(world.light([15, Y, 15], &RED), DIM_LEVEL);
    assert_eq!(world.light([17, Y, 15], &RED), DIM_LEVEL - 2);
    assert_no_seams(&world);
}

#[test]
fn a_row_of_switched_lamps_goes_dark_together_and_one_at_a_time() {
    let row: Vec<[i32; 3]> = (-2..=2).map(|x| [x, Y, -1]).collect();
    let set = |stage: u32| -> Vec<([i32; 3], u32, u32)> {
        row.iter().map(|&pos| (pos, SWITCH_LAMP, stage)).collect()
    };
    let mut world = World::new();
    world.edit(&set(1));
    assert_no_seams(&world);

    world.edit(&[(row[2], SWITCH_LAMP, 0)]);
    assert_no_seams(&world);
    world.edit(&[(row[0], SWITCH_LAMP, 0)]);
    assert_no_seams(&world);

    world.edit(&set(1));
    assert_no_seams(&world);
    world.edit(&set(0));
    assert_no_seams(&world);
    assert_eq!(world.light([0, Y, -1], &RED), 0);
}

#[test]
fn random_torch_and_stone_edits_across_chunk_borders_never_leave_a_seam() {
    let mut seed: u64 = 0x5eed;
    let mut random = move || {
        seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        ((seed >> 33) as f64) / ((1u64 << 31) as f64)
    };
    let ids = [TORCH, TORCH, WARM_LAMP, DIM_LAMP, STONE, STONE, AIR, AIR];

    let mut world = World::new();
    for step in 0..30 {
        let pos = [
            (random() * 40.0) as i32 - 20,
            Y + (random() * 3.0) as i32,
            (random() * 24.0) as i32 - 12,
        ];
        let id = ids[(random() * ids.len() as f64) as usize % ids.len()];
        world.edit(&[(pos, id, 0)]);
        let seams = world.seams();
        assert!(
            seams.is_empty(),
            "step {step}: {id} at {pos:?}, {} voxel(s) off, first: {:?}",
            seams.len(),
            &seams[..seams.len().min(4)]
        );
    }
}

#[test]
fn sunlight_under_a_roof_on_a_shared_border_agrees_from_both_chunks_load_passes() {
    // A roofed hall straddles the x=15|16 border between chunks (0,0) and
    // (1,0), sealed except for a doorway on its z=0 side at x 8..=14, where
    // the full-sun columns at z=-1 shine in sideways. Lit chunk by chunk,
    // (1,0)'s pass saw those sun columns and the shaded doorway in two
    // different sweeps and never seeded the doorway, so its half of the
    // hall came out black while (0,0) lit its half from the same doorway.
    let mut world = World::new();
    let roof_y = FLOOR_Y + 5;
    for x in 8..=24 {
        for z in 0..=12 {
            world.chunks.set_voxel(x, roof_y, z, STONE);
        }
    }
    for y in Y..roof_y {
        for z in 0..=12 {
            world.chunks.set_voxel(7, y, z, STONE);
            world.chunks.set_voxel(25, y, z, STONE);
        }
        for x in 8..=24 {
            world.chunks.set_voxel(x, y, 13, STONE);
        }
        for x in 15..=24 {
            world.chunks.set_voxel(x, y, 0, STONE);
        }
    }

    load_light(&mut world, 0, 0);
    load_light(&mut world, 1, 0);

    // Sun enters the doorway at level 14 and loses one per step:
    // (14,0)=14, (14,1)=13, (15,1)=12, (16,1)=11.
    assert_eq!(world.chunks.get_sunlight(14, Y + 1, 0), 14);
    assert_eq!(world.chunks.get_sunlight(15, Y + 1, 1), 12);
    assert_eq!(
        world.chunks.get_sunlight(16, Y + 1, 1),
        11,
        "chunk (1,0) must light its half of the hall from the doorway in (0,0)"
    );
    for y in Y..roof_y {
        for z in 1..=12 {
            let (a, b) = (
                world.chunks.get_sunlight(15, y, z),
                world.chunks.get_sunlight(16, y, z),
            );
            assert!(a.abs_diff(b) <= 1, "sunlight seam at y={y} z={z}: {a} vs {b}");
        }
    }
}

#[test]
fn light_flooding_into_a_chunk_moves_its_write_epoch() {
    // The mesher lights a clone taken at dispatch; the generating system
    // compares the clone's epoch with the live chunk's when the result
    // lands, and relights instead of renewing when they differ. So a flood
    // from a neighbour's edit across the border must move the epoch of the
    // chunk it reaches, and only that chunk's.
    let mut world = World::new();
    let dispatched = world.chunks.raw(&Vec2(0, 0)).unwrap().clone();
    let far = world.chunks.raw(&Vec2(-3, -2)).unwrap().write_epoch;

    world.edit(&[([16, Y, 8], TORCH, 0)]);

    assert!(world.light([15, Y, 8], &RED) > 0);
    assert_ne!(
        world.chunks.raw(&Vec2(0, 0)).unwrap().write_epoch,
        dispatched.write_epoch,
        "light written over the border must be visible as a write"
    );
    assert_eq!(world.chunks.raw(&Vec2(-3, -2)).unwrap().write_epoch, far);
}

#[test]
fn every_test_chunk_is_loaded() {
    let world = World::new();
    for cx in MIN_CHUNK[0]..=MAX_CHUNK[0] {
        for cz in MIN_CHUNK[1]..=MAX_CHUNK[1] {
            assert!(world.chunks.raw(&Vec2(cx, cz)).is_some());
        }
    }
}
