use std::f64;

use hashbrown::HashMap;
use nalgebra::{Rotation3, Vector3};

use crate::{LSystem, NoiseOptions, SeededNoise, Vec3, VoxelUpdate};

/// There are a set of L-system symbols for the tree generator.
/// The symbols are:
/// - `F`: Forward one unit.
/// - `+`: Rotate right drot degrees.
/// - `-`: Rotate left drot degrees.
/// - `#`: Rotate downwards dy degrees.
/// - `&`: Rotate upwards dy degrees.
/// - `[`: Push the current state onto the stack.
/// - `]`: Pop the current state from the stack.
/// - `@`: Scale length by decreases.
/// - `!`: Scale radius by decreases.
/// - `%`: Place a ball of leaves.

struct TreeState {
    pub base: Vec3<i32>,
    pub length: f64,
    pub radius: f64,
    pub y_angle: f64,
    pub rot_angle: f64,
    pub leaf_scale: f64,
}

#[derive(Clone)]
pub struct Trees {
    threshold: f64,
    noise: SeededNoise,
    trees: HashMap<String, Tree>,
}

impl Trees {
    pub fn new(seed: u32, options: &NoiseOptions) -> Trees {
        Trees {
            threshold: 0.5,
            noise: SeededNoise::new(seed + options.seed, options),
            trees: HashMap::new(),
        }
    }

    pub fn set_threshold(&mut self, threshold: f64) {
        self.threshold = threshold;
    }

    pub fn register(&mut self, name: &str, tree: Tree) {
        self.trees.insert(name.to_lowercase(), tree);
    }

    pub fn should_plant(&self, pos: &Vec3<i32>) -> bool {
        ((self.noise.get3d(pos.0, pos.1, pos.2) + 1.0) / 2.0 * 10000.0).floor() / 10000.0
            > self.threshold
    }

    pub fn generate(&self, name: &str, at: &Vec3<i32>) -> Vec<VoxelUpdate> {
        let tree = self.trees.get(&name.to_lowercase()).unwrap();
        // Panic if the tree doesn't exist
        let &Tree {
            leaf_radius,
            leaf_height,
            leaf_min_scale,
            leaf_id,
            trunk_id,
            branch_initial_radius,
            branch_min_radius,
            branch_radius_factor,
            branch_initial_length,
            branch_min_length,
            branch_length_factor,
            branch_drot_angle,
            branch_dy_angle,
            ..
        } = tree;

        let mut base = at.clone();
        let mut length = branch_initial_length as f64;
        let mut radius = branch_initial_radius as f64;
        let mut leaf_scale = 1.0;

        let mut y_angle = 0.0;
        let mut rot_angle = 0.0;

        let mut updates = HashMap::new();
        let mut leaves_updates = HashMap::new();

        let mut push_updates = |new_updates: Vec<VoxelUpdate>| {
            new_updates.into_iter().for_each(|(pos, id)| {
                updates.insert(pos, id);
            });
        };

        let mut stack = vec![];

        for symbol in tree.system_result.chars() {
            // Grow the tree from base.
            if symbol == 'F' {
                let delta_pos = Trees::angle_dist_cast(y_angle, rot_angle, length.ceil() as i32);
                let next_pos = Vec3(
                    delta_pos.0 + base.0,
                    delta_pos.1 + base.1,
                    delta_pos.2 + base.2,
                );

                push_updates(Trees::place_trunk_by_points(
                    trunk_id,
                    &base,
                    &next_pos,
                    radius.round() as i32,
                    radius.round() as i32,
                ));

                base = next_pos;
            } else if symbol == '+' {
                rot_angle += branch_drot_angle;
            } else if symbol == '-' {
                rot_angle -= branch_drot_angle;
            } else if symbol == '#' {
                y_angle += branch_dy_angle;
            } else if symbol == '$' {
                y_angle -= branch_dy_angle;
            } else if symbol == '@' {
                length *= branch_length_factor;
                length = length.max(branch_min_length as f64);
                leaf_scale *= branch_length_factor;
                leaf_scale = leaf_scale.max(leaf_min_scale);
            } else if symbol == '!' {
                radius *= branch_radius_factor;
                radius = radius.max(branch_min_radius as f64);
            } else if symbol == '%' {
                let scaled_radius = ((leaf_radius as f64) * leaf_scale).round().max(1.0) as u32;
                let scaled_height = ((leaf_height as f64) * leaf_scale).round().max(1.0) as u32;
                Trees::place_leaves(
                    leaf_id,
                    &Vec3(scaled_radius, scaled_height, scaled_radius),
                    &base,
                )
                .into_iter()
                .for_each(|(pos, id)| {
                    leaves_updates.insert(pos, id);
                });
            }
            // Save the state
            else if symbol == '[' {
                stack.push(TreeState {
                    base: base.clone(),
                    length,
                    radius,
                    y_angle,
                    rot_angle,
                    leaf_scale,
                });
            } else if symbol == ']' && !stack.is_empty() {
                let state = stack.pop().unwrap();
                base = state.base;
                length = state.length;
                radius = state.radius;
                y_angle = state.y_angle;
                rot_angle = state.rot_angle;
                leaf_scale = state.leaf_scale;
            }
        }

        leaves_updates.extend(updates.into_iter());

        leaves_updates.into_iter().collect()
    }

