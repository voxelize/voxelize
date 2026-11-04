//! Chunks nobody is near are let go, and what comes back on a revisit is what
//! left: edits read back from disk, and a structure's writes across a chunk
//! border neither lost nor written twice.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use specs::WorldExt;

use super::*;
use crate::{Block, Chunk, ChunkStage, Resources, Space, Vec2, Vec3, VoxelAccess};

const GROUND: u32 = 1;
const LEAF: u32 = 2;
const IDLE: Duration = Duration::from_secs(60);

/// Flat ground, and from chunk `(0, 0)` one leaf over its +x border into
/// `(1, 0)`: the cross-chunk write a tree crown makes.
struct OverhangStage;

/// Where `OverhangStage` puts its leaf, inside chunk `(1, 0)`.
const OVERHANG: Vec3<i32> = Vec3(16, 8, 0);

/// A leaf chunk `(3, 0)` puts in `(1, 0)`, beyond its light ring: a large
/// structure's reach, which can land after `(1, 0)` is ready.
const REACH: Vec3<i32> = Vec3(20, 9, 0);

impl ChunkStage for OverhangStage {
    fn name(&self) -> String {
        "Overhang".to_owned()
    }

    fn process(&self, mut chunk: Chunk, _: Resources, _: Option<Space>) -> Chunk {
        let Vec3(min_x, _, min_z) = chunk.min;
        let Vec3(max_x, _, max_z) = chunk.max;
        for vx in min_x..max_x {
            for vz in min_z..max_z {
                for vy in 0..4 {
                    chunk.set_voxel(vx, vy, vz, GROUND);
                }
            }
        }
        if chunk.coords == Vec2(0, 0) {
            chunk.set_voxel(OVERHANG.0, OVERHANG.1, OVERHANG.2, LEAF);
        }
        if chunk.coords == Vec2(3, 0) {
            chunk.set_voxel(REACH.0, REACH.1, REACH.2, LEAF);
        }
        chunk
    }
}

fn save_dir(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "voxelize-eviction-{label}-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    std::fs::remove_dir_all(&dir).ok();
    dir
}

fn world(label: &str, saving: Option<&PathBuf>, max_resident_chunks: usize) -> World {
    let mut builder = WorldConfig::new()
        .min_chunk([-8, -8])
        .max_chunk([8, 8])
        .chunk_size(16)
        .max_height(32)
        .sub_chunks(1)
        .chunk_eviction_idle_ms(IDLE.as_millis() as u64)
        .max_resident_chunks(max_resident_chunks);
    if let Some(dir) = saving {
        builder = builder.saving(true).save_dir(dir.to_str().unwrap());
    }
    let config = builder.build();

    let mut registry = Registry::new();
    registry.register_block(&Block::new("Ground").id(GROUND).build());
    registry.register_block(&Block::new("Leaf").id(LEAF).build());

    let mut world = World::new(label, &config);
    world.ecs_mut().insert(registry);
    world.pipeline_mut().add_stage(OverhangStage);
    world.prepare();
    world
}

fn tick_until(world: &mut World, what: &str, is_done: impl Fn(&World) -> bool) {
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        world.tick();
        if is_done(world) {
            return;
        }
        std::thread::sleep(Duration::from_millis(1));
    }
    panic!("timed out waiting for {what}");
}

/// Ask for a chunk the way a client request does: a chunk parked at
/// `Meshing` goes back to the mesher, anything else to the pipeline.
fn ready(world: &mut World, coords: Vec2<i32>) {
    let status = world.chunks().raw(&coords).map(|chunk| chunk.status.clone());
    match status {
        Some(ChunkStatus::Ready) => return,
        Some(ChunkStatus::Meshing) => world.mesher_mut().add_chunk(&coords, true),
        _ => world.pipeline_mut().add_chunk(&coords, false),
    }
    tick_until(world, &format!("{coords:?} to be ready"), |world| {
        world.chunks().is_chunk_ready(&coords)
    });
}

/// A chunk and its light ring, ready: what an edit in it waits for.
fn ready_around(world: &mut World, center: Vec2<i32>) {
    for dx in -1..=1 {
        for dz in -1..=1 {
            ready(world, Vec2(center.0 + dx, center.1 + dz));
        }
    }
}

fn edit(world: &mut World, voxel: Vec3<i32>, id: u32) {
    world.chunks_mut().update_voxel(&voxel, id);
    tick_until(world, &format!("the edit at {voxel:?}"), |world| {
        world.chunks().get_voxel(voxel.0, voxel.1, voxel.2) == id
    });
}

/// Run the sweep at a moment of the test's choosing, past the wall clock the
/// ticks' own sweeps use.
struct Clock(Instant);

impl Clock {
    fn new() -> Self {
        Self(Instant::now() + Duration::from_secs(1))
    }

