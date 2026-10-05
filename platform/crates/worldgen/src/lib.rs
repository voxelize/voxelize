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
use std::collections::HashMap;

use platform_content::{parse_color, BiomeDef, Content, Dimension, StructurePlacement};

mod sky;
mod underworld;
pub use sky::{Sky, Span};
pub use underworld::Underworld;

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
    /// Colour of tinted blocks (grass, leaves); 128 per channel is neutral.
    tint: [u8; 3],
    /// Cold enough that still water freezes over at sea level.
    freezes: bool,
}

/// Biome temperature at or under which water freezes at the surface.
const FREEZING: f64 = -0.4;

/// Neutral tint: blocks look as their textures are drawn.
pub const NEUTRAL_TINT: [u8; 3] = [128, 128, 128];

#[derive(Debug, Clone)]
struct VillageSpec {
    biomes: Vec<usize>,
    spacing: i32,
    chance: f64,
    center: usize,
    houses: Vec<usize>,
    min_houses: u32,
    max_houses: u32,
    radius: i32,
    path: u32,
}

/// One structure placed in the world, turned by quarter turns (0: as
/// drawn, its front row facing -z; 1: front facing -x; 2: +z; 3: +x).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Placed {
    structure: usize,
    origin: [i32; 3],
    turn: u8,
}

/// Columns a turned footprint covers: (width along x, depth along z).
fn turned_size(size: (i32, i32, i32), turn: u8) -> (i32, i32) {
    if turn % 2 == 1 {
        (size.2, size.0)
    } else {
        (size.0, size.2)
    }
}

/// The drawn cell (x, z) at a turned footprint's (tx, tz).
fn drawn_cell(size: (i32, i32, i32), turn: u8, tx: i32, tz: i32) -> (i32, i32) {
    let (w, d) = (size.0, size.2);
    match turn % 4 {
        0 => (tx, tz),
        1 => (w - 1 - tz, tx),
        2 => (w - 1 - tx, d - 1 - tz),
        _ => (tz, d - 1 - tx),
    }
}

/// Stage value carried by a chest generated inside a structure: the
/// structure's index plus one (loot chests are found by the server).
pub const LOOT_STAGE_SHIFT: u32 = 24;

