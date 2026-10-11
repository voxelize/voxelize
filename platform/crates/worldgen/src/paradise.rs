//! Paradise: soft, luminous meadows of radiant turf over golden loam and
//! pearlstone, crossed by slow rivers of honey and of wine. Light trees
//! bearing golden fruit and halo blooms grow everywhere, pearl shrines with
//! lanterns stand on the hills, and the pearlstone is thick with diamonds.
//! Everything glows; there are no caves and no dark.
//!
//! Like the other generators, every voxel is a pure function of
//! `(seed, content, chunk coords)` and nothing a chunk writes leaves it.

use noise::{Fbm, NoiseFn, OpenSimplex};
use platform_content::{Content, Dimension};

use crate::{fbm, hash, place_ores, unit, GeneratedChunk, OreSpec, WorldgenError, AIR};

pub struct Paradise {
    seed: u32,
    max_height: i32,
    hills: Fbm<OpenSimplex>,
    detail: Fbm<OpenSimplex>,
    river: Fbm<OpenSimplex>,
    flavour: Fbm<OpenSimplex>,
    blocks: Blocks,
    ores: Vec<OreSpec>,
    biome: String,
}

struct Blocks {
    turf: u32,
    loam: u32,
    pearl: u32,
    bedrock: u32,
    honey: u32,
    wine: u32,
    log: u32,
    leaves: u32,
    bloom: u32,
    lantern: u32,
    diamond_block: u32,
}

/// What a river carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum River {
    Honey,
    Wine,
}

impl Paradise {
    /// Surface of the rivers; the land always stands above it.
    pub const RIVER_LEVEL: i32 = 70;
    /// Lowest ground away from rivers.
    pub const GROUND: i32 = 73;
    /// Side of the grid cells that each may hold one shrine.
    pub const SHRINE_CELL: i32 = 48;
    /// How close to a river centre counts as river (noise units).
    const RIVER_WIDTH: f64 = 0.045;
    /// The banks slope down over this much more noise.
    const BANK: f64 = 0.06;

