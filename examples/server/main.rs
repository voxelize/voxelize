use std::{process, time::Instant};

use nanoid::nanoid;
use specs::{
    Builder, Component, DispatcherBuilder, NullStorage, ReadExpect, ReadStorage, System, WorldExt,
    WriteStorage,
};
use voxelize::{
    chunk::Chunk,
    chunks::Chunks,
    pipeline::{ChunkStage, Pipeline},
    vec::Vec3,
    world::{
        comps::{
            etype::ETypeComp, flags::EntityFlag, heading::HeadingComp, id::IDComp,
            metadata::MetadataComp, position::PositionComp, target::TargetComp,
        },
        registry::Registry,
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

struct TestStage;

impl ChunkStage for TestStage {
    fn neighbors(&self) -> usize {
        15
    }

    fn process(
        &self,
        chunk: &mut Chunk,
        chunks: &Chunks,
        registry: &Registry,
        pipeline: &Pipeline,
    ) {
        let Vec3(min_x, min_y, min_z) = chunk.min;
        chunk.set_voxel(min_x, min_y, min_z, registry.get_id_by_name("1"));
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
    world.pipeline_mut().add_stage(TestStage {});

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

    server.add_world(world).expect("Could not create world1.");

    let config2 = WorldConfig::new().build();
    server
        .create_world("world2", &config2)
        .expect("Could not create world2.");

    Voxelize::run(server);
}
