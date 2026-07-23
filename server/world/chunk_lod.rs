//! Opt-in level-of-detail (LOD) chunk meshing for distant terrain.
//!
//! When a world enables [`ChunkLodConfig`], the server builds a small pyramid
//! of reduced-detail meshes for every chunk alongside its normal meshing work
//! (see `crates/mesher/src/lod.rs` for the meshing and seam strategy).
//! Clients then request distant chunks *as LOD meshes only* — a few kilobytes
//! of geometry instead of full voxel + light data — extending the visible
//! horizon to `render_radius * 2^max_level` chunks while triangle count grows
//! only linearly with `max_level`.
//!
//! Everything is opt-in: with the default `None`, no pyramid is built, no LOD
//! requests are honored, and no wire traffic changes.

use serde::{Deserialize, Serialize};

/// Configuration for LOD chunk meshing. Enable through
/// [`WorldConfigBuilder::chunk_lod`](super::WorldConfigBuilder::chunk_lod).
///
/// Detail levels halve linear resolution per step: level `L` collapses
/// `2^L`-sized voxel cells into single cubes. Clients map distance to level
/// geometrically — full detail up to their render radius `R`, level `L` for
/// distances in `(R * 2^(L-1), R * 2^L]` — so each ring roughly doubles the
/// view distance for a near-constant triangle budget.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkLodConfig {
    /// Highest LOD level to build and serve, in `1..=4`. The mesh pyramid
    /// holds levels `1..=max_level`; level `L` downsamples by `2^L` (level 4
    /// collapses a whole 16-block chunk column slice into single cells).
    pub max_level: u32,
}

impl Default for ChunkLodConfig {
    fn default() -> Self {
        Self { max_level: 2 }
    }
}

impl ChunkLodConfig {
    /// Validate against the world's chunk dimensions. Every level's
    /// downsample factor must divide both the chunk size and the max height
    /// so coarse grids align exactly with chunk borders — the seam guarantees
    /// depend on that alignment.
    pub fn validate(&self, chunk_size: usize, max_height: usize) -> Result<(), String> {
        if self.max_level < 1 || self.max_level > 4 {
            return Err(format!(
                "max_level must be in 1..=4, got {}",
                self.max_level
            ));
        }

        let factor = 1usize << self.max_level;
        if chunk_size % factor != 0 {
            return Err(format!(
                "chunk_size {} must be divisible by 2^max_level = {}",
                chunk_size, factor
            ));
        }
        if max_height % factor != 0 {
            return Err(format!(
                "max_height {} must be divisible by 2^max_level = {}",
                max_height, factor
            ));
        }

        Ok(())
    }

    /// The LOD levels this config builds, lowest (finest) first.
    pub fn levels(&self) -> impl Iterator<Item = u32> {
        1..=self.max_level
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_two_levels() {
        assert_eq!(ChunkLodConfig::default().max_level, 2);
    }

    #[test]
    fn validates_divisibility() {
        let config = ChunkLodConfig { max_level: 4 };
        assert!(config.validate(16, 256).is_ok());
        assert!(config.validate(12, 256).is_err());
        assert!(config.validate(16, 100).is_err());
    }

    #[test]
    fn rejects_out_of_range_levels() {
        assert!(ChunkLodConfig { max_level: 0 }.validate(16, 256).is_err());
        assert!(ChunkLodConfig { max_level: 5 }.validate(16, 256).is_err());
    }

    #[test]
    fn levels_iterates_finest_first() {
        let config = ChunkLodConfig { max_level: 3 };
        assert_eq!(config.levels().collect::<Vec<_>>(), vec![1, 2, 3]);
    }
}
