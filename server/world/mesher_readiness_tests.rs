//! Regressions around the mesher's light-traversal prerequisites. Both
//! failures here are invisible from outside — a chunk stuck short of `Ready`
//! and a world that quietly generates itself both just look like the server
//! being slow.

use std::time::{Duration, Instant};

use super::*;
use crate::world::generators::FlatlandStage;
use crate::Vec2;

fn flatland_world(name: &str, bounds: i32) -> World {
    let config = WorldConfig::new()
        .saving(false)
        .min_chunk([-bounds, -bounds])
        .max_chunk([bounds, bounds])
        .build();
    let mut world = World::new(name, &config);
    world.ecs_mut().insert(Registry::new());
    world.pipeline_mut().add_stage(FlatlandStage::new());
    world.prepare();
    world
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
fn meshing_chunk_with_missing_neighbors_converges_to_ready() {
    // A chunk whose light-traversal neighbor was never requested used to be
    // popped from the mesher queue with no listener, no re-queue, and no log —
    // stranded in `Meshing` forever, never sent to any client. The fix queues
    // the missing neighbor into the pipeline and re-adds the popped chunk
    // after the drain, so an isolated generation request still converges.
    actix::System::new().block_on(async {
        let mut world = flatland_world("mesher_stall", 8);

        // One isolated chunk, exactly as a lone request leaves the queue:
        // its light-traversal neighbors exist nowhere, and nothing else
        // will ever ask for them.
        world.pipeline_mut().add_chunk(&Vec2(0, 0), false);

        assert!(
            tick_for(&mut world, Duration::from_secs(60), |world| world
                .chunks()
                .is_chunk_ready(&Vec2(0, 0))),
            "chunk (0,0) never reached Ready: the mesher drain dropped it \
             instead of queueing its missing light-traversal neighbors"
        );
    });
}

#[test]
fn one_requested_chunk_does_not_generate_the_whole_world() {
    // The other side of that fix. When a missing light-traversal neighbor was
    // queued as a first-class chunk, it entered the mesher and queued *its*
    // missing neighbors in turn — nothing damped the recursion, so a single
    // request expanded until it hit the world bounds: every world generated
    // itself in full with no player connected, and held the result in memory.
    // A neighbor queued as context contributes voxel data and parks, so the
    // demanded chunk plus its ring is the whole bill.
    actix::System::new().block_on(async {
        let bounds = 8;
        let in_bounds = ((bounds * 2 + 1) * (bounds * 2 + 1)) as usize;
        let mut world = flatland_world("mesher_expansion", bounds);

        world.pipeline_mut().add_chunk(&Vec2(0, 0), false);

        assert!(
            tick_for(&mut world, Duration::from_secs(60), |world| world
                .chunks()
                .is_chunk_ready(&Vec2(0, 0))),
            "the demanded chunk (0,0) never reached Ready"
        );

        // Let any expansion that is going to happen, happen.
        tick_for(&mut world, Duration::from_secs(5), |_| false);

        // (0,0) needs its light-traversal ring to exist; it does not need the
        // ring's rings. A generous ceiling still catches a runaway.
        let generated = world.chunks().map.len();
        assert!(
            generated < in_bounds / 4,
            "one requested chunk generated {generated} of {in_bounds} \
             in-bounds chunks: the mesh-prerequisite expansion cascades \
             across the whole world instead of stopping at the chunks \
             lighting (0,0) actually needs"
        );
    });
}

#[test]
fn a_parked_context_chunk_is_revived_by_demand() {
    // Context chunks park short of the mesher, which is only safe because
    // parking is not dropping: the moment something demands one — here a
    // deliberate `add_chunk`, in production `ChunkRequestsSystem` — it must
    // still converge to `Ready` like any other chunk.
    actix::System::new().block_on(async {
        let mut world = flatland_world("mesher_park_revive", 8);

        world.pipeline_mut().add_chunk(&Vec2(0, 0), false);
        assert!(
            tick_for(&mut world, Duration::from_secs(60), |world| world
                .chunks()
                .is_chunk_ready(&Vec2(0, 0))),
            "the demanded chunk (0,0) never reached Ready"
        );

        let parked = Vec2(1, 1);
        {
            let chunks = world.chunks();
            let status = &chunks.raw(&parked).expect("ring member missing").status;
            assert!(
                matches!(status, ChunkStatus::Meshing),
                "ring member {parked:?} should be parked in Meshing, was {status:?}"
            );
        }

        world.mesher_mut().add_chunk(&parked, true);
        assert!(
            tick_for(&mut world, Duration::from_secs(60), |world| world
                .chunks()
                .is_chunk_ready(&parked)),
            "demanding the parked chunk {parked:?} never brought it to Ready"
        );
    });
}

#[test]
fn a_client_rerequest_revives_a_parked_chunk_despite_recorded_interest() {
    // The production wedge behind walkable-but-invisible regions: a client's
    // first request for a chunk recorded its interest, but the revival raced
    // (chunk mid-load, mesher entry superseded) and got lost. Revival used to
    // run only when the interest set was empty, so every retry from then on
    // saw the recorded interest and did nothing — the chunk stayed parked at
    // `Meshing` forever, its data never reached the client, and the client
    // could not mesh any chunk whose 9-stencil touched it. A re-request must
    // make progress no matter what interest is already recorded.
    actix::System::new().block_on(async {
        use specs::{Builder, WorldExt};

        let mut world = flatland_world("mesher_rerequest_revive", 8);

        world.pipeline_mut().add_chunk(&Vec2(0, 0), false);
        assert!(
            tick_for(&mut world, Duration::from_secs(60), |world| world
                .chunks()
                .is_chunk_ready(&Vec2(0, 0))),
            "the demanded chunk (0,0) never reached Ready"
        );

        let parked = Vec2(1, 1);
        assert!(
            matches!(
                world.chunks().raw(&parked).expect("ring member missing").status,
                ChunkStatus::Meshing
            ),
            "ring member {parked:?} should be parked in Meshing"
        );

        // The lost-race state: interest recorded, chunk still parked.
        world
            .ecs_mut()
            .write_resource::<ChunkInterests>()
            .add("wedged-client", &parked);

        // The client's retry, through the real request system.
        let mut requests = ChunkRequestsComp::new();
        requests.requests.push(parked.to_owned());
        world
            .ecs_mut()
            .create_entity()
            .with(IDComp::new("wedged-client"))
            .with(requests)
            .build();

        assert!(
            tick_for(&mut world, Duration::from_secs(60), |world| world
                .chunks()
                .is_chunk_ready(&parked)),
            "a re-request with interest already recorded never revived the \
             parked chunk {parked:?}: the revival gate only opens for the \
             first asker"
        );
    });
}
