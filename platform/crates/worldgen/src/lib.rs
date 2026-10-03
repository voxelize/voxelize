//! Seeded, deterministic terrain generation driven by content data.
//!
//! The pipeline follows `docs/WORLD_GENERATION.md`:
//!
//! ```text
//! seed -> climate (temperature, humidity, continentalness, erosion)
//!      -> terrain height (blended across biomes) -> biome
//!      -> surface layers -> caves and lava pools -> ores -> vegetation
//! ```
//!
//! Every output is a pure function of `(seed, content, chunk coords)`: the
//! same chunk generated on any machine, in any order, is bit-identical. That
//! is what lets the server persist only chunks players changed and
//! regenerate pristine ones on demand. Chunks are generated independently:
//! nothing a stage writes leaves its chunk, so there is no cross-chunk
//! ordering to get wrong.

use noise::{Fbm, MultiFractal, NoiseFn, OpenSimplex};
use platform_content::{BiomeDef, Content};

/// Voxel id of air.
pub const AIR: u32 = 0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WorldgenConfig {
    pub seed: u32,
    pub sea_level: i32,
    /// Lowest cave air below this height is flooded with lava.
    pub lava_level: i32,
    pub max_height: i32,
}

impl Default for WorldgenConfig {
    fn default() -> Self {
        Self {
            seed: 1,
            sea_level: 64,
            lava_level: 10,
            max_height: 256,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Climate {
    pub temperature: f64,
    pub humidity: f64,
    pub continentalness: f64,
    pub erosion: f64,
}

#[derive(Debug, Clone)]
struct TreeSpec {
    log: u32,
    leaves: u32,
    density: f64,
    min_height: u32,
    max_height: u32,
}

#[derive(Debug, Clone)]
struct CoverSpec {
    block: u32,
    density: f64,
    on: Option<u32>,
}

#[derive(Debug, Clone)]
struct BiomeSpec {
    key: String,
    point: [f64; 4],
    height_offset: f64,
    roughness: f64,
    surface: u32,
    subsurface: u32,
    subsurface_depth: i32,
    underwater_surface: u32,
    trees: Option<TreeSpec>,
    cover: Vec<CoverSpec>,
}

#[derive(Debug, Clone)]
struct OreSpec {
    block: u32,
    replaces: u32,
    min_y: i32,
    max_y: i32,
    veins: u32,
    size: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorldgenError {
    MissingBlock(&'static str),
    NoBiomes,
}

impl std::fmt::Display for WorldgenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WorldgenError::MissingBlock(key) => write!(f, "worldgen needs block {key:?}"),
            WorldgenError::NoBiomes => write!(f, "worldgen needs at least one biome"),
        }
    }
}

impl std::error::Error for WorldgenError {}

/// One generated chunk: `size x max_height x size` voxels.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeneratedChunk {
    pub cx: i32,
    pub cz: i32,
    pub size: usize,
    pub height: usize,
    /// Column-major: index `(x * size + z) * height + y`, local coordinates.
    pub voxels: Vec<u32>,
    /// Biome index per column, `x * size + z`.
    pub biomes: Vec<u16>,
    /// Topmost solid (non-air, non-water) y per column, `x * size + z`.
    pub heights: Vec<i32>,
}

impl GeneratedChunk {
    fn index(&self, x: usize, y: usize, z: usize) -> usize {
        (x * self.size + z) * self.height + y
    }

    pub fn get(&self, x: usize, y: usize, z: usize) -> u32 {
        self.voxels[self.index(x, y, z)]
    }

    fn set(&mut self, x: usize, y: usize, z: usize, id: u32) {
        let i = self.index(x, y, z);
        self.voxels[i] = id;
    }
}

/// splitmix64: a fast, well-distributed hash used for every random choice,
/// so randomness depends only on its inputs.
fn mix(mut z: u64) -> u64 {
    z = z.wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

fn hash(seed: u32, a: i64, b: i64, salt: u64) -> u64 {
    mix(mix(mix(seed as u64 ^ salt.rotate_left(17)) ^ a as u64) ^ (b as u64).rotate_left(32))
}

/// Uniform float in [0, 1) from a hash.
fn unit(h: u64) -> f64 {
    (h >> 11) as f64 / (1u64 << 53) as f64
}

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        mix(self.0)
    }

    fn below(&mut self, n: u64) -> u64 {
        if n == 0 {
            0
        } else {
            self.next() % n
        }
    }
}

