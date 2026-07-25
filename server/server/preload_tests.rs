use super::*;
use crate::FlatlandStage;

#[test]
fn bounded_world_preload_completes_with_oversize_radius() {
    actix::System::new().block_on(async {
        let mut server = Server::new().debug(false).build();

        // A 3x3-chunk world with a preload radius far beyond its bounds:
        // most cells of the completion check square can never be ready.
        let config = WorldConfig::new()
            .min_chunk([-1, -1])
            .max_chunk([1, 1])
            .preload(true)
            .preload_radius(5)
            .build();

        let mut bounded = World::new("bounded", &config);
        bounded.pipeline_mut().add_stage(FlatlandStage::new());

        let world = server
            .add_world(bounded)
            .expect("world should register")
            .clone();

        world.send(Preload).await.expect("preload should schedule");

        let mut preloading = true;
        for _ in 0..2000 {
            world.send(Tick).await.expect("tick should run");
            let info = world.send(GetInfo).await.expect("info should be readable");
            if !info.preloading {
                preloading = false;
                break;
            }
        }

        assert!(
            !preloading,
            "bounded world preload must complete even when the preload radius exceeds the world bounds"
        );
    });
}
