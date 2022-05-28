---
sidebar_position: 2
---

# Register Blocks

In Voxelize, each server has a set of blocks that the developer defines. These blocks are managed by a **registry**, and are shared across all worlds in the same server.

## Create a Registry

Here we create our example registry, registering two blocks to it:

```rust title="server/main.rs" {2,7-14}
use voxelize::{
    world::{registry::Registry, voxels::block::Block},
    Server, Voxelize,
};

fn main() {
    let mut registry = Registry::new();

    let dirt = Block::new("Dirt").build();
    let stone = Block::new("Stone").build();

    registry.register_blocks(&[dirt, stone]);

    let mut server = Server::new().port(4000).registry(&registry).build();

    Voxelize::run(server);
}
```

The `Block` struct also obeys the builder pattern, and a lot of other options are available to be configured:

- `id`: ID of the block. **Assigned by the server.**
- `name`: Name of the block, no duplicates.
- `rotatable`: Whether this block can be placed in different orientations.
- `y_rotatable`: The rotation on the y-axis of the block.
- `is_block`: Whether this type is a 6-faced block.
- `is_empty`: Whether if this type is empty, such as "Air".
- `is_fluid`: Whether if this block is a fluid, which is used in the physics engine.
- `is_light`: Whether if this block emits rgb colored light.
- `is_plant`: Whether if this block is a plant.
- `is_solid`: Whether if this block is solid and can interfere with physical bodies.
- `is_transparent`: Whether if this block is transparent, such as glass.
- `red_light_level`: The red light level of the block.
- `green_light_level`: The green light level of the block.
- `blue_light_level`: The blue light level of the block.
- `is_plantable`: Whether can plants be placed on this block.
- `transparent_standalone`: Whether should faces be rendered next to each other. Requires `is_transparent` to be true.
- `faces`: A list of faces that should be meshed.
- `aabbs`: A list of bounding boxes for this block, used by the physics engine.

## More on [`BlockFaces`](https://github.com/shaoruu/voxelize/blob/3ecd43456cd533df268926f6c0feae5987d70302/server/world/voxels/block.rs#L219-L231)

`BlockFaces` can be used to define different textures of a block. By default, a block has the `faces` field set as `&[BlockFaces::All]`.

As defined above, each enum value stands for a face to apply a texture. Other than `BlockFaces::Diagonal`, they are all for six-faced blocks. We view the block faces in 3 groups:

- `All`: Lowest priority. Applies a texture to all 6 faces.
- `Top`, `Side`, `Bottom`: Second priority. Applies a texture to either the top face, four side faces, or the bottom face.
- `Px`, `Py`, `Pz`, `Nx`, `Ny`, `Nz`: Top priority. Applies a texture to a specific face direction.

We define the block faces as such:

```rust title="BlockFace Example"
// Six faces would use the same texture.
let six_same_faces = Block::new("Dirt").faces(&[BlockFaces::All]).build();

// BlockFaces::Top takes priority over BlockFaces::All.
// Creates a block with a different texture on the top.
let top_face_different = Block::new("Stone").faces(&[BlockFaces::All, BlockFaces::Top]).build();
```

## More on [`AABB`](https://github.com/shaoruu/voxelize/blob/3ecd43456cd533df268926f6c0feae5987d70302/server/world/physics/aabb.rs#L6-L19)

`AABB` can be used to define the bounding boxes of a block. By default, a block has the `aabbs` field set as `&[AABB::new(0.0, 0.0, 0.0, 1.0, 1.0, 1.0)]`, which is a solid block from `(0,0,0)` to `(1,1,1)`.

An example of defining a staircase bounding box:

```rust title="AABB Example"
use voxelize::physics::aabb::AABB;

let stairs = Block::new("Stairs")
    .aabbs(&[
	AABB::new(0.0, 0.0, 0.0, 1.0, 0.5, 1.0),
	AABB::new(0.5, 0.5, 0.0, 1.0, 1.0, 1.0),
    ])
    .build();
```
