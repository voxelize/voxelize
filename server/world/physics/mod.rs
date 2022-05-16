use log::info;

use crate::{libs::math::approx_equals, vec::Vec3};

use self::{aabb::AABB, rigidbody::RigidBody, sweep::sweep};

use super::{registry::Registry, WorldConfig};

pub mod aabb;
pub mod rigidbody;
pub mod sweep;

pub type GetVoxelFunc<'a> = &'a dyn Fn(i32, i32, i32) -> u32;

pub struct Physics;

impl Physics {
    pub fn iterate_body(
        body: &mut RigidBody,
        dt: f32,
        get_voxel: GetVoxelFunc,
        config: &WorldConfig,
        registry: &Registry,
    ) {
        let gravity_mag_sq =
            config.gravity[0].powf(2.0) + config.gravity[1].powf(2.0) + config.gravity[2].powf(2.0);
        let no_gravity = approx_equals(0.0, gravity_mag_sq);

        // Reset the flags.
        body.collision = None;
        body.stepped = false;

        let old_resting = body.resting.clone();

        // treat bodies with <= 0 mass as static
        if body.mass <= 0.0 {
            body.velocity.set(0.0, 0.0, 0.0);
            body.forces.set(0.0, 0.0, 0.0);
            body.impulses.set(0.0, 0.0, 0.0);
            return;
        }

        // skip bodies if static or no velocity/forces/impulses
        let local_no_grav = no_gravity || approx_equals(body.gravity_multiplier, 0.0);
        if Physics::is_body_asleep(get_voxel, registry, config, body, dt, local_no_grav) {
            return;
        }
        body.sleep_frame_count -= 1;

        // Check if under water, if so apply buoyancy and drag forces
        Physics::apply_fluid_forces(get_voxel, registry, config, body);

        // semi-implicit Euler integration

        // a = f/m + gravity * gravity_multiplier
        let a = body
            .forces
            .scale(1.0 / body.mass)
            .scale_and_add(&Vec3::from(&config.gravity), body.gravity_multiplier);

        // dv = i/m + a*dt
        // v1 = v0 + dv
        let dv = body.impulses.scale(1.0 / body.mass);
        let dv = dv.scale_and_add(&a, dt);
        body.velocity = body.velocity.add(&dv);

        // apply friction based on change in velocity this frame
        if !approx_equals(body.friction, 0.0) {
            Physics::apply_friction_by_axis(0, body, &dv);
            Physics::apply_friction_by_axis(1, body, &dv);
            Physics::apply_friction_by_axis(2, body, &dv);
        }

        // linear air or fluid friction - effectively v *= drag;
        // body settings override global settings
        let mut drag = if body.air_drag >= 0.0 {
            body.air_drag
        } else {
            config.air_drag
        };
        if body.in_fluid {
            drag = if body.fluid_drag >= 0.0 {
                body.fluid_drag
            } else {
                config.fluid_drag
            };
            drag *= 1.0 - (1.0 - body.ratio_in_fluid).powi(2);
        }
        let mult = (1.0 - (drag * dt) / body.mass).max(0.0);
        body.velocity = body.velocity.scale(mult);

        // x1-x0 = v1*dt
        let dx = body.velocity.scale(dt);

        // clear forces and impulses for next timestep
        body.forces.set(0.0, 0.0, 0.0);
        body.impulses.set(0.0, 0.0, 0.0);

        // cache old position for use in autostepping
        let tmp_box = if body.auto_step {
            Some(body.aabb.clone())
        } else {
            None
        };

        // sweeps aabb along dx and accounts for collisions
        Physics::process_collisions(get_voxel, registry, &mut body.aabb, &dx, &mut body.resting);

        // if autostep, and on ground, run collisions again with stepped up aabb
        if body.auto_step {
            let mut tmp_box = tmp_box.unwrap();
            Physics::try_auto_stepping(get_voxel, registry, body, &mut tmp_box, &dx);
        }

        let mut impacts: Vec3<f32> = Vec3::default();

        // collision impacts. body.resting shows which axes had collisions
        for i in 0..3 {
            impacts[i] = 0.0;
            if body.resting[i] != 0 {
                // count impact only if wasn't collided last frame
                if old_resting[i] == 0 {
                    impacts[i] = -body.velocity[i];
                }
                body.velocity[i] = 0.0;
            }
        }

        let mag = impacts.len();
        if mag > 0.001 {
            // epsilon
            // send collision event - allow player to optionally change
            // body's restitution depending on what terrain it hit
            // event argument is impulse J = m * dv
            impacts = impacts.scale(body.mass);
            body.collision = Some(impacts.clone().to_arr());

            // bounce depending on restitution and min_bounce_impulse
            if body.restitution > 0.0 && mag > config.min_bounce_impulse {
                impacts = impacts.scale(body.restitution);
                body.apply_impulse(impacts.0, impacts.1, impacts.2);
            }
        }

        // sleep check
        let vsq = body.velocity.len().powi(2);
        if vsq > 1e-5 {
            body.mark_active()
        }
    }

