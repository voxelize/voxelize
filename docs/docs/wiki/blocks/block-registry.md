---
sidebar_position: 1
---

# Block Registry

The block registry defines all block types on the server—their physical properties, face geometry, transparency, and special behaviors like block entities and dynamic connections.

## Registering Blocks

```rust title="Basic Registration"
use voxelize::*;

let mut registry = Registry::new();

registry.register_block(&Block::new("Dirt").id(1).build());
registry.register_block(&Block::new("Stone").id(2).build());
registry.register_block(&Block::new("Glass").id(3).is_transparent(true).is_see_through(true).build());

registry.generate(); // Compute UV coordinates for texture atlas
```

## Block Properties

```rust title="Property Examples"
let block = Block::new("Custom Block")
    .id(100)
    // Physics
    .is_solid(true)           // Has collision (default: true)
    .is_passable(false)       // Entities can walk through (default: false)
    .is_fluid(false)          // Water-like behavior (default: false)
    // Light emission
    .is_light(true)
    .light_level(14)          // Sets RGB to same value (0-15)
    // Or per-channel:
    .red_light_level(15)
    .green_light_level(12)
    .blue_light_level(8)
    // Rotation
    .rotatable(true)          // Can face any direction
    .y_rotatable(true)        // Only rotates around Y axis
    .y_rotatable_segments(YRotatableSegments::Four)  // 90° increments
    .build();
```

## Transparency

Four properties control transparency behavior:

| Property                 | Effect                                     |
| ------------------------ | ------------------------------------------ |
| `is_transparent`         | Adjacent block faces render (face culling) |
| `is_see_through`         | Visual alpha blending on client            |
| `transparent_standalone` | Renders faces between same block type      |
| `light_reduce`           | Light decreases by 1 passing through       |

```rust title="Transparency Examples"
// Glass: see-through, adjacent faces render
let glass = Block::new("Glass")
    .id(10)
    .is_transparent(true)
    .is_see_through(true)
    .build();

// Water: see-through, dims light, fluid physics
let water = Block::new("Water")
    .id(11)
    .is_transparent(true)
    .is_see_through(true)
    .is_fluid(true)
    .is_passable(true)
    .light_reduce(true)
    .build();

// Leaves: renders faces between adjacent leaves (not a solid mass)
let leaves = Block::new("Oak Leaves")
    .id(12)
    .is_transparent(true)
    .is_see_through(true)
    .light_reduce(true)
    .transparent_standalone(true)
    .build();

// Slab: only sides are transparent (top/bottom solid)
let slab = Block::new("Stone Slab")
    .id(13)
    .is_transparent(true)
    .is_py_transparent(false)
    .is_ny_transparent(false)
    .build();
```

## Face Geometry

Customize block shape with scaling, offsets, and prefixes. Default is a standard cube with faces `px`, `nx`, `py`, `ny`, `pz`, `nz`.

```rust title="Face Geometry Examples"
// Half-height slab
let slab = Block::new("Stone Slab")
    .id(20)
    .faces(&BlockFaces::six_faces().scale_y(0.5).build())
    .build();

// Diagonal X-pattern for plants (faces: "one", "two")
let grass = Block::new("Tall Grass")
    .id(21)
    .faces(&BlockFaces::diagonal_faces().build())
    .is_transparent(true)
    .is_see_through(true)
    .is_passable(true)
    .build();

// Torch: thin vertical shape
let torch = Block::new("Torch")
    .id(22)
    .faces(&BlockFaces::six_faces()
        .scale_x(0.1)
        .scale_z(0.1)
        .scale_y(0.6)
        .offset_x(0.45)
        .offset_z(0.45)
        .build())
    .is_transparent(true)
    .is_light(true)
    .light_level(14)
    .build();
```

### Compound Blocks

Use prefixes to create multi-part blocks where each part can be textured separately on the client:

```rust title="Mushroom with Stem and Cap"
let stem = BlockFaces::six_faces()
    .prefix("stem").concat("-")
    .scale_x(0.25).scale_z(0.25)
    .offset_x(0.375).offset_z(0.375)
    .build();

let cap = BlockFaces::six_faces()
    .prefix("cap").concat("-")
    .scale_y(0.3).offset_y(0.7)
    .build();

let mushroom = Block::new("Mushroom")
    .id(30)
    .faces(&(stem + cap))  // Faces: stem-px, stem-ny, cap-py, etc.
    .is_transparent(true)
    .build();
```

