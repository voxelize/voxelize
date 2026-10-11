//! The Ocean: an endless sea with no shore. The water stands at
//! [`Ocean::SURFACE`] everywhere, far above a seafloor of sand and stone that
//! sinks into abyssal trenches and rises into seamounts that never break the
//! surface. Coral reefs in three colours, kelp forests reaching for the
//! light, sea grass, glow anemones in the dark deep, giant clams holding
//! pearls and bubble vents breathing air up through the water cover the
//! floor. In every [`Ocean::DOME_CELL`] square stands one glass air dome: a
//! dry hall on a tidestone floor, lit by pearl, where travellers arrive.
//!
//! Plants that grow in water (kelp, sea grass, anemones) are written
//! waterlogged ([`WATERLOGGED`]), so the water stays around them.
//!
//! Like the other generators, every voxel is a pure function of
//! `(seed, content, chunk coords)` and nothing a chunk writes leaves it.

use noise::{Fbm, NoiseFn, OpenSimplex};
use platform_content::{Content, Dimension};

use crate::{fbm, hash, place_ores, unit, GeneratedChunk, OreSpec, WorldgenError, AIR};

/// Bit 28 of a voxel: the cell holds water as well as its block (the
/// engine's waterlogged bit).
pub const WATERLOGGED: u32 = 1 << 28;

pub struct Ocean {
    seed: u32,
    max_height: i32,
    basin: Fbm<OpenSimplex>,
    detail: Fbm<OpenSimplex>,
    trench: Fbm<OpenSimplex>,
    mounts: Fbm<OpenSimplex>,
    reef: Fbm<OpenSimplex>,
    kelp: Fbm<OpenSimplex>,
    blocks: Blocks,
    ores: Vec<OreSpec>,
    biome: String,
}

struct Blocks {
    bedrock: u32,
    stone: u32,
    sand: u32,
    gravel: u32,
    water: u32,
    glass: u32,
    abyssal: u32,
    tidestone: u32,
    corals: [u32; 3],
    kelp: u32,
    sea_grass: u32,
    anemone: u32,
    clam: u32,
    vent: u32,
    pearl: u32,
}

/// One cell of a column above the floor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Growth {
    Coral,
    Kelp,
    SeaGrass,
    Anemone,
    Clam,
    Vent,
}

impl Ocean {
    /// The water's surface: everything below it is sea.
    pub const SURFACE: i32 = 120;
    /// The usual depth of the seafloor.
    pub const FLOOR: i32 = 60;
    /// Floors below this are the abyss: dark rock and glowing anemones.
    pub const DEEP: i32 = 44;
    /// Side of the grid cells that each hold one air dome.
    pub const DOME_CELL: i32 = 64;
    /// Inner radius of a dome (its air); the glass is a block and a half
    /// thick around it.
    pub const DOME_RADIUS: i32 = 6;
    /// Dome floors stay between these heights.
    const DOME_LOWEST: i32 = 20;
    const DOME_HIGHEST: i32 = Self::SURFACE - 16;