    fn place_trunk_by_angles(
        trunk_id: u32,
        from: &Vec3<i32>,
        y_angle: f64,
        rot_angle: f64,
        dist: i32,
        start_radius: i32,
        end_radius: i32,
    ) -> Vec<VoxelUpdate> {
        let &Vec3(fx, fy, fz) = from;

        let Vec3(dx, dy, dz) = Trees::angle_dist_cast(y_angle, rot_angle, dist);

        Trees::place_trunk_by_points(
            trunk_id,
            from,
            &Vec3(fx + dx, fy + dy, fz + dz),
            start_radius,
            end_radius,
        )
    }

    fn place_trunk_by_points(
        trunk_id: u32,
        from: &Vec3<i32>,
        to: &Vec3<i32>,
        start_radius: i32,
        end_radius: i32,
    ) -> Vec<VoxelUpdate> {
        let mut changes = vec![];

        let &Vec3(fx, fy, fz) = from;

        let height = to.sub(from);

        // Cannot be colinear to the y-axis.
        let rotation = Rotation3::rotation_between(
            &Vector3::y(),
            &Vector3::new(height.0 as f32, height.1 as f32, height.2 as f32),
        );

        let height = ((height.0 * height.0 + height.1 * height.1 + height.2 * height.2) as f32)
            .sqrt()
            .ceil();

        // Create a normal branch first
        for y in 0..(height as i32) {
            let radius = (((end_radius - start_radius) as f32) * (y as f32 / height as f32)) as i32
                + start_radius;

            for x in -radius..=radius {
                for z in -radius..=radius {
                    if ((x * x + z * z) as i32) < radius * radius {
                        let mut vec = Vector3::new(x as f32, y as f32, z as f32);

                        if let Some(rotation) = rotation {
                            vec = rotation.transform_vector(&vec);
                        }

                        let new_x = vec.x.round() as i32;
                        let new_y = vec.y.round() as i32;
                        let new_z = vec.z.round() as i32;

                        changes.push((Vec3(fx + new_x, fy + new_y, fz + new_z), trunk_id));
                    }
                }
            }
        }

        changes
    }

    fn place_leaves(leaf_id: u32, dimensions: &Vec3<u32>, at: &Vec3<i32>) -> Vec<VoxelUpdate> {
        let mut changes = vec![];

        let &Vec3(vx, vy, vz) = at;
        let &Vec3(dx, dy, dz) = dimensions;

        let dx = dx as i32;
        let dy = dy as i32;
        let dz = dz as i32;

        for x in -dx..=dx {
            for y in -dy..=dy {
                for z in -dz..=dz {
                    // Encapsulate the position within an ellipse
                    let dist = (x * x + y * y + z * z) as f32;
                    if dist >= (dx * dx + dy * dy + dz * dz) as f32 {
                        continue;
                    }

                    changes.push((Vec3(vx + x, vy + y, vz + z), leaf_id));
                }
            }
        }

        changes
    }

    fn angle_dist_cast(y_angle: f64, rot_angle: f64, dist: i32) -> Vec3<i32> {
        let dist = dist as f64;

        // Sin because y-angle is angle from y-axis not horizontal plane.
        let t_sum_x = y_angle.sin() * dist;
        let dy = (y_angle.cos() * dist).ceil() as i32;
        let dx = (rot_angle.cos() * t_sum_x).round() as i32;
        let dz = (rot_angle.sin() * t_sum_x).round() as i32;

        Vec3(dx, dy, dz)
    }
}

#[derive(Clone)]
pub struct Tree {
    /// The horizontal radius of each bunch of leaves.
    pub leaf_radius: i32,

    /// The height of each bunch of leaves.
    pub leaf_height: i32,

    /// The minimum scale factor for leaf clusters.
    pub leaf_min_scale: f64,

    /// The starting radius of the base of the tree.
    pub branch_initial_radius: i32,

    /// The minimum radius of the branches.
    pub branch_min_radius: i32,

    /// The rate at which the branch radius shrinks.
    pub branch_radius_factor: f64,

    /// The initial length of the branch.
    pub branch_initial_length: i32,

    /// The minimum length of the branch.
    pub branch_min_length: i32,

    /// The rate at which the branch length decreases.
    pub branch_length_factor: f64,

    /// The angle from the y-axis at which the branch turns on a node.
    pub branch_dy_angle: f64,

    /// The angle from the horizontal plane at which the branch turns on a node.
    pub branch_drot_angle: f64,

    /// The id of the leaf block.
    pub leaf_id: u32,

