use crate::{Chunks, Registry, VoxelAccess};

#[inline]
pub(crate) fn update_chunk_column_height_for_voxel_update(
    chunks: &mut Chunks,
    registry: &Registry,
    vx: i32,
    vy: i32,
    vz: i32,
    updated_id: u32,
) {
    if !chunks.contains(vx, vy, vz) {
        return;
    }
    let height = chunks.get_max_height(vx, vz);
    if registry.is_air(updated_id) {
        if let Ok(vy_u32) = u32::try_from(vy) {
            if vy_u32 == height {
                for y in (0..vy).rev() {
                    if y == 0 || registry.check_height(chunks.get_voxel(vx, y, vz)) {
                        chunks.set_max_height(vx, vz, y as u32);
                        break;
                    }
                }
            }
        }
    } else if let Ok(vy_u32) = u32::try_from(vy) {
        if height < vy_u32 {
            chunks.set_max_height(vx, vz, vy_u32);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::update_chunk_column_height_for_voxel_update;
    use crate::{Block, Chunk, ChunkOptions, Chunks, Registry, VoxelAccess, WorldConfig};

    fn create_chunk_registry() -> Registry {
        let mut registry = Registry::new();
        registry.register_block(&Block::new("stone").id(1).build());
        registry
    }

    #[test]
    fn update_chunk_column_height_for_voxel_update_scans_from_previous_level() {
        let registry = create_chunk_registry();
        let config = WorldConfig {
            chunk_size: 16,
            max_height: 16,
            max_light_level: 15,
            min_chunk: [0, 0],
            max_chunk: [0, 0],
            saving: false,
            ..Default::default()
        };
        let mut chunks = Chunks::new(&config);
        chunks.add(Chunk::new(
            "chunk-0-0",
            0,
            0,
            &ChunkOptions {
                size: 16,
                max_height: 16,
                sub_chunks: 1,
            },
        ));

        chunks.set_raw_voxel(0, 4, 0, 1);
        chunks.set_raw_voxel(0, 5, 0, 1);
        chunks.set_max_height(0, 0, 5);

        chunks.set_raw_voxel(0, 5, 0, 0);
        update_chunk_column_height_for_voxel_update(&mut chunks, &registry, 0, 5, 0, 0);

        assert_eq!(chunks.get_max_height(0, 0), 4);
    }

    #[test]
    fn update_chunk_column_height_for_voxel_update_ignores_negative_y_for_non_air() {
        let registry = create_chunk_registry();
        let config = WorldConfig {
            chunk_size: 16,
            max_height: 16,
            max_light_level: 15,
            min_chunk: [0, 0],
            max_chunk: [0, 0],
            saving: false,
            ..Default::default()
        };
        let mut chunks = Chunks::new(&config);
        chunks.add(Chunk::new(
            "chunk-0-0",
            0,
            0,
            &ChunkOptions {
                size: 16,
                max_height: 16,
                sub_chunks: 1,
            },
        ));
        chunks.set_max_height(0, 0, 3);

        update_chunk_column_height_for_voxel_update(&mut chunks, &registry, 0, -1, 0, 1);

        assert_eq!(chunks.get_max_height(0, 0), 3);
    }

    #[test]
    fn update_chunk_column_height_for_voxel_update_ignores_coords_outside_chunk_shape() {
        let registry = create_chunk_registry();
        let config = WorldConfig {
            chunk_size: 16,
            max_height: 16,
            max_light_level: 15,
            min_chunk: [0, 0],
            max_chunk: [0, 0],
            saving: false,
            ..Default::default()
        };
        let mut chunks = Chunks::new(&config);
        chunks.add(Chunk::new(
            "chunk-0-0",
            0,
            0,
            &ChunkOptions {
                size: 8,
                max_height: 8,
                sub_chunks: 1,
            },
        ));
        chunks.set_max_height(0, 0, 3);

        update_chunk_column_height_for_voxel_update(&mut chunks, &registry, 12, 4, 0, 1);

        assert_eq!(chunks.get_max_height(0, 0), 3);
    }
}
