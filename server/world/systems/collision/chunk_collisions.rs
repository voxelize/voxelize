use log::debug;
use rapier3d::prelude::CollisionEvent;
use specs::{Join, ReadExpect, ReadStorage, System, WriteExpect};

use crate::{
    world::{physics::Physics, stats::Stats},
    CollisionsComp, RigidBodyComp,
};

/// System that scans collision events recorded on each entity and logs collisions
/// against static chunk colliders.  Every detected event increments
/// `stats.chunk_collision_count` for performance monitoring.
///
/// Runs **after** `PhysicsSystem` so all collisions for the current tick are
/// already populated.
#[derive(Default)]
pub struct ChunkCollisionEventSystem;

impl<'a> System<'a> for ChunkCollisionEventSystem {
    type SystemData = (
        ReadExpect<'a, Physics>,
        WriteExpect<'a, Stats>,
        ReadStorage<'a, RigidBodyComp>,
        ReadStorage<'a, CollisionsComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (physics, mut stats, _bodies, collisions) = data;

        // Build a fast set of all chunk collider handles.
        let chunk_colliders: std::collections::HashSet<_> =
            physics.chunk_colliders.values().map(|(c, _)| *c).collect();

        for (ent, col_comp) in (&collisions).join().enumerate() {
            for (event, other_ent) in &col_comp.0 {
                // Check if either collider in the event belongs to a chunk.
                let (c1, c2) = match event {
                    CollisionEvent::Started(c1, c2, _) |
                    CollisionEvent::Stopped(c1, c2, _) => (c1, c2),
                };

                let is_chunk_collision = chunk_colliders.contains(c1) || chunk_colliders.contains(c2);
                if is_chunk_collision {
                    debug!("Chunk collision event for entity {:?}: {:?}", ent, event);
                    stats.chunk_collision_count += 1;
                }
            }
        }
    }
}