use crossbeam_channel::Receiver;
use hashbrown::HashMap;
use log::{debug, info};
use nalgebra::Vector3;
use rapier3d::{
    geometry::DefaultBroadPhase,
    prelude::{
        vector, ActiveEvents, BroadPhase, CCDSolver, ChannelEventCollector, ColliderBuilder,
        ColliderHandle, ColliderSet, CollisionEvent, ImpulseJointSet, IntegrationParameters,
        IslandManager, MultibodyJointSet, NarrowPhase, PhysicsHooks, PhysicsPipeline,
        RigidBody as RapierBody, RigidBodyBuilder as RapierBodyBuilder,
        RigidBodyHandle as RapierBodyHandle, RigidBodySet as RapierBodySet,
    },
};
use specs::Entity;

use crate::world::voxels::chunk::Chunk;
use crate::{approx_equals, BlockRotation, Vec2, Vec3, VoxelAccess};

use super::{registry::Registry, WorldConfig};

mod aabb;
mod raycast;
mod rigidbody;
mod sweep;

pub use aabb::*;
pub use raycast::*;
pub use rigidbody::*;
pub use sweep::*;

pub struct Physics {
    body_set: RapierBodySet,
    collider_set: ColliderSet,
    pipeline: PhysicsPipeline,
    integration_options: IntegrationParameters,
    island_manager: IslandManager,
    broad_phase: DefaultBroadPhase,
    narrow_phase: NarrowPhase,
    impulse_joint_set: ImpulseJointSet,
    multibody_joint_set: MultibodyJointSet,
    ccd_solver: CCDSolver,
    collision_recv: Receiver<CollisionEvent>,
    event_handler: ChannelEventCollector,
    gravity: Vector3<f32>,
    pub entity_to_handlers: HashMap<Entity, (ColliderHandle, RapierBodyHandle)>,
    /// Static colliders representing terrain chunks when `rapier_chunk_collisions` is enabled.
    pub chunk_colliders: HashMap<Vec2<i32>, (ColliderHandle, RapierBodyHandle)>,
}

impl Physics {
    pub fn new() -> Self {
        let (collision_send, collision_recv) = crossbeam_channel::unbounded();
        let (contact_force_send, _) = crossbeam_channel::unbounded();
        let event_handler = ChannelEventCollector::new(collision_send, contact_force_send);

        Self {
            collision_recv,
            body_set: RapierBodySet::default(),
            broad_phase: DefaultBroadPhase::new(),
            ccd_solver: CCDSolver::default(),
            collider_set: ColliderSet::default(),
            impulse_joint_set: ImpulseJointSet::default(),
            integration_options: IntegrationParameters::default(),
            island_manager: IslandManager::default(),
            multibody_joint_set: MultibodyJointSet::default(),
            narrow_phase: NarrowPhase::default(),
            pipeline: PhysicsPipeline::default(),
            event_handler,
            gravity: vector![0.0, 0.0, 0.0],
            entity_to_handlers: HashMap::new(),
            chunk_colliders: HashMap::new(),
        }
    }

    pub fn step(&mut self, dt: f32) -> Vec<CollisionEvent> {
        self.integration_options.dt = dt;

        let physics_hooks = ();

        self.pipeline.step(
            &self.gravity,
            &self.integration_options,
            &mut self.island_manager,
            &mut self.broad_phase,
            &mut self.narrow_phase,
            &mut self.body_set,
            &mut self.collider_set,
            &mut self.impulse_joint_set,
            &mut self.multibody_joint_set,
            &mut self.ccd_solver,
            None,
            &physics_hooks,
            &self.event_handler,
        );

        let mut collisions = vec![];

        while let Ok(collision_event) = self.collision_recv.try_recv() {
            // Handle the collision event.
            collisions.push(collision_event);
        }

        collisions
    }

    pub fn register(&mut self, body: &RigidBody) -> (RapierBodyHandle, ColliderHandle) {
        let Vec3(px, py, pz) = body.get_position();

        let rapier_body = RapierBodyBuilder::dynamic()
            .additional_mass(body.mass)
            .translation(vector![px, py, pz])
            // .gravity_scale(0.0)
            .lock_rotations()
            .build();
        let mut collider = ColliderBuilder::capsule_y(
            body.aabb.height() / 2.0,
            (body.aabb.width() / 2.0).min(body.aabb.depth() / 2.0),
        )
        .build();

        collider.set_active_events(ActiveEvents::COLLISION_EVENTS);

        let body_handle = self.body_set.insert(rapier_body);
        let collider_handle: ColliderHandle =
            self.collider_set
                .insert_with_parent(collider, body_handle.clone(), &mut self.body_set);

        log::debug!(
            "[Physics] Added chunk collider at coords {:?} (body {:?}, collider {:?})",
            body.aabb,
            body_handle,
            collider_handle
        );

        (body_handle, collider_handle)
    }

