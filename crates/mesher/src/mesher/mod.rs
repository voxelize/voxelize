mod connectivity;
mod faces;
mod fluid;
mod greedy;
mod lighting;
mod space;
mod types;
mod vertex_light;
#[cfg(test)]
mod tests;

pub use connectivity::{
    compute_section_connectivity, connectivity_pair_bit, CONNECTIVITY_FACES, CONNECTIVITY_FULL,
    CONNECTIVITY_SEALED,
};
pub use greedy::mesh_space_greedy;
pub use types::*;
pub use vertex_light::*;

use connectivity::*;
use faces::*;
use fluid::*;
use lighting::*;
use space::*;



pub fn mesh_chunk(mut input: MeshInput) -> MeshOutput {
    input.registry.build_cache();
    let registry = input.registry.clone();
    mesh_chunk_with_registry_chunks(&input.chunks, input.min, input.max, input.config, &registry)
}

pub fn mesh_chunk_with_registry_chunks(
    chunks: &[Option<ChunkData>],
    min: [i32; 3],
    max: [i32; 3],
    config: MeshConfig,
    registry: &Registry,
) -> MeshOutput {
    let center_chunk = chunks.get(4).and_then(|c| c.as_ref());
    if center_chunk.is_none() {
        return MeshOutput {
            geometries: vec![],
            connectivity: CONNECTIVITY_FULL,
        };
    }

    let center_chunk = center_chunk.unwrap();
    let center_coords = [
        center_chunk.min[0] / config.chunk_size,
        center_chunk.min[2] / config.chunk_size,
    ];

    if !chunk_range_has_non_empty_voxel(center_chunk, &min, &max, registry) {
        return MeshOutput {
            geometries: vec![],
            connectivity: CONNECTIVITY_FULL,
        };
    }

    let space = VoxelSpace::new(chunks, config.chunk_size, center_coords);

    let geometries = mesh_space_greedy(&min, &max, &space, registry);
    let connectivity = compute_section_connectivity(&min, &max, &space, registry);

    MeshOutput {
        geometries,
        connectivity,
    }
}

pub fn mesh_chunk_with_registry(input: MeshInputNoRegistry, registry: &Registry) -> MeshOutput {
    mesh_chunk_with_registry_chunks(&input.chunks, input.min, input.max, input.config, registry)
}
