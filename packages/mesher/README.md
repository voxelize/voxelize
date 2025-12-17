# voxelize-mesher

The **single source of truth** for voxel meshing algorithms in Voxelize.

## Architecture

```
voxelize-mesher (this crate)
    |
    +-- voxelize-wasm-mesher (WASM wrapper for browser client)
    |
    +-- voxelize server (uses this crate directly via Cargo dependency)
```

Both the server and client now use **the same meshing algorithms** from this crate.

## Usage

### Client (via WASM)

The `voxelize-wasm-mesher` package wraps this crate for use in the browser via WebAssembly.
The client's mesh-worker imports and calls the WASM-compiled meshing functions.

### Server

The server depends on this crate directly via Cargo. The server's `Space` type implements
the `VoxelAccess` trait, allowing the shared meshing functions to work seamlessly.

## Development

When making changes to meshing algorithms:

1. Edit this crate (`packages/mesher/src/`)
2. Rebuild WASM: `cd packages/wasm-mesher && wasm-pack build --target web`
3. Rebuild client: `cd packages/core && pnpm compile`
4. Server will automatically use the changes when rebuilt

## Structure

- `src/access.rs` - `VoxelAccess` trait for abstracting voxel data access
- `src/types.rs` - Core types (Block, BlockFace, Registry, GeometryProtocol, etc.)
- `src/mesher.rs` - Meshing algorithms (greedy meshing, face culling, AO, lighting)
- `src/lib.rs` - Public exports