    pub fn unregister(&mut self, body_handle: &RapierBodyHandle, collider_handle: &ColliderHandle) {
        self.collider_set.remove(
            collider_handle.to_owned(),
            &mut self.island_manager,
            &mut self.body_set,
            false,
        );
        self.body_set.remove(
            body_handle.to_owned(),
            &mut self.island_manager,
            &mut self.collider_set,
            &mut self.impulse_joint_set,
            &mut self.multibody_joint_set,
            true,
        );

        log::debug!(
            "[Physics] Removed chunk collider (body {:?}, collider {:?})",
            body_handle,
            collider_handle
        );
    }

    pub fn get(&self, body_handle: &RapierBodyHandle) -> &RapierBody {
        &self.body_set[body_handle.to_owned()]
    }

    pub fn get_mut(&mut self, body_handle: &RapierBodyHandle) -> &mut RapierBody {
        &mut self.body_set[body_handle.to_owned()]
    }

    pub fn move_rapier_body(&mut self, body_handle: &RapierBodyHandle, position: &Vec3<f32>) {
        let body = self.get_mut(body_handle);
        let &Vec3(px, py, pz) = position;

        body.set_translation(vector![px, py, pz], false);
        body.set_linvel(vector![0.0, 0.0, 0.0], false);
        body.set_angvel(vector![0.0, 0.0, 0.0], false);
        body.reset_forces(false);
        body.reset_torques(false);
    }

