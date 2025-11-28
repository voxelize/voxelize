---
sidebar_position: 3
---

# Custom Entity Creation

On the server, entities are ECS objects with components. You define entity loaders that specify which components an entity type has, then spawn instances of those entities.

## Defining an Entity Loader

Use `world.set_entity_loader()` to define how an entity type is created:

```rust title="Entity Loader Definition"
use nanoid::nanoid;

world.set_entity_loader("mob", |world, metadata| {
    let body = RigidBody::new(
        &AABB::new()
            .scale_x(0.6)
            .scale_y(1.8)
            .scale_z(0.6)
            .build()
    ).build();
    let interactor = world.physics_mut().register(&body);

    world
        .create_entity(&nanoid!(), "mob")
        .with(PositionComp::default())
        .with(RigidBodyComp::new(&body))
        .with(InteractorComp::new(&interactor))
        .with(CollisionsComp::new())
});
```

The loader receives the world and any metadata passed during spawning.

## Spawning Entities

Spawn entities using the loader you defined:

```rust title="Basic Spawning"
world.spawn_entity_at("mob", &Vec3(10.0, 80.0, 10.0));
```

Spawn with initial metadata:

```rust title="Spawning with Metadata"
let mut metadata = MetadataComp::default();
metadata.set::<PositionComp>("position", &PositionComp::new(10.0, 80.0, 10.0));
metadata.set("name", &"Bob".to_string());

world.spawn_entity_with_metadata("mob", &Vec3(10.0, 80.0, 10.0), metadata);
```

## Adding Physics

For entities that interact with the voxel world:

```rust title="Physical Entity"
world.set_entity_loader("ball", |world, _| {
    let mut body = RigidBody::new(
        &AABB::new()
            .scale_x(0.5)
            .scale_y(0.5)
            .scale_z(0.5)
            .build()
    )
    .build();

    body.gravity_multiplier = 1.0;
    body.air_drag = 0.1;

    let interactor = world.physics_mut().register(&body);

    world
        .create_entity(&nanoid!(), "ball")
        .with(PositionComp::default())
        .with(RigidBodyComp::new(&body))
        .with(InteractorComp::new(&interactor))
        .with(CollisionsComp::new())
});
```

## Adding AI Behavior

For entities that chase players or wander:

```rust title="AI Entity"
use std::time::Duration;

world.set_entity_loader("zombie", |world, _| {
    let body = RigidBody::new(
        &AABB::new()
            .scale_x(0.6)
            .scale_y(1.8)
            .scale_z(0.6)
            .build()
    ).build();
    let interactor = world.physics_mut().register(&body);

    world
        .create_entity(&nanoid!(), "zombie")
        .with(PositionComp::default())
        .with(RigidBodyComp::new(&body))
        .with(InteractorComp::new(&interactor))
        .with(BrainComp::new(BrainOptions {
            max_speed: 4.0,
            jump_impulse: 8.0,
            ..Default::default()
        }))
        .with(TargetComp::players())
        .with(PathComp::new(
            100,                       // max_nodes
            24.0,                      // max_distance
            10000,                     // max_depth_search
            Duration::from_millis(50), // max_pathfinding_time
        ))
});
```

The AI systems will automatically find targets and move toward them.

## Custom Components

Define custom components for entity-specific data:

```rust title="Custom Component"
use specs::{Component, VecStorage};
use serde::{Serialize, Deserialize};

#[derive(Component, Default, Serialize, Deserialize)]
#[storage(VecStorage)]
pub struct HealthComp(pub i32);

#[derive(Component, Default)]
#[storage(NullStorage<BossFlag>)]
pub struct BossFlag;
```

Register components with the ECS:

```rust title="Registering Components"
world.ecs_mut().register::<HealthComp>();
world.ecs_mut().register::<BossFlag>();
```

Use them in entity loaders:

```rust title="Using Custom Components"
world.set_entity_loader("boss", |world, metadata| {
    let health = metadata.get::<HealthComp>("health").unwrap_or(HealthComp(100));

    world
        .create_entity(&nanoid!(), "boss")
        .with(BossFlag)
        .with(health)
        .with(PositionComp::default())
        // ... other components
});
```

## Spawning via Methods

Allow clients to spawn entities via methods:

```rust title="Spawn Method"
#[derive(Serialize, Deserialize)]
struct SpawnMobPayload {
    position: Vec3<f32>,
    name: Option<String>,
}

world.set_method_handle("spawn-mob", |world, _, payload| {
    let data: SpawnMobPayload = serde_json::from_str(payload)
        .expect("Invalid spawn-mob payload");

    let mut metadata = MetadataComp::default();
    if let Some(name) = data.name {
        metadata.set("name", &name);
    }

    world.spawn_entity_with_metadata("mob", &data.position, metadata);
});
```

Call from the client:

```ts title="Client Spawn Call"
method.call("spawn-mob", {
  position: [10, 80, 10],
  name: "Bob",
});
```

## Deleting Entities

Remove entities from the ECS:

```rust title="Deleting Entities"
world.set_method_handle("kill-mob", |world, _, payload| {
    let id: String = serde_json::from_str(payload).unwrap();

    let entity_ids = world.entity_ids();
    if let Some(&ent_id) = entity_ids.get(&id) {
        drop(entity_ids);

        let entities = world.ecs().entities();
        if let Some(entity) = entities.entity(ent_id) {
            entities.delete(entity).ok();
        }
    }
});
```

## Entity Persistence

Entities with `config.saving = true` are automatically saved to disk. They're stored in `{save_dir}/entities/{entity_id}.json`.

When the world loads, entities are revived using their loaders:

```rust title="Entity Revival"
// Automatically called during world.prepare()
// Entities are restored with their saved metadata
```

## Example: Drop Entity

A pickup item that players can collect:

```rust title="Drop Entity"
#[derive(Component, Default, Serialize, Deserialize)]
#[storage(VecStorage)]
pub struct DropComp {
    pub item_id: u32,
    pub count: u32,
}

world.set_entity_loader("drop", |world, metadata| {
    let drop_data = metadata.get::<DropComp>("drop").unwrap_or_default();

    world
        .create_entity(&nanoid!(), "drop")
        .with(PositionComp::default())
        .with(drop_data)
});

// Custom system to handle pickup
struct DropPickupSystem;

impl<'a> System<'a> for DropPickupSystem {
    type SystemData = (
        Entities<'a>,
        ReadStorage<'a, DropComp>,
        ReadStorage<'a, PositionComp>,
        ReadStorage<'a, ClientFlag>,
        WriteStorage<'a, InventoryComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        // Check distance between drops and players
        // Add to inventory and delete drop entity
    }
}
```

Read on to learn about the [metadata component](./metadata-component) for syncing entity data to clients.



