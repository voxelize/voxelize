//! Regression: the mesher readiness drain must never silently drop a
//! chunk. A chunk whose light-traversal neighbor was never requested used
//! to be popped from the mesher queue with no listener, no re-queue, and
//! no log — stranded in `Meshing` forever, never sent to any client. The
//! fix queues the missing neighbor into the pipeline and re-adds the
//! popped chunk after the drain, so an isolated generation request still
//! converges to `Ready`.

use std::time::{Duration, Instant};

use super::*;
use crate::world::generators::FlatlandStage;
use crate::Vec2;

#[test]
fn meshing_chunk_with_missing_neighbors_converges_to_ready() {
    actix::System::new().block_on(async {
        let config = WorldConfig::new().saving(false).build();
        let mut world = World::new("mesher_stall", &config);
        world.ecs_mut().insert(Registry::new());
        world.pipeline_mut().add_stage(FlatlandStage::new());
        world.prepare();

        // One isolated chunk, exactly as a lone request leaves the queue:
        // its light-traversal neighbors exist nowhere, and nothing else
        // will ever ask for them.
        world.pipeline_mut().add_chunk(&Vec2(0, 0), false);

        let deadline = Instant::now() + Duration::from_secs(60);
        let mut is_ready = false;
        while Instant::now() < deadline {
            world.tick();
            if world.chunks().is_chunk_ready(&Vec2(0, 0)) {
                is_ready = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        assert!(
            is_ready,
            "chunk (0,0) never reached Ready: the mesher drain dropped it \
             instead of queueing its missing light-traversal neighbors"
        );
    });
}
