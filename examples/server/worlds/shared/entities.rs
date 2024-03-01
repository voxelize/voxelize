use nanoid::nanoid;
use specs::Builder;
use voxelize::{InteractorComp, PositionComp, RigidBody, RigidBodyComp, World, AABB};

use super::components::{BotFlag, BrainComp, PathComp, RotationComp, TargetComp, TextComp};

const MAX_NODES: usize = 24;

pub fn setup_entities(world: &mut World) {
    world.set_entity_loader("floating-text", |world, metadata| {
        world
            .create_entity(&nanoid!(), "floating-text")
            .with(metadata.get::<PositionComp>("position").unwrap_or_default())
            .with(metadata.get::<TextComp>("text").unwrap_or_default())
    });

    world.set_entity_loader("bot", |world, metadata| {
        let body =
            RigidBody::new(&AABB::new().scale_x(0.5).scale_y(0.5).scale_z(0.5).build()).build();
        let interactor = world.physics_mut().register(&body);

        world
            .create_entity(&nanoid!(), "bot")
            .with(BotFlag)
            .with(metadata.get::<TargetComp>("target").unwrap_or_default())
            .with(metadata.get::<PositionComp>("position").unwrap_or_default())
            .with(
                metadata
                    .get::<PathComp>("path")
                    .unwrap_or_else(|| PathComp::new(MAX_NODES)),
            )
            .with(metadata.get::<RotationComp>("rotation").unwrap_or_default())
            .with(RigidBodyComp::new(&body))
            .with(InteractorComp::new(&interactor))
            .with(BrainComp::default())
    });
}
