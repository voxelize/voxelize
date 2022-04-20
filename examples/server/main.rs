use std::process;

use log::info;
use nanoid::nanoid;
use noise::{NoiseFn, SuperSimplex};
use simdnoise::NoiseBuilder;
use specs::{
    Builder, Component, DispatcherBuilder, NullStorage, ReadExpect, ReadStorage, System, WorldExt,
    WriteStorage,
};
use voxelize::{
    chunk::Chunk,
    pipeline::ChunkStage,
    utils::ndarray::ndarray,
    vec::Vec3,
    world::{
        block::{Block, BlockFaces},
        comps::{
            etype::ETypeComp, flags::EntityFlag, heading::HeadingComp, id::IDComp,
            metadata::MetadataComp, position::PositionComp, target::TargetComp,
        },
        registry::Registry,
        space::Space,
        stats::Stats,
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

struct TestStage {
    noise: SuperSimplex,
}

impl ChunkStage for TestStage {
    fn name(&self) -> String {
        "Test".to_owned()
    }

    fn process(
        &self,
        mut chunk: Chunk,
        registry: &Registry,
        config: &WorldConfig,
        _: Option<Space>,
    ) -> Chunk {
        let Vec3(min_x, _, min_z) = chunk.min;
        let Vec3(max_x, _, max_z) = chunk.max;

        let &WorldConfig {
            chunk_size,
            max_height,
            ..
        } = config;

        let marble = registry.get_block_by_name("Marble");
        let stone = registry.get_block_by_name("Stone");

        let mut noise = ndarray(&[chunk_size, max_height, chunk_size], 0.0);
        noise.data = NoiseBuilder::gradient_3d_offset(
            min_x as f32,
            config.chunk_size,
            0.0,
            config.max_height,
            min_z as f32,
            config.chunk_size,
        )
        .with_seed(config.seed)
        .generate_scaled(0.0, 1.0);

        for vx in min_x..max_x {
            for vz in min_z..max_z {
                // let limit =
                //     (5.0 * (vx as f32 / 10.0).sin() + 8.0 * (vz as f32 / 20.0).cos() + 30.0) as i32;
                for vy in 0..(max_height as i32) {
                    let mut val =
                        noise[&[(vx - min_x) as usize, vy as usize, (vz - min_z) as usize]];
                    val += -0.75 * (vy - max_height as i32).max(0) as f32;

                    if val > 0.5 {
                        if vx * vz % 7 == 0 {
                            chunk.set_voxel(vx, vy, vz, stone.id);
                        } else {
                            chunk.set_voxel(vx, vy, vz, marble.id);
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
        WriteStorage<'a, PositionComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use specs::Join;

        let (stats, flag, mut positions) = data;

        for (position, _) in (&mut positions, &flag).join() {
            let inner = position.inner_mut();
            let elapsed = stats.elapsed().as_millis() as f32;

            inner.0 += (elapsed * BOX_SPEED).cos() * 0.005;
            inner.1 += (elapsed * BOX_SPEED).sin() * 0.005;
            inner.2 += (elapsed * BOX_SPEED).sin() * 0.005;
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

    let mut server = Server::new().port(4000).build();

    let config1 = WorldConfig::new().build();

    let mut world = World::new("world1", &config1);

    world.ecs_mut().register::<BoxFlag>();

    world.set_dispatcher(get_dispatcher);
    world.pipeline_mut().add_stage(TestStage {
        noise: SuperSimplex::new(),
    });

    world
        .registry_mut()
        .register_block(Block::new("Marble").faces(&[BlockFaces::All]).build());

    world
        .registry_mut()
        .register_block(Block::new("Stone").faces(&[BlockFaces::All]).build());

    world
        .ecs_mut()
        .create_entity()
        .with(EntityFlag::default())
        .with(ETypeComp::new("Box"))
        .with(IDComp::new(&nanoid!()))
        .with(BoxFlag::default())
        .with(PositionComp::new(3.0, 3.0, 3.0))
        .with(TargetComp::new(0.0, 0.0, 0.0))
        .with(HeadingComp::new(0.0, 0.0, 0.0))
        .with(MetadataComp::new())
        .build();

    world
        .ecs_mut()
        .create_entity()
        .with(EntityFlag::default())
        .with(ETypeComp::new("Box"))
        .with(IDComp::new(&nanoid!()))
        .with(BoxFlag::default())
        .with(PositionComp::new(-3.0, 3.0, -3.0))
        .with(TargetComp::new(0.0, 0.0, 0.0))
        .with(HeadingComp::new(0.0, 0.0, 0.0))
        .with(MetadataComp::new())
        .build();

    server.add_world(world).expect("Could not create world1.");

    let config2 = WorldConfig::new().build();
    server
        .create_world("world2", &config2)
        .expect("Could not create world2.");

    Voxelize::run(server);
}