    fn apply_fluid_forces(
        get_voxel: GetVoxelFunc,
        registry: &Registry,
        config: &WorldConfig,
        body: &mut RigidBody,
    ) {
        let aabb = &body.aabb;
        let cx = aabb.min_x.floor() as i32;
        let cz = aabb.min_z.floor() as i32;
        let y0 = aabb.min_y.floor() as i32;
        let y1 = aabb.max_y.floor() as i32;

        let test_fluid = |vx: i32, vy: i32, vz: i32| -> bool {
            let id = get_voxel(vx, vy, vz);
            let block = registry.get_block_by_id(id);
            block.is_fluid
        };

        if !test_fluid(cx, y0, cz) {
            body.in_fluid = false;
            body.ratio_in_fluid = 0.0;
            return;
        }

        // body is in fluid - find out how much body is submerged
        let mut submerged = 1;
        let mut cy = y0 + 1;

        while cy <= y1 && test_fluid(cx, cy, cz) {
            submerged += 1;
            cy += 1;
        }

        let fluid_level = y0 + submerged;
        let height_in_fluid = fluid_level as f32 - aabb.min_y;
        let mut ratio_in_fluid = height_in_fluid / (aabb.max_y - aabb.min_y);
        if ratio_in_fluid > 1.0 {
            ratio_in_fluid = 1.0;
        }
        let vol = aabb.width() * aabb.height() * aabb.depth();
        let displaced = vol * ratio_in_fluid;

        // buoyant force = -gravity * fluid_density * volume_displaced
        let scalar = config.fluid_density * displaced;
        body.apply_force(
            config.gravity[0] * scalar,
            config.gravity[1] * scalar,
            config.gravity[2] * scalar,
        );
    }

    fn apply_friction_by_axis(axis: usize, body: &mut RigidBody, dvel: &Vec3<f32>) {
        // friction applies only if moving into a touched surface
        let rest_dir = body.resting[axis];
        let v_normal = dvel[axis];
        if rest_dir == 0 || rest_dir as f32 * v_normal <= 0.0 {
            return;
        }

        // current vel lateral to friction axis
        let mut lateral_vel = body.velocity.clone();
        lateral_vel[axis] = 0.0;
        let v_curr = lateral_vel.len();
        if approx_equals(v_curr, 0.0) {
            return;
        }

        // treat current change in velocity as the result of a pseudoforce
        //        Fpseudo = m*dv/dt
        // Base friction force on normal component of the pseudoforce
        //        Ff = u * Fnormal
        //        Ff = u * m * dvnormal / dt
        // change in velocity due to friction force
        //        dvF = dt * Ff / m
        //            = dt * (u * m * dvnormal / dt) / m
        //            = u * dvnormal
        let dv_max = (body.friction * v_normal).abs();

        // decrease lateral vel by dv_max (or clamp to zero)
        let scalar = if v_curr > dv_max {
            (v_curr - dv_max) / v_curr
        } else {
            0.0
        };

        body.velocity[(axis + 1) % 3] *= scalar;
        body.velocity[(axis + 2) % 3] *= scalar;
    }

