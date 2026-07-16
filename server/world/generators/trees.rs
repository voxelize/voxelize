use std::f64;

use hashbrown::HashMap;
use nalgebra::{Rotation3, Vector3};

use crate::{LSystem, NoiseOptions, SeededNoise, TreeRng, Vec3, VoxelUpdate};

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

/// Per-individual variation ranges for a tree species. Every draw comes
/// from the tree's position-seeded stream, so the same world seed always
/// grows the same forest. The neutral defaults are bit-exact no-ops:
/// species that configure nothing generate exactly as before.
#[derive(Debug, Clone, Copy)]
pub struct TreeVariance {
    /// Whole-tree scale multiplier on branch lengths, drawn per tree.
    pub size_range: (f64, f64),

    /// Starting leaf-cluster scale multiplier, drawn per tree.
    pub leaf_scale_range: (f64, f64),

    /// Initial trunk tilt from vertical in radians, drawn per tree. The
    /// tilt heading follows the spin draw.
    pub lean_range: (f64, f64),

    /// Whole-tree heading rotation in radians, drawn per tree in
    /// [0, spin). Use TAU so asymmetric species face any direction.
    pub spin: f64,

    /// Random +/- jitter in radians applied to every `+`/`-` turn.
    pub drot_jitter: f64,

    /// Random +/- jitter in radians applied to every `#`/`$` pitch.
    pub dy_jitter: f64,

    /// Random +/- fraction applied to every `F` segment's length.
    pub length_jitter: f64,
}

impl Default for TreeVariance {
    fn default() -> Self {
        Self {
            size_range: (1.0, 1.0),
            leaf_scale_range: (1.0, 1.0),
            lean_range: (0.0, 0.0),
            spin: 0.0,
            drot_jitter: 0.0,
            dy_jitter: 0.0,
            length_jitter: 0.0,
        }
    }
}

#[derive(Clone)]
pub struct Trees {
    seed: u32,
    threshold: f64,
    noise: SeededNoise,
    trees: HashMap<String, Tree>,
}