## Custom Collision (AABBs)

Define collision boxes independent of visual geometry:

```rust title="Custom Collision Examples"
// Fence post: narrow center collision
let fence = Block::new("Fence Post")
    .id(40)
    .aabbs(&[
        AABB::new()
            .scale_x(0.25).scale_z(0.25)
            .offset_x(0.375).offset_z(0.375)
            .build()
    ])
    .is_transparent(true)
    .build();

// Table: tabletop + 4 legs
let table = Block::new("Table")
    .id(41)
    .aabbs(&[
        AABB::new().scale_y(0.1).offset_y(0.9).build(),
        AABB::new().scale_x(0.1).scale_z(0.1).scale_y(0.9).build(),
        AABB::new().scale_x(0.1).scale_z(0.1).scale_y(0.9).offset_x(0.9).build(),
        AABB::new().scale_x(0.1).scale_z(0.1).scale_y(0.9).offset_z(0.9).build(),
        AABB::new().scale_x(0.1).scale_z(0.1).scale_y(0.9).offset_x(0.9).offset_z(0.9).build(),
    ])
    .build();
```

## Face Texture Types

Voxelize supports three texture allocation strategies per face:

| Type            | Atlas Slot           | Use Case                               | Client API            |
| --------------- | -------------------- | -------------------------------------- | --------------------- |
| **Standard**    | Shared in atlas      | Normal blocks                          | `applyBlockTexture`   |
| **Independent** | Dedicated, shared    | High-res textures, animations          | `applyBlockTexture`   |
| **Isolated**    | Dedicated, per-block | Per-instance content (signs, pictures) | `applyBlockTextureAt` |

### Standard Faces (Default)

All block instances share the same texture slot in the atlas. This is memory-efficient for blocks where every instance looks identical.

```rust title="Standard Faces"
let stone = Block::new("Stone")
    .id(1)
    .faces(&BlockFaces::six_faces().build())
    .build();
```

On the client, use `applyBlockTexture`:

```ts
world.applyBlockTexture("Stone", "*", "/textures/stone.png");
```

### Independent Faces

A face marked independent gets its own dedicated texture outside the atlas, but still shares that texture across all instances. Use this for high-resolution textures or animated faces that would otherwise consume too much atlas space.

```rust title="Independent Face"
let monitor = Block::new("Monitor")
    .id(50)
    .faces(&BlockFaces::six_faces()
        .independent_at(SIX_FACES_PZ)  // PZ face gets dedicated texture
        .build())
    .build();
```

On the client, still use `applyBlockTexture`—every monitor shows the same screen:

```ts
world.applyBlockTexture("Monitor", "pz", highResTexture);
```

### Isolated Faces

A face marked isolated gets a unique texture **per block instance**. This is essential for blocks where each placed instance shows different content—signs with custom text, picture frames with different images, screens with unique displays.

**Requirements:**

1. Mark faces with `.isolated_at()` on the server
2. Set `.is_entity(true)` so each instance stores metadata
3. Use `applyBlockTextureAt` on the client (not `applyBlockTexture`)

```rust title="Isolated Face with Block Entity"
let sign = Block::new("Oak Wall Sign")
    .id(23001)
    .faces(&BlockFaces::six_faces()
        .scale_z(0.1)
        .isolated_at(SIX_FACES_PZ)  // Each sign's PZ face is unique
        .build())
    .is_entity(true)  // Required: enables per-instance data
    .is_transparent(true)
    .y_rotatable(true)
    .build();
```

On the client, target a specific voxel position:

```ts
world.applyBlockTextureAt(
  "Oak Wall Sign",
  "pz",
  canvasTexture,
  [10, 5, 20] // This specific sign at this position
);
```

Calling `applyBlockTexture` on an isolated face will silently skip it—isolated faces can only be textured per-instance.

### Example: Picture Frame with Isolated Inner Face

A picture frame has a wooden border (standard faces) and an inner display area (isolated face):