    fn process_collisions(
        get_voxel: GetVoxelFunc,
        registry: &Registry,
        aabb: &mut AABB,
        velocity: &Vec3<f32>,
        resting: &mut Vec3<i32>,
    ) {
        resting.set(0, 0, 0);

        sweep(
            get_voxel,
            registry,
            aabb,
            velocity,
            &mut |_, axis, dir, vec| -> bool {
                resting[axis] = dir;
                vec[axis] = 0.0;
                false
            },
            10,
        );
    }

    fn try_auto_stepping(
        get_voxel: GetVoxelFunc,
        registry: &Registry,
        body: &mut RigidBody,
        old_aabb: &mut AABB,
        dx: &Vec3<f32>,
    ) {
        // in the air
        if body.resting[1] >= 0 && !body.in_fluid {
            return;
        }

        // direction movement was blocked before trying a step
        let x_blocked = body.resting[0] != 0;
        let z_blocked = body.resting[2] != 0;
        if !(x_blocked || z_blocked) {
            return;
        }

        // continue auto-stepping only if headed sufficiently into obstruction
        let ratio = (dx[0] / dx[2]).abs();
        let cutoff = 4.0;
        if !x_blocked && ratio > cutoff || !z_blocked && ratio < 1.0 / cutoff {
            return;
        }

        // original target position before being obstructed
        let target_pos = [
            old_aabb.min_x + dx.0,
            old_aabb.min_y + dx.1,
            old_aabb.min_z + dx.2,
        ];

        // move towards the target until the first x/z collision
        sweep(
            get_voxel,
            registry,
            &mut body.aabb,
            dx,
            &mut |_, axis, _, vec| {
                if axis == 1 {
                    vec[axis] = 0.0;
                    return false;
                }
                true
            },
            10,
        );

        let y = body.aabb.min_y;
        // TODO: AUTO_STEPPING HAPPENS HERE
        let y_dist = (y + 1.001).floor() - y;
        let up_vec = Vec3(0.0, y_dist, 0.0);
        let mut collided = false;

        sweep(
            get_voxel,
            registry,
            &mut body.aabb,
            &up_vec,
            &mut |_, _, _, _| {
                collided = true;
                true
            },
            10,
        );

        if collided {
            return;
        }

        // now move in x/z however far was left over before hitting the obstruction
        let mut leftover = Vec3(
            target_pos[0] - old_aabb.min_x,
            target_pos[1] - old_aabb.min_y,
            target_pos[2] - old_aabb.min_z,
        );
        leftover[1] = 0.0;
        let mut tmp_resting = Vec3::default();
        Physics::process_collisions(
            get_voxel,
            registry,
            &mut body.aabb,
            &leftover,
            &mut tmp_resting,
        );

        // bail if no movement happened in the originally blocked direction
        if x_blocked && !approx_equals(old_aabb.min_x, target_pos[0]) {
            return;
        }
        if z_blocked && !approx_equals(old_aabb.min_z, target_pos[2]) {
            return;
        }

        // done, old_box is now at the target auto-stepped position
        body.aabb.copy(old_aabb);
        body.resting[0] = tmp_resting[0];
        body.resting[2] = tmp_resting[2];
        body.stepped = true;
    }

    fn is_body_asleep(
        get_voxel: GetVoxelFunc,
        registry: &Registry,
        config: &WorldConfig,
        body: &mut RigidBody,
        dt: f32,
        no_gravity: bool,
    ) -> bool {
        if body.sleep_frame_count > 0 {
            return false;
        }

        // without gravity bodies stay asleep until a force/impulse wakes them up
        if no_gravity {
            return true;
        }

        // otherwise check body is resting against something
        // i.e. sweep along by distance d = 1/2 g*t^2
        // and check there's still collision
        let g_mult = 0.5 * dt * dt * body.gravity_multiplier;

        let sleep_vec = Vec3(
            config.gravity[0] * g_mult,
            config.gravity[1] * g_mult,
            config.gravity[2] * g_mult,
        );

        let mut is_resting = false;

        sweep(
            get_voxel,
            registry,
            &mut body.aabb,
            &sleep_vec,
            &mut |_, _, _, _| {
                is_resting = true;
                true
            },
            10,
        );

        is_resting
    }
}
