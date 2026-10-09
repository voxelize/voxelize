//! A client unloading a chunk while one of its stages runs must not leave
//! the chunks around it waiting forever. The unload used to pull the chunk
//! out of the pipeline mid-stage: the finished stage was thrown away, the
//! chunk stayed at the stage before, nothing would run it again, and every
//! neighbor that needed it past that stage never loaded.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::json;
use specs::{Builder, WorldExt};

use super::*;
use crate::{Chunk, ChunkStage, Resources, Space, SpaceData, Vec2, WsSender};

/// The first stage. It holds the chunk at `held` until `release` is set, so
/// the test can act while that stage is running.
struct HeldStage {
    held: Vec2<i32>,
    release: Arc<AtomicBool>,
}

impl ChunkStage for HeldStage {
    fn name(&self) -> String {
        "Held".to_owned()
    }

    fn process(&self, chunk: Chunk, _: Resources, _: Option<Space>) -> Chunk {
        if chunk.coords == self.held {
            while !self.release.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(1));
            }
        }
        chunk
    }
}

/// The second stage, which needs every neighbor past the first.
struct NeighborStage;

impl ChunkStage for NeighborStage {
    fn name(&self) -> String {
        "Neighbor".to_owned()
    }

    fn neighbors(&self, config: &WorldConfig) -> usize {
        config.chunk_size
    }

    fn needs_space(&self) -> Option<SpaceData> {
        Some(SpaceData {
            needs_voxels: true,
            needs_lights: false,
            needs_height_maps: false,
        })
    }

    fn process(&self, chunk: Chunk, _: Resources, _: Option<Space>) -> Chunk {
        chunk
    }
}

/// Two chunks side by side, `(0,0)` and `(1,0)`, each the other's only
/// neighbor.
fn two_chunk_world(name: &str, held: Vec2<i32>, release: Arc<AtomicBool>) -> World {
    let config = WorldConfig::new()
        .saving(false)
        .min_chunk([0, 0])
        .max_chunk([1, 0])
        .build();
    let mut world = World::new(name, &config);
    world.ecs_mut().insert(Registry::new());
    world.pipeline_mut().add_stage(HeldStage { held, release });
    world.pipeline_mut().add_stage(NeighborStage);
    world.prepare();
    world
}

fn add_client(world: &mut World, id: &str) {
    let entity = world.ecs_mut().create_entity().build();
    let (control, _) = tokio::sync::mpsc::unbounded_channel();
    let (bulk, _) = tokio::sync::mpsc::unbounded_channel();
    world.clients_mut().insert(
        id.to_owned(),
        Client {
            id: id.to_owned(),
            entity,
            username: id.to_owned(),
            sender: WsSender::new(control, bulk),
            motion_protocol: Default::default(),
        },
    );
}

fn unload(world: &mut World, id: &str, coords: &Vec2<i32>) {
    let message = Message::new(&MessageType::Unload)
        .json(&json!({ "chunks": [[coords.0, coords.1]] }).to_string())
        .build();
    world.on_unload(id, message);
}

fn tick_for(world: &mut World, duration: Duration, is_satisfied: impl Fn(&World) -> bool) -> bool {
    let deadline = Instant::now() + duration;
    while Instant::now() < deadline {
        world.tick();
        if is_satisfied(world) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(1));
    }
    false
}

#[test]
fn a_neighbor_still_loads_after_an_unload_lands_mid_stage() {
    actix::System::new().block_on(async {
        let wanted = Vec2(0, 0);
        let unloaded = Vec2(1, 0);
        let release = Arc::new(AtomicBool::new(false));
        let mut world = two_chunk_world("unload_mid_stage", unloaded.clone(), release.clone());
        add_client(&mut world, "walker");

        world
            .ecs_mut()
            .write_resource::<ChunkInterests>()
            .add("walker", &unloaded);
        world.pipeline_mut().add_chunk(&unloaded, false);
        assert!(
            tick_for(&mut world, Duration::from_secs(10), |world| world
                .pipeline()
                .has_chunk(&unloaded)),
            "the first stage of {unloaded:?} never started"
        );

        // The client walks away while that stage is still running.
        unload(&mut world, "walker", &unloaded);
        release.store(true, Ordering::Release);

        // Its neighbor is asked for next, and needs it past the first stage.
        world.pipeline_mut().add_chunk(&wanted, false);
        assert!(
            tick_for(&mut world, Duration::from_secs(20), |world| world
                .chunks()
                .is_chunk_ready(&wanted)),
            "{wanted:?} never reached Ready: the unload threw away the stage \
             running on {unloaded:?}, which then stayed short of the stage \
             {wanted:?} waits for, with nothing left to run it"
        );
    });
}

#[test]
fn an_unloaded_chunk_parks_where_its_running_stage_landed() {
    actix::System::new().block_on(async {
        let unloaded = Vec2(1, 0);
        let release = Arc::new(AtomicBool::new(false));
        let mut world = two_chunk_world("unload_parks", unloaded.clone(), release.clone());
        add_client(&mut world, "walker");

        world.pipeline_mut().add_chunk(&unloaded, false);
        assert!(
            tick_for(&mut world, Duration::from_secs(10), |world| world
                .pipeline()
                .has_chunk(&unloaded)),
            "the first stage of {unloaded:?} never started"
        );
        unload(&mut world, "walker", &unloaded);
        release.store(true, Ordering::Release);

        // The stage lands on the chunk, and nobody wants it any further.
        assert!(
            tick_for(&mut world, Duration::from_secs(10), |world| matches!(
                world.chunks().raw(&unloaded).map(|chunk| &chunk.status),
                Some(ChunkStatus::Generating(1))
            )),
            "the stage running on {unloaded:?} never landed"
        );
        tick_for(&mut world, Duration::from_millis(200), |_| false);
        assert!(
            matches!(
                world.chunks().raw(&unloaded).map(|chunk| &chunk.status),
                Some(ChunkStatus::Generating(1))
            ),
            "{unloaded:?} went on through the pipeline though nobody wants it"
        );
        assert!(!world.pipeline().has_chunk(&unloaded));
    });
}
