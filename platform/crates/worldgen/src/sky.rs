//! The sky: floating islands over an empty void. Turf-topped islands of
//! cloudrock with tapering undersides drift around a main layer, smaller
//! islets float higher up, and flat cloud banks hang above them all.
//! Sunstone veins run through the cloudrock. Falling off an island falls
//! out of the world.
//!
//! Like the other generators, every voxel is a pure function of
//! `(seed, content, chunk coords)` and nothing a chunk writes leaves it.

use noise::{Fbm, NoiseFn, OpenSimplex};
use platform_content::{Content, Dimension};

use crate::{fbm, hash, place_ores, GeneratedChunk, OreSpec, WorldgenError, AIR};

pub struct Sky {
    seed: u32,
    max_height: i32,
    islets: Fbm<OpenSimplex>,
    detail: Fbm<OpenSimplex>,
    clouds: Fbm<OpenSimplex>,
    turf: u32,
    dirt: u32,
    cloudrock: u32,
    cloud: u32,
    ores: Vec<OreSpec>,
    biome: String,
}

/// One island's column: solid from `bottom` to `top` inclusive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Span {
    pub bottom: i32,
    pub top: i32,
}

impl Sky {
    /// Height of the main island layer's tops (each island varies by up
    /// to 12 blocks around it).
    pub const ISLAND_LEVEL: i32 = 96;
    /// Side of the grid cells that each hold one main island, so no point
    /// is far from land.
    pub const CELL: i32 = 40;
    /// Height of the higher islets.
    pub const ISLET_LEVEL: i32 = 150;
    /// Height of the cloud banks.
    pub const CLOUD_LEVEL: i32 = 190;