#[derive(Debug, Clone)]
struct StructureSpec {
    key: String,
    placement: StructurePlacement,
    biomes: Vec<usize>,
    spacing: i32,
    chance: f64,
    y_offset: i32,
    min_y: i32,
    max_y: i32,
    size: (i32, i32, i32),
    /// [y][z][x] -> block to write (None keeps the terrain).
    cells: Vec<Vec<Vec<Option<u32>>>>,
    foundation: Option<u32>,
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
    /// Biome colour at the chunk's four corners (x0z0, x1z0, x0z1, x1z1),
    /// RGB each, for tinted blocks; `None` where nothing is tinted.
    pub tints: Option<[u8; 12]>,
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

/// Seeded ore veins, each replacing only its host block.
fn place_ores(ores: &[OreSpec], seed: u32, max_height: i32, chunk: &mut GeneratedChunk) {
    let size = chunk.size as i32;
    for (index, ore) in ores.iter().enumerate() {
        let mut rng = Rng(hash(
            seed,
            chunk.cx as i64,
            chunk.cz as i64,
            0x0E5 + index as u64,
        ));
        let min_y = ore.min_y.max(1);
        let max_y = ore.max_y.min(max_height - 1);
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

fn ore_specs(content: &Content, fallback: u32) -> Vec<OreSpec> {
    let block = |key: &str| content.block(key).map(|b| b.id).unwrap_or(fallback);
    content
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
        .collect()
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
    river: Fbm<OpenSimplex>,
    ravine: Fbm<OpenSimplex>,
    ravine_mask: Fbm<OpenSimplex>,
    biomes: Vec<BiomeSpec>,
    ores: Vec<OreSpec>,
    structures: Vec<StructureSpec>,
    villages: Vec<VillageSpec>,
    aquifer: Fbm<OpenSimplex>,
    aquifer_level: Fbm<OpenSimplex>,
    /// Ground cover blocks (paths clear them).
    cover_blocks: Vec<u32>,
    stone: u32,
    water: u32,
    lava: u32,
    bedrock: u32,
    /// Ice for frozen seas and lakes (water when the pack has none).
    ice: u32,
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

        let overworld = content.biomes_of(Dimension::Overworld);
        let biomes: Vec<BiomeSpec> = overworld
            .iter()
            .map(|b: &&BiomeDef| BiomeSpec {
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
                tint: b
                    .tint
                    .as_deref()
                    .and_then(parse_color)
                    .unwrap_or(NEUTRAL_TINT),
                freezes: b.temperature <= FREEZING,
            })
            .collect();
        if biomes.is_empty() {
            return Err(WorldgenError::NoBiomes);
        }
        let ores = ore_specs(content, stone);

        let chest = content.block("chest").map(|b| b.id);
        let biome_index: HashMap<&str, usize> = overworld
            .iter()
            .enumerate()
            .map(|(i, b)| (b.key.as_str(), i))
            .collect();
        let structures = content
            .structures()
            .iter()
            .enumerate()
            .map(|(index, st)| {
                let (w, h, d) = st.size();
                let marker = ((index as u32 + 1).min(15)) << LOOT_STAGE_SHIFT;
                let cells = st
                    .layers
                    .iter()
                    .map(|layer| {
                        layer
                            .iter()
                            .map(|row| {
                                row.chars()
                                    .map(|c| match c {
                                        ' ' => None,
                                        '.' => Some(AIR),
                                        c => st.palette.get(&c).map(|key| {
                                            let id = block(key);
                                            if Some(id) == chest {
                                                id | marker
                                            } else {
                                                id
                                            }
                                        }),
                                    })
                                    .collect()
                            })
                            .collect()
                    })
                    .collect();
                StructureSpec {
                    key: st.key.clone(),
                    placement: st.placement,
                    biomes: st
                        .biomes
                        .iter()
                        .filter_map(|b| biome_index.get(b.as_str()).copied())
                        .collect(),
                    spacing: st.spacing as i32,
                    chance: st.chance,
                    y_offset: st.y_offset,
                    min_y: st.min_y,
                    max_y: st.max_y,
                    size: (w as i32, h as i32, d as i32),
                    cells,
                    foundation: st.foundation.as_deref().map(block),
                }
            })
            .collect();
        let structure_index = |key: &str| content.structures().iter().position(|s| s.key == key);
        let villages = content
            .villages()
            .iter()
            .filter_map(|v| {
                Some(VillageSpec {
                    biomes: v
                        .biomes
                        .iter()
                        .filter_map(|b| biome_index.get(b.as_str()).copied())
                        .collect(),
                    spacing: v.spacing as i32,
                    chance: v.chance,
                    center: structure_index(&v.center)?,
                    houses: v.houses.iter().filter_map(|h| structure_index(h)).collect(),
                    min_houses: v.min_houses,
                    max_houses: v.max_houses,
                    radius: v.radius as i32,
                    path: block(&v.path),
                })
            })
            .collect();
        let cover_blocks = biomes
            .iter()
            .flat_map(|b| b.cover.iter().map(|c| c.block))
            .collect();

        let s = config.seed;
        Ok(Self {
            structures,
            villages,
            aquifer: fbm(s.wrapping_add(12), 2, 1.0 / 110.0),
            aquifer_level: fbm(s.wrapping_add(13), 1, 1.0 / 300.0),
            cover_blocks,
            config,
            temperature: fbm(s.wrapping_add(1), 4, 1.0 / 1400.0),
            humidity: fbm(s.wrapping_add(2), 4, 1.0 / 1200.0),
            continentalness: fbm(s.wrapping_add(3), 5, 1.0 / 2200.0),
            erosion: fbm(s.wrapping_add(4), 4, 1.0 / 900.0),
            detail: fbm(s.wrapping_add(5), 5, 1.0 / 140.0),
            cheese: fbm(s.wrapping_add(6), 3, 1.0 / 90.0),
            tunnel_a: fbm(s.wrapping_add(7), 2, 1.0 / 70.0),
            tunnel_b: fbm(s.wrapping_add(8), 2, 1.0 / 70.0),
            river: fbm(s.wrapping_add(9), 3, 1.0 / 700.0),
            ravine: fbm(s.wrapping_add(10), 2, 1.0 / 160.0),
            ravine_mask: fbm(s.wrapping_add(11), 2, 1.0 / 500.0),
            biomes,
            ores,
            stone,
            water,
            lava,
            ice: content.block("ice").map(|b| b.id).unwrap_or(water),
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

    /// Colour of tinted blocks at a column: the biome tints around it,
    /// averaged over a 3 x 3 grid eight blocks apart so borders blend.
    pub fn tint_at(&self, x: i32, z: i32) -> [u8; 3] {
        let mut sum = [0u32; 3];
        for dx in [-8, 0, 8] {
            for dz in [-8, 0, 8] {
                let t = self.biomes[self.nearest_biome(&self.climate(x + dx, z + dz))].tint;
                for c in 0..3 {
                    sum[c] += u32::from(t[c]);
                }
            }
        }
        sum.map(|v| (v / 9) as u8)
    }

    /// Water table of an aquifer under a column: caves below it hold water
    /// instead of air. `None` where the column has no aquifer.
    fn aquifer_at(&self, x: i32, z: i32, surface: i32) -> Option<i32> {
        let p = [x as f64, z as f64];
        if self.aquifer.get(p) < 0.2 {
            return None;
        }
        let level = self.config.sea_level - 14 - (self.aquifer_level.get(p).abs() * 30.0) as i32;
        // Always well under the ground, so water never wells up on land.
        Some(level.min(surface - 10))
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
        let mut height = self.config.sea_level as f64 + 2.0 + offset + roughness * detail;
        // Rivers: where the river field crosses zero on land, the terrain
        // sinks smoothly to a bed below sea level, so water fills it.
        let river = self.river_strength(x, z, climate.continentalness);
        if river > 0.0 {
            let bed = self.config.sea_level as f64 - 3.0;
            // A flat bed over the inner part, smooth banks outside it.
            let k = (river * 1.6).min(1.0);
            let t = k * k * (3.0 - 2.0 * k);
            height = height + (height.min(bed) - height) * t;
        }
        let height = height.round() as i32;
        (
            height.clamp(2, self.config.max_height - 20),
            self.nearest_biome(&climate),
        )
    }

    /// 0 away from rivers, rising to 1 at a river's centre line.
    fn river_strength(&self, x: i32, z: i32, continentalness: f64) -> f64 {
        if continentalness < -0.15 {
            return 0.0; // the sea needs no rivers
        }
        const WIDTH: f64 = 0.06;
        let r = self.river.get([x as f64, z as f64]).abs();
        (1.0 - r / WIDTH).max(0.0)
    }

    /// Whether a column lies on a river's bed (its flat inner part).
    pub fn is_river(&self, x: i32, z: i32) -> bool {
        let climate = self.climate(x, z);
        self.river_strength(x, z, climate.continentalness) > 0.65
    }

    /// Ravines: narrow, deep cuts from the surface in some regions.
    fn is_ravine(&self, x: i32, y: i32, z: i32, surface: i32) -> bool {
        if surface < self.config.sea_level + 2 || y < 12 || y < surface - 40 {
            return false;
        }
        let p = [x as f64, z as f64];
        if self.ravine_mask.get(p) < 0.35 {
            return false;
        }
        // Narrower towards the bottom.
        let depth = (surface - y) as f64 / 40.0;
        let width = 0.03 * (1.0 - depth * 0.7);
        self.ravine.get(p).abs() < width
    }

    fn is_cave(&self, x: i32, y: i32, z: i32, surface: i32) -> bool {
        if y <= 4 {
            return false;
        }
        if self.is_ravine(x, y, z, surface) {
            return true;
        }
        // Keep a roof under seas and lakes so water never drains into caves.
        let roof = if surface < self.config.sea_level {
            8
        } else {
            1
        };
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
        let base_x = cx * size as i32;
        let base_z = cz * size as i32;
        let s = size as i32;
        let mut tints = [0u8; 12];
        for (i, (x, z)) in [(0, 0), (s, 0), (0, s), (s, s)].into_iter().enumerate() {
            tints[i * 3..i * 3 + 3].copy_from_slice(&self.tint_at(base_x + x, base_z + z));
        }
        let mut chunk = GeneratedChunk {
            cx,
            cz,
            size,
            height,
            voxels: vec![AIR; size * size * height],
            biomes: vec![0; size * size],
            heights: vec![0; size * size],
            tints: Some(tints),
        };
        let sea = self.config.sea_level;

        // Terrain, surface layers, caves.
        for lx in 0..size {
            for lz in 0..size {
                let (wx, wz) = (base_x + lx as i32, base_z + lz as i32);
                let (surface, biome_index) = self.column(wx, wz);
                let biome = &self.biomes[biome_index];
                let aquifer = self.aquifer_at(wx, wz, surface);
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
                            } else if aquifer.is_some_and(|level| y <= level) {
                                self.water
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
                    } else if y == sea && biome.freezes {
                        self.ice
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
        self.place_paths(&mut chunk);
        self.place_structures(&mut chunk);
        chunk
    }

    /// A village's layout in a grid cell, if it has one there: its placed
    /// structures (the centre first) and its path columns.
    fn village(&self, index: usize, gx: i32, gz: i32) -> Option<(Vec<Placed>, Vec<[i32; 2]>)> {
        let v = &self.villages[index];
        let h = hash(
            self.config.seed,
            gx as i64,
            gz as i64,
            0x7111 + index as u64,
        );
        if unit(h) >= v.chance {
            return None;
        }
        let cell = v.spacing * 16;
        let margin = v.radius + 16;
        let span = (cell - 2 * margin).max(1) as u64;
        let cx = gx * cell + margin + ((h >> 8) % span) as i32;
        let cz = gz * cell + margin + ((h >> 24) % span) as i32;
        let (surface, biome) = self.column(cx, cz);
        if surface < self.config.sea_level
            || self.is_river(cx, cz)
            || (!v.biomes.is_empty() && !v.biomes.contains(&biome))
        {
            return None;
        }
        let mut parts = Vec::new();
        let mut paths = Vec::new();
        let center = &self.structures[v.center];
        let (cw, cd) = turned_size(center.size, 0);
        parts.push(Placed {
            structure: v.center,
            origin: [cx - cw / 2, surface + center.y_offset, cz - cd / 2],
            turn: 0,
        });
        let mut r = Rng(h ^ 0xA5A5);
        let count = v.min_houses + r.below(u64::from(v.max_houses - v.min_houses + 1)) as u32;
        let start = unit(r.next()) * std::f64::consts::TAU;
        for i in 0..count {
            let angle = start + i as f64 * std::f64::consts::TAU / count as f64;
            let hx = cx + (angle.cos() * v.radius as f64).round() as i32;
            let hz = cz + (angle.sin() * v.radius as f64).round() as i32;
            let structure = v.houses[r.below(v.houses.len() as u64) as usize];
            let (ground, _) = self.column(hx, hz);
            if ground < self.config.sea_level || self.is_river(hx, hz) {
                continue;
            }
            let st = &self.structures[structure];
            // Turn the front row (drawn at -z) towards the centre.
            let (dx, dz) = (cx - hx, cz - hz);
            let turn = if dz.abs() >= dx.abs() {
                if dz < 0 {
                    0
                } else {
                    2
                }
            } else if dx < 0 {
                1
            } else {
                3
            };
            let (w, d) = turned_size(st.size, turn);
            let origin = [hx - w / 2, ground + st.y_offset, hz - d / 2];
            parts.push(Placed {
                structure,
                origin,
                turn,
            });
            // The path starts in front of the middle of the front row.
            let door = match turn {
                0 => [origin[0] + w / 2, origin[2] - 1],
                1 => [origin[0] - 1, origin[2] + d / 2],
                2 => [origin[0] + w / 2, origin[2] + d],
                _ => [origin[0] + w, origin[2] + d / 2],
            };
            let steps = (door[0] - cx).abs().max((door[1] - cz).abs()).max(1);
            for s in 0..=steps {
                let t = s as f64 / steps as f64;
                paths.push([
                    door[0] + ((cx - door[0]) as f64 * t).round() as i32,
                    door[1] + ((cz - door[1]) as f64 * t).round() as i32,
                ]);
            }
        }
        Some((parts, paths))
    }

    /// Village layouts whose area may reach the given chunk.
    #[allow(clippy::type_complexity)]
    fn villages_near(
        &self,
        cx: i32,
        cz: i32,
        size: usize,
    ) -> Vec<(usize, Vec<Placed>, Vec<[i32; 2]>)> {
        let mut out = Vec::new();
        let (x0, z0) = (cx * size as i32, cz * size as i32);
        let (x1, z1) = (x0 + size as i32, z0 + size as i32);
        for (index, v) in self.villages.iter().enumerate() {
            let cell = v.spacing * 16;
            let reach = v.radius + 24;
            for gx in (x0 - reach).div_euclid(cell)..=(x1 + reach).div_euclid(cell) {
                for gz in (z0 - reach).div_euclid(cell)..=(z1 + reach).div_euclid(cell) {
                    if let Some((parts, paths)) = self.village(index, gx, gz) {
                        out.push((index, parts, paths));
                    }
                }
            }
        }
        out
    }

    /// Centres of the villages in a square of world columns, for tests and
    /// tools: `(village index, centre structure origin)`.
    pub fn villages_in(&self, x0: i32, z0: i32, x1: i32, z1: i32) -> Vec<(usize, [i32; 3])> {
        let mut out = Vec::new();
        for (index, v) in self.villages.iter().enumerate() {
            let cell = v.spacing * 16;
            for gx in x0.div_euclid(cell)..=x1.div_euclid(cell) {
                for gz in z0.div_euclid(cell)..=z1.div_euclid(cell) {
                    if let Some((parts, _)) = self.village(index, gx, gz) {
                        out.push((index, parts[0].origin));
                    }
                }
            }
        }
        out
    }

    /// Every placed structure whose footprint touches the chunk.
    fn placed_touching(&self, cx: i32, cz: i32, size: usize) -> Vec<Placed> {
        let (x0, z0) = (cx * size as i32, cz * size as i32);
        let (x1, z1) = (x0 + size as i32, z0 + size as i32);
        let touches = |origin: [i32; 3], w: i32, d: i32| {
            origin[0] < x1 && origin[0] + w > x0 && origin[2] < z1 && origin[2] + d > z0
        };
        let mut out = Vec::new();
        for (index, st) in self.structures.iter().enumerate() {
            if st.placement == StructurePlacement::Village {
                continue;
            }
            let cell = st.spacing * 16;
            let (w, _, d) = st.size;
            for gx in (x0 - w).div_euclid(cell)..=x1.div_euclid(cell) {
                for gz in (z0 - d).div_euclid(cell)..=z1.div_euclid(cell) {
                    let Some(origin) = self.structure_origin(index, gx, gz) else {
                        continue;
                    };
                    if touches(origin, w, d) {
                        out.push(Placed {
                            structure: index,
                            origin,
                            turn: 0,
                        });
                    }
                }
            }
        }
        for (_, parts, _) in self.villages_near(cx, cz, size) {
            for p in parts {
                let (w, d) = turned_size(self.structures[p.structure].size, p.turn);
                if touches(p.origin, w, d) {
                    out.push(p);
                }
            }
        }
        out
    }

    /// Village paths: the path block on the surface, clearing ground cover.
    fn place_paths(&self, chunk: &mut GeneratedChunk) {
        let size = chunk.size as i32;
        let (x0, z0) = (chunk.cx * size, chunk.cz * size);
        for (index, _, paths) in self.villages_near(chunk.cx, chunk.cz, chunk.size) {
            let path = self.villages[index].path;
            for [x, z] in paths {
                let (lx, lz) = (x - x0, z - z0);
                if !(0..size).contains(&lx) || !(0..size).contains(&lz) {
                    continue;
                }
                let (lx, lz) = (lx as usize, lz as usize);
                let y = chunk.heights[lx * chunk.size + lz];
                if y < self.config.sea_level || y + 2 >= chunk.height as i32 {
                    continue;
                }
                let ground = chunk.get(lx, y as usize, lz);
                if ground == AIR || ground == self.water || ground == self.lava {
                    continue;
                }
                chunk.set(lx, y as usize, lz, path);
                let above = chunk.get(lx, y as usize + 1, lz);
                if self.cover_blocks.contains(&above) {
                    chunk.set(lx, y as usize + 1, lz, AIR);
                }
            }
        }
    }

    /// Where a structure stands in a grid cell, if it has one there:
    /// `(min x, floor y, min z)`.
    fn structure_origin(&self, index: usize, gx: i32, gz: i32) -> Option<[i32; 3]> {
        let st = &self.structures[index];
        let h = hash(
            self.config.seed,
            gx as i64,
            gz as i64,
            0x5757 + index as u64,
        );
        if unit(h) >= st.chance {
            return None;
        }
        let cell = st.spacing * 16;
        let (w, _, d) = st.size;
        let x = gx * cell + ((h >> 8) % (cell - w).max(1) as u64) as i32;
        let z = gz * cell + ((h >> 24) % (cell - d).max(1) as u64) as i32;
        let (cx, cz) = (x + w / 2, z + d / 2);
        let (surface, biome) = self.column(cx, cz);
        if !st.biomes.is_empty() && !st.biomes.contains(&biome) {
            return None;
        }
        let y = match st.placement {
            StructurePlacement::Village => return None,
            StructurePlacement::Surface => {
                if surface < self.config.sea_level || self.is_river(cx, cz) {
                    return None;
                }
                surface + st.y_offset
            }
            StructurePlacement::Underground => {
                st.min_y + ((h >> 40) % (st.max_y - st.min_y).max(1) as u64) as i32
            }
        };
        Some([x, y, z])
    }

    /// Every structure placed in the world whose footprint touches the
    /// given chunk: `(structure key, origin)` (the min corner of its turned
    /// footprint, at its floor).
    pub fn structures_touching(&self, cx: i32, cz: i32, size: usize) -> Vec<(String, [i32; 3])> {
        self.placed_touching(cx, cz, size)
            .into_iter()
            .map(|p| (self.structures[p.structure].key.clone(), p.origin))
            .collect()
    }

    fn place_structures(&self, chunk: &mut GeneratedChunk) {
        let size = chunk.size as i32;
        let (x0, z0) = (chunk.cx * size, chunk.cz * size);
        for placed in self.placed_touching(chunk.cx, chunk.cz, chunk.size) {
            let st = &self.structures[placed.structure];
            let origin = placed.origin;
            let (w, d) = turned_size(st.size, placed.turn);
            for tz in 0..d {
                for tx in 0..w {
                    let (x, z) = (origin[0] + tx - x0, origin[2] + tz - z0);
                    if !(0..size).contains(&x) || !(0..size).contains(&z) {
                        continue;
                    }
                    let (dx, dz) = drawn_cell(st.size, placed.turn, tx, tz);
                    let (x, z) = (x as usize, z as usize);
                    for (dy, layer) in st.cells.iter().enumerate() {
                        let y = origin[1] + dy as i32;
                        if y <= 0 || y >= chunk.height as i32 {
                            continue;
                        }
                        if let Some(id) = layer[dz as usize][dx as usize] {
                            chunk.set(x, y as usize, z, id);
                        }
                    }
                    // Fill the ground under the floor so it does not float.
                    let Some(fill) = st.foundation else { continue };
                    if st
                        .cells
                        .first()
                        .is_none_or(|l| l[dz as usize][dx as usize].is_none())
                    {
                        continue;
                    }
                    for y in (origin[1] - 8..origin[1]).rev() {
                        if y <= 0 {
                            break;
                        }
                        let here = chunk.get(x, y as usize, z);
                        if here != AIR && here != self.water && !self.cover_blocks.contains(&here) {
                            break;
                        }
                        chunk.set(x, y as usize, z, fill);
                    }
                }
            }
        }
    }

    fn place_ores(&self, chunk: &mut GeneratedChunk) {
        place_ores(&self.ores, self.config.seed, self.config.max_height, chunk);
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
                        let trunk =
                            tree.min_height + (hash(self.config.seed, wx, wz, 0x7E1) % span) as u32;
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

    fn place_tree(
        chunk: &mut GeneratedChunk,
        x: usize,
        y: usize,
        z: usize,
        trunk: usize,
        tree: &TreeSpec,
    ) {
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
        assert_ne!(
            a.generate_chunk(0, 0, 16).voxels,
            b.generate_chunk(0, 0, 16).voxels
        );
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
    fn rivers_cut_through_land_and_hold_water() {
        let (_, g) = generator(2024);
        let sea = g.config().sea_level;
        let mut river_columns = 0;
        let mut wet = 0;
        for i in -60..60 {
            for j in -60..60 {
                let (x, z) = (i * 37, j * 37);
                if g.is_river(x, z) {
                    river_columns += 1;
                    if g.surface_height(x, z) < sea {
                        wet += 1;
                    }
                }
            }
        }
        assert!(river_columns > 20, "found {river_columns} river columns");
        assert!(
            wet * 10 >= river_columns * 8,
            "river beds lie under water: {wet}/{river_columns}"
        );
    }

    #[test]
    fn ravines_open_deep_cuts_somewhere() {
        let (_, g) = generator(77);
        let mut deepest = 0;
        'search: for i in -80..80 {
            for j in -80..80 {
                let (x, z) = (i * 13, j * 13);
                let surface = g.surface_height(x, z);
                let mut depth = 0;
                for y in (12..surface).rev() {
                    if g.is_ravine(x, y, z, surface) {
                        depth += 1;
                    } else {
                        break;
                    }
                }
                deepest = deepest.max(depth);
                if deepest >= 15 {
                    break 'search;
                }
            }
        }
        assert!(deepest >= 15, "deepest ravine {deepest}");
    }

    #[test]
    fn structures_appear_whole_across_chunk_borders_with_loot_chests() {
        let (content, g) = generator(31);
        let chest = content.block("chest").unwrap().id;
        let mut seen = std::collections::BTreeMap::new();
        let mut loot_chests = 0;
        for cx in -30..30 {
            for cz in -30..30 {
                for (key, origin) in g.structures_touching(cx, cz, 16) {
                    seen.insert(key, origin);
                }
            }
        }
        assert!(seen.len() >= 3, "structures found: {seen:?}");
        // Generate every chunk a structure covers and check it is complete.
        for (key, origin) in seen.iter().take(3) {
            let st = content.structures().iter().find(|s| &s.key == key).unwrap();
            let (w, _, d) = st.size();
            let mut solid = 0;
            for cx in origin[0].div_euclid(16)..=(origin[0] + w as i32).div_euclid(16) {
                for cz in origin[2].div_euclid(16)..=(origin[2] + d as i32).div_euclid(16) {
                    let chunk = g.generate_chunk(cx, cz, 16);
                    for v in &chunk.voxels {
                        if v & 0xFFFF == chest && v >> LOOT_STAGE_SHIFT > 0 {
                            loot_chests += 1;
                        }
                    }
                    solid += 1;
                }
            }
            assert!(solid >= 1);
        }
        assert!(loot_chests >= 1, "structures carry loot chests");
    }

    /// The block at a world position, generating its chunk.
    fn block_at(g: &Generator, x: i32, y: i32, z: i32) -> u32 {
        let chunk = g.generate_chunk(x.div_euclid(16), z.div_euclid(16), 16);
        chunk.get(
            x.rem_euclid(16) as usize,
            y as usize,
            z.rem_euclid(16) as usize,
        ) & 0xFFFF
    }

    #[test]
    fn villages_have_a_well_houses_facing_it_and_paths() {
        let (content, g) = generator(5);
        let villages = g.villages_in(-8000, -8000, 8000, 8000);
        assert!(villages.len() >= 2, "villages: {villages:?}");
        let id = |k: &str| content.block(k).unwrap().id;
        let (water, gravel, door, chest) = (id("water"), id("gravel"), id("door"), id("chest"));
        let mut checked = 0;
        for (_, well) in villages.iter().take(4) {
            // The well's water (its 3 x 3 middle, at the surface layer).
            assert_eq!(block_at(&g, well[0] + 2, well[1] + 2, well[2] + 2), water);
            let (mut doors, mut paths, mut chests) = (0, 0, 0);
            let (cx, cz) = (well[0] + 2, well[2] + 2);
            for chunk_x in (cx - 28).div_euclid(16)..=(cx + 28).div_euclid(16) {
                for chunk_z in (cz - 28).div_euclid(16)..=(cz + 28).div_euclid(16) {
                    let chunk = g.generate_chunk(chunk_x, chunk_z, 16);
                    for v in &chunk.voxels {
                        let v = v & 0xFFFF;
                        doors += usize::from(v == door);
                        paths += usize::from(v == gravel);
                        chests += usize::from(v == chest);
                    }
                }
            }
            if doors == 0 {
                continue; // every house plot fell in water
            }
            assert!(paths >= 8, "paths join the houses: {paths}");
            assert!(chests >= 1);
            checked += 1;
        }
        assert!(checked >= 1, "a village with houses");
    }

    #[test]
    fn house_turns_keep_every_cell() {
        let size = (7, 5, 5);
        for turn in 0..4u8 {
            let (w, d) = turned_size(size, turn);
            let mut seen = std::collections::HashSet::new();
            for tz in 0..d {
                for tx in 0..w {
                    let (x, z) = drawn_cell(size, turn, tx, tz);
                    assert!((0..7).contains(&x) && (0..5).contains(&z));
                    seen.insert((x, z));
                }
            }
            assert_eq!(seen.len(), 35, "turn {turn}");
        }
        // The drawn front row (z = 0) ends up on the turned side.
        assert_eq!(drawn_cell(size, 1, 0, 3), (3, 0), "front faces -x");
        assert_eq!(drawn_cell(size, 2, 3, 4), (3, 0), "front faces +z");
        assert_eq!(drawn_cell(size, 3, 4, 3), (3, 0), "front faces +x");
    }

    #[test]
    fn cold_seas_and_lakes_freeze_over_and_warm_ones_do_not() {
        let (content, g) = generator(5);
        let ice = content.block("ice").unwrap().id;
        let water = content.block("water").unwrap().id;
        let sea = g.config().sea_level as usize;
        let (mut frozen, mut open) = (0, 0);
        for cx in -24..24 {
            for cz in -24..24 {
                if (cx + cz) % 4 != 0 {
                    continue; // a sample is enough
                }
                let chunk = g.generate_chunk(cx, cz, 16);
                for x in 0..16 {
                    for z in 0..16 {
                        let biome = &g.biomes[chunk.biomes[x * 16 + z] as usize];
                        let top = chunk.get(x, sea, z);
                        if top == ice {
                            assert!(biome.freezes, "ice only where it is cold ({})", biome.key);
                            assert_ne!(
                                chunk.get(x, sea - 1, z),
                                0,
                                "water or ground under the ice, never air"
                            );
                            frozen += 1;
                        } else if top == water && !biome.freezes {
                            open += 1;
                        }
                    }
                }
            }
        }
        assert!(frozen > 0, "some lake or sea froze");
        assert!(open > frozen, "most water stays open");
    }

    #[test]
    fn aquifers_hold_water_in_caves_under_dry_land() {
        let (content, g) = generator(9);
        let water = content.block("water").unwrap().id;
        let sea = g.config().sea_level;
        let mut found = 0;
        'chunks: for cx in -12..12 {
            for cz in -12..12 {
                let chunk = g.generate_chunk(cx, cz, 16);
                for x in 0..16 {
                    for z in 0..16 {
                        if chunk.heights[x * 16 + z] < sea + 4 {
                            continue; // seas and lakes hold water anyway
                        }
                        for y in 6..(sea - 14) as usize {
                            if chunk.get(x, y, z) == water {
                                found += 1;
                                if found > 50 {
                                    break 'chunks;
                                }
                            }
                        }
                    }
                }
            }
        }
        assert!(found > 50, "aquifer water under land: {found}");
    }

    #[test]
    fn biome_tints_vary_and_meet_at_chunk_corners() {
        let (_, g) = generator(3);
        let a = g.generate_chunk(4, 7, 16).tints.unwrap();
        let east = g.generate_chunk(5, 7, 16).tints.unwrap();
        let south = g.generate_chunk(4, 8, 16).tints.unwrap();
        assert_eq!(a[3..6], east[0..3], "shared corner with the east chunk");
        assert_eq!(a[6..9], south[0..3], "shared corner with the south chunk");
        let mut colours = std::collections::HashSet::new();
        for i in -20..20 {
            colours.insert(g.tint_at(i * 400, i * 300));
        }
        assert!(colours.len() >= 3, "tints differ by biome: {colours:?}");
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