    pub fn iterate_body(
        body: &mut RigidBody,
        dt: f32,
        space: &dyn VoxelAccess,
        registry: &Registry,
        config: &WorldConfig,
    ) {
        if approx_equals(dt, 0.0) {
            return;
        }

        let gravity_mag_sq =
            config.gravity[0].powf(2.0) + config.gravity[1].powf(2.0) + config.gravity[2].powf(2.0);
        let no_gravity = approx_equals(0.0, gravity_mag_sq);

        // Reset the flags.
        body.collision = None;
        body.stepped = false;

        // treat bodies with <= 0 mass as static
        if body.mass <= 0.0 {
            body.velocity.set(0.0, 0.0, 0.0);
            body.forces.set(0.0, 0.0, 0.0);
            body.impulses.set(0.0, 0.0, 0.0);
            return;
        }

        // skip bodies if static or no velocity/forces/impulses
        let local_no_grav = no_gravity || approx_equals(body.gravity_multiplier, 0.0);
        let is_body_asleep =
            Physics::is_body_asleep(space, registry, config, body, dt, local_no_grav);
        if is_body_asleep {
            return;
        }
        body.sleep_frame_count -= 1;

        let old_resting = body.resting.clone();

        // Check if under water, if so apply buoyancy and drag forces
        Physics::apply_fluid_forces(space, registry, config, body);

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
        Physics::process_collisions(space, registry, &mut body.aabb, &dx, &mut body.resting);

        // if autostep, and on ground, run collisions again with stepped up aabb
        if body.auto_step {
            let mut tmp_box = tmp_box.unwrap();
            Physics::try_auto_stepping(space, registry, body, &mut tmp_box, &dx);
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

    pub fn is_body_asleep(
        space: &dyn VoxelAccess,
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
            space,
            registry,
            &mut body.aabb,
            &sleep_vec,
            &mut |_, _, _, _| {
                is_resting = true;
                true
            },
            false,
            10,
        );

        is_resting
    }

    fn apply_fluid_forces(
        space: &dyn VoxelAccess,
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
            let id = space.get_voxel(vx, vy, vz);
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
        space: &dyn VoxelAccess,
        registry: &Registry,
        aabb: &mut AABB,
        velocity: &Vec3<f32>,
        resting: &mut Vec3<i32>,
    ) {
        resting.set(0, 0, 0);

        sweep(
            space,
            registry,
            aabb,
            velocity,
            &mut |_, axis, dir, vec| -> bool {
                resting[axis] = dir;
                vec[axis] = 0.0;
                false
            },
            true,
            10,
        );
    }

    fn try_auto_stepping(
        space: &dyn VoxelAccess,
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
            space,
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
            true,
            10,
        );

        let y = body.aabb.min_y;
        // TODO: AUTO_STEPPING HAPPENS HERE
        let y_dist = (y + 1.001).floor() - y;
        let up_vec = Vec3(0.0, y_dist, 0.0);
        let mut collided = false;

        sweep(
            space,
            registry,
            &mut body.aabb,
            &up_vec,
            &mut |_, _, _, _| {
                collided = true;
                true
            },
            true,
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
        Physics::process_collisions(space, registry, &mut body.aabb, &leftover, &mut tmp_resting);

        // bail if no movement happened in the originally blocked direction
        // if x_blocked && !approx_equals(old_aabb.min_x, target_pos[0]) {
        //     return;
        // }
        // if z_blocked && !approx_equals(old_aabb.min_z, target_pos[2]) {
        //     return;
        // }

        // if the new position is below the old position, then the new position is invalid
        // since we trying to step upwards
        if old_aabb.min_y < body.aabb.min_y {
            return;
        }

        // done, old_box is now at the target auto-stepped position
        body.aabb.copy(old_aabb);
        body.resting[0] = tmp_resting[0];
        body.resting[2] = tmp_resting[2];
        body.stepped = true;
    }

    // Helper function to create a fallback collider when mesh data is not available
    fn create_fallback_collider(&self, chunk: &Chunk) -> rapier3d::prelude::Collider {
        let Vec3(min_x, _, min_z) = chunk.min;
        let size = chunk.options.size as f32;

        rapier3d::prelude::ColliderBuilder::cuboid(size / 2.0, 0.1, size / 2.0)
            .translation(vector![
                min_x as f32 + size / 2.0,
                0.0,
                min_z as f32 + size / 2.0
            ])
            .build()
    }

    /// Register a collider for a chunk based on its calculated meshes.
    ///
    /// Given the chunk's `(cx, cz)` coordinate and its `Chunk` object, this function:
    /// 1. Creates a compound collider from the chunk's meshes in the `meshes` field
    /// 2. Creates a Rapier collider for each mesh level in the chunk
    /// 3. Inserts the rigid-body + collider into the internal Rapier sets and returns their
    ///    handles.
    ///
    /// The order of the returned tuple is **(body_handle, collider_handle)** to mirror
    /// `Physics::register` for entities.
    pub fn register_chunk_collider(
        &mut self,
        chunk_coords: &Vec2<i32>,
        chunk: &Chunk,
    ) -> (RapierBodyHandle, ColliderHandle) {
        debug_assert_eq!(
            *chunk_coords, chunk.coords,
            "Chunk coords do not match the supplied key when registering collider."
        );

        // Create a fixed rigid body for the chunk
        let body = rapier3d::prelude::RigidBodyBuilder::fixed().build();
        let body_handle = self.body_set.insert(body);

        // Handle the case where there are no meshes yet
        if chunk.meshes.is_none() || chunk.meshes.as_ref().unwrap().is_empty() {
            // Create a simple collider as fallback
            let Vec3(min_x, _, min_z) = chunk.min;
            let size = chunk.options.size as f32;
            let collider = rapier3d::prelude::ColliderBuilder::cuboid(size / 2.0, 0.1, size / 2.0)
                .translation(vector![
                    min_x as f32 + size / 2.0,
                    0.0,
                    min_z as f32 + size / 2.0
                ])
                .build();

            let collider_handle = self.collider_set.insert_with_parent(
                collider,
                body_handle.clone(),
                &mut self.body_set,
            );

            debug!(
                "[Physics] Added fallback chunk collider for coords {:?} (no meshes available)",
                chunk_coords
            );

            return (body_handle, collider_handle);
        }

        // Create a compound collider from all mesh levels
        let meshes = chunk.meshes.as_ref().unwrap();

        // We'll use the first mesh to create the main collider, then add the rest as children
        let first_mesh_level = *meshes.keys().next().unwrap();
        let first_mesh = &meshes[&first_mesh_level];

        // Create the main collider (either from mesh or fallback)
        let main_collider = if !first_mesh.geometries.is_empty() {
            // Collect all vertices and indices from all geometries in the mesh
            let mut all_vertices = Vec::new();
            let mut all_indices = Vec::new();
            let mut offset: usize = 0;

            for geometry in &first_mesh.geometries {
                // Add vertices
                for pos_chunk in geometry.positions.chunks(3) {
                    all_vertices.push(rapier3d::prelude::Point::new(
                        pos_chunk[0],
                        pos_chunk[1],
                        pos_chunk[2],
                    ));
                }

                // Add indices with offset
                for idx_chunk in geometry.indices.chunks(3) {
                    all_indices.push([
                        idx_chunk[0] as u32 + offset as u32,
                        idx_chunk[1] as u32 + offset as u32,
                        idx_chunk[2] as u32 + offset as u32,
                    ]);
                }

                // Update offset for the next geometry
                offset += geometry.positions.len() / 3;
            }

            if !all_vertices.is_empty() && !all_indices.is_empty() {
                rapier3d::prelude::ColliderBuilder::trimesh(all_vertices, all_indices).build()
            } else {
                // Fallback if empty geometries
                self.create_fallback_collider(chunk)
            }
        } else {
            // Fallback if no geometries
            self.create_fallback_collider(chunk)
        };

        let main_collider_handle = self.collider_set.insert_with_parent(
            main_collider,
            body_handle.clone(),
            &mut self.body_set,
        );

        // Process other mesh levels if any
        for (level, mesh) in meshes.iter() {
            if *level == first_mesh_level {
                continue; // Skip the first mesh we already processed
            }

            // Skip if no geometries
            if mesh.geometries.is_empty() {
                continue;
            }

            // Collect all vertices and indices from all geometries in this mesh level
            let mut level_vertices = Vec::new();
            let mut level_indices = Vec::new();
            let mut offset: usize = 0;

            for geometry in &mesh.geometries {
                // Add vertices
                for pos_chunk in geometry.positions.chunks(3) {
                    level_vertices.push(rapier3d::prelude::Point::new(
                        pos_chunk[0],
                        pos_chunk[1],
                        pos_chunk[2],
                    ));
                }

                // Add indices with offset
                for idx_chunk in geometry.indices.chunks(3) {
                    level_indices.push([
                        idx_chunk[0] as u32 + offset as u32,
                        idx_chunk[1] as u32 + offset as u32,
                        idx_chunk[2] as u32 + offset as u32,
                    ]);
                }

                // Update offset for the next geometry
                offset += geometry.positions.len() / 3;
            }

            if level_vertices.is_empty() || level_indices.is_empty() {
                continue;
            }

            let level_collider =
                rapier3d::prelude::ColliderBuilder::trimesh(level_vertices, level_indices).build();

            self.collider_set.insert_with_parent(
                level_collider,
                body_handle.clone(),
                &mut self.body_set,
            );
        }

        debug!(
            "[Physics] Added mesh-based chunk collider at coords {:?} with {} mesh levels",
            chunk_coords,
            meshes.len()
        );

        (body_handle, main_collider_handle)
    }

    /// Remove a previously registered chunk collider.
    ///
    /// This is the inverse of `register_chunk_collider` and cleans up both the Rapier
    /// `Collider` and its owning fixed `RigidBody`.
    pub fn unregister_chunk_collider(
        &mut self,
        collider: &ColliderHandle,
        body: &RapierBodyHandle,
    ) {
        self.collider_set.remove(
            collider.to_owned(),
            &mut self.island_manager,
            &mut self.body_set,
            false,
        );
        self.body_set.remove(
            body.to_owned(),
            &mut self.island_manager,
            &mut self.collider_set,
            &mut self.impulse_joint_set,
            &mut self.multibody_joint_set,
            true,
        );

        log::debug!(
            "[Physics] Removed chunk collider (body {:?}, collider {:?})",
            body,
            collider
        );
    }
}

// ------------------------------ Tests ----------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::voxels::chunk::ChunkOptions;

    fn make_flat_chunk(size: usize, height: u32) -> Chunk {
        let mut chunk = Chunk::new(
            "test",
            0,
            0,
            &ChunkOptions {
                size,
                max_height: 256,
                sub_chunks: 8,
            },
        );

        for x in 0..size {
            for z in 0..size {
                chunk.height_map[&[x, z]] = height;
            }
        }
        chunk.status = crate::ChunkStatus::Ready;
        chunk
    }

    #[test]
    fn collider_translation_and_cleanup() {
        let size = 16;
        let chunk = make_flat_chunk(size, 10);
        let coords = chunk.coords;

        let mut physics = Physics::new();

        let (body, collider) = physics.register_chunk_collider(&coords, &chunk);

        assert!(
            physics.collider_set.contains(collider),
            "Collider not registered."
        );

        let collider_world = &physics.collider_set[collider];
        let trans = collider_world.translation();
        let expected = vector![size as f32 * 0.5, 0.0, size as f32 * 0.5];
        assert!(
            (trans - expected).norm() < 1e-4,
            "Translation incorrect: {:?}",
            trans
        );

        physics.unregister_chunk_collider(&collider, &body);
        assert!(
            !physics.collider_set.contains(collider),
            "Collider not removed"
        );
    }
}

// End of file
