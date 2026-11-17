//! `Chunks::rewrite_chunk` and `Chunks::request_relight`: an edit too large
//! for the per-voxel lanes is written in one borrow, and the chunks it
//! touched are lit again from scratch. The world it leaves has to be the
//! world the lanes would have left, light included.

use std::time::{Duration, Instant};

use crate::world::generators::FlatlandStage;
use crate::{Block, ChunkStatus, Registry, Vec2, Vec3, VoxelAccess, World, WorldConfig};

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

/// Ready chunks round the origin, open to the sky.
fn world(name: &str) -> World {
    let config = WorldConfig::new()
        .saving(false)
        .min_chunk([-4, -4])
        .max_chunk([4, 4])
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

/// Ticks until every relight asked for has run and landed.
fn relit(world: &mut World) {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        world.tick();
        let is_idle = world.chunks().pending_relights() == 0 && {
            let mesher = world.mesher();
            mesher.queue.is_empty() && mesher.map.is_empty()
        };
        if is_idle {
            break;
        }
        assert!(Instant::now() < deadline, "the relights never all landed");
        std::thread::sleep(Duration::from_millis(1));
    }
    world.tick();
}

/// A stone room with one hole in its roof and a lamp in a wall, full of
/// stone inside: what `hollow` then empties. All of it inside chunk (0, 0).
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