    /// One sweep now, then one after the idle time: every chunk nobody is
    /// near has been unwanted long enough.
    fn sweep_idle(&mut self, world: &mut World) -> ChunkEvictionStats {
        self.sweep(world);
        self.0 += IDLE;
        self.sweep(world)
    }

    fn sweep(&mut self, world: &mut World) -> ChunkEvictionStats {
        self.0 += Duration::from_secs(2);
        let ecs = world.ecs();
        let config = ecs.read_resource::<WorldConfig>();
        let mut eviction = ecs.write_resource::<ChunkEviction>();
        eviction.sweep(
            self.0,
            &config,
            &mut ecs.write_resource::<Chunks>(),
            &ecs.read_resource::<ChunkInterests>(),
            &mut ecs.write_resource::<Pipeline>(),
            &mut ecs.write_resource::<Mesher>(),
        );
        eviction.stats.clone()
    }
}

fn watch(world: &mut World, coords: Vec2<i32>) {
    world
        .ecs_mut()
        .write_resource::<ChunkInterests>()
        .add("walker", &coords);
}

fn is_resident(world: &World, coords: Vec2<i32>) -> bool {
    world.chunks().raw(&coords).is_some()
}

#[test]
fn a_chunk_nobody_is_near_goes_after_the_idle_time_and_one_in_view_stays() {
    actix::System::new().block_on(async {
        let mut world = world("eviction-idle", None, 0);
        let mut clock = Clock::new();
        ready(&mut world, Vec2(0, 0));
        ready(&mut world, Vec2(6, 0));
        watch(&mut world, Vec2(0, 0));

        clock.sweep(&mut world);
        assert!(is_resident(&world, Vec2(6, 0)), "evicted before its idle time ran out");

        clock.0 += IDLE;
        let stats = clock.sweep(&mut world);
        assert!(!is_resident(&world, Vec2(6, 0)), "an idle chunk stayed: {stats:?}");
        assert!(stats.evicted > 0);
        assert!(is_resident(&world, Vec2(0, 0)), "the watched chunk was evicted");
        // Its light ring and the ring beyond it stay with it.
        assert!(is_resident(&world, Vec2(1, 0)));
        assert!(is_resident(&world, Vec2(1, 1)));

        // Coming back generates it again.
        ready(&mut world, Vec2(6, 0));
        assert_eq!(world.chunks().get_voxel(6 * 16 + 3, 2, 3), GROUND);
    });
}

#[test]
fn an_edit_is_on_disk_before_its_chunk_goes_and_reads_back_after() {
    actix::System::new().block_on(async {
        let dir = save_dir("edit");
        let mut world = world("eviction-edit", Some(&dir), 0);
        let mut clock = Clock::new();
        let edited = Vec3(5 * 16 + 2, 10, 2);
        ready_around(&mut world, Vec2(5, 0));
        edit(&mut world, edited.clone(), GROUND);

        // Drain whatever save the edit queued on its own, then edit again so
        // the live chunk is ahead of its file when the sweep finds it.
        tick_until(&mut world, "the first save", |world| {
            world.chunks().saves_in_flight.is_empty() && world.chunks().to_save.is_empty()
        });
        let edited_again = Vec3(5 * 16 + 3, 11, 2);
        world.chunks_mut().update_voxel(&edited_again, GROUND);
        tick_until(&mut world, "the second edit", |world| {
            world
                .chunks()
                .get_voxel(edited_again.0, edited_again.1, edited_again.2)
                == GROUND
        });

        clock.sweep_idle(&mut world);
        assert!(
            is_resident(&world, Vec2(5, 0)) || world.chunks().is_persisted(&Vec2(5, 0)),
            "an edited chunk went before its save was confirmed"
        );
        tick_until(&mut world, "the save to land", |world| {
            world.chunks().is_persisted(&Vec2(5, 0))
        });
        clock.sweep(&mut world);
        assert!(!is_resident(&world, Vec2(5, 0)), "a saved chunk nobody is near stayed");

        ready(&mut world, Vec2(5, 0));
        let chunks = world.chunks();
        assert_eq!(chunks.get_voxel(edited.0, edited.1, edited.2), GROUND);
        assert_eq!(
            chunks.get_voxel(edited_again.0, edited_again.1, edited_again.2),
            GROUND,
            "the edit made after the first save was lost"
        );
        drop(chunks);
        std::fs::remove_dir_all(&dir).ok();
    });
}

#[test]
fn an_edited_chunk_stays_when_the_world_does_not_save() {
    actix::System::new().block_on(async {
        let mut world = world("eviction-unsaved", None, 0);
        let mut clock = Clock::new();
        ready_around(&mut world, Vec2(5, 0));
        edit(&mut world, Vec3(5 * 16 + 2, 10, 2), GROUND);

        let stats = clock.sweep_idle(&mut world);
        assert!(is_resident(&world, Vec2(5, 0)), "an unsaved edit was thrown away");
        assert!(stats.unsaved >= 1, "{stats:?}");
        // Its untouched neighbors still go.
        assert!(!is_resident(&world, Vec2(5, 2)));
    });
}

