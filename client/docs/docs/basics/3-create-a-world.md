---
sidebar_position: 3
---

# Create a World

With a server and two blocks, we are ready to create our first world. 

## What are Chunks?

Chunks are columns of blocks that make up an entire Voxelize world. By default, a chunk is 16x256x16 in dimension. A Voxelize world can be infinite because the world only generates the chunks around the clients, and as the client moves, more chunks are generated.

Chunks have their own coordinate system, separate from the voxel coordinate system. Voxel coordinates are 3D, and chunk coordinates are 2D. For example, if the chunk size is 16 blocks wide, the voxel `(1, 1, 1)` would reside in the chunk `(0, 0)`, and the voxel `(17, 1, 1)` would reside in chunk `(1, 0)`. If chunk has a max height of 256, a voxel coordinate such as `(17, 256, 1)` would be invalid since the valid y-coordinate range would be `0-256`.


