use specs::{Component, VecStorage};

use crate::{RigidBody, Vec3};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct BrainState {
    pub heading: f32,
    pub running: bool,
    pub jumping: bool,
    pub sprinting: bool,

    pub jump_count: u32,
    pub is_jumping: bool,
    pub current_jump_time: f32,
}

impl Default for BrainState {
    fn default() -> Self {
        Self {
            heading: 0.0,
            running: false,
            jumping: false,
            sprinting: false,

            jump_count: 0,
            is_jumping: false,
            current_jump_time: 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrainOptions {
    pub max_speed: f32,
    pub move_force: f32,
    pub responsiveness: f32,
    pub running_friction: f32,
    pub standing_friction: f32,

    pub air_move_mult: f32,
    pub jump_impulse: f32,
    pub jump_force: f32,
    pub jump_time: f32, // ms
    pub air_jumps: u32,
    pub sprint_speed_mult: f32,
    pub sprint_force_mult: f32,
}

impl Default for BrainOptions {
    fn default() -> Self {
        Self {
            max_speed: 6.0,
            move_force: 12.0,
            responsiveness: 120.0,
            running_friction: 0.4,
            standing_friction: 2.0,

            air_move_mult: 0.7,
            jump_impulse: 8.0,
            jump_force: 1.0,
            jump_time: 50.0,
            air_jumps: 0,
            sprint_speed_mult: 1.2,
            sprint_force_mult: 1.5,
        }
    }
}

#[derive(Default, Component, Serialize, Deserialize)]
#[storage(VecStorage)]
pub struct BrainComp {
    pub state: BrainState,
    pub options: BrainOptions,

    #[serde(skip)]
    zero_vec: Vec3<f32>,
    #[serde(skip)]
    temp_vec: Vec3<f32>,
    #[serde(skip)]
    temp_vec2: Vec3<f32>,
}

impl BrainComp {
    pub fn new(options: BrainOptions) -> Self {
        Self {
            options,
            state: BrainState::default(),
            ..Default::default()
        }
    }

    /// Stop an entity from walking
    pub fn stop(&mut self) {
        self.state.running = false;
    }

    /// Mark entity to start walking
    pub fn walk(&mut self) {
        self.state.running = true;
    }

    /// Mark entity to start jumping
    pub fn jump(&mut self) {
        self.state.jumping = true;
    }

    /// Mark entity to be calm
    pub fn stop_jumping(&mut self) {
        self.state.jumping = false;
    }

    /// Mark entity to start sprinting
    pub fn sprint(&mut self) {
        self.state.sprinting = true;
    }

    /// Stop sprinting
    pub fn stop_sprinting(&mut self) {
        self.state.sprinting = false;
    }

    /// Operate brain state upon a rigid body
    pub fn operate(&mut self, target: &Vec3<f32>, body: &mut RigidBody, dt: f32) {
        // move implementation originally written as external module
        //   see https://github.com/andyhall/voxel-fps-controller
        //   for original code
        let origin = body.get_position();

        let dx = target.0 - origin.0;
        let dz = target.2 - origin.2;

        let angle = dx.atan2(dz);
        self.state.heading = angle;

        // jumping
        let on_ground = body.at_rest_y() < 0;
        let can_jump = on_ground || self.state.jump_count < self.options.air_jumps;
        if on_ground {
            self.state.is_jumping = false;
            self.state.jump_count = 0;
        }

        // process jump input
        if self.state.jumping {
            if self.state.is_jumping {
                // continue previous jump
                if self.state.current_jump_time > 0.0 {
                    let mut jf = self.options.jump_force;
                    if self.state.current_jump_time < dt {
                        jf *= self.state.current_jump_time / dt;
                    }
                    body.apply_force(0.0, jf, 0.0);
                    self.state.current_jump_time -= dt;
                }
            } else if can_jump {
                // start new jump
                self.state.is_jumping = true;
                if !on_ground {
                    self.state.jump_count += 1;
                }
                self.state.current_jump_time = self.options.jump_time;
                body.apply_impulse(0.0, self.options.jump_impulse, 0.0);
                // clear downward velocity on airjump
                if !on_ground && body.velocity[1] < 0.0 {
                    body.velocity[1] = 0.0;
                }
            }
        } else {
            self.state.is_jumping = false;
        }

        // apply movement forces if entity is moving, otherwise just friction
        let m = &mut self.temp_vec;
        let push = &mut self.temp_vec2;
        if self.state.running {
            let mut speed = self.options.max_speed;
            if self.state.sprinting {
                speed *= self.options.sprint_speed_mult;
            }
            m.set(0.0, 0.0, speed);

            // rotate move vector to entity's heading
            m.copy(&m.rotate_y(&self.zero_vec, self.state.heading));

            // push vector to achieve desired speed & dir
            // following code to adjust 2D velocity to desired amount is patterned on Quake:
            // https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/bg_pmove.c#L275
            push.copy(&m.sub(&body.velocity));
            push[1] = 0.0;
            let push_len = push.len();
            push.copy(&push.normalize());

            if push_len > 0.0 {
                // pushing force vector
                let mut can_push = self.options.move_force;
                if self.state.sprinting {
                    can_push *= self.options.sprint_force_mult;
                }
                if !on_ground {
                    can_push *= self.options.air_move_mult;
                }

                // apply final force
                let push_amt = self.options.responsiveness * push_len;
                if can_push > push_amt {
                    can_push = push_amt;
                }

                push.copy(&push.scale(can_push));
                body.apply_force(push.0, push.1, push.2);
            }

            // different friction when not moving
            // idea from Sonic: http://info.sonicretro.org/SPG:Running
            body.friction = self.options.running_friction;
        } else {
            body.friction = self.options.standing_friction;
        }
    }
}