#[test]
fn a_regenerated_chunk_gets_back_the_leaf_its_kept_neighbor_wrote() {
    actix::System::new().block_on(async {
        let mut world = world("eviction-leftover", None, 0);
        let mut clock = Clock::new();
        ready(&mut world, Vec2(0, 0));
        ready(&mut world, Vec2(1, 0));
        assert_eq!(world.chunks().get_voxel(OVERHANG.0, OVERHANG.1, OVERHANG.2), LEAF);

        // Seen from two chunks west: (0, 0) stays, (1, 0) goes.
        watch(&mut world, Vec2(-2, 0));
        clock.sweep_idle(&mut world);
        assert!(is_resident(&world, Vec2(0, 0)));
        assert!(!is_resident(&world, Vec2(1, 0)));

        ready(&mut world, Vec2(1, 0));
        assert_eq!(
            world.chunks().get_voxel(OVERHANG.0, OVERHANG.1, OVERHANG.2),
            LEAF,
            "(1, 0) came back without the leaf (0, 0) wrote into it"
        );
    });
}

#[test]
fn a_regenerated_chunk_does_not_write_over_an_edit_in_its_kept_neighbor() {
    actix::System::new().block_on(async {
        let dir = save_dir("overwrite");
        let mut world = world("eviction-overwrite", Some(&dir), 0);
        let mut clock = Clock::new();
        ready(&mut world, Vec2(0, 0));
        ready_around(&mut world, Vec2(1, 0));
        // A player breaks the leaf.
        edit(&mut world, OVERHANG, 0);

        // Seen from two chunks east: (1, 0) stays, (0, 0) goes.
        watch(&mut world, Vec2(3, 0));
        clock.sweep_idle(&mut world);
        assert!(is_resident(&world, Vec2(1, 0)));
        assert!(!is_resident(&world, Vec2(0, 0)));

        // Its whole ring, so a write it sends into (1, 0) lands instead of
        // waiting parked for a footprint that is not ready.
        ready_around(&mut world, Vec2(0, 0));
        tick_until(&mut world, "pending writes to land", |world| {
            world.chunks().pending_updates_count() == 0
        });
        assert_eq!(
            world.chunks().get_voxel(OVERHANG.0, OVERHANG.1, OVERHANG.2),
            0,
            "regenerating (0, 0) put the broken leaf back"
        );
        std::fs::remove_dir_all(&dir).ok();
    });
}

#[test]
fn a_late_generator_write_is_not_an_edit_and_comes_back_with_its_chunk() {
    actix::System::new().block_on(async {
        let mut world = world("eviction-late", None, 0);
        let mut clock = Clock::new();
        // (3, 0) is two chunks out, so nothing makes it before (1, 0) and
        // its ring are ready; its leaf arrives afterwards, through the edit
        // lane.
        ready_around(&mut world, Vec2(1, 0));
        ready(&mut world, Vec2(3, 0));
        tick_until(&mut world, "the late leaf", |world| {
            world.chunks().get_voxel(REACH.0, REACH.1, REACH.2) == LEAF
        });
        assert!(
            !world.chunks().is_chunk_save_dirty(&Vec2(1, 0)),
            "the generator's own output counted as an edit"
        );

        let stats = clock.sweep_idle(&mut world);
        assert!(!is_resident(&world, Vec2(1, 0)), "kept as if edited: {stats:?}");
        assert_eq!(stats.unsaved, 0, "{stats:?}");

        ready(&mut world, Vec2(1, 0));
        assert_eq!(
            world.chunks().get_voxel(REACH.0, REACH.1, REACH.2),
            LEAF,
            "(1, 0) came back without the leaf (3, 0) wrote after it was ready"
        );
    });
}

#[test]
fn past_the_cap_idle_chunks_go_without_waiting() {
    actix::System::new().block_on(async {
        let mut world = world("eviction-cap", None, 8);
        let mut clock = Clock::new();
        for x in [-6, 0, 6] {
            ready(&mut world, Vec2(x, 0));
        }
        watch(&mut world, Vec2(0, 0));

        // The ticks' own sweeps may already have started on the cap.
        let stats = clock.sweep(&mut world);
        assert!(stats.evicted > 0, "nothing went past the cap: {stats:?}");
        assert!(is_resident(&world, Vec2(0, 0)), "the cap evicted a watched chunk");
        // The watched chunk's keep area alone is 25 chunks, so the cap cannot
        // be met; everything else is gone.
        assert!(!is_resident(&world, Vec2(6, 0)));
        assert!(!is_resident(&world, Vec2(-6, 0)));
    });
}
