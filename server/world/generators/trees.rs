use hashbrown::HashMap;
use rand::SeedableRng;
use rand_chacha::ChaChaRng;

use crate::{BlockChange, NoiseParams, SeededNoise, Vec3};

#[derive(Clone)]
pub struct Trees {
    noise: SeededNoise,
    rand: ChaChaRng,
    trees: HashMap<String, Tree>,
}

impl Trees {
    pub fn new(seed: u32, params: &NoiseParams) -> Trees {
        Trees {
            noise: SeededNoise::new(seed, params),
            rand: ChaChaRng::seed_from_u64(seed as u64),
            trees: HashMap::new(),
        }
    }

    pub fn register(&mut self, name: &str, tree: Tree) {
        self.trees.insert(name.to_lowercase(), tree);
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

        self.place_leaves(leaf_id, &Vec3(leaf_radius, leaf_height, leaf_radius), at)
            .into_iter()
            .for_each(|(pos, id)| {
                updates.insert(pos, id);
            });

        updates.into_iter().collect()
    }

    fn place_leaves(
        &self,
        leaf_id: u32,
        dimensions: &Vec3<u32>,
        at: &Vec3<i32>,
    ) -> Vec<BlockChange> {
        let mut changes = Vec::new();

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