```rust title="Picture Frame Registration"
fn create_frame(name: &str, id: u32, dimensions: (f32, f32)) -> Block {
    let (width, height) = dimensions;
    let frame_depth = 0.08;
    let frame_thickness = 0.08;
    let inner_depth = 0.04;

    // Inner display area - isolated so each frame shows different content
    let inner_faces = BlockFaces::six_faces()
        .scale_z(inner_depth)
        .scale_x(width - frame_thickness * 2.0)
        .scale_y(height - frame_thickness * 2.0)
        .offset_x(-(width - 1.0) / 2.0 + frame_thickness)
        .offset_y(frame_thickness)
        .isolated_at(SIX_FACES_PZ)  // Each frame's display is unique
        .prefix("inner")
        .build();

    // Wooden frame border - standard faces, all frames share same texture
    let top_frame = BlockFaces::six_faces()
        .scale_z(frame_depth)
        .scale_x(width)
        .scale_y(frame_thickness)
        .offset_x(-(width - 1.0) / 2.0)
        .offset_y(height - frame_thickness)
        .prefix("frame")
        .build();

    // ... bottom, left, right frame pieces ...

    Block::new(name)
        .id(id)
        .faces(&(inner_faces + top_frame /* + other frame pieces */))
        .is_entity(true)  // Required for isolated faces
        .is_transparent(true)
        .y_rotatable(true)
        .build()
}

registry.register_block(&create_frame("Picture Frame 1x1", 23060, (1.0, 1.0)));
```

On the client:

```ts
// All picture frames share the same wooden border texture
world.applyBlockTexture(
  "Picture Frame 1x1",
  "frame*",
  "/textures/oak_planks.png"
);

// Each frame's inner display is set individually
world.applyBlockTextureAt(
  "Picture Frame 1x1",
  "innerpz",
  userUploadedImage,
  [10, 5, 20]
);
```

Face constants: `SIX_FACES_PX`, `SIX_FACES_NX`, `SIX_FACES_PY`, `SIX_FACES_NY`, `SIX_FACES_PZ`, `SIX_FACES_NZ`.

## Block Entities

Blocks with `is_entity(true)` create an entity when placed, storing arbitrary JSON metadata per instance. The client receives updates via `addBlockEntityUpdateListener` and can render accordingly.

Block entities are required for isolated faces because the system needs to track each instance. They're also useful for storing custom data even without isolated faces (e.g., chest contents, redstone state).

