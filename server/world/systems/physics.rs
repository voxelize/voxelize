use std::ops::Deref;

use hashbrown::HashMap;
use log::info;
use rapier3d::prelude::CollisionEvent;
use specs::{Entities, ReadExpect, ReadStorage, System, WriteExpect, WriteStorage};

use crate::{
    world::{
        components::{CurrentChunkComp, PositionComp, RigidBodyComp},
        physics::Physics,
        registry::Registry,
        stats::Stats,
        voxels::Chunks,
        WorldConfig,
    },
    BrainComp, ClientFilter, ClientFlag, CollisionsComp, Event, EventBuilder, Events, IDComp,
    InteractorComp, Vec3,
};

struct RigidControlsOptions {
    sensitivity: f32,
    min_polar_angle: f32,
    max_polar_angle: f32,
    initial_position: [f32; 3],
    initial_direction: [f32; 3],
    rotation_lerp: f32,
    position_lerp: f32,
    step_lerp: f32,
    body_width: f32,
    body_height: f32,
    body_depth: f32,
    eye_height: f32,
    max_speed: f32,
    move_force: f32,
    responsiveness: f32,
    running_friction: f32,
    standing_friction: f32,
    fly_speed: f32,
    fly_force: f32,
    fly_impulse: f32,
    fly_inertia: f32,
    sprint_factor: f32,
    crouch_factor: f32,
    always_sprint: bool,
    air_move_mult: f32,
    fluid_push_force: f32,
    jump_impulse: f32,
    jump_force: f32,
    jump_time: f32,
    air_jumps: u32,
    step_height: f32,
}

const DEFAULT_OPTIONS: RigidControlsOptions = RigidControlsOptions {
    sensitivity: 100.0,
    min_polar_angle: std::f32::consts::PI * 0.01,
    max_polar_angle: std::f32::consts::PI * 0.99,
    initial_position: [0.0, 80.0, 10.0],
    initial_direction: [0.0, 0.0, 0.0],
    rotation_lerp: 0.9,
    position_lerp: 1.0,
    step_lerp: 0.6,
    body_width: 0.8,
    body_height: 1.55,
    body_depth: 0.8,
    eye_height: 0.9193548387096774,
    max_speed: 6.0,
    move_force: 30.0,
    responsiveness: 240.0,
    running_friction: 0.1,
    standing_friction: 4.0,
    fly_speed: 40.0,
    fly_force: 80.0,
    fly_impulse: 2.5,
    fly_inertia: 6.0,
    sprint_factor: 1.4,
    crouch_factor: 0.6,
    always_sprint: false,
    air_move_mult: 0.7,
    fluid_push_force: 0.3,
    jump_impulse: 8.0,
    jump_force: 1.0,
    jump_time: 50.0,
    air_jumps: 0,
    step_height: 0.5,
};

#[derive(Default)]
pub struct PhysicsSystem;

fn rotate_y(a: [f32; 3], b: [f32; 3], c: f32) -> [f32; 3] {
    let bx = b[0];
    let bz = b[2];

    // translate point to the origin
    let px = a[0] - bx;
    let pz = a[2] - bz;

    let sc = c.sin();
    let cc = c.cos();

    // perform rotation and translate to correct position
    let mut out = [0.0, 0.0, 0.0];
    out[0] = bx + pz * sc + px * cc;
    out[1] = a[1];
    out[2] = bz + pz * cc - px * sc;

    out
}

impl<'a> System<'a> for PhysicsSystem {
    type SystemData = (
        Entities<'a>,
        ReadExpect<'a, Stats>,
        ReadExpect<'a, Registry>,
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, Chunks>,
        WriteExpect<'a, Physics>,
        WriteExpect<'a, Events>,
        ReadStorage<'a, IDComp>,
        ReadStorage<'a, CurrentChunkComp>,
        ReadStorage<'a, InteractorComp>,
        ReadStorage<'a, ClientFlag>,
        WriteStorage<'a, BrainComp>,
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
            mut physics,
            mut events,
            ids,
            curr_chunks,
            interactors,
            client_flag,
            mut brains,
            mut collisions,
            mut bodies,
            mut positions,
        ) = data;

