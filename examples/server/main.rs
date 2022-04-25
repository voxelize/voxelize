use std::process;

use log::info;
use nanoid::nanoid;
use noise::{MultiFractal, NoiseFn, SuperSimplex, Worley};
use simdnoise::NoiseBuilder;
use specs::{
    Builder, Component, DispatcherBuilder, NullStorage, ReadExpect, ReadStorage, System, WorldExt,
    WriteStorage,
};
use voxelize::{
    chunk::Chunk,
    common::BlockChange,
    pipeline::{ChunkStage, HeightMapStage},
    utils::ndarray::ndarray,
    vec::{Vec2, Vec3},
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

impl TestStage {
    fn octave_simplex3(
        &self,
        vx: i32,
        vy: i32,
        vz: i32,
        scale: f64,
        octaves: usize,
        persistance: f64,
        lacunarity: f64,
        amplifier: f64,
        height_bias: f64,
        height_offset: f64,
    ) -> f64 {
        let mut total = 0.0;
        let mut frequency = 1.0;
        let mut amplitude = 1.0;
        let mut max_val = 0.0;

        for _ in 0..octaves {
            total += self.noise.get([
                vx as f64 * frequency * scale,
                vy as f64 * frequency * scale,
                vz as f64 * frequency * scale,
            ]) * amplitude;

            max_val += amplitude;

            amplitude *= persistance;
            frequency *= lacunarity;
        }

        (total / max_val) * amplifier - height_bias * (vy as f64 - height_offset) * scale
    }
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
    ) -> (Chunk, Option<Vec<BlockChange>>) {
        let Vec3(min_x, _, min_z) = chunk.min;
        let Vec3(max_x, _, max_z) = chunk.max;

        let max_height = config.max_height as i32;

        let marble = registry.get_block_by_name("Marble");

        let scale = 0.01;
        let octaves = 10;
        let persistance = 0.9;
        let lacunarity = 1.2;
        let amplifier = 3.0;
        let height_bias = 3.0;
        let height_offset = 50.0;

        for vx in min_x..max_x {
            for vz in min_z..max_z {
                for vy in 0..max_height {
                    let density = self.octave_simplex3(
                        vx,
                        vy,
                        vz,
                        scale,
                        octaves,
                        persistance,
                        lacunarity,
                        amplifier,
                        height_bias,
                        height_offset,
                    );

                    if density > 0.0 {
                        chunk.set_voxel(vx, vy, vz, marble.id);
                    }
                }
            }
        }

        (chunk, None)
    }
}

struct TreeTestStage {
    noise: Worley,
}

impl ChunkStage for TreeTestStage {
    fn name(&self) -> String {
        "TreeTest".to_owned()
    }

    fn neighbors(&self, _: &WorldConfig) -> usize {
        1
    }

    fn process(
        &self,
        mut chunk: Chunk,
        registry: &Registry,
        config: &WorldConfig,
        space: Option<Space>,
    ) -> (Chunk, Option<Vec<BlockChange>>) {
        let Vec3(min_x, _, min_z) = chunk.min;
        let Vec3(max_x, _, max_z) = chunk.max;

        let lychee = registry.get_block_by_name("Lychee");
        let dirt = registry.get_block_by_name("Dirt");

        let scale = 1.0;

        let mut changes = vec![];

        for vx in min_x..max_x {
            for vz in min_z..max_z {
                let height = chunk.get_max_height(vx, vz) as i32;
                if self.noise.get([vx as f64 * scale, vz as f64 * scale]) > 0.999 {
                    for i in 0..5 {
                        chunk.set_voxel(vx, height + i, vz, lychee.id);
                    }

                    for i in -1..=1 {
                        for j in -1..=1 {
                            let vox = Vec3(vx + i, height + 4, vz + j);

                            if !chunk.contains(vox.0, vox.1, vox.2) {
                                changes.push((vox, dirt.id));
                                continue;
                            }

                            chunk.set_voxel(vox.0, vox.1, vox.2, dirt.id);
                        }
                    }
                }
            }
        }

        (chunk, Some(changes))
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

    let config1 = WorldConfig::new()
        .min_chunk([-5, -5])
        // .max_chunk([5, 5])
        .build();

    let mut world = World::new("world1", &config1);

    world.ecs_mut().register::<BoxFlag>();

    world.set_dispatcher(get_dispatcher);

    {
        let mut pipeline = world.pipeline_mut();

        pipeline.add_stage(TestStage {
            noise: SuperSimplex::new(),
        });
        pipeline.add_stage(HeightMapStage);
        pipeline.add_stage(TreeTestStage {
            noise: Worley::new(),
        });
    }

    {
        let mut registry = world.registry_mut();

        registry.register_block(Block::new("Dirt").faces(&[BlockFaces::All]).build());
        registry.register_block(Block::new("Stone").faces(&[BlockFaces::All]).build());
        registry.register_block(Block::new("Marble").faces(&[BlockFaces::All]).build());
        registry.register_block(Block::new("Lychee").faces(&[BlockFaces::All]).build());
        registry.register_block(
            Block::new("Grass")
                .faces(&[BlockFaces::Top, BlockFaces::Side, BlockFaces::Bottom])
                .build(),
        );
    }

    server.add_world(world).expect("Could not create world1.");

    let config2 = WorldConfig::new().build();
    server
        .create_world("world2", &config2)
        .expect("Could not create world2.");

    Voxelize::run(server);
}
