pub mod biomes;

use noise::{Curve, Fbm, HybridMulti, MultiFractal, NoiseFn, Perlin, ScaleBias};
use serde::{Deserialize, Serialize};
use std::f64;
use voxelize::{
    Biome, Chunk, ChunkStage, KdTree, LSystem, NoiseOptions, Resources, SeededNoise, Space,
    Terrain, TerrainLayer, Tree, Trees, Vec3, VoxelAccess, World, WorldConfig,
};

use super::shared::{
    setup_client, setup_components, setup_dispatcher, setup_entities, setup_methods, SoilingStage,
};

pub const MOUNTAIN_HEIGHT: f64 = 1.1;
pub const RIVER_HEIGHT: f64 = 0.25;
pub const PLAINS_HEIGHT: f64 = 0.347;
pub const RIVER_WIDTH: f64 = 0.36;

pub const VARIANCE: f64 = 5.0;
pub const SNOW_HEIGHT: f64 = 0.6;
pub const STONE_HEIGHT: f64 = 0.5;

struct TreeStage {
    // trees + tree type
    all_trees: Vec<(Trees, String)>,
}

impl TreeStage {
    pub fn new() -> Self {
        Self { all_trees: vec![] }
    }

    pub fn with(mut self, trees: Trees, tree_type: &str) -> Self {
        self.all_trees.push((trees, tree_type.to_string()));
        self
    }
}

impl ChunkStage for TreeStage {
    fn name(&self) -> String {
        "Trees".to_owned()
    }

    fn process(&self, mut chunk: Chunk, resources: Resources, _: Option<Space>) -> Chunk {
        let dirt = resources.registry.get_block_by_name("Dirt");
        let grass_block = resources.registry.get_block_by_name("Grass Block");

        for vx in chunk.min.0..chunk.max.0 {
            for vz in chunk.min.2..chunk.max.2 {
                let height = chunk.get_max_height(vx, vz) as i32;
                let id = chunk.get_voxel(vx, height, vz);

                if id != dirt.id && id != grass_block.id {
                    continue;
                }

                for (trees, tree_type) in self.all_trees.iter() {
                    if trees.should_plant(&Vec3(vx, height, vz)) {
                        trees
                            .generate(&tree_type, &Vec3(vx, height, vz))
                            .into_iter()
                            .for_each(|(Vec3(ux, uy, uz), id)| {
                                chunk.set_voxel(ux, uy, uz, id);
                            });
                    }
                }
            }
        }

        chunk
    }
}

pub struct BaseTerrainStage {
    threshold: f64,
    base: u32,
    terrain: Terrain,
}

impl BaseTerrainStage {
    pub fn new(terrain: Terrain) -> Self {
        Self {
            threshold: 0.0,
            base: 0,
            terrain,
        }
    }

    pub fn set_base(&mut self, base: u32) {
        self.base = base;
    }

    pub fn set_threshold(&mut self, threshold: f64) {
        self.threshold = threshold;
    }
}

impl ChunkStage for BaseTerrainStage {
    fn name(&self) -> String {
        "Base Terrain".to_owned()
    }

    fn process(&self, mut chunk: Chunk, resources: Resources, _: Option<Space>) -> Chunk {
        let Vec3(min_x, min_y, min_z) = chunk.min;
        let Vec3(max_x, max_y, max_z) = chunk.max;

        let registry = resources.registry;

        for vx in min_x..max_x {
            for vz in min_z..max_z {
                for vy in min_y..max_y {
                    let (bias, offset) = self.terrain.get_bias_offset(vx, vy, vz);
                    let density = self.terrain.get_density_from_bias_offset(bias, offset, vy);
                    let biome = self.terrain.get_biome_at(vx, vy, vz);
                    let block = registry.get_block_by_name(&biome.test_block);

                    if density > self.threshold {
                        chunk.set_voxel(vx, vy, vz, block.id);
                    }
                }
            }
        }

        chunk
    }
}

#[derive(Serialize, Deserialize, Debug)]
struct TimeMethodPayload {
    time: f32,
}