        let mut collision_map = HashMap::new();

        // Update the clients' rigid bodies by the physics engine
        (&mut bodies, &mut brains, &client_flag)
            .join()
            .for_each(|(body, brain, _)| {
                let options = &DEFAULT_OPTIONS;
                let body = &mut body.0;
                let state = &mut brain.state;
                let dt = stats.delta;

                let air_jumps = options.air_jumps;
                let jump_force = options.jump_force;
                let jump_time = options.jump_time;
                let jump_impulse = options.jump_impulse;
                let max_speed = options.max_speed;
                let sprint_factor = options.sprint_factor;
                let crouch_factor = options.crouch_factor;
                let move_force = options.move_force;
                let air_move_mult = options.air_move_mult;
                let responsiveness = options.responsiveness;
                let running_friction = options.running_friction;
                let standing_friction = options.standing_friction;
                let fly_inertia = options.fly_inertia;
                let fly_impulse = options.fly_impulse;
                let fly_force = options.fly_force;
                let fly_speed = options.fly_speed;
                let fluid_push_force = options.fluid_push_force;

                if body.gravity_multiplier != 0.0 {
                    // jumping
                    let on_ground = body.at_rest_y() < 0;
                    let can_jump = on_ground || state.jump_count < air_jumps;
                    if on_ground {
                        state.is_jumping = false;
                        state.jump_count = 0;
                    }

                    // process jump input
                    if state.jumping {
                        if state.is_jumping {
                            // continue previous jump
                            if state.current_jump_time > 0.0 {
                                let mut jf = jump_force;
                                if state.current_jump_time < dt {
                                    jf *= state.current_jump_time / dt;
                                }
                                body.apply_force(0.0, jf, 0.0);
                                state.current_jump_time -= dt;
                            }
                        } else if can_jump {
                            // start new jump
                            state.is_jumping = true;
                            if !on_ground {
                                state.jump_count += 1;
                            }
                            state.current_jump_time = jump_time;
                            body.apply_impulse(0.0, jump_impulse, 0.0);
                            // clear downward velocity on airjump
                            if !on_ground && body.velocity[1] < 0.0 {
                                body.velocity[1] = 0.0;
                            }
                        } else if body.ratio_in_fluid > 0.0 {
                            // apply impulse to swim
                            body.apply_impulse(0.0, fluid_push_force, 0.0);
                        }
                    } else {
                        state.is_jumping = false;
                    }

                    // apply movement forces if entity is moving, otherwise just friction
                    let mut m = [0.0, 0.0, 0.0];
                    let mut push = [0.0, 0.0, 0.0];
                    if state.running {
                        let mut speed = max_speed;
                        // todo: add crouch/sprint modifiers if needed
                        if state.sprinting {
                            speed *= sprint_factor;
                        }
                        if state.crouching {
                            speed *= crouch_factor;
                        }
                        m[2] = speed;

                        // rotate move vector to entity's heading
                        m = rotate_y(m, [0.0, 0.0, 0.0], state.heading);

                        // push vector to achieve desired speed & dir
                        // following code to adjust 2D velocity to desired amount is patterned on Quake:
                        // https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/bg_pmove.c#L275
                        push = [
                            m[0] - body.velocity[0],
                            m[1] - body.velocity[1],
                            m[2] - body.velocity[2],
                        ];
                        push[1] = 0.0;
                        let push_len = (push[0].powi(2) + push[1].powi(2) + push[2].powi(2)).sqrt();

                        push[0] /= push_len;
                        push[1] /= push_len;
                        push[2] /= push_len;

                        if push_len > 0.0 {
                            // pushing force vector
                            let mut can_push = move_force;
                            if !on_ground {
                                can_push *= air_move_mult;
                            }

                            // apply final force
                            let push_amt = responsiveness * push_len;
                            if can_push > push_amt {
                                can_push = push_amt;
                            }

                            push[0] *= can_push;
                            push[1] *= can_push;
                            push[2] *= can_push;

                            body.apply_force(push[0], push[1], push[2]);
                        }

                        // different friction when not moving
                        // idea from Sonic: http://info.sonicretro.org/SPG:Running
                        body.friction = running_friction;
                    } else {
                        body.friction = standing_friction;
                    }
                } else {
                    body.velocity[0] -= body.velocity[0] * fly_inertia * dt;
                    body.velocity[1] -= body.velocity[1] * fly_inertia * dt;
                    body.velocity[2] -= body.velocity[2] * fly_inertia * dt;

                    if state.jumping {
                        body.apply_impulse(0.0, fly_impulse, 0.0);
                    }

                    if state.crouching {
                        body.apply_impulse(0.0, -fly_impulse, 0.0);
                    }

                    // apply movement forces if entity is moving, otherwise just friction
                    let mut m = [0.0, 0.0, 0.0];
                    let mut push = [0.0, 0.0, 0.0];
                    if state.running {
                        let mut speed = fly_speed;
                        // todo: add crouch/sprint modifiers if needed
                        if state.sprinting {
                            speed *= sprint_factor;
                        }
                        if state.crouching {
                            speed *= crouch_factor;
                        }
                        m[2] = speed;

                        // rotate move vector to entity's heading
                        m = rotate_y(m, [0.0, 0.0, 0.0], state.heading);

                        // push vector to achieve desired speed & dir
                        // following code to adjust 2D velocity to desired amount is patterned on Quake:
                        // https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/bg_pmove.c#L275
                        push = [
                            m[0] - body.velocity[0],
                            m[1] - body.velocity[1],
                            m[2] - body.velocity[2],
                        ];

                        push[1] = 0.0;
                        let push_len = (push[0].powi(2) + push[1].powi(2) + push[2].powi(2)).sqrt();

                        push[0] /= push_len;
                        push[1] /= push_len;
                        push[2] /= push_len;

                        if push_len > 0.0 {
                            // pushing force vector
                            let mut can_push = fly_force;

                            // apply final force
                            let push_amt = responsiveness * push_len;
                            if can_push > push_amt {
                                can_push = push_amt;
                            }

                            push[0] *= can_push;
                            push[1] *= can_push;
                            push[2] *= can_push;

                            body.apply_force(push[0], push[1], push[2]);
                        }

                        // different friction when not moving
                        // idea from Sonic: http://info.sonicretro.org/SPG:Running
                        body.friction = running_friction;
                    } else {
                        body.friction = standing_friction;
                    }
                }

                // let Vec3(x, y, z) = body.get_position();
                // let eye_height = options.eye_height;
                // let body_height = options.body_height;
                // self.new_position
                //     .set(x, y + body_height * (eye_height - 0.5), z);
            });

        // Tick the voxel physics of all entities.
        (&curr_chunks, &mut bodies, &mut positions)
            .par_join()
            .for_each(|(curr_chunk, body, position)| {
                if !chunks.is_chunk_ready(&curr_chunk.coords) {
                    return;
                }

                Physics::iterate_body(&mut body.0, stats.delta, chunks.deref(), &registry, &config);

                let body_pos = body.0.get_position();
                let Vec3(px, py, pz) = body_pos;
                position.0.set(px, py, pz);
            });

        // Map the entities to their interactor components.
        (&entities, &interactors, &positions)
            .join()
            .for_each(|(ent, interactor, position)| {
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
            if !chunks.is_chunk_ready(&curr_chunk.coords) {
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
                    let event = EventBuilder::new("vox-builtin:impulse")
                        .payload(vec![
                            dx * config.client_collision_repulsion,
                            dy * config.client_collision_repulsion,
                            dz * config.client_collision_repulsion,
                        ])
                        .filter(ClientFilter::Direct(id.0.to_owned()))
                        .build();
                    events.dispatch(event);
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
