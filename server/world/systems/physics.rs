use std::ops::Deref;

use hashbrown::HashMap;
use log::info;
use rapier3d::prelude::CollisionEvent;
use specs::{BitSet, Entities, ReadExpect, ReadStorage, System, WriteExpect, WriteStorage};

use crate::{
    world::{
        components::{CurrentChunkComp, PositionComp, RigidBodyComp},
        interests::ChunkInterests,
        physics::Physics,
        registry::Registry,
        stats::Stats,
        voxels::Chunks,
        WorldConfig,
    },
    run_on_tick_pool, tick_split, ClientFilter, ClientFlag, CollisionsComp, Event, EventBuilder,
    Events, IDComp, InteractorComp, Vec2, Vec3, TICK_SPLIT_MIN_BODIES,
};

#[derive(Default)]
pub struct PhysicsSystem;

impl<'a> System<'a> for PhysicsSystem {
    type SystemData = (
        Entities<'a>,
        ReadExpect<'a, Stats>,
        ReadExpect<'a, Registry>,
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, Chunks>,
        ReadExpect<'a, ChunkInterests>,
        WriteExpect<'a, Physics>,
        WriteExpect<'a, Events>,
        ReadStorage<'a, IDComp>,
        ReadStorage<'a, CurrentChunkComp>,
        ReadStorage<'a, InteractorComp>,
        ReadStorage<'a, ClientFlag>,
        WriteStorage<'a, CollisionsComp>,
        WriteStorage<'a, RigidBodyComp>,
        WriteStorage<'a, PositionComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::{Join, ParJoin};

        let (
            entities,
            stats,
            registry,
            config,
            chunks,
            interests,
            mut physics,
            mut events,
            ids,
            curr_chunks,
            interactors,
            client_flag,
            mut collisions,
            mut bodies,
            mut positions,
        ) = data;

        if stats.preloading {
            return;
        }

        let mut collision_map = HashMap::new();

        // Tick the voxel physics of all entities (non-clients). Skip entities
        // whose chunk (or a neighbor) is not ready, and entities in chunks no
        // player is interested in. Choosing the active bodies is cheap and
        // runs inline; integrating them splits across the tick pool only
        // when there are enough to pay for the handoff.
        let mut active = BitSet::new();
        let mut active_count = 0usize;
        for (entity, curr_chunk, body, _, _) in (
            &entities,
            &curr_chunks,
            &mut bodies,
            &positions,
            !&client_flag,
        )
            .join()
        {
            if !chunks.is_chunk_ready(&curr_chunk.coords) {
                continue;
            }

            let cx = curr_chunk.coords.0;
            let cz = curr_chunk.coords.1;
            let mut neighbors_ready = true;
            for dx in -1i32..=1 {
                for dz in -1i32..=1 {
                    if dx == 0 && dz == 0 {
                        continue;
                    }
                    let n = Vec2(cx + dx, cz + dz);
                    if chunks.is_within_world(&n) && !chunks.is_chunk_ready(&n) {
                        neighbors_ready = false;
                        break;
                    }
                }
                if !neighbors_ready {
                    break;
                }
            }
            if !neighbors_ready {
                body.0.forces.set(0.0, 0.0, 0.0);
                body.0.impulses.set(0.0, 0.0, 0.0);
                continue;
            }

            if !interests.has_interests_in_region(&curr_chunk.coords) {
                body.0.forces.set(0.0, 0.0, 0.0);
                body.0.impulses.set(0.0, 0.0, 0.0);
                continue;
            }

            active.add(entity.id());
            active_count += 1;
        }

        let integrate =
            |(_, body, position): (u32, &mut RigidBodyComp, &mut PositionComp)| {
                // First tick against ready terrain: lift the body clear of
                // any solids it was revived or spawned overlapping (saves
                // written under older body dimensions bake in centers the
                // current box may overlap the floor with).
                if !body.0.is_placement_validated {
                    Physics::validate_placement(&mut body.0, chunks.deref(), &registry, &config);
                    let lifted_pos = body.0.get_position();
                    position.0.set(lifted_pos.0, lifted_pos.1, lifted_pos.2);
                }

                Physics::iterate_body(&mut body.0, stats.delta, chunks.deref(), &registry, &config);

                let body_pos = body.0.get_position();
                let Vec3(px, py, pz) = body_pos;
                position.0.set(px, py, pz);
            };

        if tick_split(active_count, TICK_SPLIT_MIN_BODIES) {
            let work = (&active, &mut bodies, &mut positions).par_join();
            run_on_tick_pool(move || work.for_each(&integrate));
        } else {
            (&active, &mut bodies, &mut positions)
                .join()
                .for_each(&integrate);
        }

        // Move the clients' rigid bodies to their positions. A body that has
        // asked to sit out repulsion (an insect perched on a creature) has
        // its collider disabled for the step, so the contact solver never
        // pushes it — or what it sits on — apart; clients carry no body
        // here and keep their collider as it is.
        (&entities, &interactors, &positions)
            .join()
            .for_each(|(ent, interactor, position)| {
                physics.move_rapier_body(interactor.body_handle(), &position.0);
                if let Some(body) = bodies.get(ent) {
                    physics.set_collider_enabled(
                        interactor.collider_handle(),
                        !body.0.is_repulsion_exempt,
                    );
                }
                collision_map.insert(interactor.collider_handle().clone(), ent);
            });

        // Tick the rapier physics engine, and add the collisions to individual entities.
        let collision_events = physics.step(stats.delta);

        let mut started_collisions = Vec::new();
        let mut stopped_collisions = Vec::new();

        for event in collision_events {
            match event {
                CollisionEvent::Started(ch1, ch2, _) => {
                    if let (Some(ent1), Some(ent2)) =
                        (collision_map.get(&ch1), collision_map.get(&ch2))
                    {
                        started_collisions.push((*ent1, *ent2, event));
                    }
                }
                CollisionEvent::Stopped(ch1, ch2, _) => {
                    if let (Some(ent1), Some(ent2)) =
                        (collision_map.get(&ch1), collision_map.get(&ch2))
                    {
                        stopped_collisions.push((*ent1, *ent2, event));
                    }
                }
                _ => {}
            }
        }

        for (ent1, ent2, event) in started_collisions {
            if let Some(collision_comp) = collisions.get_mut(ent1) {
                collision_comp.0.push((event, ent2));
            }
            if let Some(collision_comp) = collisions.get_mut(ent2) {
                collision_comp.0.push((event, ent1));
            }
        }

        for (ent1, ent2, event) in stopped_collisions {
            if let Some(collision_comp) = collisions.get_mut(ent1) {
                collision_comp.0.push((event, ent2));
            }
            if let Some(collision_comp) = collisions.get_mut(ent2) {
                collision_comp.0.push((event, ent1));
            }
        }

        if config.collision_repulsion <= f32::EPSILON {
            return;
        }

        // Collision detection, push bodies away from one another.
        let mut collision_data = Vec::new();
        for (curr_chunk, body, interactor, entity, position) in (
            &curr_chunks,
            &mut bodies,
            &interactors,
            &entities,
            &positions,
        )
            .join()
        {
            if !chunks.is_chunk_ready(&curr_chunk.coords) || body.0.is_repulsion_exempt {
                continue;
            }

            let rapier_body = physics.get(&interactor.0);
            let after = rapier_body.translation();

            let Vec3(px, py, pz) = position.0;

            let dx = after.x - px;
            let dy = after.y - py;
            let dz = after.z - pz;

            let dx = if dx.abs() < 0.001 { 0.0 } else { dx };
            let dy = if dy.abs() < 0.001 { 0.0 } else { dy };
            let dz = if dz.abs() < 0.001 { 0.0 } else { dz };

            let len = (dx * dx + dy * dy + dz * dz).sqrt();

            if len > 0.0001 {
                collision_data.push((body, dx, dy, dz, len, entity));
            }
        }
        for (body, dx, dy, dz, len, entity) in collision_data {
            let mut dx = dx / len;
            let dy = dy / len;
            let mut dz = dz / len;

            // If only dy movements, add a little bias to eliminate stack overflow.
            if dx.abs() < 0.001 && dz.abs() < 0.001 {
                dx = fastrand::i32(-10..10) as f32 / 1000.0;
                dz = fastrand::i32(-10..10) as f32 / 1000.0;
            }

            // Check if the entity is a client, and if so, apply the impulse to the client's body.
            if client_flag.get(entity).is_some() {
                if let Some(id) = ids.get(entity) {
                    if let Some(impulse) =
                        client_repulsion_impulse([dx, dy, dz], config.client_collision_repulsion)
                    {
                        let event = EventBuilder::new("vox-builtin:impulse")
                            .payload(impulse.to_vec())
                            .filter(ClientFilter::Direct(id.0.to_owned()))
                            .build();
                        events.dispatch(event);
                    }
                    continue;
                }
            }

            // Apply the impulse to the body.
            body.0.apply_impulse(
                (dx * config.collision_repulsion).min(3.0),
                (dy * config.collision_repulsion).min(3.0),
                (dz * config.collision_repulsion).min(3.0),
            );
        }
    }
}

/// The impulse that pushes an overlapping client along `direction`, or
/// `None` when it would change nothing. With a repulsion of zero (the
/// default) overlapping players are never pushed apart, so without this a
/// zero impulse went to each of them every tick, and each one woke the
/// receiving body.
fn client_repulsion_impulse(direction: [f32; 3], strength: f32) -> Option<[f32; 3]> {
    let impulse = direction.map(|component| component * strength);
    impulse
        .iter()
        .any(|component| component.abs() > f32::EPSILON)
        .then_some(impulse)
}

#[cfg(test)]
mod client_repulsion_tests {
    use super::client_repulsion_impulse;

    #[test]
    fn a_zero_repulsion_sends_no_impulse() {
        assert_eq!(client_repulsion_impulse([0.01, -1.0, 0.0], 0.0), None);
        assert_eq!(client_repulsion_impulse([0.0, 0.0, 0.0], 0.4), None);
    }

    #[test]
    fn a_real_repulsion_pushes_along_the_overlap() {
        assert_eq!(
            client_repulsion_impulse([1.0, 0.0, -0.5], 0.4),
            Some([0.4, 0.0, -0.2])
        );
    }
}