See [Block Textures](./block-textures.md#per-instance-textures-isolated-faces) for the client-side implementation.

## Dynamic Blocks (Conditional Geometry)

Dynamic blocks change their geometry based on neighboring blocks—useful for fences, walls, pipes, and connectors.

### How It Works

1. Define base geometry (always rendered)
2. Define conditional parts with rules
3. When a rule matches, its faces and AABBs are added to the block

```rust title="Fence with Conditional Connections"
let fence_id = 50000;

// Base post - always visible
let post = BlockFaces::six_faces()
    .scale_x(0.2).scale_z(0.2).scale_y(0.6)
    .offset_x(0.4).offset_z(0.4)
    .build();
let post_aabb = AABB::from_faces(&post);

// Connection arm for +X direction
let arm_px_bottom = BlockFaces::six_faces()
    .scale_x(0.4).scale_y(0.15).scale_z(0.1)
    .offset_x(0.6).offset_y(0.15).offset_z(0.45)
    .build();
let arm_px_top = BlockFaces::six_faces()
    .scale_x(0.4).scale_y(0.15).scale_z(0.1)
    .offset_x(0.6).offset_y(0.35).offset_z(0.45)
    .build();
let arm_px_faces = [arm_px_bottom.to_vec(), arm_px_top.to_vec()].concat();
let arm_px_aabb = AABB::from_faces(&arm_px_faces);

let fence = Block::new("Fence")
    .id(fence_id)
    .faces(&post)
    .aabbs(&[post_aabb])
    .is_transparent(true)
    .is_dynamic(true)
    .dynamic_patterns(&[BlockDynamicPattern {
        parts: vec![
            // Base post - rule is None, always added
            BlockConditionalPart {
                rule: BlockRule::None,
                faces: post.to_vec(),
                aabbs: vec![post_aabb],
                is_transparent: [true; 6],
                ..Default::default()
            },
            // +X arm - added when neighbor is solid (not air, water, etc.)
            BlockConditionalPart {
                rule: BlockRule::Combination {
                    logic: BlockRuleLogic::And,
                    rules: vec![
                        BlockRule::Combination {
                            logic: BlockRuleLogic::Not,
                            rules: vec![BlockRule::Simple(BlockSimpleRule {
                                offset: Vec3(1, 0, 0),
                                id: Some(0),  // Not air
                                ..Default::default()
                            })],
                        },
                    ],
                },
                faces: arm_px_faces.clone(),
                aabbs: vec![arm_px_aabb],
                is_transparent: [true; 6],
                ..Default::default()
            },
            // Add similar parts for -X, +Z, -Z directions...
        ],
    }])
    .build();
```

### Block Rules

Rules determine when conditional geometry appears:

```rust title="Rule Types"
// Always add this part (use for base geometry in dynamic_patterns)
BlockRule::None

// Match specific block at offset
BlockRule::Simple(BlockSimpleRule {
    offset: Vec3(1, 0, 0),  // Check +X neighbor
    id: Some(70),           // Must be block ID 70
    rotation: None,         // Any rotation (or Some(BlockRotation::PY(0.0)))
    stage: None,            // Any stage (or Some(2))
})

// Combine rules with logic
BlockRule::Combination {
    logic: BlockRuleLogic::And,  // All must match
    rules: vec![/* ... */],
}

BlockRule::Combination {
    logic: BlockRuleLogic::Or,   // Any must match
    rules: vec![/* ... */],
}

BlockRule::Combination {
    logic: BlockRuleLogic::Not,  // Inverts the inner rule
    rules: vec![/* single rule */],
}
```

### Example: Fence Connecting to Any Solid Block

```rust title="Connect to Non-Air Neighbors"
fn get_fence_connection_rule(offset: Vec3<i32>) -> BlockRule {
    BlockRule::Combination {
        logic: BlockRuleLogic::And,
        rules: vec![
            // Not air
            BlockRule::Combination {
                logic: BlockRuleLogic::Not,
                rules: vec![BlockRule::Simple(BlockSimpleRule {
                    offset: offset.clone(),
                    id: Some(0),
                    ..Default::default()
                })],
            },
            // Not water
            BlockRule::Combination {
                logic: BlockRuleLogic::Not,
                rules: vec![BlockRule::Simple(BlockSimpleRule {
                    offset: offset.clone(),
                    id: Some(30000),
                    ..Default::default()
                })],
            },
        ],
    }
}

// Use for each direction
let rule_px = get_fence_connection_rule(Vec3(1, 0, 0));
let rule_nx = get_fence_connection_rule(Vec3(-1, 0, 0));
let rule_pz = get_fence_connection_rule(Vec3(0, 0, 1));
let rule_nz = get_fence_connection_rule(Vec3(0, 0, -1));
```

## Complete Example

```rust title="Full Block Registration"
use voxelize::*;

pub fn register_blocks(registry: &mut Registry) {
    // Basic solid block
    registry.register_block(&Block::new("Stone").id(1).build());

    // Transparent block
    registry.register_block(&Block::new("Glass")
        .id(10)
        .is_transparent(true)
        .is_see_through(true)
        .build());

    // Light-emitting block
    registry.register_block(&Block::new("Torch")
        .id(20)
        .is_light(true)
        .light_level(14)
        .is_transparent(true)
        .is_passable(true)
        .faces(&BlockFaces::six_faces()
            .scale_x(0.1).scale_z(0.1).scale_y(0.6)
            .offset_x(0.45).offset_z(0.45)
            .build())
        .build());

    // Block entity with isolated face for per-instance textures
    registry.register_block(&Block::new("Sign")
        .id(30)
        .is_entity(true)
        .is_transparent(true)
        .y_rotatable(true)
        .faces(&BlockFaces::six_faces()
            .scale_z(0.1)
            .isolated_at(SIX_FACES_PZ)
            .build())
        .build());

    // Plant with diagonal faces
    registry.register_block(&Block::new("Tall Grass")
        .id(40)
        .is_transparent(true)
        .is_see_through(true)
        .is_passable(true)
        .faces(&BlockFaces::diagonal_faces().build())
        .build());

    registry.generate();
}
```

## Related Pages

- [Block Textures](./block-textures.md) - Client-side texture application
- [Chunk Meshing](./chunk-meshing.md) - How blocks become geometry
- [Custom Block Rendering](./custom-block-rendering.md) - Block entity patterns