    pub fn new(content: &Content, seed: u32, max_height: i32) -> Result<Self, WorldgenError> {
        let id = |key: &'static str| {
            content
                .block(key)
                .map(|b| b.id)
                .ok_or(WorldgenError::MissingBlock(key))
        };
        let biome = content
            .biomes_of(Dimension::Sky)
            .first()
            .map(|b| b.key.clone())
            .ok_or(WorldgenError::NoBiomes)?;
        let cloudrock = id("cloudrock")?;
        let s = seed.wrapping_add(0x5C1E_5EED);
        Ok(Self {
            seed: s,
            max_height,
            islets: fbm(s.wrapping_add(2), 2, 1.0 / 40.0),
            detail: fbm(s.wrapping_add(3), 3, 1.0 / 18.0),
            clouds: fbm(s.wrapping_add(4), 2, 1.0 / 60.0),
            turf: id("turf")?,
            dirt: id("dirt")?,
            cloudrock,
            cloud: id("cloud")?,
            ores: crate::ore_specs(content, cloudrock),
            biome,
        })
    }

    pub fn biome_at(&self, _x: i32, _z: i32) -> &str {
        &self.biome
    }

    /// The island spans of a column, lowest first.
    pub fn spans(&self, x: i32, z: i32) -> Vec<Span> {
        let (fx, fz) = (x as f64, z as f64);
        let detail = self.detail.get([fx, fz]);
        let mut spans = Vec::new();
        // Main layer: one island per grid cell, at a jittered centre, with
        // a ragged rim, a gently domed top and an underside hanging deepest
        // at its middle.
        let (gx, gz) = (x.div_euclid(Self::CELL), z.div_euclid(Self::CELL));
        for cx in gx - 1..=gx + 1 {
            for cz in gz - 1..=gz + 1 {
                let h = hash(self.seed, cx as i64, cz as i64, 0x15_1A4D);
                let centre = (
                    (cx * Self::CELL + 8 + (h % 24) as i32) as f64,
                    (cz * Self::CELL + 8 + ((h >> 8) % 24) as i32) as f64,
                );
                let radius = 9.0 + ((h >> 16) % 12) as f64;
                let level = Self::ISLAND_LEVEL - 12 + ((h >> 24) % 25) as i32;
                let d = ((fx - centre.0).powi(2) + (fz - centre.1).powi(2)).sqrt() + detail * 4.0;
                if d >= radius {
                    continue;
                }
                let t = 1.0 - d / radius;
                let top = level + (t * 3.0).round() as i32;
                let depth = 2 + (t.sqrt() * radius * 1.3 * (0.8 + 0.2 * detail)).round() as i32;
                spans.push(Span {
                    bottom: top - depth,
                    top,
                });
            }
        }
        // Islets: small, thin and higher.
        let n = self.islets.get([fx + 4000.0, fz - 4000.0]);
        if n > 0.42 {
            let strength = ((n - 0.42) / 0.2).min(1.0);
            let top = Self::ISLET_LEVEL + (detail * 4.0).round() as i32;
            let depth = (1.0 + strength * 8.0).round() as i32;
            spans.push(Span {
                bottom: top - depth,
                top,
            });
        }
        spans
    }

    /// Whether a cloud bank fills this cell.
    pub fn is_cloud(&self, x: i32, y: i32, z: i32) -> bool {
        (Self::CLOUD_LEVEL..Self::CLOUD_LEVEL + 3).contains(&y)
            && self.clouds.get([x as f64, z as f64]) > 0.22
    }

    pub fn generate_chunk(&self, cx: i32, cz: i32, size: usize) -> GeneratedChunk {
        let height = self.max_height as usize;
        let mut chunk = GeneratedChunk {
            cx,
            cz,
            size,
            height,
            voxels: vec![AIR; size * size * height],
            biomes: vec![0; size * size],
            heights: vec![0; size * size],
        };
        let (base_x, base_z) = (cx * size as i32, cz * size as i32);
        let limit = self.max_height - 1;
        for lx in 0..size {
            for lz in 0..size {
                let (x, z) = (base_x + lx as i32, base_z + lz as i32);
                let mut highest = 0;
                for span in self.spans(x, z) {
                    for y in span.bottom.max(1)..=span.top.min(limit) {
                        let id = match span.top - y {
                            0 => self.turf,
                            1..=2 => self.dirt,
                            _ => self.cloudrock,
                        };
                        chunk.set(lx, y as usize, lz, id);
                    }
                    highest = highest.max(span.top.min(limit));
                }
                for y in Self::CLOUD_LEVEL..(Self::CLOUD_LEVEL + 3).min(limit) {
                    if self.is_cloud(x, y, z) {
                        chunk.set(lx, y as usize, lz, self.cloud);
                    }
                }
                chunk.heights[lx * size + lz] = highest;
            }
        }
        place_ores(&self.ores, self.seed, limit, &mut chunk);
        chunk
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sky() -> (Content, Sky) {
        let content = Content::load(platform_content::default_pack_dir()).unwrap();
        let s = Sky::new(&content, 20260101, 256).unwrap();
        (content, s)
    }

    #[test]
    fn islands_float_over_a_void() {
        let (content, s) = sky();
        let id = |k: &str| content.block(k).unwrap().id;
        let (turf, rock, cloud) = (id("turf"), id("cloudrock"), id("cloud"));
        let (mut columns, mut island_columns, mut turf_tops, mut rock_cells, mut clouds) =
            (0, 0, 0, 0, 0);
        for (cx, cz) in [(0, 0), (3, -2), (-5, 4), (8, 8), (-9, -7), (12, 1)] {
            let c = s.generate_chunk(cx, cz, 16);
            assert_eq!(c, s.generate_chunk(cx, cz, 16), "deterministic");
            for x in 0..16 {
                for z in 0..16 {
                    columns += 1;
                    // The void: nothing at the bottom of the world.
                    assert!((0..40).all(|y| c.get(x, y, z) == AIR));
                    let top = c.heights[x * 16 + z] as usize;
                    if top > 0 {
                        island_columns += 1;
                        turf_tops += (c.get(x, top, z) == turf) as usize;
                        assert_eq!(c.get(x, top + 1, z), AIR, "open sky above an island");
                    }
                    rock_cells += (0..256).filter(|&y| c.get(x, y, z) == rock).count();
                    clouds += (0..256).filter(|&y| c.get(x, y, z) == cloud).count();
                }
            }
        }
        let share = island_columns as f64 / columns as f64;
        assert!((0.1..0.75).contains(&share), "island share {share}");
        assert!(turf_tops * 10 >= island_columns * 9, "turf on top");
        assert!(rock_cells > 1000, "cloudrock bodies: {rock_cells}");
        assert!(clouds > 50, "cloud banks: {clouds}");
    }

    #[test]
    fn sunstone_runs_through_cloudrock() {
        let (content, s) = sky();
        let sun = content.block("sunstone_ore").unwrap().id;
        let mut found = 0;
        for cx in -4..4 {
            for cz in -4..4 {
                let c = s.generate_chunk(cx, cz, 16);
                found += c.voxels.iter().filter(|&&v| v == sun).count();
            }
        }
        assert!(found > 20, "sunstone cells: {found}");
    }
}
