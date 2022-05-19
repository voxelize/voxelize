use std::process;

use log::info;
use nanoid::nanoid;
use noise::{NoiseFn, SuperSimplex, Worley};
use specs::{
    Builder, Component, DispatcherBuilder, NullStorage, ReadExpect, ReadStorage, System, WorldExt,
    WriteStorage,
};
use voxelize::{
    chunk::Chunk,
    pipeline::{ChunkStage, FlatlandStage, HeightMapStage, ResourceRequirements, ResourceResults},
    vec::Vec3,
    world::{
        components::{
            current_chunk::CurrentChunkComp, etype::ETypeComp, flags::EntityFlag,
            heading::HeadingComp, id::IDComp, metadata::MetadataComp, position::PositionComp,
            rigidbody::RigidBodyComp, target::TargetComp,
        },
        generators::noise::{NoiseQuery, SeededNoise, SeededSimplex},
        physics::{aabb::AABB, rigidbody::RigidBody},
        registry::Registry,
        stats::Stats,
        voxels::{
            access::VoxelAccess,
            block::{Block, BlockFaces},
            space::Space,
        },
        World, WorldConfig,
    },
    Server, Voxelize,
};

fn handle_ctrlc() {
    ctrlc::set_handler(move || {
        print!("\nStopping application...\n");
        process::exit(0);
    })
    .expect("Error setting Ctrl-C handler");
}

struct TestStage;

impl ChunkStage for TestStage {
    fn name(&self) -> String {
        "Test".to_owned()
    }

    fn needs_resources(&self) -> ResourceRequirements {
        ResourceRequirements {
            needs_registry: true,
            needs_config: true,
            needs_noise: true,
        }
    }

    fn process(&self, mut chunk: Chunk, resources: ResourceResults, _: Option<Space>) -> Chunk {
        let Vec3(min_x, _, min_z) = chunk.min;
        let Vec3(max_x, _, max_z) = chunk.max;

        let config = resources.config.unwrap();
        let registry = resources.registry.unwrap();
        let noise = resources.noise.unwrap();

        let max_height = config.max_height as i32;

        let map = registry.get_type_map(&["Stone", "Lol"]);

        let mut query = NoiseQuery::new()
            .scale(0.01)
            .octaves(10)
            .persistance(0.9)
            .lacunarity(1.2)
            .amplifier(3.0)
            .height_bias(3.0)
            .height_offset(50.0)
            .build();

        for vx in min_x..max_x {
            for vz in min_z..max_z {
                for vy in 0..max_height {
                    query.voxel(vx, vy, vz);

                    let density = noise.simplex.get(&query);

                    if density > 0.0 {
                        chunk.set_voxel(vx, vy, vz, *map.get("Stone").unwrap());
                    }
                }
            }
        }

        chunk
    }
}

struct TreeTestStage {
    noise: Worley,
}

impl ChunkStage for TreeTestStage {
    fn name(&self) -> String {
        "TreeTest".to_owned()
    }

    fn process(&self, mut chunk: Chunk, resource: ResourceResults, _: Option<Space>) -> Chunk {
        let Vec3(min_x, _, min_z) = chunk.min;
        let Vec3(max_x, _, max_z) = chunk.max;

        let registry = resource.registry.unwrap();

        let wood = registry.get_block_by_name("Wood");
        let leaves = registry.get_block_by_name("Leaves");
        let dirt = registry.get_block_by_name("Dirt");
        let grass = registry.get_block_by_name("Grass");

        let scale = 1.0;

        for vx in min_x..max_x {
            for vz in min_z..max_z {
                let height = chunk.get_max_height(vx, vz) as i32;

                chunk.set_voxel(vx, height, vz, grass.id);

                for k in -2..0 {
                    chunk.set_voxel(vx, height + k, vz, dirt.id);
                }

                if self.noise.get([vx as f64 * scale, vz as f64 * scale]) > 0.9
                    && self.noise.get([vz as f64 * scale, vx as f64 * scale]) > 0.95
                {
                    for i in 0..5 {
                        chunk.set_voxel(vx, height + i, vz, wood.id);
                    }

                    let r = 2;

                    for i in -r..=r {
                        for j in -r..=r {
                            chunk.set_voxel(vx + i, height + 4, vz + j, leaves.id);
                        }
                    }
                }
            }
        }

        chunk
    }
}

