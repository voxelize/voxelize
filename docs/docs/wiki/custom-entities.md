# Custom Entities

In Voxelize, you can create entities such as mobs by defining custom entity loaders and entity components. These entities can be used to create custom game logic.

## Defining a Custom Entity

```rust title="Custom Entity Definition"
struct PigFlag;

let world = server.create_world("my_world", &config).expect("Failed to create world");

world.set_entity_loader("Pig", |world, metadata| {
  let position = metadata.get::<PositionComp>("position").expect("Failed to get position");

  let body = RigidBody::new(&AABB::new().scale_x(0.5).scale_y(0.5).scale_z(0.5).build());
  let interactor = world.physics_mut().register(&body);

  world
    .create_entity(&nanoid(), "Pig")
    .with(PigFlag)
    .with(PositionComp::default())
    .with(RigidBodyComp::new(&body))
    .with(InteractorComp::new(&interactor))
    .with(position)
});
```

You can then spawn the entity by calling the `spawn_entity` method on the world. For more information about metadata, see the [Metadata](metadata-processing) page.

```rust title="Spawning a Custom Entity"
world.spawn_entity_at("Pig", &Vec3(0.0, 80.0, 0.0));
```

## Handling Entity on the Client

```ts title="Client Entity Receive"
class Pig extends VOXELIZE.Entity<{ position: Coords3 }> {
  constructor(id: string) {
    super(id);

    // Temporary mesh for testing out the pig.
    this.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.5, 0.5),
        new THREE.MeshBasicMaterial({ color: "#FFCAC8" })
      )
    )
  }

  onSpawn(data: { position: Coords3 }) {
    // Setup the animations and other stuff here.

    this.position.set(...data.position);
  }

  onUpdate(data: { position: Coords3 }) {
    // Update the animations and other stuff here.

    this.position.lerp(new THREE.Vector3(...data.position), 0.8);
  }
}

const entities = new VOXELIZE.Entities();

network.register(entities);

entities.addClass("Pig", Pig);
```
