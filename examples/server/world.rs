use log::info;
use nanoid::nanoid;
use serde::{Deserialize, Serialize};
use specs::{Builder, Component, NullStorage, WorldExt};
use std::f64;
use voxelize::{
    default_client_parser, BaseTerrainStage, Chunk, ChunkStage, CurrentChunkComp, ETypeComp,
    EntityFlag, IDComp, InteractorComp, LSystem, MetadataComp, NoiseParams, PositionComp,
    Resources, RigidBody, RigidBodyComp, SeededNoise, Space, Terrain, TerrainLayer, Tree, Trees,
    Vec3, VoxelAccess, World, WorldConfig, AABB,
};

const MOUNTAIN_HEIGHT: f64 = 0.6;
const RIVER_HEIGHT: f64 = 0.2;
const PLAINS_HEIGHT: f64 = 0.24;
const RIVER_TO_PLAINS: f64 = 0.06;

const VARIANCE: f64 = 3.0;
const SNOW_HEIGHT: i32 = 90;
const STONE_HEIGHT: i32 = 80;

struct SoilingStage {
    noise: SeededNoise,
}

impl SoilingStage {
    pub fn new(seed: u32, params: &NoiseParams) -> Self {
        Self {
            noise: SeededNoise::new(seed, params),
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

                let snow_height = SNOW_HEIGHT + (self.noise.get2d(vx, vz) * VARIANCE) as i32;
                let stone_height = STONE_HEIGHT + (self.noise.get2d(vx, vz) * VARIANCE) as i32;

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
                        if self.noise.get3d(vx, vy, vz) > 1.0 {
                            chunk.set_voxel(vx, vy, vz, stone.id);
                        } else {
                            chunk.set_voxel(vx, vy, vz, sand.id);
                        }
                    }
                }
            }
        }

        chunk
    }
}

struct TreeStage {
    trees: Trees,
}

impl TreeStage {
    pub fn new(trees: Trees) -> Self {
        Self { trees }
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

                if self.trees.should_plant(&Vec3(vx, height, vz)) {
                    self.trees
                        .generate("Palm", &Vec3(vx, height, vz))
                        .into_iter()
                        .for_each(|(Vec3(ux, uy, uz), id)| {
                            chunk.set_voxel(ux, uy, uz, id);
                        });
                }
            }
        }

        chunk
    }
}

#[derive(Default, Component)]
#[storage(NullStorage)]
struct BoxFlag;

#[derive(Serialize, Deserialize, Debug)]
struct TestMethodPayload {
    test: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct SpawnMethodPayload {
    position: Vec3<f32>,
}

pub fn setup_world() -> World {
    let config = WorldConfig::new()
        .terrain(
            &NoiseParams::new()
                .frequency(0.005)
                .octaves(8)
                .persistence(0.5)
                .lacunarity(1.8623123)
                .build(),
        )
        // .preload(true)
        .seed(12312)
        // .min_chunk([0, 0])
        // .max_chunk([0, 0])
        // .saving(true)
        // .save_dir("data")
        .build();

    let mut world = World::new("world1", &config);

    world.set_client_parser(|metadata, ent, world| {
        default_client_parser(metadata, ent, world);
    });

    let mut terrain = Terrain::new(&config);

    let continentalness = TerrainLayer::new(
        "continentalness",
        &NoiseParams::new()
            .frequency(0.0035)
            .octaves(7)
            .persistence(0.5)
            .lacunarity(1.8)
            .build(),
    )
    .add_bias_points(&[[-1.0, 3.0], [0.0, 2.0], [1.0, 3.0]])
    .add_offset_points(&[
        [-1.0, MOUNTAIN_HEIGHT + RIVER_HEIGHT],
        [-RIVER_TO_PLAINS, PLAINS_HEIGHT],
        [0.0, RIVER_HEIGHT],
        [RIVER_TO_PLAINS, PLAINS_HEIGHT],
        [1.0, PLAINS_HEIGHT],
    ]);

    terrain.add_layer(&continentalness, 0.8);

    {
        let mut pipeline = world.pipeline_mut();

        let mut terrain_stage = BaseTerrainStage::new(terrain);
        terrain_stage.set_base(2);
        terrain_stage.set_threshold(0.0);

        let oak = Tree::new(44, 43)
            .leaf_height(3)
            .leaf_radius(3)
            .branch_initial_radius(2)
            .branch_initial_length(7)
            .branch_radius_factor(0.8)
            .branch_length_factor(0.5)
            .branch_dy_angle(f64::consts::PI / 4.0)
            .branch_drot_angle(f64::consts::PI * 2.0 / 7.0)
            .system(
                LSystem::new()
                    .axiom("A")
                    .rule('A', "F[[#B]++[#B]++[#B]++[#B]]+%!A")
                    .rule('B', "%F#@%B")
                    .iterations(4)
                    .build(),
            )
            .build();

        let palm = Tree::new(44, 43)
            .leaf_height(2)
            .leaf_radius(1)
            .branch_initial_radius(1)
            .branch_initial_length(6)
            .branch_dy_angle(f64::consts::PI / 4.0)
            .branch_drot_angle(f64::consts::PI / 4.0)
            .build();

        let mut trees = Trees::new(
            config.seed,
            &NoiseParams::new().frequency(0.4).lacunarity(2.9).build(),
        );
        trees.set_threshold(1.5);

        trees.register("Oak", oak);
        trees.register("Palm", palm);

        pipeline.add_stage(terrain_stage);
        pipeline.add_stage(SoilingStage::new(
            config.seed,
            &NoiseParams::new().frequency(0.04).lacunarity(3.0).build(),
        ));
        pipeline.add_stage(TreeStage::new(trees));

        // pipeline.add_stage(FlatlandStage::new(10, 2, 2, 2));
    }

    world.ecs_mut().register::<BoxFlag>();

    // world
    //     .ecs_mut()
    //     .create_entity()
    //     .with(EntityFlag::default())
    //     .with(ETypeComp::new("Box"))
    //     .with(IDComp::new(&nanoid!()))
    //     .with(PositionComp::new(3.0, 90.0, 3.0))
    //     .with(MetadataComp::new())
    //     .with(RigidBodyComp::new(&test_body))
    //     .with(CurrentChunkComp::default())
    //     .with(BoxFlag)
    //     .build();

    world.set_entity_loader("box", |world, metadata| {
        info!("loading box entity: {:?}", metadata);

        let position = metadata.get::<PositionComp>("position").unwrap_or_default();

        let body =
            RigidBody::new(&AABB::new().scale_x(0.5).scale_y(0.5).scale_z(0.5).build()).build();
        let interactor = world.physics_mut().register(&body);

        world
            .create_entity(&nanoid!(), "box")
            .with(BoxFlag)
            .with(PositionComp::default())
            .with(RigidBodyComp::new(&body))
            .with(InteractorComp::new(&interactor))
            .with(position)
    });

    world.set_method_handle("spawn", |world, _, payload| {
        let data: SpawnMethodPayload = serde_json::from_str(&payload).unwrap();
        world.spawn_entity_at("box", &data.position);
        info!("spawn method called with payload: {:?}", data);
    });

    world.set_method_handle("test", |world, client_id, payload| {
        let data: TestMethodPayload = serde_json::from_str(&payload).unwrap();

        info!("test method called with payload: {:?}", data);
    });

    world.set_event_handle("test1", |_, _, payload| {
        info!("test1 event called with payload: {:?}", payload);
    });

    world
}
