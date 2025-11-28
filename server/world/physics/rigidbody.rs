use crate::{Vec3, AABB};

/// A physical body in the Voxelize world.
#[derive(Default, Clone)]
pub struct RigidBody {
    /// If `body.collision` is true that tick, means there's a collision detected.
    pub collision: Option<[f32; 3]>,

    /// If the body stepped upwards that tick.
    pub stepped: bool,

    /// The amount of drag this body has in air.
    pub air_drag: f32,
    /// The amount of drag this body has in fluid.
    pub fluid_drag: f32,

    /// A vector representing which axis is the body resting against something.
    pub resting: Vec3<i32>,

    /// Whether or not this body is in fluid.
    pub in_fluid: bool,

    /// Ratio of body this body is in fluid.
    pub ratio_in_fluid: f32,

    /// Whether or not this body is on a climbable block.
    pub on_climbable: bool,

    /// Velocity vector of the rigid body.
    pub velocity: Vec3<f32>,

    /// Forces vector of the rigid body.
    pub forces: Vec3<f32>,

    /// Impulses vector of the rigid body.
    pub impulses: Vec3<f32>,

    /// Counts how many frames this rigid body is static.
    pub sleep_frame_count: i32,

    /// AABB of this rigid body, describing its collision box.
    pub aabb: AABB,

    /// Mass of this rigid body.
    pub mass: f32,

    /// Friction of this rigid body.
    pub friction: f32,

    /// Restitution of this rigid body.
    pub restitution: f32,

    /// Gravity Multiplier of this rigid body. Set to 0 to fly.
    pub gravity_multiplier: f32,

    /// Whether or not this rigid body auto-steps up blocks.
    pub auto_step: bool,
}

impl RigidBody {
    /// Instantiate a new RigidBody using the Builder's pattern.
    pub fn new(aabb: &AABB) -> RigidBodyBuilder {
        RigidBodyBuilder::new(aabb)
    }

    /// Setter for rigid body's position, which is the center of the rigid body.
    pub fn set_position(&mut self, px: f32, py: f32, pz: f32) {
        let [offset_w, offset_h, offset_d] = self.aabb_offset();

        self.aabb
            .set_position(px - offset_w, py - offset_h, pz - offset_d);
        self.mark_active()
    }

    /// Set the position of the rigid body, which is the center of the rigid body.
    pub fn set_voxel_position(&mut self, vx: i32, vy: i32, vz: i32) {
        self.aabb.set_position(vx as f32, vy as f32, vz as f32);
        self.mark_active();
    }

    /// Get the position of the rigid body, which is the center of the rigid body.
    pub fn get_position(&self) -> Vec3<f32> {
        let [offset_w, offset_h, offset_d] = self.aabb_offset();
        Vec3(
            self.aabb.min_x + offset_w,
            self.aabb.min_y + offset_h,
            self.aabb.min_z + offset_d,
        )
    }

    /// Get the voxel position of the rigid body.
    pub fn get_voxel_position(&self) -> Vec3<i32> {
        let [offset_w, _, offset_d] = self.aabb_offset();
        Vec3(
            (self.aabb.min_x + offset_w).floor() as i32,
            (self.aabb.min_y).floor() as i32,
            (self.aabb.min_z + offset_d).floor() as i32,
        )
    }

    /// Adds a vector to rigid body's internal force, which gets processed every tick.
    pub fn apply_force(&mut self, fx: f32, fy: f32, fz: f32) {
        self.forces[0] += fx;
        self.forces[1] += fy;
        self.forces[2] += fz;
        self.mark_active();
    }

    /// Adds a vector to rigid body's internal impulse, which gets processed every tick.
    pub fn apply_impulse(&mut self, ix: f32, iy: f32, iz: f32) {
        self.impulses[0] += ix;
        self.impulses[1] += iy;
        self.impulses[2] += iz;
        self.mark_active();
    }

    /// Get x-axis of the resting vector of a rigid body. A resting
    /// vector indicates whether a body is resting or not.
    pub fn at_rest_x(&self) -> i32 {
        self.resting[0]
    }

    /// Get y-axis of the resting vector of a rigid body. A resting
    /// vector indicates whether a body is resting or not.
    pub fn at_rest_y(&self) -> i32 {
        self.resting[1]
    }

    /// Get z-axis of the resting vector of a rigid body. A resting
    /// vector indicates whether a body is resting or not.
    pub fn at_rest_z(&self) -> i32 {
        self.resting[2]
    }

    /// Mark rigid body as active in the physical world.
    pub fn mark_active(&mut self) {
        self.sleep_frame_count = 10;
    }

    /// Compute the offset from the minimum coordinates to the bottom center.
    fn aabb_offset(&self) -> [f32; 3] {
        [
            self.aabb.width() / 2.0,
            self.aabb.height() / 2.0,
            self.aabb.depth() / 2.0,
        ]
    }
}

/// Builder pattern for RigidBody.
#[derive(Default)]
pub struct RigidBodyBuilder {
    aabb: AABB,
    mass: f32,
    friction: f32,
    restitution: f32,
    gravity_multiplier: f32,
    auto_step: bool,
}

impl RigidBodyBuilder {
    /// Create a new RigidBody with the builder pattern.
    pub fn new(aabb: &AABB) -> Self {
        Self {
            aabb: aabb.to_owned(),

            mass: 1.0,
            friction: 1.0,
            gravity_multiplier: 1.0,
            auto_step: false,

            ..Default::default()
        }
    }

    /// Configure the mass of this rigid body. Default is 1.0.
    pub fn mass(mut self, mass: f32) -> Self {
        self.mass = mass;
        self
    }

    /// Configure the friction of this rigid body. Default is 1.0.
    pub fn friction(mut self, friction: f32) -> Self {
        self.friction = friction;
        self
    }

    pub fn restitution(mut self, restitution: f32) -> Self {
        self.restitution = restitution;
        self
    }

    pub fn gravity_multiplier(mut self, gravity_multiplier: f32) -> Self {
        self.gravity_multiplier = gravity_multiplier;
        self
    }

    pub fn auto_step(mut self, auto_step: bool) -> Self {
        self.auto_step = auto_step;
        self
    }

    pub fn build(self) -> RigidBody {
        RigidBody {
            collision: None,
            stepped: false,

            air_drag: -1.0,
            fluid_drag: -1.0,

            resting: Vec3::default(),
            velocity: Vec3::default(),
            in_fluid: false,
            ratio_in_fluid: 0.0,
            on_climbable: false,
            forces: Vec3::default(),
            impulses: Vec3::default(),
            sleep_frame_count: 10 | 0,

            aabb: self.aabb,
            mass: self.mass,
            friction: self.friction,
            restitution: self.restitution,
            gravity_multiplier: self.gravity_multiplier,
            auto_step: self.auto_step,
        }
    }
}