pub fn setup_terrain_world() -> World {
    let config = WorldConfig::new()
        .terrain(
            &NoiseOptions::new()
                .frequency(0.005)
                .octaves(8)
                .persistence(0.5)
                .lacunarity(1.8623123)
                .build(),
        )
        .preload(true)
        .preload_radius(2)
        .default_time(1200.0)
        .time_per_day(2400)
        .seed(999)
        .build();

    let mut world = World::new("terrain", &config);

    let mut terrain = Terrain::new(&config);

    // let fb0: Fbm<Perlin> = Fbm::new(config.seed)
    //     .set_frequency(0.007)
    //     .set_lacunarity(2.22)
    //     .set_octaves(10)
    //     .set_persistence(0.5);

    // let bias: Curve<f64, Fbm<Perlin>, 2> = Curve::new(fb0.clone())
    //     .add_control_point(-1.0, MOUNTAIN_HEIGHT)
    //     .add_control_point(-RIVER_WIDTH, RIVER_HEIGHT)
    //     .add_control_point(RIVER_WIDTH, RIVER_HEIGHT)
    //     .add_control_point(1.0, PLAINS_HEIGHT);

    // let offset: Curve<f64, Fbm<Perlin>, 2> = Curve::new(fb0.clone())
    //     .add_control_point(-1.0, 3.5)
    //     .add_control_point(-RIVER_WIDTH, 5.0)
    //     .add_control_point(RIVER_WIDTH, 5.0)
    //     .add_control_point(1.0, 6.5);

    // let terrain: HybridMulti<Perlin> = HybridMulti::new(config.seed)
    //     .set_frequency(config.terrain.frequency)
    //     .set_lacunarity(config.terrain.lacunarity)
    //     .set_octaves(config.terrain.octaves)
    //     .set_persistence(config.terrain.persistence);

    // let offset_height = ScaleBias::new(offset).set

    // The base shape of the terrain:
    // The more extreme (far from 0) the value, the more mountainous the terrain will be.
    // The closer to 0, the more plains-like the terrain will be.
    let continentalness = TerrainLayer::new(
        "continentalness",
        &NoiseOptions::new()
            .frequency(0.0005)
            .octaves(7)
            .persistence(0.52)
            .lacunarity(2.3)
            .seed(9999)
            .build(),
    )
    .add_bias_points(&[[-1.0, 3.5], [0.0, 3.0], [0.4, 5.0], [1.0, 8.5]])
    .add_offset_points(&[
        [-2.9, MOUNTAIN_HEIGHT],
        [-0.7, PLAINS_HEIGHT + 0.01],
        [0.0, PLAINS_HEIGHT],
        [RIVER_WIDTH / 2.0, PLAINS_HEIGHT],
        // [0.0, PLAINS_HEIGHT],
        [1.1, RIVER_HEIGHT],
        [2.8, 0.0],
        [4.6, MOUNTAIN_HEIGHT], // [5.7, MOUNTAIN_HEIGHT],
    ]);

    // // The peaks and valleys of the terrain:
    // // The higher the value, the more mountainous the terrain will be.
    // // The lower the value, the more plains-like the terrain will be.
    let peaks_and_valleys = TerrainLayer::new(
        "peaks_and_valleys",
        &NoiseOptions::new()
            .frequency(0.002)
            .octaves(7)
            .persistence(0.53)
            .lacunarity(2.0)
            .seed(4544)
            .build(),
    )
    .add_bias_points(&[[-1.0, 3.5], [1.0, 3.5]])
    .add_offset_points(&[
        [-3.0, RIVER_HEIGHT],
        [-2.0, PLAINS_HEIGHT],
        [-0.4, PLAINS_HEIGHT * 0.9],
        [0.0, RIVER_HEIGHT],
        [RIVER_WIDTH / 2.0, RIVER_HEIGHT * 1.05],
        [2.0, PLAINS_HEIGHT + RIVER_HEIGHT],
        [5.0, MOUNTAIN_HEIGHT * 2.0],
    ]);

    let erosion = TerrainLayer::new(
        "erosion",
        &NoiseOptions::new()
            .dimension(3)
            .frequency(0.01)
            .octaves(7)
            .persistence(0.5)
            .lacunarity(1.9)
            .seed(904)
            .build(),
    )
    .add_bias_points(&[[-1.0, 8.5], [1.0, 8.5]])
    .add_offset_points(&[[-1.0, MOUNTAIN_HEIGHT], [1.0, RIVER_HEIGHT / 2.0]]);

    terrain.add_layer(&continentalness, 1.0);
    terrain.add_layer(&peaks_and_valleys, 0.6);
    terrain.add_noise_layer(&erosion, 0.045);

    // ●	Continentalness (weight: 1.7)
    //  ●	1.0: Low terrain, most likely water
    //  ●	0.0: Shores between plains and water
    //  ●	-1.0: Land, from plains to high mountains
    // ●	Peaks and Valleys (weight: 1.0)
    //  ●	1.0: Mountains, quite drastic
    //  ●	0.0: Water, shore, rivers
    //  ●	-1.0: Plains, flatland
    // ●	Erosion (weight: 0.3)
    //  ●	1.0: Low, shores or sea.
    //  ●	0.0: Land, mountainous
    //  ●	-1.0: Mountain peaks

    let cap = 0.2;

    terrain.add_biome(&[0.0, 0.0, 0.0], Biome::new("Biome 0", "Biome Test 0"));

    terrain.add_biome(&[0.0, 0.0, cap], Biome::new("Biome 1", "Biome Test 1"));
    terrain.add_biome(&[0.0, cap, 0.0], Biome::new("Biome 2", "Biome Test 2"));
    terrain.add_biome(&[0.0, cap, cap], Biome::new("Biome 3", "Biome Test 3"));
    terrain.add_biome(&[cap, 0.0, 0.0], Biome::new("Biome 4", "Biome Test 4"));
    terrain.add_biome(&[cap, 0.0, cap], Biome::new("Biome 5", "Biome Test 5"));
    terrain.add_biome(&[cap, cap, 0.0], Biome::new("Biome 6", "Biome Test 6"));
    terrain.add_biome(&[cap, cap, cap], Biome::new("Biome 7", "Biome Test 7"));

    terrain.add_biome(&[0.0, 0.0, -cap], Biome::new("Biome 8", "Biome Test 8"));
    terrain.add_biome(&[0.0, -cap, 0.0], Biome::new("Biome 9", "Biome Test 9"));
    terrain.add_biome(&[0.0, -cap, -cap], Biome::new("Biome 10", "Biome Test 10"));
    terrain.add_biome(&[-cap, 0.0, 0.0], Biome::new("Biome 11", "Biome Test 11"));
    terrain.add_biome(&[-cap, 0.0, -cap], Biome::new("Biome 12", "Biome Test 12"));
    terrain.add_biome(&[-cap, -cap, 0.0], Biome::new("Biome 13", "Biome Test 13"));
    terrain.add_biome(&[-cap, -cap, -cap], Biome::new("Biome 14", "Biome Test 14"));

    terrain.add_biome(&[cap, cap, -cap], Biome::new("Biome 15", "Biome Test 15"));
    terrain.add_biome(&[cap, -cap, cap], Biome::new("Biome 16", "Biome Test 16"));
    terrain.add_biome(&[cap, -cap, -cap], Biome::new("Biome 17", "Biome Test 17"));
    terrain.add_biome(&[-cap, cap, cap], Biome::new("Biome 18", "Biome Test 18"));
    terrain.add_biome(&[-cap, cap, -cap], Biome::new("Biome 19", "Biome Test 19"));
    terrain.add_biome(&[-cap, -cap, cap], Biome::new("Biome 20", "Biome Test 20"));

    {
        let mut pipeline = world.pipeline_mut();

        let mut terrain_stage = BaseTerrainStage::new(terrain);
        terrain_stage.set_base(2);
        terrain_stage.set_threshold(0.0);

        pipeline.add_stage(terrain_stage);

        pipeline.add_stage(SoilingStage::new(
            config.seed,
            &NoiseOptions::new().frequency(0.04).lacunarity(1.6).build(),
        ));

        let mut tiny_trees = Trees::new(
            config.seed,
            &NoiseOptions::new()
                .frequency(0.4)
                .lacunarity(2.9)
                .seed(123123)
                .build(),
        );
        tiny_trees.set_threshold(3.5);

        let palm = Tree::new(44, 43)
            .leaf_height(2)
            .leaf_radius(1)
            .branch_initial_radius(1)
            .branch_initial_length(6)
            .branch_dy_angle(f64::consts::PI / 4.0)
            .branch_drot_angle(f64::consts::PI / 4.0)
            .system(LSystem::new().axiom("F%[F%]").iterations(1).build())
            .build();

        tiny_trees.register("Tiny", palm);

        let mut oak_trees = Trees::new(
            config.seed,
            &NoiseOptions::new()
                .frequency(0.36)
                .lacunarity(2.9)
                .seed(532874)
                .build(),
        );
        oak_trees.set_threshold(4.5);
        let oak = Tree::new(44, 43)
            .leaf_height(3)
            .leaf_radius(3)
            .branch_initial_radius(3)
            .branch_initial_length(7)
            .branch_radius_factor(0.8)
            .branch_length_factor(0.5)
            .branch_dy_angle(f64::consts::PI / 4.0)
            .branch_drot_angle(f64::consts::PI * 2.0 / 7.0)
            .system(
                LSystem::new()
                    .axiom("A")
                    .rule('A', "FF[[#B]++[#B]++[#B]++[#B]]+%!A")
                    .rule('B', "%F#@%B")
                    .iterations(4)
                    .build(),
            )
            .build();

        oak_trees.register("Oak", oak);

        let mut boulder_trees = Trees::new(
            config.seed,
            &NoiseOptions::new()
                .frequency(0.15)
                .lacunarity(2.9)
                .seed(4716384)
                .build(),
        );
        boulder_trees.set_threshold(4.5);
        let boulder = Tree::new(2, 0)
            .leaf_height(3)
            .leaf_radius(3)
            .branch_initial_radius(2)
            .branch_initial_length(7)
            .branch_radius_factor(0.8)
            .branch_length_factor(0.5)
            .branch_dy_angle(f64::consts::PI / 4.0)
            .branch_drot_angle(f64::consts::PI * 2.0 / 7.0)
            .system(LSystem::new().axiom("%").iterations(0).build())
            .build();

        boulder_trees.register("Boulder", boulder);

        let mut mystical_trees = Trees::new(
            config.seed,
            &NoiseOptions::new()
                .frequency(0.25)
                .lacunarity(3.0)
                .seed(8675309)
                .build(),
        );
        mystical_trees.set_threshold(5.0);
        let mystical = Tree::new(44, 43)
            .leaf_height(3)
            .leaf_radius(3)
            .branch_initial_radius(3)
            .branch_initial_length(9)
            .branch_radius_factor(0.85)
            .branch_length_factor(0.6)
            .branch_dy_angle(f64::consts::PI / 6.0)
            .branch_drot_angle(f64::consts::PI / 4.0)
            .system(
                LSystem::new()
                    .axiom("F")
                    .rule('F', "FF")
                    .iterations(4)
                    .build(),
            )
            .build();

        mystical_trees.register("Mystical", mystical);

        // let mut ancient_trees = Trees::new(
        //     config.seed,
        //     &NoiseOptions::new()
        //         .frequency(0.12)
        //         .lacunarity(2.8)
        //         .seed(424242)
        //         .build(),
        // );
        // ancient_trees.set_threshold(4.7);
        // let ancient = Tree::new(44, 43)
        //     .leaf_height(4)
        //     .leaf_radius(4)
        //     .branch_initial_radius(4)
        //     .branch_initial_length(11)
        //     .branch_radius_factor(0.9)
        //     .branch_length_factor(0.7)
        //     .branch_dy_angle(f64::consts::PI / 5.0)
        //     .branch_drot_angle(f64::consts::PI / 4.0)
        //     .system(
        //         LSystem::new()
        //             .axiom("F")
        //             .rule('F', "FF-[-F+F+F]+[+F-F-F]")
        //             .iterations(4)
        //             .build(),
        //     )
        //     .build();

        // ancient_trees.register("Ancient", ancient);

        let tree_stage = TreeStage::new()
            .with(oak_trees, "Oak")
            .with(tiny_trees, "Tiny")
            .with(boulder_trees, "Boulder")
            .with(mystical_trees, "Mystical");
        // .with(ancient_trees, "Ancient");

        pipeline.add_stage(tree_stage);
    }

    world.ecs_mut().insert(KdTree::new());

    setup_components(&mut world);
    setup_entities(&mut world);
    setup_dispatcher(&mut world);
    setup_methods(&mut world);
    setup_client(&mut world);

    world.set_method_handle("time", |world, _, payload| {
        let time_per_day = world.config().time_per_day as f32;
        let new_time: TimeMethodPayload = serde_json::from_str(&payload).unwrap();
        world.stats_mut().set_time(new_time.time % time_per_day);
    });

    world
}