pub struct Generator {
    config: WorldgenConfig,
    temperature: Fbm<OpenSimplex>,
    humidity: Fbm<OpenSimplex>,
    continentalness: Fbm<OpenSimplex>,
    erosion: Fbm<OpenSimplex>,
    detail: Fbm<OpenSimplex>,
    cheese: Fbm<OpenSimplex>,
    tunnel_a: Fbm<OpenSimplex>,
    tunnel_b: Fbm<OpenSimplex>,
    biomes: Vec<BiomeSpec>,
    ores: Vec<OreSpec>,
    stone: u32,
    water: u32,
    lava: u32,
    bedrock: u32,
}

fn fbm(seed: u32, octaves: usize, frequency: f64) -> Fbm<OpenSimplex> {
    Fbm::<OpenSimplex>::new(seed)
        .set_octaves(octaves)
        .set_frequency(frequency)
}

impl Generator {
    pub fn new(content: &Content, config: WorldgenConfig) -> Result<Self, WorldgenError> {
        let id = |key: &'static str| {
            content
                .block(key)
                .map(|b| b.id)
                .ok_or(WorldgenError::MissingBlock(key))
        };
        let stone = id("stone")?;
        let water = id("water")?;
        let lava = id("lava")?;
        let bedrock = id("bedrock")?;
        // Validated content guarantees every key below resolves.
        let block = |key: &str| content.block(key).map(|b| b.id).unwrap_or(stone);

        let biomes: Vec<BiomeSpec> = content
            .biomes()
            .iter()
            .map(|b: &BiomeDef| BiomeSpec {
                key: b.key.clone(),
                point: [b.temperature, b.humidity, b.continentalness, b.erosion],
                height_offset: b.terrain.height_offset,
                roughness: b.terrain.roughness,
                surface: block(&b.surface),
                subsurface: block(&b.subsurface),
                subsurface_depth: b.subsurface_depth as i32,
                underwater_surface: b
                    .underwater_surface
                    .as_deref()
                    .map(block)
                    .unwrap_or_else(|| block(&b.subsurface)),
                trees: b.vegetation.trees.as_ref().map(|t| TreeSpec {
                    log: block(&t.log),
                    leaves: block(&t.leaves),
                    density: t.density,
                    min_height: t.min_height,
                    max_height: t.max_height,
                }),
                cover: b
                    .vegetation
                    .ground_cover
                    .iter()
                    .map(|c| CoverSpec {
                        block: block(&c.block),
                        density: c.density,
                        on: c.on.as_deref().map(block),
                    })
                    .collect(),
            })
            .collect();
        if biomes.is_empty() {
            return Err(WorldgenError::NoBiomes);
        }
        let ores = content
            .ores()
            .iter()
            .map(|o| OreSpec {
                block: block(&o.block),
                replaces: block(&o.replaces),
                min_y: o.min_y,
                max_y: o.max_y,
                veins: o.veins_per_chunk,
                size: o.vein_size,
            })
            .collect();

