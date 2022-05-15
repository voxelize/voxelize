use std::default;

use crate::vec::Vec3;

use super::aabb::AABB;

pub struct RigidBody {
    air_drag: f32,
    fluid_drag: f32,

    pub resting: Vec3<i32>,
    pub velocity: Vec3<f32>,
    pub in_fluid: bool,
    pub ratio_in_fluid: f32,
    pub forces: Vec3<f32>,
    pub impulses: Vec3<f32>,
    pub sleep_frame_count: u32,

    pub aabb: AABB,
    pub mass: f32,
    pub friction: f32,
    pub restitution: f32,
    pub gravity_multiplier: f32,
    pub auto_step: bool,
}

impl RigidBody {}

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
    pub fn new(aabb: &AABB) -> Self {
        Self {
            aabb: aabb.to_owned(),
            ..Default::default()
        }
    }

    pub fn mass(mut self, mass: f32) -> Self {
        self.mass = mass;
        self
    }

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
            air_drag: -1.0,
            fluid_drag: -1.0,

            resting: Vec3::default(),
            velocity: Vec3::default(),
            in_fluid: false,
            ratio_in_fluid: 0.0,
            forces: Vec3::default(),
            impulses: Vec3::default(),
            sleep_frame_count: 10,

            aabb: self.aabb,
            mass: self.mass,
            friction: self.friction,
            restitution: self.restitution,
            gravity_multiplier: self.gravity_multiplier,
            auto_step: self.auto_step,
        }
    }
}