impl Trees {
    pub fn new(seed: u32, options: &NoiseOptions) -> Trees {
        Trees {
            seed,
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
            variance,
            ..
        } = tree;

        // One stream per individual, keyed by world seed and plant
        // position: neighboring trees of one species diverge, replants at
        // the same spot regrow identically.
        let mut rng = TreeRng::new(TreeRng::scramble(
            TreeRng::scramble(((self.seed as u64) << 32) | at.1 as u32 as u64)
                ^ (((at.0 as u32 as u64) << 32) | at.2 as u32 as u64),
        ));

        let size = rng.range(variance.size_range.0, variance.size_range.1);
        let mut leaf_scale = rng.range(variance.leaf_scale_range.0, variance.leaf_scale_range.1);
        let mut y_angle = rng.range(variance.lean_range.0, variance.lean_range.1);
        let mut rot_angle = rng.range(0.0, variance.spin);

        // Stochastic species re-roll their production per individual;
        // deterministic species reuse the string baked at build time.
        let expanded;
        let symbols = if tree.system.is_stochastic() {
            expanded = tree.system.generate_seeded(&mut rng);
            expanded.as_str()
        } else {
            tree.system_result.as_str()
        };

        let mut base = at.clone();
        let mut length = branch_initial_length as f64 * size;
        let mut radius = branch_initial_radius as f64;

        let mut updates = HashMap::new();
        let mut leaves_updates = HashMap::new();

        let mut push_updates = |new_updates: Vec<VoxelUpdate>| {
            new_updates.into_iter().for_each(|(pos, id)| {
                updates.insert(pos, id);
            });
        };

        let mut stack = vec![];

        for symbol in symbols.chars() {
            // Grow the tree from base.
            if symbol == 'F' {
                let step = length * (1.0 + rng.signed() * variance.length_jitter);
                let delta_pos = Trees::angle_dist_cast(y_angle, rot_angle, step.ceil() as i32);
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
                rot_angle += branch_drot_angle + rng.signed() * variance.drot_jitter;
            } else if symbol == '-' {
                rot_angle -= branch_drot_angle + rng.signed() * variance.drot_jitter;
            } else if symbol == '#' {
                y_angle += branch_dy_angle + rng.signed() * variance.dy_jitter;
            } else if symbol == '$' {
                y_angle -= branch_dy_angle + rng.signed() * variance.dy_jitter;
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

    /// Per-individual variation ranges.
    pub variance: TreeVariance,

    /// The L-system, with builder rules merged in.
    pub system: LSystem,

    /// The L-system output baked at build time. Empty for stochastic
    /// systems, which expand per individual instead.
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
    variance: TreeVariance,
    rules: HashMap<char, String>,
    stochastic_rules: HashMap<char, Vec<(String, f64)>>,
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

            variance: TreeVariance::default(),
            rules: HashMap::new(),
            stochastic_rules: HashMap::new(),
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

    /// Per-tree whole-plant scale range.
    pub fn size_range(mut self, min: f64, max: f64) -> TreeBuilder {
        self.variance.size_range = (min, max);
        self
    }

    /// Per-tree starting leaf-cluster scale range.
    pub fn leaf_scale_range(mut self, min: f64, max: f64) -> TreeBuilder {
        self.variance.leaf_scale_range = (min, max);
        self
    }

    /// Per-tree trunk tilt range from vertical, radians.
    pub fn lean_range(mut self, min: f64, max: f64) -> TreeBuilder {
        self.variance.lean_range = (min, max);
        self
    }

    /// Per-tree heading rotation span, radians. TAU for any direction.
    pub fn spin(mut self, spin: f64) -> TreeBuilder {
        self.variance.spin = spin;
        self
    }

    /// Per-turn +/- jitter on `+`/`-` rotations, radians.
    pub fn drot_jitter(mut self, drot_jitter: f64) -> TreeBuilder {
        self.variance.drot_jitter = drot_jitter;
        self
    }

    /// Per-turn +/- jitter on `#`/`$` pitches, radians.
    pub fn dy_jitter(mut self, dy_jitter: f64) -> TreeBuilder {
        self.variance.dy_jitter = dy_jitter;
        self
    }

    /// Per-segment +/- fractional jitter on `F` lengths.
    pub fn length_jitter(mut self, length_jitter: f64) -> TreeBuilder {
        self.variance.length_jitter = length_jitter;
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

    /// Weighted production alternatives for one symbol, re-rolled per
    /// individual at generation time.
    pub fn stochastic_rule(mut self, key: char, alternatives: &[(&str, f64)]) -> TreeBuilder {
        self.stochastic_rules.insert(
            key,
            alternatives
                .iter()
                .map(|&(production, weight)| (production.to_owned(), weight))
                .collect(),
        );
        self
    }

    pub fn build(self) -> Tree {
        // Apply rules to the L-system
        let mut system = self.system;
        for (key, value) in &self.rules {
            system.rules.insert(*key, value.clone());
        }
        for (key, alternatives) in &self.stochastic_rules {
            system.stochastic_rules.insert(*key, alternatives.clone());
        }

        let system_result = if system.is_stochastic() {
            String::new()
        } else {
            system.generate()
        };

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
            variance: self.variance,
            system,
            system_result,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::{PI, TAU};

    fn make_plain_oak() -> Tree {
        Tree::new(1, 2)
            .leaf_height(2)
            .leaf_radius(2)
            .branch_initial_radius(1)
            .branch_initial_length(3)
            .system(LSystem::new().axiom("F%").iterations(0).build())
            .build()
    }

    fn sorted(mut updates: Vec<VoxelUpdate>) -> Vec<VoxelUpdate> {
        updates.sort_by_key(|(pos, id)| (pos.0, pos.1, pos.2, *id));
        updates
    }

    /// A species with neutral variance must generate the exact voxels the
    /// pre-variance engine produced, independent of position.
    #[test]
    fn neutral_variance_is_bit_exact() {
        let mut trees = Trees::new(42, &NoiseOptions::new().build());
        trees.register("Oak", make_plain_oak());

        for at in [Vec3(0, 0, 0), Vec3(-171, 83, 964), Vec3(7231, 71, -992)] {
            let updates = trees.generate("Oak", &at);
            // Trunk: one segment of length 3, radius 1 -> a 1-wide column.
            let trunk: Vec<_> = updates.iter().filter(|(_, id)| *id == 2).collect();
            assert_eq!(trunk.len(), 3, "trunk voxels at {at:?}");
            for (pos, _) in &trunk {
                assert_eq!((pos.0, pos.2), (at.0, at.2));
            }
            // Deterministic across replants.
            assert_eq!(
                sorted(trees.generate("Oak", &at)),
                sorted(trees.generate("Oak", &at))
            );
        }
    }

    /// The same species must differ between positions once variance is
    /// configured, and regenerate identically at one position.
    #[test]
    fn variance_diverges_by_position_and_stays_deterministic() {
        let mut trees = Trees::new(42, &NoiseOptions::new().build());
        trees.register(
            "WildOak",
            Tree::new(1, 2)
                .leaf_height(2)
                .leaf_radius(2)
                .branch_initial_radius(1)
                .branch_initial_length(4)
                .size_range(0.75, 1.4)
                .leaf_scale_range(0.8, 1.2)
                .lean_range(0.05, 0.3)
                .spin(TAU)
                .system(LSystem::new().axiom("F%").iterations(0).build())
                .build(),
        );

        let a = sorted(trees.generate("WildOak", &Vec3(10, 80, 10)));
        let b = sorted(trees.generate("WildOak", &Vec3(15, 80, 10)));
        let c = sorted(trees.generate("WildOak", &Vec3(10, 80, 15)));
        assert!(a != b || b != c, "wild oaks should not be clones");
        assert_eq!(a, sorted(trees.generate("WildOak", &Vec3(10, 80, 10))));
    }

    /// Stochastic productions must pick different topologies across
    /// individuals while every alternative stays reachable.
    #[test]
    fn stochastic_rules_vary_topology() {
        let mut trees = Trees::new(7, &NoiseOptions::new().build());
        trees.register(
            "Forked",
            Tree::new(1, 2)
                .leaf_height(1)
                .leaf_radius(1)
                .branch_initial_radius(1)
                .branch_initial_length(2)
                .branch_dy_angle(PI / 4.0)
                .branch_drot_angle(PI / 2.0)
                .system(
                    LSystem::new()
                        .axiom("FT")
                        .stochastic_rule('T', &[("F%", 1.0), ("[+#F%][-#F%]", 1.0), ("FF%", 1.0)])
                        .iterations(1)
                        .build(),
                )
                .build(),
        );

        let mut sizes = std::collections::HashSet::new();
        for i in 0..48 {
            sizes.insert(trees.generate("Forked", &Vec3(i * 13, 64, i * 29)).len());
        }
        assert!(
            sizes.len() >= 2,
            "expected topological variety, got sizes {sizes:?}"
        );
    }

    /// Weighted picks must respect weights: a heavily weighted
    /// alternative should dominate.
    #[test]
    fn stochastic_weights_are_respected() {
        let system = LSystem::new()
            .axiom("T")
            .stochastic_rule('T', &[("A", 99.0), ("B", 1.0)])
            .iterations(1)
            .build();

        let mut a_count = 0;
        for i in 0..200u64 {
            let mut rng = TreeRng::new(TreeRng::scramble(i.wrapping_mul(0x9e3779b97f4a7c15)));
            if system.generate_seeded(&mut rng) == "A" {
                a_count += 1;
            }
        }
        assert!(a_count > 180, "expected A to dominate, got {a_count}/200");
    }

    /// Deterministic rules still apply during seeded generation for
    /// symbols without alternatives.
    #[test]
    fn seeded_generation_mixes_deterministic_rules() {
        let system = LSystem::new()
            .axiom("FX")
            .rule('F', "FF")
            .stochastic_rule('X', &[("F%", 1.0)])
            .iterations(1)
            .build();
        let mut rng = TreeRng::new(1);
        assert_eq!(system.generate_seeded(&mut rng), "FFF%");
    }
}