const BOX_SPEED: f32 = 0.001;

#[derive(Default, Component)]
#[storage(NullStorage)]
struct BoxFlag;

struct UpdateBoxSystem;

impl<'a> System<'a> for UpdateBoxSystem {
    type SystemData = (
        ReadExpect<'a, Stats>,
        ReadStorage<'a, BoxFlag>,
        WriteStorage<'a, RigidBodyComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use specs::Join;

        let (stats, flag, mut bodies) = data;

        for (body, _) in (&mut bodies, &flag).join() {
            // if stats.tick % 500 == 0 {
            //     body.0.apply_impulse(0.0, 10.0, 2.0);
            // }
        }
    }
}

fn get_dispatcher(
    builder: DispatcherBuilder<'static, 'static>,
) -> DispatcherBuilder<'static, 'static> {
    builder.with(UpdateBoxSystem, "update-box", &[])
}

fn main() {
    handle_ctrlc();

    let mut registry = Registry::new();
    registry.register_block(Block::new("Dirt").faces(&[BlockFaces::All]).build());
    registry.register_block(Block::new("Stone").faces(&[BlockFaces::All]).build());
    registry.register_block(Block::new("Marble").faces(&[BlockFaces::All]).build());
    registry.register_block(Block::new("Lol").faces(&[BlockFaces::All]).build());
    registry.register_block(
        Block::new("Wood")
            .faces(&[BlockFaces::Top, BlockFaces::Side, BlockFaces::Bottom])
            .build(),
    );
    registry.register_block(
        Block::new("Leaves")
            .faces(&[BlockFaces::All])
            // .is_transparent(true)
            // .transparent_standalone(true)
            .build(),
    );
    registry.register_block(
        Block::new("Grass")
            .faces(&[BlockFaces::Top, BlockFaces::Side, BlockFaces::Bottom])
            .build(),
    );
    registry.register_block(
        Block::new("Color")
            .faces(&[BlockFaces::All])
            .is_light(true)
            .blue_light_level(10)
            .green_light_level(10)
            .red_light_level(10)
            .build(),
    );

    let mut server = Server::new().port(4000).registry(&registry).build();

    let config1 = WorldConfig::new()
        .min_chunk([-3, -3])
        .max_chunk([3, 3])
        .chunk_size(16)
        .seed(1213123)
        .build();

    let mut world = World::new("world1", &config1);

    world.ecs_mut().register::<BoxFlag>();

    world.set_dispatcher(get_dispatcher);

    {
        let mut pipeline = world.pipeline_mut();

        // pipeline.add_stage(FlatlandStage::new(10, 2, 2, 3));
        pipeline.add_stage(TestStage);
        pipeline.add_stage(HeightMapStage);
        pipeline.add_stage(TreeTestStage {
            noise: Worley::new(),
        });
    }

    // let test_body = RigidBody::new(&AABB::new(0.0, 0.0, 0.0, 0.5, 0.5, 0.5)).build();

    // world
    //     .ecs_mut()
    //     .create_entity()
    //     .with(EntityFlag::default())
    //     .with(ETypeComp::new("Box"))
    //     .with(IDComp::new(&nanoid!()))
    //     .with(PositionComp::new(3.0, 30.0, 3.0))
    //     .with(TargetComp::new(0.0, 0.0, 0.0))
    //     .with(HeadingComp::new(0.0, 0.0, 0.0))
    //     .with(MetadataComp::new())
    //     .with(RigidBodyComp::new(&test_body))
    //     .with(CurrentChunkComp::default())
    //     .with(BoxFlag)
    //     .build();

    server.add_world(world).expect("Could not create world1.");

    let config2 = WorldConfig::new()
        .min_chunk([-5, -5])
        .max_chunk([5, 5])
        .build();
    let world = server
        .create_world("world2", &config2)
        .expect("Could not create world2.");

    {
        let mut pipeline = world.pipeline_mut();
        pipeline.add_stage(FlatlandStage::new(10, 1, 1, 1));
    }

    Voxelize::run(server);
}
