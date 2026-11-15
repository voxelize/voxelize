---
sidebar_position: 7
---

# Collision Detection

Voxelize uses [Rapier physics](https://rapier.rs/) for entity-to-entity collision detection. Entities with `InteractorComp` can detect when they collide with other interactors.

## Server-Side Collisions

### Setting Up Colliders

Entities need both `RigidBodyComp` and `InteractorComp` to participate in collision detection:

```rust title="Entity with Collider"
world.set_entity_loader("enemy", |world, _| {
    let body = RigidBody::new(
        &AABB::new()
            .scale_x(0.8)
            .scale_y(1.8)
            .scale_z(0.8)
            .build()
    ).build();

    let interactor = world.physics_mut().register(&body);

    world
        .create_entity(&nanoid!(), "enemy")
        .with(PositionComp::default())
        .with(RigidBodyComp::new(&body))
        .with(InteractorComp::new(&interactor))
        .with(CollisionsComp::new())
});
```

- `RigidBodyComp` - Defines the collision box shape and physics properties
- `InteractorComp` - Registers the body with Rapier for collision detection
- `CollisionsComp` - Stores collision results each frame

### Reading Collisions

Create a system to process collisions:

```rust title="Collision Processing System"
use specs::{System, ReadStorage, Join};

pub struct DamageOnCollisionSystem;

impl<'a> System<'a> for DamageOnCollisionSystem {
    type SystemData = (
        ReadStorage<'a, CollisionsComp>,
        ReadStorage<'a, IDComp>,
        WriteStorage<'a, HealthComp>,
    );

    fn run(&mut self, (collisions, ids, mut healths): Self::SystemData) {
        for (collision, id, health) in (&collisions, &ids, &mut healths).join() {
            for other_entity in &collision.0 {
                // Entity collided with another interactor
                health.0 = health.0.saturating_sub(1);
            }
        }
    }
}
```

### Collision Data

`CollisionsComp` contains a vector of entities that collided this frame:

```rust title="CollisionsComp Structure"
pub struct CollisionsComp(pub Vec<Entity>);
```

Collisions are cleared each frame by `CleanupSystem`.

## Client-Side Collisions

### Rigid Controls Collision

The `RigidControls` handles player-to-voxel collisions automatically. Configure collision behavior:

```ts title="RigidControls Collision Options"
const controls = new VOXELIZE.RigidControls(camera, canvas, world, {
  bodyWidth: 0.8,
  bodyHeight: 1.8,
  bodyDepth: 0.8,
  stepHeight: 0.5,
  maxSpeed: 8,
});
```

### Solid Colliders

Solid shapes that aren't blocks (a wall, a platform, a prop) can be added to the client's physics engine as colliders. Bodies collide with them exactly as they collide with blocks: they stop at their faces, stand on their tops and step up their low ledges, and auto-jump sees them too.

```ts title="Adding a Collider"
import { AABB } from "@voxelize/aabb";

// A 2x3x2 crate at the origin, in world space.
const crate = world.physics.addCollider([new AABB(0, 0, 0, 2, 3, 2)]);

// Move it, or take it away.
world.physics.updateCollider(crate, [new AABB(4, 0, 0, 6, 3, 2)]);
world.physics.removeCollider(crate);
```

A collider that moves or appears around a body doesn't push it out; the body walks out of it freely, as out of a block placed around it. Every box needs finite bounds and a positive size on every axis: `addCollider` and `updateCollider` throw on one that doesn't.

### Raycasting

Use raycasting to detect blocks or entities:

```ts title="Raycasting for Blocks"
const voxelInteract = new VOXELIZE.VoxelInteract(camera, world, {
  reachDistance: 5,
});

function update() {
  voxelInteract.update();

  if (voxelInteract.target) {
    const { voxel, normal } = voxelInteract.target;
    console.log(`Looking at block at ${voxel}`);
  }
}
```

### Custom Collision Checks

For custom entity collision on the client:

```ts title="Distance-Based Collision"
class CollisionChecker {
  checkCollision(
    entity1: THREE.Object3D,
    entity2: THREE.Object3D,
    threshold: number
  ): boolean {
    const distance = entity1.position.distanceTo(entity2.position);
    return distance < threshold;
  }

  checkPlayerNearEntity(
    controls: VOXELIZE.RigidControls,
    entity: THREE.Object3D,
    threshold: number
  ): boolean {
    const playerPos = controls.object.position;
    return playerPos.distanceTo(entity.position) < threshold;
  }
}
```

## Physics Properties

Configure rigid body physics:

```rust title="Physics Configuration"
let mut body = RigidBody::new(
    &AABB::new()
        .scale_x(0.5)
        .scale_y(0.5)
        .scale_z(0.5)
        .build()
).build();

body.gravity_multiplier = 1.0;  // Gravity scale
body.air_drag = 0.1;            // Air resistance
body.fluid_drag = 0.4;          // Water resistance
body.friction = 0.5;            // Ground friction
```

## Example: Pickup System

Detect when players collide with drops:

```rust title="Pickup System"
pub struct PickupSystem;

impl<'a> System<'a> for PickupSystem {
    type SystemData = (
        Entities<'a>,
        ReadStorage<'a, CollisionsComp>,
        ReadStorage<'a, ClientFlag>,
        ReadStorage<'a, DropComp>,
        ReadStorage<'a, IDComp>,
        Write<'a, Events>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (entities, collisions, clients, drops, ids, mut events) = data;

        for (entity, collision, _, id) in (&entities, &collisions, &clients, &ids).join() {
            for &other in &collision.0 {
                if let Some(drop) = drops.get(other) {
                    // Player collided with a drop
                    events.dispatch(
                        Event::new("pickup")
                            .payload(serde_json::json!({
                                "playerId": id.0,
                                "itemId": drop.item_id,
                            }))
                            .build()
                    );

                    // Delete the drop entity
                    entities.delete(other).ok();
                }
            }
        }
    }
}
```

## Collision Repulsion

Configure how entities push each other apart:

```rust title="World Config Collision Settings"
let config = WorldConfig::new()
    .collision_repulsion(1.0)        // Entity-entity repulsion strength
    .client_collision_repulsion(0.2) // Player-entity repulsion strength
    .build();
```

Read on to learn about [the events system](./the-events-system).