    pub fn new(content: &Content, seed: u32, max_height: i32) -> Result<Self, WorldgenError> {
        let id = |key: &'static str| {
            content
                .block(key)
                .map(|b| b.id)
                .ok_or(WorldgenError::MissingBlock(key))
        };
        let biome = content
            .biomes_of(Dimension::Ocean)
            .first()
            .map(|b| b.key.clone())
            .ok_or(WorldgenError::NoBiomes)?;
        let stone = id("stone")?;
        let s = Self::salted(seed);
        Ok(Self {
            seed: s,
            max_height,
            basin: fbm(s.wrapping_add(1), 3, 1.0 / 260.0),
            detail: fbm(s.wrapping_add(2), 3, 1.0 / 30.0),
            trench: fbm(s.wrapping_add(3), 2, 1.0 / 420.0),
            mounts: fbm(s.wrapping_add(4), 2, 1.0 / 160.0),
            reef: fbm(s.wrapping_add(5), 2, 1.0 / 90.0),
            kelp: fbm(s.wrapping_add(6), 2, 1.0 / 70.0),
            blocks: Blocks {
                bedrock: id("bedrock")?,
                stone,
                sand: id("sand")?,
                gravel: id("gravel")?,
                water: id("water")?,
                glass: id("glass")?,
                abyssal: id("abyssal_rock")?,
                tidestone: id("tidestone")?,
                corals: [id("coral_red")?, id("coral_blue")?, id("coral_gold")?],
                kelp: id("kelp")?,
                sea_grass: id("sea_grass")?,
                anemone: id("glow_anemone")?,
                clam: id("giant_clam")?,
                vent: id("bubble_vent")?,
                pearl: id("pearl_block")?,
            },
            ores: crate::ore_specs(content, stone),
            biome,
        })
    }

    fn salted(seed: u32) -> u32 {
        seed.wrapping_add(0x0CEA_0D11)
    }

    pub fn biome_at(&self, _x: i32, _z: i32) -> &str {
        &self.biome
    }

    /// Height of the seafloor (the top solid block of a column, before
    /// anything grows on it).
    pub fn floor(&self, x: i32, z: i32) -> i32 {
        let (fx, fz) = (x as f64, z as f64);
        let mut y =
            Self::FLOOR as f64 + self.basin.get([fx, fz]) * 14.0 + self.detail.get([fx, fz]) * 3.0;
        // Trenches: narrow canyons along the zero line of a slow field.
        let t = self.trench.get([fx, fz]).abs();
        if t < 0.05 {
            let k = 1.0 - t / 0.05;
            y -= (y - 24.0) * k * k * (3.0 - 2.0 * k);
        }
        // Seamounts rise from the floor towards the light.
        let m = self.mounts.get([fx, fz]);
        if m > 0.15 {
            let k = ((m - 0.15) / 0.25).min(1.0);
            y += k * k * 55.0;
        }
        (y.round() as i32).clamp(6, Self::SURFACE - 4)
    }

    /// What grows on the floor of a column, and how tall.
    pub fn growth_at(&self, x: i32, z: i32, floor: i32) -> Option<(Growth, i32)> {
        let h = hash(self.seed, x as i64, z as i64, 0xDEC0);
        let r = unit(h);
        let water_above = Self::SURFACE - floor;
        if floor < Self::DEEP {
            // The abyss: anemones light the dark, vents breathe.
            return if r < 0.06 {
                Some((Growth::Anemone, 1))
            } else if r < 0.068 {
                Some((Growth::Vent, 0))
            } else {
                None
            };
        }
        let (fx, fz) = (x as f64, z as f64);
        if self.reef.get([fx, fz]) > 0.1 && floor > 62 {
            // A reef: coral stacks, with anemones between.
            return if r < 0.5 {
                Some((Growth::Coral, 1 + ((h >> 12) % 3) as i32))
            } else if r < 0.56 {
                Some((Growth::Anemone, 1))
            } else if r < 0.6 {
                Some((Growth::SeaGrass, 1))
            } else {
                None
            };
        }
        if self.kelp.get([fx, fz]) > 0.2 && water_above > 6 {
            // A kelp forest: tall stalks reaching most of the way up.
            if r < 0.35 {
                let reach = (water_above - 3) as f64 * (0.35 + 0.6 * unit(h >> 7));
                return Some((Growth::Kelp, (reach as i32).clamp(2, 40)));
            }
            return (r < 0.55).then_some((Growth::SeaGrass, 1));
        }
        if r < 0.12 {
            Some((Growth::SeaGrass, 1))
        } else if r < 0.126 {
            Some((Growth::Clam, 1))
        } else if r < 0.13 {
            Some((Growth::Vent, 0))
        } else if r < 0.136 {
            Some((Growth::Anemone, 1))
        } else {
            None
        }
    }

    /// The centre column of the dome in a grid cell (every cell has one).
    pub fn dome_in(&self, gx: i32, gz: i32) -> (i32, i32) {
        Self::dome_in_cell(self.seed, gx, gz)
    }

    fn dome_in_cell(salted: u32, gx: i32, gz: i32) -> (i32, i32) {
        let h = hash(salted, gx as i64, gz as i64, 0xD0_3E);
        let span = (Self::DOME_CELL - 24) as u64;
        (
            gx * Self::DOME_CELL + 12 + (h % span) as i32,
            gz * Self::DOME_CELL + 12 + ((h >> 16) % span) as i32,
        )
    }

    /// The dome nearest to `(x, z)` for a world seed: where travellers
    /// arriving there land. Needs only the seed, not the generator.
    pub fn nearest_dome(seed: u32, x: i32, z: i32) -> (i32, i32) {
        let salted = Self::salted(seed);
        let (gx, gz) = (x.div_euclid(Self::DOME_CELL), z.div_euclid(Self::DOME_CELL));
        let mut best = (0, 0);
        let mut best_d = i64::MAX;
        for dx in -1..=1 {
            for dz in -1..=1 {
                let (cx, cz) = Self::dome_in_cell(salted, gx + dx, gz + dz);
                let d = ((cx - x) as i64).pow(2) + ((cz - z) as i64).pow(2);
                if d < best_d {
                    best = (cx, cz);
                    best_d = d;
                }
            }
        }
        best
    }

    /// The height of a dome's floor (its tidestone) at centre `(x, z)`.
    pub fn dome_floor(&self, x: i32, z: i32) -> i32 {
        (self.floor(x, z) + 1).clamp(Self::DOME_LOWEST, Self::DOME_HIGHEST)
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
        let surface = Self::SURFACE.min(limit - 1);

        // Floor, sea and what grows on the floor.
        for lx in 0..size {
            for lz in 0..size {
                let (x, z) = (base_x + lx as i32, base_z + lz as i32);
                let top = self.floor(x, z).min(surface - 2);
                let deep = top < Self::DEEP;
                let gravelly = self.reef.get([x as f64 * 1.7, z as f64 * 1.7]) < -0.45;
                for y in 0..=top {
                    let id = if y == 0 {
                        b.bedrock
                    } else if deep && y + 4 >= top {
                        b.abyssal
                    } else if y + 3 >= top {
                        if gravelly {
                            b.gravel
                        } else {
                            b.sand
                        }
                    } else {
                        b.stone
                    };
                    chunk.set(lx, y as usize, lz, id);
                }
                for y in top + 1..=surface {
                    chunk.set(lx, y as usize, lz, b.water);
                }
                let mut solid_top = top;
                if let Some((growth, tall)) = self.growth_at(x, z, top) {
                    let wet = |id: u32| id | WATERLOGGED;
                    match growth {
                        Growth::Coral => {
                            let kind = hash(self.seed, (x >> 1) as i64, (z >> 1) as i64, 0xC0) % 3;
                            for y in top + 1..=top + tall {
                                chunk.set(lx, y as usize, lz, b.corals[kind as usize]);
                            }
                            solid_top = top + tall;
                        }
                        Growth::Kelp => {
                            for y in top + 1..=(top + tall).min(surface - 1) {
                                chunk.set(lx, y as usize, lz, wet(b.kelp));
                            }
                        }
                        Growth::SeaGrass => chunk.set(lx, (top + 1) as usize, lz, wet(b.sea_grass)),
                        Growth::Anemone => chunk.set(lx, (top + 1) as usize, lz, wet(b.anemone)),
                        Growth::Clam => {
                            chunk.set(lx, (top + 1) as usize, lz, b.clam);
                            solid_top = top + 1;
                        }
                        Growth::Vent => chunk.set(lx, top as usize, lz, b.vent),
                    }
                }
                chunk.heights[lx * size + lz] = solid_top;
            }
        }

        place_ores(&self.ores, self.seed, limit, &mut chunk);

        // Air domes, including those centred in neighbouring chunks whose
        // glass reaches in.
        let put = |chunk: &mut GeneratedChunk, x: i32, y: i32, z: i32, id: u32| {
            let (lx, lz) = (x - base_x, z - base_z);
            if (0..s).contains(&lx) && (0..s).contains(&lz) && (1..limit).contains(&y) {
                chunk.set(lx as usize, y as usize, lz as usize, id);
            }
        };
        let reach = Self::DOME_RADIUS + 2;
        let (g0x, g0z) = (
            (base_x - reach).div_euclid(Self::DOME_CELL),
            (base_z - reach).div_euclid(Self::DOME_CELL),
        );
        let (g1x, g1z) = (
            (base_x + s + reach).div_euclid(Self::DOME_CELL),
            (base_z + s + reach).div_euclid(Self::DOME_CELL),
        );
        for gx in g0x..=g1x {
            for gz in g0z..=g1z {
                let (sx, sz) = self.dome_in(gx, gz);
                if sx + reach < base_x
                    || sx - reach >= base_x + s
                    || sz + reach < base_z
                    || sz - reach >= base_z + s
                {
                    continue;
                }
                let floor = self.dome_floor(sx, sz);
                // Air inside radius r + 0.5, glass out to r + 2: thick
                // enough that no water seeps through a diagonal.
                let inner = (Self::DOME_RADIUS * 2 + 1).pow(2); // (2r+1)^2 = 4(r+0.5)^2
                let outer = (Self::DOME_RADIUS * 2 + 4).pow(2); // 4(r+2)^2
                for dx in -reach..=reach {
                    for dz in -reach..=reach {
                        let flat = 4 * (dx * dx + dz * dz);
                        if flat > outer {
                            continue;
                        }
                        // A tidestone floor, filled down to the seafloor.
                        let ground = self.floor(sx + dx, sz + dz);
                        for y in ground.min(floor)..=floor {
                            put(&mut chunk, sx + dx, y, sz + dz, b.tidestone);
                        }
                        for dy in 1..=reach {
                            let r = flat + 4 * dy * dy;
                            let id = if r < inner {
                                AIR
                            } else if r <= outer {
                                b.glass
                            } else {
                                continue;
                            };
                            put(&mut chunk, sx + dx, floor + dy, sz + dz, id);
                        }
                    }
                }
                // Pearl lamps in the four corners and a clam by the wall.
                for (dx, dz) in [(-4, -4), (4, -4), (-4, 4), (4, 4)] {
                    put(&mut chunk, sx + dx, floor + 1, sz + dz, b.pearl);
                }
                put(&mut chunk, sx - 4, floor + 1, sz, b.clam);
            }
        }
        chunk
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ocean() -> (Content, Ocean) {
        let content = Content::load(platform_content::default_pack_dir()).unwrap();
        let o = Ocean::new(&content, 20260101, 256).unwrap();
        (content, o)
    }

    #[test]
    fn everything_lies_under_the_sea() {
        let (content, o) = ocean();
        let id = |k: &str| content.block(k).unwrap().id;
        let (water, kelp, grass, anemone, clam, vent, abyssal) = (
            id("water"),
            id("kelp"),
            id("sea_grass"),
            id("glow_anemone"),
            id("giant_clam"),
            id("bubble_vent"),
            id("abyssal_rock"),
        );
        let corals = [id("coral_red"), id("coral_blue"), id("coral_gold")];
        let mut counts = std::collections::HashMap::<&str, usize>::new();
        let mut columns = 0;
        for cx in (-40..40).step_by(4) {
            for cz in (-40..40).step_by(4) {
                let c = o.generate_chunk(cx, cz, 16);
                for x in 0..16 {
                    for z in 0..16 {
                        columns += 1;
                        // Nothing stands above the surface, and the
                        // surface itself is water (outside of nothing).
                        for y in Ocean::SURFACE as usize + 1..256 {
                            assert_eq!(c.get(x, y, z), AIR, "nothing above the sea");
                        }
                        let surface = c.get(x, Ocean::SURFACE as usize, z);
                        assert_eq!(surface, water, "the sea reaches the surface everywhere");
                        for y in 1..Ocean::SURFACE as usize {
                            let raw = c.get(x, y, z);
                            let v = raw & 0xFFFF;
                            let key = if v == kelp {
                                assert!(raw & WATERLOGGED != 0, "kelp stands in water");
                                "kelp"
                            } else if v == grass {
                                assert!(raw & WATERLOGGED != 0, "sea grass stands in water");
                                "grass"
                            } else if v == anemone {
                                "anemone"
                            } else if v == clam {
                                "clam"
                            } else if v == vent {
                                "vent"
                            } else if v == abyssal {
                                "abyssal"
                            } else if corals.contains(&v) {
                                "coral"
                            } else {
                                continue;
                            };
                            *counts.entry(key).or_default() += 1;
                        }
                    }
                }
            }
        }
        let n = |k: &str| counts.get(k).copied().unwrap_or(0);
        assert!(n("kelp") > 2000, "kelp forests: {counts:?}");
        assert!(n("grass") > 1000, "sea grass: {counts:?}");
        assert!(n("coral") > 1000, "coral reefs: {counts:?}");
        assert!(n("anemone") > 200, "glow anemones: {counts:?}");
        assert!(n("clam") > 50, "giant clams: {counts:?}");
        assert!(n("vent") > 30, "bubble vents: {counts:?}");
        assert!(n("abyssal") > 500, "an abyss: {counts:?}");
        assert!(columns > 0);
    }

    #[test]
    fn domes_hold_dry_air_on_a_tidestone_floor() {
        let (content, o) = ocean();
        let (tidestone, glass, water) = (
            content.block("tidestone").unwrap().id,
            content.block("glass").unwrap().id,
            content.block("water").unwrap().id,
        );
        for (gx, gz) in [(0, 0), (-3, 2), (5, -7), (11, 11)] {
            let (sx, sz) = o.dome_in(gx, gz);
            assert!(sx.div_euclid(Ocean::DOME_CELL) == gx && sz.div_euclid(Ocean::DOME_CELL) == gz);
            let floor = o.dome_floor(sx, sz);
            let at = |x: i32, y: i32, z: i32| {
                let c = o.generate_chunk(x.div_euclid(16), z.div_euclid(16), 16);
                c.get(
                    x.rem_euclid(16) as usize,
                    y as usize,
                    z.rem_euclid(16) as usize,
                )
            };
            assert_eq!(at(sx, floor, sz), tidestone, "a tidestone floor");
            for y in floor + 1..=floor + Ocean::DOME_RADIUS {
                assert_eq!(at(sx, y, sz), AIR, "dry air up the middle");
            }
            assert_eq!(
                at(sx, floor + Ocean::DOME_RADIUS + 1, sz),
                glass,
                "a glass roof"
            );
            assert_eq!(
                at(sx + Ocean::DOME_RADIUS + 1, floor + 1, sz),
                glass,
                "glass walls"
            );
            // No water inside: every cell within the radius is dry.
            let r = Ocean::DOME_RADIUS;
            for dx in -r..=r {
                for dz in -r..=r {
                    for dy in 1..=r {
                        if 4 * (dx * dx + dz * dz + dy * dy) < (2 * r + 1).pow(2) {
                            assert_ne!(at(sx + dx, floor + dy, sz + dz) & 0xFFFF, water);
                        }
                    }
                }
            }
            // Room for a portal (4 wide, 5 tall, 3 deep) at the centre.
            for dx in 0..4 {
                for dz in -1..=1 {
                    for dy in 1..5 {
                        assert_eq!(at(sx + dx, floor + dy, sz + dz), AIR);
                    }
                }
            }
        }
    }

    #[test]
    fn travellers_find_the_nearest_dome_from_the_seed_alone() {
        let (_, o) = ocean();
        for (x, z) in [(0, 0), (100, -250), (-999, 31), (4000, 4000)] {
            let (dx, dz) = Ocean::nearest_dome(20260101, x, z);
            let d = ((dx - x) as f64).hypot((dz - z) as f64);
            assert!(
                d < Ocean::DOME_CELL as f64 * 1.5,
                "a dome within reach: {d}"
            );
            let (gx, gz) = (
                dx.div_euclid(Ocean::DOME_CELL),
                dz.div_euclid(Ocean::DOME_CELL),
            );
            assert_eq!(o.dome_in(gx, gz), (dx, dz), "the generator builds it there");
        }
    }

    #[test]
    fn deterministic_and_the_floor_varies() {
        let (_, o) = ocean();
        let a = o.generate_chunk(3, -7, 16);
        assert_eq!(a, o.generate_chunk(3, -7, 16));
        let floors: Vec<i32> = (-3000..3000).step_by(7).map(|x| o.floor(x, 77)).collect();
        let (lo, hi) = (*floors.iter().min().unwrap(), *floors.iter().max().unwrap());
        assert!(lo < Ocean::DEEP, "trenches into the abyss: {lo}");
        assert!(hi > Ocean::FLOOR + 25, "seamounts: {hi}");
        assert!(hi < Ocean::SURFACE, "nothing breaks the surface: {hi}");
    }
}
