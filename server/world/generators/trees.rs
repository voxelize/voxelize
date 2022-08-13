use hashbrown::HashMap;
use nalgebra::{Rotation3, Vector3};

use crate::{BlockChange, NoiseParams, SeededNoise, Vec3};

pub struct Trees {
    threshold: f64,
    noise: SeededNoise,
    trees: HashMap<String, Tree>,
}

impl Trees {
    pub fn new(seed: u32, params: &NoiseParams) -> Trees {
        Trees {
            threshold: 0.5,
            noise: SeededNoise::new(seed, params),
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
        (self.noise.get3d(pos.0, pos.1, pos.2) + 1.0) / 2.0 > self.threshold
    }

    pub fn generate(&self, name: &str, at: &Vec3<i32>) -> Vec<BlockChange> {
        // Panic if the tree doesn't exist
        let &Tree {
            leaf_radius,
            leaf_height,
            iteration,
            leaf_id,
            trunk_id,
        } = self.trees.get(&name.to_lowercase()).unwrap();

        let &Vec3(vx, vy, vz) = at;

        let mut updates = HashMap::new();

        let extend = 50;

        self.place_trunk(trunk_id, at, &Vec3(vx, vy + extend, vz), 7, 2)
            .into_iter()
            .for_each(|(pos, id)| {
                updates.insert(pos, id);
            });

        // self.place_leaves(
        //     leaf_id,
        //     &Vec3(leaf_radius, leaf_height, leaf_radius),
        //     &Vec3(vx + 5, vy + 5, vz + 5),
        // )
        // .into_iter()
        // .for_each(|(pos, id)| {
        //     updates.insert(pos, id);
        // });

        updates.into_iter().collect()
    }

    fn place_trunk(
        &self,
        trunk_id: u32,
        from: &Vec3<i32>,
        to: &Vec3<i32>,
        start_radius: i32,
        end_radius: i32,
    ) -> Vec<BlockChange> {
        let mut changes = vec![];

        let &Vec3(fx, fy, fz) = from;
        let &Vec3(tx, _, tz) = to;

        let height = to.sub(from);

        // Cannot be colinear to the y-axis.
        let rotation = if (tx - fx) == 0 && (tz - fz) == 0 {
            None
        } else {
            // Create a rotation that transforms y-axis to the direction of the vector.
            Some(Rotation3::face_towards(
                &Vector3::z(),
                &Vector3::new(height.0 as f32, height.1 as f32, height.2 as f32),
            ))
        };

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

                        let new_x = vec.x as i32;
                        let new_y = vec.y as i32;
                        let new_z = vec.z as i32;

                        changes.push((Vec3(fx + new_x, fy + new_y, fz + new_z), trunk_id));
                    }
                }
            }
        }

        changes
    }

    fn place_leaves(
        &self,
        leaf_id: u32,
        dimensions: &Vec3<u32>,
        at: &Vec3<i32>,
    ) -> Vec<BlockChange> {
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
}

#[derive(Clone)]
pub struct Tree {
    leaf_radius: u32,
    leaf_height: u32,

    iteration: u32,

    leaf_id: u32,
    trunk_id: u32,
}

impl Tree {
    pub fn new(leaf_id: u32, trunk_id: u32) -> TreeBuilder {
        TreeBuilder::new(leaf_id, trunk_id)
    }
}

pub struct TreeBuilder {
    leaf_radius: u32,
    leaf_height: u32,

    iteration: u32,
    leaf_id: u32,
    trunk_id: u32,
}

impl TreeBuilder {
    pub fn new(leaf_id: u32, trunk_id: u32) -> TreeBuilder {
        TreeBuilder {
            leaf_radius: 1,
            leaf_height: 1,
            iteration: 1,
            leaf_id,
            trunk_id,
        }
    }

    pub fn leaf_radius(mut self, leaf_radius: u32) -> TreeBuilder {
        self.leaf_radius = leaf_radius;
        self
    }

    pub fn leaf_height(mut self, leaf_height: u32) -> TreeBuilder {
        self.leaf_height = leaf_height;
        self
    }

    pub fn iteration(mut self, iteration: u32) -> TreeBuilder {
        self.iteration = iteration;
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

    pub fn build(self) -> Tree {
        Tree {
            leaf_radius: self.leaf_radius,
            leaf_height: self.leaf_height,
            iteration: self.iteration,
            leaf_id: self.leaf_id,
            trunk_id: self.trunk_id,
        }
    }
}
