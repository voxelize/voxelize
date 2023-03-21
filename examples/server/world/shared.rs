use log::info;
use voxelize::{Chunk, ChunkStage, NoiseOptions, Resources, SeededNoise, Space, VoxelAccess};

pub const MOUNTAIN_HEIGHT: f64 = 0.6;
pub const RIVER_HEIGHT: f64 = 0.16;
pub const PLAINS_HEIGHT: f64 = 0.24;
pub const RIVER_TO_PLAINS: f64 = 0.2;

pub const VARIANCE: f64 = 5.0;
pub const SNOW_HEIGHT: f64 = 0.6;
pub const STONE_HEIGHT: f64 = 0.5;

pub struct SoilingStage {
    noise: SeededNoise,
}

impl SoilingStage {
    pub fn new(seed: u32, options: &NoiseOptions) -> Self {
        Self {
            noise: SeededNoise::new(seed, options),
        }
    }
}

impl ChunkStage for SoilingStage {
    fn name(&self) -> String {
        "Water".to_owned()
    }

    fn process(&self, mut chunk: Chunk, resources: Resources, _: Option<Space>) -> Chunk {
        let config = resources.config;
        let registry = resources.registry;

        let water_level = config.water_level as i32;

        let water = registry.get_block_by_name("Water");
        let sand = registry.get_block_by_name("Sand");
        let dirt = registry.get_block_by_name("Dirt");
        let stone = registry.get_block_by_name("Stone");
        let grass_block = registry.get_block_by_name("Grass Block");
        let snow = registry.get_block_by_name("Snow");
        let grass = registry.get_block_by_name("Grass");

        for vx in chunk.min.0..chunk.max.0 {
            for vz in chunk.min.2..chunk.max.2 {
                let height = chunk.get_max_height(vx, vz) as i32;

                let snow_height = (SNOW_HEIGHT * config.max_height as f64) as i32
                    + (self.noise.get2d(vx, vz) * VARIANCE) as i32;
                let stone_height = (STONE_HEIGHT * config.max_height as f64) as i32
                    + (self.noise.get2d(vx, vz) * VARIANCE) as i32;

                for vy in 0..=(height.max(water_level)) {
                    let depth = 2;

                    // Fill in the water
                    let id = chunk.get_voxel(vx, vy, vz);

                    if registry.is_air(id) && vy < water_level {
                        chunk.set_voxel(vx, vy, vz, water.id);
                        continue;
                    }

                    if height > water_level {
                        if vy >= height - depth {
                            if vy > snow_height {
                                chunk.set_voxel(vx, vy, vz, snow.id);
                            } else if vy > stone_height {
                                chunk.set_voxel(vx, vy, vz, stone.id);
                            } else {
                                if vy == height {
                                    chunk.set_voxel(vx, vy, vz, grass_block.id);
                                } else {
                                    chunk.set_voxel(vx, vy, vz, dirt.id);
                                }
                            }
                        }

                        if vy == height {
                            if self.noise.get3d(vx, vy, vz) > 1.0
                                && chunk.get_voxel(vx, vy, vz) == grass_block.id
                            {
                                chunk.set_voxel(vx, vy + 1, vz, grass.id);
                            }
                        }
                    } else if chunk.get_voxel(vx, vy, vz) != water.id
                        && vy <= height
                        && vy >= height - depth
                    {
                        // if self.noise.get3d(vx, vy, vz) > 1.0 {
                        //     chunk.set_voxel(vx, vy, vz, stone.id);
                        // } else {
                        // }
                        chunk.set_voxel(vx, vy, vz, sand.id);
                    }
                }
            }
        }

        chunk
    }
}
