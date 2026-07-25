use super::*;

use super::*;
use crate::world::fixed_step::FixedStepConfig;

fn fixed() -> FixedStepConfig {
    FixedStepConfig {
        hz: 60,
        max_catchup_steps: 5,
        seed: 1,
    }
}

fn lag() -> LagCompConfig {
    LagCompConfig {
        window_ms: 300,
        max_ticks: 18,
        dly_floor_ms: 0,
        dly_ceil_ms: 250,
    }
}

// §8.1 through the real world tick path: `record_rewind_poses` historizes
// only rewind-eligible entities, capturing their pose keyed by tick.
#[test]
fn records_only_eligible_poses_at_tick() {
    actix::System::new().block_on(async {
        let config = WorldConfig::new()
            .fixed_timestep(Some(fixed()))
            .lag_comp(Some(lag()))
            .build();
        let mut world = World::new("lagcomp", &config);

        let eligible = world
            .ecs_mut()
            .create_entity()
            .with(PositionComp::new(1.0, 2.0, 3.0))
            .with(DirectionComp::new(0.0, 0.0, 1.0))
            .with(RewindEligibleComp)
            .build();
        let ineligible = world
            .ecs_mut()
            .create_entity()
            .with(PositionComp::new(9.0, 9.0, 9.0))
            .build();

        world.record_rewind_poses(1);

        let pose = world
            .rewound_pose(eligible.id() as u64, 1)
            .expect("eligible entity historized");
        assert_eq!(pose.position, [1.0, 2.0, 3.0]);
        assert_eq!(pose.direction, [0.0, 0.0, 1.0]);
        assert!(
            world.rewound_pose(ineligible.id() as u64, 1).is_none(),
            "unmarked entity must not be historized"
        );
    });
}

// §8.1 eviction through the world: the ring keeps exactly its capacity of
// most-recent frames; older frames evict.
#[test]
fn ring_evicts_oldest_beyond_capacity() {
    actix::System::new().block_on(async {
        let config = WorldConfig::new()
            .fixed_timestep(Some(fixed()))
            .lag_comp(Some(lag()))
            .build();
        let mut world = World::new("lagcomp", &config);
        let entity = world
            .ecs_mut()
            .create_entity()
            .with(PositionComp::new(0.0, 0.0, 0.0))
            .with(RewindEligibleComp)
            .build();

        let capacity = world.lag_comp().unwrap().history().capacity() as u64;
        for tick in 1..=(capacity + 5) {
            world
                .ecs_mut()
                .write_storage::<PositionComp>()
                .get_mut(entity)
                .unwrap()
                .0 = Vec3(tick as f32, 0.0, 0.0);
            world.record_rewind_poses(tick);
        }

        let newest = capacity + 5;
        let id = entity.id() as u64;
        assert_eq!(
            world.rewound_pose(id, newest).unwrap().position[0],
            newest as f32,
            "newest frame is the last recorded pose"
        );
        assert!(
            world.rewound_pose(id, newest - capacity + 1).is_some(),
            "oldest in-window frame retained"
        );
        assert!(
            world.rewound_pose(id, newest - capacity).is_none(),
            "frame past the window evicted"
        );
    });
}

// Opt-out default: a world without lag_comp keeps no ring and the recorder
// is an inert no-op — existing worlds pay nothing.
#[test]
fn disabled_world_records_nothing() {
    actix::System::new().block_on(async {
        let config = WorldConfig::new().build();
        let mut world = World::new("plain", &config);
        let entity = world
            .ecs_mut()
            .create_entity()
            .with(PositionComp::new(1.0, 2.0, 3.0))
            .with(RewindEligibleComp)
            .build();

        assert!(!world.has_lag_comp());
        world.record_rewind_poses(1);
        assert!(world.rewound_pose(entity.id() as u64, 1).is_none());
    });
}