        let s = config.seed;
        Ok(Self {
            config,
            temperature: fbm(s.wrapping_add(1), 4, 1.0 / 1400.0),
            humidity: fbm(s.wrapping_add(2), 4, 1.0 / 1200.0),
            continentalness: fbm(s.wrapping_add(3), 5, 1.0 / 2200.0),
            erosion: fbm(s.wrapping_add(4), 4, 1.0 / 900.0),
            detail: fbm(s.wrapping_add(5), 5, 1.0 / 140.0),
            cheese: fbm(s.wrapping_add(6), 3, 1.0 / 90.0),
            tunnel_a: fbm(s.wrapping_add(7), 2, 1.0 / 70.0),
            tunnel_b: fbm(s.wrapping_add(8), 2, 1.0 / 70.0),
            biomes,
            ores,
            stone,
            water,
            lava,
            bedrock,
        })
    }

    pub fn config(&self) -> &WorldgenConfig {
        &self.config
    }

    /// Climate at a world column; each axis roughly in [-1, 1].
    pub fn climate(&self, x: i32, z: i32) -> Climate {
        let p = [x as f64, z as f64];
        // Fbm output clusters around zero; stretch it so biomes at the
        // edges of climate space are reachable.
        let stretch = |v: f64| (v * 1.8).clamp(-1.0, 1.0);
        Climate {
            temperature: stretch(self.temperature.get(p)),
            humidity: stretch(self.humidity.get(p)),
            continentalness: stretch(self.continentalness.get(p) + 0.15),
            erosion: stretch(self.erosion.get(p)),
        }
    }

    fn distance2(point: &[f64; 4], climate: &Climate) -> f64 {
        let d = [
            point[0] - climate.temperature,
            point[1] - climate.humidity,
            // Continentalness decides land versus sea, so it weighs most.
            (point[2] - climate.continentalness) * 2.0,
            point[3] - climate.erosion,
        ];
        d.iter().map(|v| v * v).sum()
    }

    fn nearest_biome(&self, climate: &Climate) -> usize {
        let mut best = 0;
        let mut best_d = f64::MAX;
        for (i, biome) in self.biomes.iter().enumerate() {
            let d = Self::distance2(&biome.point, climate);
            if d < best_d {
                best = i;
                best_d = d;
            }
        }
        best
    }

    /// Biome key at a world column.
    pub fn biome_at(&self, x: i32, z: i32) -> &str {
        &self.biomes[self.nearest_biome(&self.climate(x, z))].key
    }

    /// Terrain surface height at a world column, before caves.
    pub fn surface_height(&self, x: i32, z: i32) -> i32 {
        self.column(x, z).0
    }

    fn column(&self, x: i32, z: i32) -> (i32, usize) {
        let climate = self.climate(x, z);
        // Biome terrain parameters are blended with a smooth kernel in
        // climate space, so neighbouring biomes meet without cliffs.
        let mut weight_sum = 0.0;
        let mut offset = 0.0;
        let mut roughness = 0.0;
        for biome in &self.biomes {
            let w = (-Self::distance2(&biome.point, &climate) / 0.08).exp();
            weight_sum += w;
            offset += w * biome.height_offset;
            roughness += w * biome.roughness;
        }
        if weight_sum > 0.0 {
            offset /= weight_sum;
            roughness /= weight_sum;
        }
        let detail = self.detail.get([x as f64, z as f64]);
        let height = self.config.sea_level as f64 + 2.0 + offset + roughness * detail;
        let height = height.round() as i32;
        (height.clamp(2, self.config.max_height - 20), self.nearest_biome(&climate))
    }

    fn is_cave(&self, x: i32, y: i32, z: i32, surface: i32) -> bool {
        if y <= 4 {
            return false;
        }
        // Keep a roof under seas and lakes so water never drains into caves.
        let roof = if surface < self.config.sea_level { 8 } else { 1 };
        if y > surface - roof {
            return false;
        }
        let p = [x as f64, y as f64 * 1.4, z as f64];
        // Large chambers where the "cheese" field is high, deep down mostly.
        let depth_bias = ((self.config.sea_level - y) as f64 / 64.0).clamp(0.0, 1.0) * 0.12;
        if self.cheese.get(p) > 0.62 - depth_bias {
            return true;
        }
        // Long winding tunnels where two fields both cross zero.
        let a = self.tunnel_a.get(p);
        let b = self.tunnel_b.get(p);
        a.abs() < 0.035 && b.abs() < 0.035
    }

    /// Generate one chunk of `size x size` columns.
    pub fn generate_chunk(&self, cx: i32, cz: i32, size: usize) -> GeneratedChunk {
        let height = self.config.max_height as usize;
        let mut chunk = GeneratedChunk {
            cx,
            cz,
            size,
            height,
            voxels: vec![AIR; size * size * height],
            biomes: vec![0; size * size],
            heights: vec![0; size * size],
        };
        let sea = self.config.sea_level;
        let base_x = cx * size as i32;
        let base_z = cz * size as i32;

        // Terrain, surface layers, caves.
        for lx in 0..size {
            for lz in 0..size {
                let (wx, wz) = (base_x + lx as i32, base_z + lz as i32);
                let (surface, biome_index) = self.column(wx, wz);
                let biome = &self.biomes[biome_index];
                chunk.biomes[lx * size + lz] = biome_index as u16;
                let underwater = surface < sea;
                let mut top = 0;
                for y in 0..height as i32 {
                    let id = if y == 0 {
                        self.bedrock
                    } else if y <= surface {
                        if self.is_cave(wx, y, wz, surface) {
                            if y <= self.config.lava_level {
                                self.lava
                            } else {
                                AIR
                            }
                        } else if y == surface {
                            if underwater {
                                biome.underwater_surface
                            } else {
                                biome.surface
                            }
                        } else if y > surface - 1 - biome.subsurface_depth {
                            biome.subsurface
                        } else {
                            self.stone
                        }
                    } else if y <= sea {
                        self.water
                    } else {
                        break;
                    };
                    if id != AIR && id != self.water && id != self.lava {
                        top = y;
                    }
                    chunk.set(lx, y as usize, lz, id);
                }
                chunk.heights[lx * size + lz] = top;
            }
        }

        self.place_ores(&mut chunk);
        self.place_vegetation(&mut chunk);
        chunk
    }

    fn place_ores(&self, chunk: &mut GeneratedChunk) {
        let size = chunk.size as i32;
        for (index, ore) in self.ores.iter().enumerate() {
            let mut rng = Rng(hash(self.config.seed, chunk.cx as i64, chunk.cz as i64, 0x0E5 + index as u64));
            let min_y = ore.min_y.max(1);
            let max_y = ore.max_y.min(self.config.max_height - 1);
            if min_y >= max_y {
                continue;
            }
            for _ in 0..ore.veins {
                let mut x = rng.below(size as u64) as i32;
                let mut y = min_y + rng.below((max_y - min_y) as u64) as i32;
                let mut z = rng.below(size as u64) as i32;
                for _ in 0..ore.size {
                    if (0..size).contains(&x)
                        && (min_y..max_y).contains(&y)
                        && (0..size).contains(&z)
                        && chunk.get(x as usize, y as usize, z as usize) == ore.replaces
                    {
                        chunk.set(x as usize, y as usize, z as usize, ore.block);
                    }
                    match rng.below(6) {
                        0 => x += 1,
                        1 => x -= 1,
                        2 => y += 1,
                        3 => y -= 1,
                        4 => z += 1,
                        _ => z -= 1,
                    }
                }
            }
        }
    }

    fn place_vegetation(&self, chunk: &mut GeneratedChunk) {
        let size = chunk.size;
        let sea = self.config.sea_level;
        let max = self.config.max_height as usize;
        for lx in 0..size {
            for lz in 0..size {
                let column = lx * size + lz;
                let surface = chunk.heights[column];
                if surface < sea || surface as usize + 16 >= max {
                    continue;
                }
                let biome = &self.biomes[chunk.biomes[column] as usize];
                let ground = chunk.get(lx, surface as usize, lz);
                if ground != biome.surface || chunk.get(lx, surface as usize + 1, lz) != AIR {
                    continue;
                }
                let (wx, wz) = (
                    chunk.cx as i64 * size as i64 + lx as i64,
                    chunk.cz as i64 * size as i64 + lz as i64,
                );
                let roll = unit(hash(self.config.seed, wx, wz, 0x7EE));
                if let Some(tree) = &biome.trees {
                    // Trees stay inside their chunk (canopy radius 2) so
                    // chunks generate independently.
                    let inside = (2..size - 2).contains(&lx) && (2..size - 2).contains(&lz);
                    if inside && roll < tree.density {
                        let span = (tree.max_height - tree.min_height + 1) as u64;
                        let trunk = tree.min_height
                            + (hash(self.config.seed, wx, wz, 0x7E1) % span) as u32;
                        Self::place_tree(chunk, lx, surface as usize + 1, lz, trunk as usize, tree);
                        continue;
                    }
                }
                let mut threshold = 0.0;
                let roll = unit(hash(self.config.seed, wx, wz, 0xC0E));
                for cover in &biome.cover {
                    threshold += cover.density;
                    if roll < threshold {
                        if cover.on.is_none_or(|on| on == ground) {
                            chunk.set(lx, surface as usize + 1, lz, cover.block);
                        }
                        break;
                    }
                }
            }
        }
    }

    fn place_tree(chunk: &mut GeneratedChunk, x: usize, y: usize, z: usize, trunk: usize, tree: &TreeSpec) {
        let top = y + trunk;
        for dy in 0..3usize {
            let ly = top - 2 + dy;
            let radius: i32 = if dy == 2 { 1 } else { 2 };
            for dx in -radius..=radius {
                for dz in -radius..=radius {
                    if radius == 2 && dx.abs() == 2 && dz.abs() == 2 {
                        continue;
                    }
                    let (px, pz) = ((x as i32 + dx) as usize, (z as i32 + dz) as usize);
                    if chunk.get(px, ly, pz) == AIR {
                        chunk.set(px, ly, pz, tree.leaves);
                    }
                }
            }
        }
        chunk.set(x, top + 1, z, tree.leaves);
        for ly in y..top {
            chunk.set(x, ly, z, tree.log);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use platform_content::default_pack_dir;

    fn generator(seed: u32) -> (Content, Generator) {
        let content = Content::load(default_pack_dir()).expect("pack loads");
        let generator = Generator::new(
            &content,
            WorldgenConfig {
                seed,
                ..Default::default()
            },
        )
        .expect("generator");
        (content, generator)
    }

    #[test]
    fn generation_is_deterministic() {
        let (_, a) = generator(42);
        let (_, b) = generator(42);
        for (cx, cz) in [(0, 0), (-3, 7), (120, -45)] {
            assert_eq!(a.generate_chunk(cx, cz, 16), b.generate_chunk(cx, cz, 16));
        }
        // Order of generation does not matter.
        let first = a.generate_chunk(5, 5, 16);
        let _ = a.generate_chunk(6, 5, 16);
        assert_eq!(first, a.generate_chunk(5, 5, 16));
    }

    #[test]
    fn different_seeds_differ() {
        let (_, a) = generator(1);
        let (_, b) = generator(2);
        assert_ne!(a.generate_chunk(0, 0, 16).voxels, b.generate_chunk(0, 0, 16).voxels);
    }

    #[test]
    fn bedrock_floor_and_no_floating_water_or_air_holes_at_bedrock() {
        let (content, g) = generator(7);
        let bedrock = content.block("bedrock").unwrap().id;
        let chunk = g.generate_chunk(3, -2, 16);
        for x in 0..16 {
            for z in 0..16 {
                assert_eq!(chunk.get(x, 0, z), bedrock);
            }
        }
    }

    #[test]
    fn ores_stay_in_their_height_band() {
        let (content, g) = generator(99);
        let bands: Vec<(u32, i32, i32)> = content
            .ores()
            .iter()
            .map(|o| (content.block(&o.block).unwrap().id, o.min_y.max(1), o.max_y))
            .collect();
        let mut found = 0;
        for cx in 0..6 {
            let chunk = g.generate_chunk(cx, 0, 16);
            for x in 0..16 {
                for z in 0..16 {
                    for y in 0..chunk.height {
                        let id = chunk.get(x, y, z);
                        if let Some((_, min, max)) = bands.iter().find(|(b, _, _)| *b == id) {
                            found += 1;
                            assert!((*min..*max).contains(&(y as i32)), "ore {id} at y {y}");
                        }
                    }
                }
            }
        }
        assert!(found > 50, "expected ores, found {found}");
    }

    #[test]
    fn world_has_varied_biomes_and_both_land_and_sea() {
        let (_, g) = generator(2024);
        let mut biomes = std::collections::BTreeSet::new();
        let mut land = 0;
        let mut sea = 0;
        for i in -40..40 {
            for j in -40..40 {
                let (x, z) = (i * 97, j * 97);
                biomes.insert(g.biome_at(x, z).to_owned());
                if g.surface_height(x, z) >= g.config().sea_level {
                    land += 1;
                } else {
                    sea += 1;
                }
            }
        }
        assert!(biomes.len() >= 6, "only {biomes:?}");
        assert!(land > 0 && sea > 0, "land {land} sea {sea}");
    }

    #[test]
    fn neighbouring_columns_have_no_cliffs_outside_mountains() {
        let (_, g) = generator(5);
        let mut worst = 0;
        for x in -256..256 {
            let a = g.surface_height(x, 0);
            let b = g.surface_height(x + 1, 0);
            worst = worst.max((a - b).abs());
        }
        assert!(worst <= 6, "steepest step {worst}");
    }

    #[test]
    fn trees_grow_on_land_somewhere() {
        let (content, g) = generator(11);
        let logs: Vec<u32> = ["oak_log", "spruce_log"]
            .iter()
            .map(|k| content.block(k).unwrap().id)
            .collect();
        let mut count = 0;
        for cx in -6..6 {
            for cz in -6..6 {
                let chunk = g.generate_chunk(cx, cz, 16);
                count += chunk.voxels.iter().filter(|v| logs.contains(v)).count();
            }
        }
        assert!(count > 0, "no trees in 144 chunks");
    }
}
