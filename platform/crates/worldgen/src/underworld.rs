//! The underworld: a sealed cavern dimension between a bedrock floor and a
//! bedrock roof, carved from cinderstone by 3D noise, with a lava sea,
//! emberglass hanging from cavern ceilings and ember quartz veins.
//!
//! Like the overworld generator, every voxel is a pure function of
//! `(seed, content, chunk coords)` and nothing a chunk writes leaves it.

use noise::{Fbm, NoiseFn, OpenSimplex};
use platform_content::{Content, Dimension};

use crate::{fbm, hash, place_ores, unit, GeneratedChunk, OreSpec, WorldgenError, AIR};

pub struct Underworld {
    seed: u32,
    max_height: i32,
    density: Fbm<OpenSimplex>,
    shape: Fbm<OpenSimplex>,
    cinderstone: u32,
    emberglass: u32,
    lava: u32,
    bedrock: u32,
    ores: Vec<OreSpec>,
    biome: String,
}

impl Underworld {
    /// The bedrock ceiling; nothing generates above it.
    pub const ROOF: i32 = 127;
    /// Open cavern below this height is a lava sea.
    pub const LAVA_LEVEL: i32 = 31;

    pub fn new(content: &Content, seed: u32, max_height: i32) -> Result<Self, WorldgenError> {
        let id = |key: &'static str| {
            content
                .block(key)
                .map(|b| b.id)
                .ok_or(WorldgenError::MissingBlock(key))
        };
        let cinderstone = id("cinderstone")?;
        let biome = content
            .biomes_of(Dimension::Underworld)
            .first()
            .map(|b| b.key.clone())
            .ok_or(WorldgenError::NoBiomes)?;
        let s = seed.wrapping_add(0x0BAD_F00D);
        Ok(Self {
            seed: s,
            max_height,
            density: fbm(s.wrapping_add(1), 4, 1.0 / 56.0),
            shape: fbm(s.wrapping_add(2), 2, 1.0 / 220.0),
            cinderstone,
            emberglass: id("emberglass")?,
            lava: id("lava")?,
            bedrock: id("bedrock")?,
            ores: crate::ore_specs(content, cinderstone),
            biome,
        })
    }

    pub fn biome_at(&self, _x: i32, _z: i32) -> &str {
        &self.biome
    }

    fn bedrock_at(&self, x: i32, y: i32, z: i32) -> bool {
        // Solid rows at the floor and roof, ragged for a few blocks.
        let depth = y.min(Self::ROOF - y);
        depth <= 0
            || (depth < 4
                && unit(hash(self.seed, x as i64, z as i64, 0xB0 + y as u64)) < 0.5 / depth as f64)
    }

    /// Whether the cavern rock is solid here (before bedrock and lava).
    pub fn is_solid(&self, x: i32, y: i32, z: i32) -> bool {
        let t = y as f64 / Self::ROOF as f64;
        // Dense near the floor and the roof, open in between; the large-scale
        // field varies how open a region is.
        let edge = (0.22 - t.min(1.0 - t)).max(0.0) * 6.0;
        let region = self.shape.get([x as f64, z as f64]) * 0.25;
        let n = self.density.get([x as f64, y as f64 * 1.8, z as f64]);
        n + edge + region > 0.05
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
        let top = Self::ROOF.min(self.max_height - 1);
        for lx in 0..size {
            for lz in 0..size {
                let (x, z) = (base_x + lx as i32, base_z + lz as i32);
                let mut floor = 0;
                for y in 0..=top {
                    let id = if self.bedrock_at(x, y, z) {
                        self.bedrock
                    } else if self.is_solid(x, y, z) {
                        self.cinderstone
                    } else if y <= Self::LAVA_LEVEL {
                        self.lava
                    } else {
                        AIR
                    };
                    chunk.set(lx, y as usize, lz, id);
                }
                // Highest cavern floor: solid with air above.
                for y in (1..top).rev() {
                    let below = chunk.get(lx, y as usize, lz);
                    if below != AIR
                        && below != self.lava
                        && chunk.get(lx, y as usize + 1, lz) == AIR
                    {
                        floor = y;
                        break;
                    }
                }
                chunk.heights[lx * size + lz] = floor;
            }
        }
        self.hang_emberglass(&mut chunk);
        place_ores(&self.ores, self.seed, top, &mut chunk);
        chunk
    }

    /// Emberglass clusters under cavern ceilings in the upper half.
    fn hang_emberglass(&self, chunk: &mut GeneratedChunk) {
        let size = chunk.size;
        let (base_x, base_z) = (chunk.cx * size as i32, chunk.cz * size as i32);
        for lx in 0..size {
            for lz in 0..size {
                let (x, z) = (base_x + lx as i32, base_z + lz as i32);
                for y in 64..Self::ROOF - 1 {
                    let (yu, above) = (y as usize, y as usize + 1);
                    if chunk.get(lx, yu, lz) != AIR || chunk.get(lx, above, lz) != self.cinderstone
                    {
                        continue;
                    }
                    let h = hash(self.seed, x as i64, z as i64, 0xE6 + y as u64);
                    if unit(h) >= 0.015 {
                        continue;
                    }
                    let length = 1 + (h >> 20) % 4;
                    for d in 0..length as usize {
                        if yu < d || chunk.get(lx, yu - d, lz) != AIR {
                            break;
                        }
                        chunk.set(lx, yu - d, lz, self.emberglass);
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn underworld() -> (Content, Underworld) {
        let content = Content::load(platform_content::default_pack_dir()).unwrap();
        let u = Underworld::new(&content, 20260101, 256).unwrap();
        (content, u)
    }

    #[test]
    fn sealed_between_bedrock_with_caverns_and_a_lava_sea() {
        let (content, u) = underworld();
        let id = |k: &str| content.block(k).unwrap().id;
        let (bedrock, lava, cinder) = (id("bedrock"), id("lava"), id("cinderstone"));
        let (mut air, mut solid, mut lava_cells) = (0usize, 0usize, 0usize);
        for (cx, cz) in [(0, 0), (3, -2), (-5, 4), (8, 8)] {
            let c = u.generate_chunk(cx, cz, 16);
            assert_eq!(c, u.generate_chunk(cx, cz, 16), "deterministic");
            for x in 0..16 {
                for z in 0..16 {
                    assert_eq!(c.get(x, 0, z), bedrock);
                    assert_eq!(c.get(x, Underworld::ROOF as usize, z), bedrock);
                    assert!((Underworld::ROOF as usize + 1..256).all(|y| c.get(x, y, z) == AIR));
                    for y in 32..120 {
                        match c.get(x, y, z) {
                            AIR => air += 1,
                            v if v == cinder => solid += 1,
                            _ => {}
                        }
                    }
                    lava_cells += (1..=Underworld::LAVA_LEVEL as usize)
                        .filter(|&y| c.get(x, y, z) == lava)
                        .count();
                    assert!(
                        (Underworld::LAVA_LEVEL as usize + 1..Underworld::ROOF as usize)
                            .all(|y| c.get(x, y, z) != lava),
                        "no lava above the sea"
                    );
                }
            }
        }
        let open = air as f64 / (air + solid) as f64;
        assert!((0.15..0.8).contains(&open), "cavern openness {open}");
        assert!(lava_cells > 100, "a lava sea: {lava_cells}");
    }

    #[test]
    fn emberglass_and_ember_quartz_appear() {
        let (content, u) = underworld();
        let glass = content.block("emberglass").unwrap().id;
        let quartz = content.block("ember_quartz_ore").unwrap().id;
        let (mut g, mut q) = (0, 0);
        for cx in -4..4 {
            for cz in -4..4 {
                let c = u.generate_chunk(cx, cz, 16);
                g += c.voxels.iter().filter(|&&v| v == glass).count();
                q += c.voxels.iter().filter(|&&v| v == quartz).count();
            }
        }
        assert!(g > 0, "emberglass");
        assert!(q > 50, "ember quartz {q}");
    }
}