    pub fn new(content: &Content, seed: u32, max_height: i32) -> Result<Self, WorldgenError> {
        let id = |key: &'static str| {
            content
                .block(key)
                .map(|b| b.id)
                .ok_or(WorldgenError::MissingBlock(key))
        };
        let biome = content
            .biomes_of(Dimension::Paradise)
            .first()
            .map(|b| b.key.clone())
            .ok_or(WorldgenError::NoBiomes)?;
        let pearl = id("pearlstone")?;
        let s = seed.wrapping_add(0x0EDE_7A11);
        Ok(Self {
            seed: s,
            max_height,
            hills: fbm(s.wrapping_add(1), 3, 1.0 / 220.0),
            detail: fbm(s.wrapping_add(2), 3, 1.0 / 40.0),
            river: fbm(s.wrapping_add(3), 2, 1.0 / 520.0),
            flavour: fbm(s.wrapping_add(4), 1, 1.0 / 900.0),
            blocks: Blocks {
                turf: id("radiant_turf")?,
                loam: id("golden_loam")?,
                pearl,
                bedrock: id("bedrock")?,
                honey: id("honey")?,
                wine: id("wine")?,
                log: id("light_log")?,
                leaves: id("light_leaves")?,
                bloom: id("halo_bloom")?,
                lantern: id("wisp_lantern")?,
                diamond_block: id("diamond_block")?,
            },
            ores: crate::ore_specs(content, pearl),
            biome,
        })
    }

    pub fn biome_at(&self, _x: i32, _z: i32) -> &str {
        &self.biome
    }

    /// How far a column is from the nearest river centre, in noise units
    /// (0 at the centre).
    fn river_distance(&self, x: i32, z: i32) -> f64 {
        self.river.get([x as f64, z as f64]).abs()
    }

    /// The river at a column, if one flows there.
    pub fn river_at(&self, x: i32, z: i32) -> Option<River> {
        if self.river_distance(x, z) >= Self::RIVER_WIDTH {
            return None;
        }
        // Each river carries one thing along its length: the flavour field
        // changes far more slowly than rivers bend.
        Some(if self.flavour.get([x as f64, z as f64]) >= 0.0 {
            River::Honey
        } else {
            River::Wine
        })
    }

    /// Height of the ground (the top solid block) of a column.
    pub fn ground(&self, x: i32, z: i32) -> i32 {
        let (fx, fz) = (x as f64, z as f64);
        let hills = (self.hills.get([fx, fz]) + 1.0) * 0.5; // 0..1
        let land = Self::GROUND as f64 + hills * 22.0 + self.detail.get([fx, fz]) * 3.0;
        let d = self.river_distance(x, z);
        if d < Self::RIVER_WIDTH {
            // The bed: three below the river surface, deepest mid-stream.
            let depth = 2.0 + (1.0 - d / Self::RIVER_WIDTH) * 2.0;
            return (Self::RIVER_LEVEL as f64 - depth).round() as i32;
        }
        if d < Self::RIVER_WIDTH + Self::BANK {
            // Banks rise smoothly from the river to the meadow.
            let t = (d - Self::RIVER_WIDTH) / Self::BANK;
            let bank = Self::RIVER_LEVEL as f64 + 1.0;
            return (bank + (land - bank) * t * t * (3.0 - 2.0 * t)).round() as i32;
        }
        land.round() as i32
    }

    /// A shrine's centre in a grid cell, if the cell has one.
    fn shrine_in(&self, gx: i32, gz: i32) -> Option<(i32, i32)> {
        let h = hash(self.seed, gx as i64, gz as i64, 0x5A_1A7E);
        if h % 3 != 0 {
            return None;
        }
        let x = gx * Self::SHRINE_CELL + 8 + ((h >> 8) % 32) as i32;
        let z = gz * Self::SHRINE_CELL + 8 + ((h >> 16) % 32) as i32;
        Some((x, z))
    }

    /// Whether a light tree grows from this column.
    fn tree_at(&self, x: i32, z: i32) -> Option<i32> {
        let h = hash(self.seed, x as i64, z as i64, 0x7_EE5);
        // About one column in 55, on dry meadow only.
        if h % 55 != 0 || self.river_distance(x, z) < Self::RIVER_WIDTH + Self::BANK * 0.5 {
            return None;
        }
        Some(5 + ((h >> 8) % 3) as i32)
    }

    pub fn generate_chunk(&self, cx: i32, cz: i32, size: usize) -> GeneratedChunk {
        let height = self.max_height as usize;
        let b = &self.blocks;
        let mut chunk = GeneratedChunk {
            cx,
            cz,
            size,
            height,
            voxels: vec![AIR; size * size * height],
            biomes: vec![0; size * size],
            heights: vec![0; size * size],
            tints: None,
        };
        let s = size as i32;
        let (base_x, base_z) = (cx * s, cz * s);
        let limit = self.max_height - 1;
        let put = |chunk: &mut GeneratedChunk, x: i32, y: i32, z: i32, id: u32| {
            let (lx, lz) = (x - base_x, z - base_z);
            if (0..s).contains(&lx) && (0..s).contains(&lz) && (1..limit).contains(&y) {
                chunk.set(lx as usize, y as usize, lz as usize, id);
            }
        };

        // Ground, rivers and flowers.
        for lx in 0..size {
            for lz in 0..size {
                let (x, z) = (base_x + lx as i32, base_z + lz as i32);
                let top = self.ground(x, z).min(limit - 1);
                let river = self.river_at(x, z);
                for y in 0..=top {
                    let id = if y == 0 {
                        b.bedrock
                    } else if y == top && river.is_none() && top > Self::RIVER_LEVEL {
                        b.turf
                    } else if y + 3 >= top {
                        b.loam
                    } else {
                        b.pearl
                    };
                    chunk.set(lx, y as usize, lz, id);
                }
                if let Some(kind) = river {
                    let fluid = match kind {
                        River::Honey => b.honey,
                        River::Wine => b.wine,
                    };
                    for y in top + 1..=Self::RIVER_LEVEL {
                        chunk.set(lx, y as usize, lz, fluid);
                    }
                } else if top > Self::RIVER_LEVEL
                    && unit(hash(self.seed, x as i64, z as i64, 0xB1_00)) < 0.09
                {
                    chunk.set(lx, (top + 1) as usize, lz, b.bloom);
                }
                chunk.heights[lx * size + lz] = top;
            }
        }

        // Light trees, including those rooted just outside the chunk whose
        // crowns reach in.
        for x in base_x - 3..base_x + s + 3 {
            for z in base_z - 3..base_z + s + 3 {
                let Some(trunk) = self.tree_at(x, z) else {
                    continue;
                };
                let ground = self.ground(x, z);
                if ground <= Self::RIVER_LEVEL {
                    continue;
                }
                for y in ground + 1..=ground + trunk {
                    put(&mut chunk, x, y, z, b.log);
                }
                let crown = ground + trunk;
                for dx in -2i32..=2 {
                    for dz in -2i32..=2 {
                        for dy in -1i32..=2 {
                            let r = dx * dx + dz * dz + dy * dy;
                            if r > 6 || (dx == 0 && dz == 0 && dy <= 0) {
                                continue;
                            }
                            let (px, py, pz) = (x + dx, crown + dy, z + dz);
                            let (lx, lz) = (px - base_x, pz - base_z);
                            if (0..s).contains(&lx)
                                && (0..s).contains(&lz)
                                && (1..limit).contains(&py)
                                && chunk.get(lx as usize, py as usize, lz as usize) == AIR
                            {
                                chunk.set(lx as usize, py as usize, lz as usize, b.leaves);
                            }
                        }
                    }
                }
            }
        }

        // Shrines: a pearl platform, four pillars with lanterns and a
        // diamond heart, on the hills between rivers.
        let (g0x, g0z) = (
            (base_x - 4).div_euclid(Self::SHRINE_CELL),
            (base_z - 4).div_euclid(Self::SHRINE_CELL),
        );
        let (g1x, g1z) = (
            (base_x + s + 4).div_euclid(Self::SHRINE_CELL),
            (base_z + s + 4).div_euclid(Self::SHRINE_CELL),
        );
        for gx in g0x..=g1x {
            for gz in g0z..=g1z {
                let Some((sx, sz)) = self.shrine_in(gx, gz) else {
                    continue;
                };
                if (-3..=3)
                    .any(|d| self.river_distance(sx + d, sz) < Self::RIVER_WIDTH + Self::BANK)
                {
                    continue;
                }
                let floor = self.ground(sx, sz) + 1;
                for dx in -3..=3 {
                    for dz in -3..=3 {
                        // A level platform, filled down to the ground.
                        let ground = self.ground(sx + dx, sz + dz);
                        for y in ground.min(floor)..=floor {
                            put(&mut chunk, sx + dx, y, sz + dz, b.pearl);
                        }
                        for y in floor + 1..floor + 7 {
                            put(&mut chunk, sx + dx, y, sz + dz, AIR);
                        }
                    }
                }
                for (dx, dz) in [(-3, -3), (3, -3), (-3, 3), (3, 3)] {
                    for y in floor + 1..floor + 5 {
                        put(&mut chunk, sx + dx, y, sz + dz, b.pearl);
                    }
                    put(&mut chunk, sx + dx, floor + 5, sz + dz, b.lantern);
                }
                put(&mut chunk, sx, floor + 1, sz, b.diamond_block);
            }
        }

        place_ores(&self.ores, self.seed, limit, &mut chunk);
        chunk
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paradise() -> (Content, Paradise) {
        let content = Content::load(platform_content::default_pack_dir()).unwrap();
        let p = Paradise::new(&content, 20260101, 256).unwrap();
        (content, p)
    }

    #[test]
    fn meadows_glow_and_rivers_run_with_honey_and_wine() {
        let (content, p) = paradise();
        let id = |k: &str| content.block(k).unwrap().id;
        let (turf, honey, wine, leaves, bloom, diamond) = (
            id("radiant_turf"),
            id("honey"),
            id("wine"),
            id("light_leaves"),
            id("halo_bloom"),
            id("diamond_ore"),
        );
        let (mut honey_cells, mut wine_cells, mut turf_tops, mut columns) = (0, 0, 0, 0);
        let (mut leaf_cells, mut blooms, mut diamonds) = (0, 0, 0);
        for cx in (-40..40).step_by(4) {
            for cz in (-40..40).step_by(4) {
                let c = p.generate_chunk(cx, cz, 16);
                for x in 0..16 {
                    for z in 0..16 {
                        columns += 1;
                        let top = c.heights[x * 16 + z] as usize;
                        turf_tops += (c.get(x, top, z) == turf) as usize;
                        for y in 1..200 {
                            let v = c.get(x, y, z);
                            honey_cells += (v == honey) as usize;
                            wine_cells += (v == wine) as usize;
                            leaf_cells += (v == leaves) as usize;
                            blooms += (v == bloom) as usize;
                            diamonds += (v == diamond) as usize;
                            if v == honey || v == wine {
                                assert!(
                                    y <= Paradise::RIVER_LEVEL as usize,
                                    "rivers stay in their beds"
                                );
                            }
                        }
                    }
                }
            }
        }
        assert!(
            turf_tops * 10 > columns * 7,
            "mostly radiant meadow: {turf_tops}/{columns}"
        );
        assert!(honey_cells > 100, "rivers of honey: {honey_cells}");
        assert!(wine_cells > 100, "rivers of wine: {wine_cells}");
        assert!(leaf_cells > 1000, "light trees: {leaf_cells}");
        assert!(blooms > 1000, "halo blooms: {blooms}");
        // Abundance: far more diamonds than anywhere else.
        assert!(diamonds > 400 * 4, "diamonds: {diamonds}");
    }

    #[test]
    fn deterministic_with_no_caves_and_no_dark() {
        let (_, p) = paradise();
        let a = p.generate_chunk(3, -7, 16);
        assert_eq!(a, p.generate_chunk(3, -7, 16));
        for x in 0..16 {
            for z in 0..16 {
                let top = a.heights[x * 16 + z] as usize;
                assert!(
                    (1..top).all(|y| a.get(x, y, z) != AIR),
                    "solid ground, no caves"
                );
            }
        }
    }

    #[test]
    fn rivers_are_one_flavour_along_their_length() {
        let (_, p) = paradise();
        // Walk along x and count flavour changes between river columns
        // close together: a river does not flip between honey and wine.
        let mut flips = 0;
        let mut last: Option<(i32, River)> = None;
        for x in -2000..2000 {
            if let Some(kind) = p.river_at(x, 37) {
                if let Some((lx, lk)) = last {
                    if x - lx < 4 && lk != kind {
                        flips += 1;
                    }
                }
                last = Some((x, kind));
            }
        }
        assert!(flips <= 1, "flavour flips inside a river: {flips}");
    }
}
