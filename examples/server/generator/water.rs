use voxelize::{
    chunk::Chunk,
    pipeline::{ChunkStage, ResourceRequirements, ResourceResults},
    world::{
        generators::noise::NoiseParams,
        voxels::{access::VoxelAccess, space::Space},
    },
};

pub struct WaterStage;

impl ChunkStage for WaterStage {
    fn name(&self) -> String {
        "Water".to_owned()
    }

    fn needs_resources(&self) -> ResourceRequirements {
        ResourceRequirements {
            needs_noise: true,
            needs_config: true,
            needs_registry: true,
            needs_terrain: false,
        }
    }

    fn process(&self, mut chunk: Chunk, resources: ResourceResults, _: Option<Space>) -> Chunk {
        let config = resources.config.unwrap();
        let registry = resources.registry.unwrap();
        let noise = resources.noise.unwrap();

        let water_level = config.water_level as i32;
        let max_height = config.max_height as i32;

        let water = registry.get_block_by_name("Water");
        let sand = registry.get_block_by_name("Sand");
        let dirt = registry.get_block_by_name("Dirt");
        let stone = registry.get_block_by_name("Stone");
        let grass = registry.get_block_by_name("Grass");
        let snow = registry.get_block_by_name("Snow");

        for vx in chunk.min.0..chunk.max.0 {
            for vz in chunk.min.2..chunk.max.2 {
                let height = chunk.get_max_height(vx, vz) as i32;
                let mut was_air = false;

                for vy in 0..max_height {
                    let id = chunk.get_voxel(vx, vy, vz);
                    let is_air = registry.is_air(id);

                    if is_air && vy < water_level {
                        chunk.set_voxel(vx, vy, vz, water.id);
                        continue;
                    }

                    if height < water_level {
                        chunk.set_voxel(vx, height, vz, sand.id);
                        continue;
                    }

                    let relative_height = if is_air && !was_air && vy < height {
                        vy
                    } else {
                        height
                    };

                    let snow_height = 100;
                    let stone_height = 94;

                    if vy == relative_height {
                        if vy >= snow_height
                            && noise.simplex.get2d(
                                vx,
                                vz,
                                &NoiseParams::new().frequency(0.02).octaves(6).build(),
                            ) + (vy as f64 - snow_height as f64) / snow_height as f64
                                > 0.0
                        {
                            chunk.set_voxel(vx, vy, vz, snow.id);
                        } else if vy >= stone_height
                            && noise.simplex.get2d(
                                vx,
                                vz,
                                &NoiseParams::new().frequency(0.02).octaves(6).build(),
                            ) + (vy as f64 - stone_height as f64) / stone_height as f64
                                > 0.0
                        {
                            chunk.set_voxel(vx, vy, vz, stone.id);
                        } else {
                            chunk.set_voxel(vx, vy, vz, grass.id);
                        }
                    } else if vy >= height - 2 && vy < relative_height {
                        chunk.set_voxel(vx, vy, vz, dirt.id);
                    }

                    was_air = is_air;
                }
            }
        }

        chunk
    }
}
