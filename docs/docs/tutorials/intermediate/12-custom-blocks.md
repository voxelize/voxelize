---
sidebar_position: 12
---

# Custom Blocks

Beyond basic blocks, Voxelize supports advanced block configurations including rotations, transparency, custom shapes, and dynamic behaviors.

## Block Properties

### Basic Properties

```rust title="Block Properties"
let block = Block::new("My Block")
    .id(100)
    .is_solid(true)           // Collision enabled
    .is_transparent(false)    // Renders back faces
    .is_passable(false)       // Entities can't walk through
    .is_fluid(false)          // Water-like behavior
    .is_light(false)          // Emits light
    .light_level(0)           // Light emission level (0-15)
    .build();
```

### Transparency

For transparent blocks like glass:

```rust title="Transparent Block"
let glass = Block::new("Glass")
    .id(10)
    .is_transparent(true)
    .is_see_through(true)     // Can see through for lighting
    .build();
```

### Light-Emitting Blocks

```rust title="Light Source"
let torch = Block::new("Torch")
    .id(20)
    .is_light(true)
    .light_level(14)          // Max is 15
    .is_transparent(true)
    .is_solid(false)
    .build();
```

## Block Rotation

### Y-Axis Rotation

Blocks can rotate on the Y axis:

```rust title="Y-Rotatable Block"
let furnace = Block::new("Furnace")
    .id(30)
    .rotatable(true)
    .y_rotatable(true)
    .build();
```

### 6-Face Rotation

Blocks that can face any direction:

```rust title="6-Face Rotation"
let piston = Block::new("Piston")
    .id(31)
    .rotatable(true)
    .y_rotatable(true)
    .build();
```

## Custom Shapes

### AABB Shapes

Define custom collision boxes:

```rust title="Custom AABB"
let slab = Block::new("Stone Slab")
    .id(40)
    .aabbs(&[AABB::new()
        .scale_y(0.5)
        .build()])
    .build();
```

### Multiple AABBs

```rust title="Multiple AABBs"
let stairs = Block::new("Stairs")
    .id(41)
    .aabbs(&[
        AABB::new().scale_y(0.5).build(),
        AABB::new()
            .scale_x(0.5)
            .scale_y(0.5)
            .offset_y(0.5)
            .build(),
    ])
    .build();
```

## Block Texturing

### Server-Side Texture Names

```rust title="Block Faces"
let log = Block::new("Oak Log")
    .id(50)
    .faces(&[
        Face::new("py").build(),  // Top
        Face::new("ny").build(),  // Bottom
        Face::new("px").build(),  // +X side
        Face::new("nx").build(),  // -X side
        Face::new("pz").build(),  // +Z side
        Face::new("nz").build(),  // -Z side
    ])
    .build();
```

### Client-Side Texturing

```ts title="Applying Textures"
await world.applyBlockTexture("Oak Log", "py", "/textures/log_top.png");
await world.applyBlockTexture("Oak Log", "ny", "/textures/log_top.png");
await world.applyBlockTexture(
  "Oak Log",
  ["px", "nx", "pz", "nz"],
  "/textures/log_side.png"
);
```

## Block Entities

Blocks can have associated entities for complex data:

```rust title="Block Entity"
let sign = Block::new("Sign")
    .id(60)
    .is_entity(true)          // Creates entity when placed
    .is_solid(false)
    .build();
```

The entity stores JSON data:

```ts title="Block Entity Data"
method.call("vox-builtin:update-block-entity", {
  id: entityId,
  json: JSON.stringify({ text: "Hello World" }),
});
```

## Dynamic Blocks

### Active Blocks

Blocks that update each tick:

```rust title="Active Block"
let redstone = Block::new("Redstone Wire")
    .id(70)
    .is_active(true)
    .active_fn(|world, vx, vy, vz| {
        // Called each tick for this block
        // Return updates to apply
        vec![]
    })
    .build();
```

## Client-Side Customization

### Custom Shaders

```ts title="Custom Block Shader"
world.customizeMaterialShaders(
  "Grass",
  null,
  VOXELIZE.customShaders.sway({ rooted: true })
);

world.customizeMaterialShaders("Water", VOXELIZE.customShaders.water(), null);
```

### Dynamic Textures

```ts title="Dynamic Texture"
const canvas = document.createElement("canvas");
canvas.width = 16;
canvas.height = 16;
const ctx = canvas.getContext("2d")!;

function updateTexture() {
  ctx.fillStyle = `hsl(${(Date.now() / 10) % 360}, 100%, 50%)`;
  ctx.fillRect(0, 0, 16, 16);

  world.applyBlockTextureByIdAt(blockId, "all", canvas, voxelPosition);
}
```

## Example: Slab Variants

```rust title="Slab Registration"
fn register_slabs(registry: &mut Registry, base_id: u32, name: &str) {
    let bottom_slab = Block::new(&format!("{} Slab Bottom", name))
        .id(base_id)
        .aabbs(&[AABB::new().scale_y(0.5).build()])
        .build();

    let top_slab = Block::new(&format!("{} Slab Top", name))
        .id(base_id + 1)
        .aabbs(&[AABB::new().scale_y(0.5).offset_y(0.5).build()])
        .build();

    registry.register_blocks(&[bottom_slab, top_slab]);
}
```

## Example: Door Block

```rust title="Door Block"
let door_bottom = Block::new("Door Bottom")
    .id(80)
    .rotatable(true)
    .y_rotatable(true)
    .aabbs(&[AABB::new().scale_z(0.2).build()])
    .is_transparent(true)
    .build();

let door_top = Block::new("Door Top")
    .id(81)
    .rotatable(true)
    .y_rotatable(true)
    .aabbs(&[AABB::new().scale_z(0.2).build()])
    .is_transparent(true)
    .build();
```

Read on to learn about [TypeScript transport](./typescript-transport).