/// Every voxel and light word in the room's chunk and the chunks round it,
/// as high as light from the room can reach.
fn field(world: &World) -> Vec<(Vec3<i32>, u32, u32)> {
    let chunks = world.chunks();
    let mut field = Vec::new();
    for x in -16..32 {
        for y in 0..=26 {
            for z in -16..32 {
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

/// Write `writes` into chunk (0, 0) in one borrow and have it and the ring
/// round it lit again.
fn rewrite(world: &mut World, writes: &[(Vec3<i32>, u32)]) -> usize {
    let registry = (*world.registry()).clone();
    let changed = world
        .chunks_mut()
        .rewrite_chunk(&Vec2(0, 0), &registry, |voxels| {
            for (voxel, id) in writes {
                voxels.set(voxel.0, voxel.1, voxel.2, *id);
            }
            voxels.changed()
        })
        .expect("chunk (0, 0) is ready");
    for x in -1..=1 {
        for z in -1..=1 {
            world.chunks_mut().request_relight(&Vec2(x, z));
        }
    }
    changed
}

/// The same edit through the per-voxel lane and through one rewrite and a
/// relight leaves the same voxels and the same light, in the chunk and in
/// the chunks beside it: sunlight down the hole in the roof, the lamp's
/// glow through the wall, shadow under the slab.
#[test]
fn a_rewrite_and_relight_leaves_the_light_the_lanes_would() {
    actix::System::new().block_on(async {
        let mut by_lane = world("bulk-rewrite-by-lane");
        by_lane.chunks_mut().update_voxels(&room());
        settle(&mut by_lane);
        by_lane.chunks_mut().update_voxels(&hollow());
        settle(&mut by_lane);

        let mut in_bulk = world("bulk-rewrite-in-bulk");
        assert_eq!(rewrite(&mut in_bulk, &room()), room().len());
        relit(&mut in_bulk);
        assert!(rewrite(&mut in_bulk, &hollow()) > 0);
        relit(&mut in_bulk);

        // The room is not lit as open sky is: there is something to compare.
        let chunks = by_lane.chunks();
        assert!(chunks.get_sunlight(4, 5, 4) < 15);
        assert!(chunks.get_red_light(3, 5, 7) > 0);
        drop(chunks);

        let (lane, bulk) = (field(&by_lane), field(&in_bulk));
        let differing = lane
            .iter()
            .zip(bulk.iter())
            .filter(|(a, b)| a != b)
            .take(6)
            .collect::<Vec<_>>();
        assert!(
            differing.is_empty(),
            "the rewrite left a different world; (voxel, raw, light) by lane then in bulk: {differing:?}"
        );
        // The height map followed the edit: the roof, and the hole's column.
        assert_eq!(in_bulk.chunks().get_max_height(4, 4), 10);
        assert_eq!(
            in_bulk.chunks().get_max_height(7, 7),
            by_lane.chunks().get_max_height(7, 7)
        );
    });
}

/// A rewrite that changes nothing leaves the chunk as it was, and a chunk
/// that is not ready is not the caller's to rewrite.
#[test]
fn a_rewrite_only_counts_what_it_changed_and_only_touches_ready_chunks() {
    actix::System::new().block_on(async {
        let mut world = world("bulk-rewrite-noop");
        let registry = (*world.registry()).clone();
        let epoch = world.chunks().raw(&Vec2(0, 0)).unwrap().write_epoch;
        let changed = world
            .chunks_mut()
            .rewrite_chunk(&Vec2(0, 0), &registry, |voxels| {
                assert_eq!(voxels.min(), (0, 0));
                assert_eq!(voxels.size(), 16);
                voxels.set(3, 3, 3, 0);
                assert_eq!(voxels.get(3, 3, 3), 0);
                voxels.changed()
            });
        assert_eq!(changed, Some(0));
        assert_eq!(world.chunks().raw(&Vec2(0, 0)).unwrap().write_epoch, epoch);
        assert!(!world.chunks().is_chunk_save_dirty(&Vec2(0, 0)));

        let changed = world
            .chunks_mut()
            .rewrite_chunk(&Vec2(0, 0), &registry, |voxels| {
                voxels.set(3, 3, 3, STONE);
                voxels.set(3, 3, 3, STONE);
                voxels.changed()
            });
        assert_eq!(changed, Some(1));
        assert_ne!(world.chunks().raw(&Vec2(0, 0)).unwrap().write_epoch, epoch);
        assert!(world.chunks().is_chunk_save_dirty(&Vec2(0, 0)));
        assert_eq!(world.chunks().get_voxel(3, 3, 3), STONE);
        assert_eq!(world.chunks().get_max_height(3, 3), 3);

        world.chunks_mut().raw_mut(&Vec2(1, 0)).unwrap().status = ChunkStatus::Meshing;
        let refused = world
            .chunks_mut()
            .rewrite_chunk(&Vec2(1, 0), &registry, |voxels| voxels.set(20, 3, 3, STONE));
        assert_eq!(refused, None);
        assert_eq!(world.chunks().get_voxel(20, 3, 3), 0);
        assert_eq!(
            world
                .chunks_mut()
                .rewrite_chunk(&Vec2(40, 40), &registry, |_| ()),
            None,
            "a chunk that is not resident"
        );

        // Asked for twice, a relight waits once.
        world.chunks_mut().request_relight(&Vec2(0, 0));
        world.chunks_mut().request_relight(&Vec2(0, 0));
        assert_eq!(world.chunks().pending_relights(), 1);
    });
}

/// Round a bulk edit most chunks are asked for only because light could
/// have crossed their border. One whose light comes out as it was sends
/// nothing; the chunk that was rewritten is always sent.
#[test]
fn a_relight_that_moved_no_light_sends_nothing() {
    actix::System::new().block_on(async {
        let mut world = world("bulk-rewrite-silent");
        // Nothing changed anywhere: all nine come out as they were.
        for x in -1..=1 {
            for z in -1..=1 {
                world.chunks_mut().request_relight(&Vec2(x, z));
            }
        }
        relit(&mut world);
        assert_eq!(world.chunks().silent_relights(), 9);

        // One stone on the floor in the middle of chunk (0, 0): its own
        // chunk is sent, and no light moved in the eight round it.
        assert_eq!(rewrite(&mut world, &[(Vec3(8, 0, 8), STONE)]), 1);
        relit(&mut world);
        assert_eq!(world.chunks().silent_relights(), 9 + 8);
        assert!(world.chunks().rewritten.is_empty());
    });
}
