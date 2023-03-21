use kdtree::{distance::squared_euclidean, KdTree};
use voxelize::{
    Chunk, ChunkStage, NoiseOptions, Resources, SeededNoise, Space, Vec3, VoxelAccess, WorldConfig,
};

pub struct Biomes<T: PartialEq> {
    pub tree: KdTree<f64, T, Vec<f64>>,
    pub criteria: Vec<SeededNoise>,
    pub config: WorldConfig,
}

impl<T: std::cmp::PartialEq> Biomes<T> {
    pub fn new(config: &WorldConfig) -> Self {
        Self {
            tree: KdTree::new(2),
            criteria: Vec::new(),
            config: config.clone(),
        }
    }

    pub fn query(&self, vx: i32, vz: i32) -> &T {
        let values = self
            .criteria
            .iter()
            .map(|c| c.get2d(vx, vz))
            .collect::<Vec<f64>>();

        let result = self.tree.nearest(&values, 1, &squared_euclidean).unwrap()[0];

        result.1
    }

    pub fn add_criterion(mut self, name: &str, options: &NoiseOptions) -> Self {
        self.criteria
            .push(SeededNoise::new(self.config.seed, options));
        self.tree = KdTree::new(self.criteria.len());
        self
    }

    pub fn add_biome(mut self, point: &[f64], biome: T) -> Self {
        self.tree.add(point.to_vec(), biome).unwrap();
        self
    }
}

#[derive(PartialEq)]
pub struct Biome {
    pub name: String,
    pub block: String,
}

impl Biome {
    pub fn new(name: &str, block: &str) -> Self {
        Self {
            name: name.to_string(),
            block: block.to_string(),
        }
    }
}

pub struct BiomeStage {
    pub biomes: Biomes<Biome>,
}

impl ChunkStage for BiomeStage {
    fn name(&self) -> String {
        "biome".to_string()
    }

    fn process(&self, mut chunk: Chunk, resources: Resources, space: Option<Space>) -> Chunk {
        let Vec3(min_x, _, min_z) = chunk.min;
        let Vec3(max_x, _, max_z) = chunk.max;

        let registry = resources.registry;
        let config = resources.config;

        for vx in min_x..max_x {
            for vz in min_z..max_z {
                let biome = self.biomes.query(vx, vz);
                let block = registry.get_block_by_name(&biome.block);
                let block_id = block.id;

                for vy in 0..10 {
                    chunk.set_voxel(vx, vy, vz, block_id);
                }
            }
        }

        chunk
    }
}

// let biomes: Biomes<Biome> = Biomes::new(&config)
//     .add_criterion("c0", &NoiseOptions::new().frequency(0.008).build())
//     .add_criterion("c1", &NoiseOptions::new().frequency(0.003).build())
//     .add_criterion("c2", &NoiseOptions::new().frequency(0.012).build())
//     .add_biome(&[-1.0, -1.0, -1.0], Biome::new("ocean", "Biome Test 0"))
//     .add_biome(&[1.0, 1.0, 1.0], Biome::new("plains", "Biome Test 1"))
//     .add_biome(&[0.0, 0.0, 0.0], Biome::new("river", "Biome Test 2"))
//     .add_biome(&[0.5, 0.5, 1.0], Biome::new("mountain", "Biome Test 3"));

// pipeline.add_stage(BiomeStage { biomes });