    /// The id of the trunk block.
    pub trunk_id: u32,

    /// The L-system production rules.
    pub rules: HashMap<char, String>,

    /// The L-system output to use.
    pub system_result: String,
}

impl Tree {
    pub fn new(leaf_id: u32, trunk_id: u32) -> TreeBuilder {
        TreeBuilder::new(leaf_id, trunk_id)
    }
}

pub struct TreeBuilder {
    leaf_radius: i32,
    leaf_height: i32,
    leaf_min_scale: f64,
    branch_min_radius: i32,
    branch_initial_radius: i32,
    branch_radius_factor: f64,
    branch_min_length: i32,
    branch_initial_length: i32,
    branch_length_factor: f64,
    branch_dy_angle: f64,
    branch_drot_angle: f64,
    leaf_id: u32,
    trunk_id: u32,
    rules: HashMap<char, String>,
    system: LSystem,
}

impl TreeBuilder {
    pub fn new(leaf_id: u32, trunk_id: u32) -> TreeBuilder {
        TreeBuilder {
            leaf_radius: 1,
            leaf_height: 1,
            leaf_min_scale: 0.5,

            branch_initial_radius: 5,
            branch_min_radius: 1,
            branch_radius_factor: 0.5,
            branch_initial_length: 5,
            branch_min_length: 1,
            branch_length_factor: 0.5,
            branch_dy_angle: 0.0,
            branch_drot_angle: 0.0,

            leaf_id,
            trunk_id,

            rules: HashMap::new(),
            system: LSystem::default(),
        }
    }

    pub fn leaf_radius(mut self, leaf_radius: i32) -> TreeBuilder {
        self.leaf_radius = leaf_radius;
        self
    }

    pub fn leaf_height(mut self, leaf_height: i32) -> TreeBuilder {
        self.leaf_height = leaf_height;
        self
    }

    pub fn leaf_min_scale(mut self, leaf_min_scale: f64) -> TreeBuilder {
        self.leaf_min_scale = leaf_min_scale;
        self
    }

    pub fn branch_initial_radius(mut self, branch_initial_radius: i32) -> TreeBuilder {
        self.branch_initial_radius = branch_initial_radius;
        self
    }

    pub fn branch_min_radius(mut self, branch_min_radius: i32) -> TreeBuilder {
        self.branch_min_radius = branch_min_radius;
        self
    }

    pub fn branch_radius_factor(mut self, branch_radius_factor: f64) -> TreeBuilder {
        self.branch_radius_factor = branch_radius_factor;
        self
    }

    pub fn branch_initial_length(mut self, branch_initial_length: i32) -> TreeBuilder {
        self.branch_initial_length = branch_initial_length;
        self
    }

    pub fn branch_min_length(mut self, branch_min_length: i32) -> TreeBuilder {
        self.branch_min_length = branch_min_length;
        self
    }

    pub fn branch_length_factor(mut self, branch_length_factor: f64) -> TreeBuilder {
        self.branch_length_factor = branch_length_factor;
        self
    }

    pub fn branch_dy_angle(mut self, branch_dy_angle: f64) -> TreeBuilder {
        self.branch_dy_angle = branch_dy_angle;
        self
    }

    pub fn branch_drot_angle(mut self, branch_drot_angle: f64) -> TreeBuilder {
        self.branch_drot_angle = branch_drot_angle;
        self
    }

    pub fn system(mut self, system: LSystem) -> TreeBuilder {
        self.system = system;
        self
    }

    pub fn leaf_id(mut self, leaf_id: u32) -> TreeBuilder {
        self.leaf_id = leaf_id;
        self
    }

    pub fn trunk_id(mut self, trunk_id: u32) -> TreeBuilder {
        self.trunk_id = trunk_id;
        self
    }

    pub fn rules(mut self, rules: HashMap<char, String>) -> TreeBuilder {
        self.rules = rules;
        self
    }

    pub fn rule(mut self, key: char, value: &str) -> TreeBuilder {
        self.rules.insert(key, value.to_owned());
        self
    }

    pub fn build(self) -> Tree {
        // Apply rules to the L-system
        let mut system = self.system;
        for (key, value) in &self.rules {
            system.rules.insert(*key, value.clone());
        }

        Tree {
            leaf_radius: self.leaf_radius,
            leaf_height: self.leaf_height,
            leaf_min_scale: self.leaf_min_scale,
            branch_initial_radius: self.branch_initial_radius,
            branch_min_radius: self.branch_min_radius,
            branch_radius_factor: self.branch_radius_factor,
            branch_initial_length: self.branch_initial_length,
            branch_min_length: self.branch_min_length,
            branch_length_factor: self.branch_length_factor,
            branch_dy_angle: self.branch_dy_angle,
            branch_drot_angle: self.branch_drot_angle,
            leaf_id: self.leaf_id,
            trunk_id: self.trunk_id,
            rules: self.rules,
            system_result: system.generate(),
        }
    }
}
