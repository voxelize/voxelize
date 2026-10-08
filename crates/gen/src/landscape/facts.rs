//! `ChunkFacts`: one record per chunk, the single source of truth for every
//! later pass, public query, flora rule and tool.
//!
//! Facts are structure-of-arrays over the chunk and a halo of `h` columns
//! on every side (default 2, cap 4), x fastest. They hold the continuous
//! final ground (one definition of ground), the solid top, the L2 slope,
//! aspect and curvature of final ground, temperature after the lapse,
//! moisture, the dithered biome, the zone, the resolved water and the
//! fields declared `keep: true` (as `f32`). Fields not kept are evaluated
//! into scratch and dropped.
//!
//! A point query builds the same record over a window of one column with
//! no halo, through the same code, so it equals the chunk's record bit for
//! bit (the determinism suite's `grid_equals_point`).

use smallvec::SmallVec;

use crate::climate::{BiomeBlend, BiomeId, MAX_AXES};

use super::compose::{CellStores, ClaimEntry, Claims, ProvinceEntry, SolidSpan};
use super::counters::{bump, Counter};
use super::fields::Area;
use super::index::NodeSet;
use super::lower::AxisSource;
use super::math::{soft_ceiling, soft_up, MinMax};
use super::surface::ZoneKey;
use super::water::{SeaModel, WaterColumn};
use super::Landscape;

/// Which intermediate state of the pipeline a query reads. A tier's answer
/// equals the full pipeline's state after that layer (composition is
/// ordered by layer and exclusion only flows forward, so composing the
/// layers up to a tier gives exactly that state).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Tier {
    /// After the base fields.
    Macro,
    /// After the Shore layer.
    Shaped,
    /// After the Water layer.
    Hydro,
    /// After the Detail layer (everything but fits).
    PreFit,
    /// Everything.
    Full,
}

/// A column's biome: the dithered id paint and flora use, and the blend
/// it came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct BiomeCell {
    /// The biome that owns the column after the border dither.
    pub id: BiomeId,
    /// The blend's primary biome.
    pub primary: BiomeId,
    /// The blend's runner-up (equal to `primary` when pure).
    pub secondary: BiomeId,
    /// The runner-up's weight, in 1/65535 units.
    pub edge: u16,
}

impl Default for BiomeCell {
    fn default() -> Self {
        Self {
            id: BiomeId(0),
            primary: BiomeId(0),
            secondary: BiomeId(0),
            edge: 0,
        }
    }
}

/// Resolved water per column (so far: the sea).
#[derive(Clone, Debug)]
pub struct WaterTile {
    /// The bottom y of the sea layer per column, or `i16::MAX` when dry.
    pub sea_bottom: Box<[i16]>,
}

/// One chunk's facts (see the module docs).
#[derive(Clone, Debug)]
pub struct ChunkFacts {
    /// The chunk's first interior column `(x, z)`.
    pub origin: (i32, i32),
    /// Interior columns per side.
    pub size: u16,
    /// Halo columns on every side.
    pub halo: u8,
    /// Continuous final ground.
    pub ground: Box<[f64]>,
    /// Solid top of the heightfield (voxel y is solid iff `y <= top`).
    pub top: Box<[i16]>,
    /// L2 slope of final ground.
    pub slope: Box<[f32]>,
    /// Unit downhill vector, `[0, 0]` on flats.
    pub aspect: Box<[[f32; 2]]>,
    /// Laplacian of final ground.
    pub curvature: Box<[f32]>,
    /// Temperature after the lapse.
    pub temperature: Box<[f32]>,
    /// Moisture.
    pub moisture: Box<[f32]>,
    /// Biome.
    pub biome: Box<[BiomeCell]>,
    /// Zone.
    pub zone: Box<[ZoneKey]>,
    /// Water.
    pub water: WaterTile,
    /// Kept fields, field-major: `kept[f * cells + i]`.
    pub kept: Box<[f32]>,
    /// Number of kept fields.
    pub kept_count: u16,
    /// Cave ceiling per column (`i16::MAX` where none), when a landform
    /// wrote one in this chunk.
    pub cave_ceiling: Option<Box<[i16]>>,
    /// The height the biome classifier saw (NaN where it saw final
    /// ground), when a landform wrote one in this chunk.
    pub classify: Option<Box<[f32]>>,
    /// The zone's owner per column (composition rank + 1; 0 where no
    /// landform wrote the zone), when a landform wrote one in this chunk.
    pub zone_owner: Option<Box<[u16]>>,
    /// Claims, `(stored index, entry)`, by index then bit.
    pub claims: Vec<(u16, ClaimEntry)>,
    /// Analytic solid spans, `(stored index, span)`.
    pub spans: Vec<(u16, SolidSpan)>,
    /// Province entries, `(stored index, entry)`, in composition order.
    pub provinces: Vec<(u16, ProvinceEntry)>,
    /// What composed here: `(node index, cell)`, in composition order
    /// (Field and region nodes carry cell `(i32::MIN, i32::MIN)`).
    pub instances: Vec<(u16, (i32, i32))>,
    /// Landform records (`FactKey<T>` stores).
    pub(crate) cells: CellStores,
}

/// One column's facts, as a point query returns them.
#[derive(Clone, Debug, PartialEq)]
pub struct ColumnFact {
    /// World x.
    pub x: i32,
    /// World z.
    pub z: i32,
    /// Continuous final ground.
    pub ground: f64,
    /// Solid top.
    pub top: i32,
    /// L2 slope (stored as `f32`, widened).
    pub slope: f64,
    /// Unit downhill vector.
    pub aspect: [f64; 2],
    /// Laplacian.
    pub curvature: f64,
    /// Temperature after the lapse.
    pub temperature: f64,
    /// Moisture.
    pub moisture: f64,
    /// Biome.
    pub biome: BiomeCell,
    /// Zone.
    pub zone: ZoneKey,
    /// Water layers.
    pub water: WaterColumn,
    /// Kept fields, in declaration order.
    pub kept: SmallVec<[f32; 8]>,
    /// Claims, by bit.
    pub claims: SmallVec<[ClaimEntry; 2]>,
    /// The cave ceiling, if a landform lowered it.
    pub cave_ceiling: Option<i32>,
}

impl ChunkFacts {
    /// Columns per side of the stored area.
    pub fn side(&self) -> usize {
        self.size as usize + 2 * self.halo as usize
    }

    /// Stored columns.
    pub fn cells(&self) -> usize {
        self.side() * self.side()
    }

    /// The stored area.
    pub fn area(&self) -> Area {
        Area {
            x0: self.origin.0 - self.halo as i32,
            z0: self.origin.1 - self.halo as i32,
            w: self.side(),
            d: self.side(),
        }
    }

    /// Index of world column `(x, z)`, if stored.
    #[inline]
    pub fn index(&self, x: i32, z: i32) -> Option<usize> {
        let h = self.halo as i32;
        let dx = x - (self.origin.0 - h);
        let dz = z - (self.origin.1 - h);
        let side = self.side() as i32;
        if dx < 0 || dz < 0 || dx >= side || dz >= side {
            None
        } else {
            Some((dz * side + dx) as usize)
        }
    }

    /// Kept field `f` at stored index `i`.
    pub fn kept_at(&self, f: usize, i: usize) -> f32 {
        self.kept[f * self.cells() + i]
    }

    /// The water column at stored index `i`.
    pub fn water_at(&self, i: usize, sea: &SeaModel) -> WaterColumn {
        let b = self.water.sea_bottom[i];
        if b == i16::MAX {
            WaterColumn::default()
        } else {
            sea.column(b as i32 - 1)
        }
    }

    /// The claims at stored index `i`, by bit.
    pub fn claims_at(&self, i: usize) -> SmallVec<[ClaimEntry; 2]> {
        let i = i as u16;
        let start = self.claims.partition_point(|(k, _)| *k < i);
        self.claims[start..]
            .iter()
            .take_while(|(k, _)| *k == i)
            .map(|(_, e)| *e)
            .collect()
    }

    /// The largest claim weight at stored index `i` over the bits of `c`.
    pub fn claim_weight(&self, i: usize, c: Claims) -> f64 {
        self.claims_at(i)
            .iter()
            .filter(|e| c.0 & (1 << e.bit) != 0)
            .fold(0.0f64, |w, e| w.fmax(e.weight as f64))
    }

    /// The cave ceiling at stored index `i`, if lowered.
    pub fn cave_ceiling_at(&self, i: usize) -> Option<i32> {
        self.cave_ceiling
            .as_ref()
            .map(|c| c[i])
            .filter(|&v| v != i16::MAX)
            .map(|v| v as i32)
    }

    /// The spans at stored index `i`.
    pub fn spans_at(&self, i: usize) -> Vec<SolidSpan> {
        self.spans
            .iter()
            .filter(|(k, _)| *k as usize == i)
            .map(|(_, s)| *s)
            .collect()
    }

    /// The province entries at stored index `i`.
    pub fn provinces_at(&self, i: usize) -> Vec<&ProvinceEntry> {
        self.provinces
            .iter()
            .filter(|(k, _)| *k as usize == i)
            .map(|(_, e)| e)
            .collect()
    }

    /// The column at world `(x, z)`, if stored.
    pub fn column(&self, x: i32, z: i32, sea: &SeaModel) -> Option<ColumnFact> {
        let i = self.index(x, z)?;
        Some(ColumnFact {
            x,
            z,
            ground: self.ground[i],
            top: self.top[i] as i32,
            slope: self.slope[i] as f64,
            aspect: [self.aspect[i][0] as f64, self.aspect[i][1] as f64],
            curvature: self.curvature[i] as f64,
            temperature: self.temperature[i] as f64,
            moisture: self.moisture[i] as f64,
            biome: self.biome[i],
            zone: self.zone[i],
            water: self.water_at(i, sea),
            kept: (0..self.kept_count as usize)
                .map(|f| self.kept_at(f, i))
                .collect(),
            claims: self.claims_at(i),
            cave_ceiling: self.cave_ceiling_at(i),
        })
    }

    /// Approximate heap bytes (the facts cache is capped by this).
    pub fn bytes(&self) -> usize {
        let n = self.cells();
        std::mem::size_of::<Self>()
            + n * (8 + 2 + 4 + 8 + 4 + 4 + 4 + std::mem::size_of::<BiomeCell>() + 2 + 2)
            + self.kept.len() * 4
            + self.cave_ceiling.as_ref().map_or(0, |c| c.len() * 2)
            + self.classify.as_ref().map_or(0, |c| c.len() * 4)
            + self.zone_owner.as_ref().map_or(0, |c| c.len() * 2)
            + self.claims.len() * std::mem::size_of::<(u16, ClaimEntry)>()
            + self.spans.len() * std::mem::size_of::<(u16, SolidSpan)>()
            + self.provinces.len() * (std::mem::size_of::<(u16, ProvinceEntry)>() + 32)
            + self.instances.len() * 12
            + self.cells.0.iter().map(|(_, c)| c.bytes()).sum::<usize>()
    }

    /// FNV digest of every channel's bits (golden and determinism tests).
    pub fn digest(&self) -> u64 {
        let mut h: u64 = 0xcbf29ce484222325;
        let mut eat = |v: u64| {
            h ^= v;
            h = h.wrapping_mul(0x100000001b3);
        };
        for i in 0..self.cells() {
            eat(self.ground[i].to_bits());
            eat(self.top[i] as u16 as u64);
            eat(self.slope[i].to_bits() as u64);
            eat(self.aspect[i][0].to_bits() as u64);
            eat(self.aspect[i][1].to_bits() as u64);
            eat(self.curvature[i].to_bits() as u64);
            eat(self.temperature[i].to_bits() as u64);
            eat(self.moisture[i].to_bits() as u64);
            let b = self.biome[i];
            eat(((b.id.0 as u64) << 48)
                | ((b.primary.0 as u64) << 32)
                | ((b.secondary.0 as u64) << 16)
                | b.edge as u64);
            eat(self.zone[i].0 as u64);
            eat(self.water.sea_bottom[i] as u16 as u64);
        }
        for v in self.kept.iter() {
            eat(v.to_bits() as u64);
        }
        // Composition channels join the digest only where a landform wrote
        // them, so a landscape without nodes digests as before.
        if let Some(c) = &self.cave_ceiling {
            eat(0xCE11);
            for v in c.iter() {
                eat(*v as u16 as u64);
            }
        }
        if let Some(c) = &self.classify {
            eat(0xC1A5);
            for v in c.iter() {
                eat(v.to_bits() as u64);
            }
        }
        // Owners are composition ranks, which shift when a node is added
        // or disabled elsewhere; they are provenance, so the digest leaves
        // them out (what they decide reaches the voxels and their digest).
        for (i, e) in &self.claims {
            eat(((*i as u64) << 48) | ((e.bit as u64) << 40));
            eat(e.weight.to_bits() as u64);
        }
        for (i, sp) in &self.spans {
            eat(*i as u64);
            eat(sp.lo as i64 as u64);
            eat(sp.hi as i64 as u64);
            eat(sp.block as u64);
        }
        for (i, p) in &self.provinces {
            eat(*i as u64);
            eat(crate::stream::fnv1a_64(p.kind.as_bytes()));
            eat(p.lo as i64 as u64);
            eat(p.hi as i64 as u64);
            eat(p.weight.to_bits() as u64);
        }
        h
    }
}

/// The solid top of a column of continuous ground `g`: voxel `y` is solid
/// where the heightfield density `g + 0.5 - y` is positive.
#[inline]
pub fn solid_top(g: f64) -> i32 {
    (g + 0.5).ceil() as i32 - 1
}

/// Slope (L2), downhill aspect and Laplacian from final ground at a column
/// and its four neighbours (east, west, south, north).
#[inline]
pub fn stencil(c: f64, e: f64, w: f64, s: f64, n: f64) -> (f64, [f64; 2], f64) {
    let gx = (e - w) * 0.5;
    let gz = (s - n) * 0.5;
    let slope = (gx * gx + gz * gz).sqrt();
    let aspect = if slope > 1e-9 {
        [-gx / slope, -gz / slope]
    } else {
        [0.0, 0.0]
    };
    (slope, aspect, e + w + s + n - 4.0 * c)
}

struct NoZoned;

impl crate::climate::AxisSampler for NoZoned {
    fn sample_axis(&self, _: usize, _: i32, _: i32) -> f64 {
        unreachable!("landscape partitions are single or climate-matched")
    }
}

impl Landscape {
    /// Final ground from the spine field's value: the floor clamp, then
    /// the soft ceiling (always last).
    #[inline]
    pub(crate) fn finish_ground(&self, g: f64) -> f64 {
        let f = &self.frame;
        let floored = soft_up(g, f.bedrock + 0.5 * FLOOR_ROUND, FLOOR_ROUND);
        soft_ceiling(floored, f.knee, f.cap)
    }

    /// The biome of a column from its axis values and top.
    pub(crate) fn biome_of(
        &self,
        x: i32,
        z: i32,
        axes: &SmallVec<[f64; MAX_AXES]>,
        top: i32,
    ) -> BiomeCell {
        let base = self.climate.partition.base_blend(x, z, axes, &NoZoned);
        let sea = if self.sea.enabled {
            Some(self.sea.level)
        } else {
            None
        };
        let blend: BiomeBlend = self.climate.partition.apply_overlays(base, top, sea);
        let (secondary, weight) = blend.secondary().unwrap_or((blend.primary, 0.0));
        let id = if weight > 0.0 {
            // A smooth field, not a per-column hash: the runner-up takes
            // the column where the field dips under its weight, so a border
            // frays in tongues that widen toward the line.
            let n = self.dither.sample(x as f64 + 0.5, z as f64 + 0.5);
            let roll = (0.5 + 0.5 * n).fclamp(0.0, 1.0);
            if (roll as f32) < weight {
                secondary
            } else {
                blend.primary
            }
        } else {
            blend.primary
        };
        BiomeCell {
            id,
            primary: blend.primary,
            secondary,
            edge: ((weight as f64).fclamp(0.0, 1.0) * 65535.0) as u16,
        }
    }

    /// Build facts for the `size x size` columns from `origin`, with `halo`
    /// columns around them, composing every node.
    pub fn build_facts(&self, origin: (i32, i32), size: usize, halo: i32) -> ChunkFacts {
        self.build_facts_in(origin, size, halo, &self.all_nodes)
    }

    /// [`Landscape::build_facts`] at a tier: composing only the layers up
    /// to it.
    pub fn build_facts_at(
        &self,
        origin: (i32, i32),
        size: usize,
        halo: i32,
        tier: Tier,
    ) -> ChunkFacts {
        self.build_facts_in(origin, size, halo, self.tier_set(tier))
    }

    /// Build facts composing node set `set`.
    pub(crate) fn build_facts_in(
        &self,
        origin: (i32, i32),
        size: usize,
        halo: i32,
        set: &NodeSet,
    ) -> ChunkFacts {
        bump(Counter::FactsBuilt, 1);
        let stored = Area {
            x0: origin.0 - halo,
            z0: origin.1 - halo,
            w: size + 2 * halo as usize,
            d: size + 2 * halo as usize,
        };
        let grid = self.fields.evaluate(stored, 1, &self.tiles);
        // Final ground over the stored area grown by one (for the stencil):
        // the spine, then composition, then the floor and the ceiling.
        let wide = stored.grow(1);
        let mut ground_wide = vec![0.0f64; wide.len()];
        for dz in 0..wide.d {
            let z = wide.z0 + dz as i32;
            for dx in 0..wide.w {
                let x = wide.x0 + dx as i32;
                ground_wide[dz * wide.w + dx] = grid.output(self.slots.ground, x, z);
            }
        }
        let dispatch = self.dispatch(wide, set);
        let comp = if dispatch.is_empty() {
            None
        } else {
            let c = self.compose(wide, ground_wide, &dispatch, None);
            ground_wide = c.ground.clone();
            Some(c)
        };
        for g in ground_wide.iter_mut() {
            *g = self.finish_ground(*g);
        }
        let n = stored.len();
        let kept_count = self.slots.kept.len();
        let mut f = ChunkFacts {
            origin,
            size: size as u16,
            halo: halo as u8,
            ground: vec![0.0; n].into(),
            top: vec![0; n].into(),
            slope: vec![0.0; n].into(),
            aspect: vec![[0.0; 2]; n].into(),
            curvature: vec![0.0; n].into(),
            temperature: vec![0.0; n].into(),
            moisture: vec![0.0; n].into(),
            biome: vec![BiomeCell::default(); n].into(),
            zone: vec![ZoneKey::NONE; n].into(),
            water: WaterTile {
                sea_bottom: vec![i16::MAX; n].into(),
            },
            kept: vec![0.0; kept_count * n].into(),
            kept_count: kept_count as u16,
            cave_ceiling: None,
            classify: None,
            zone_owner: None,
            claims: Vec::new(),
            spans: Vec::new(),
            provinces: Vec::new(),
            instances: Vec::new(),
            cells: CellStores(Vec::new()),
        };
        if let Some(c) = &comp {
            if c.cave_ceiling.is_some() {
                f.cave_ceiling = Some(vec![i16::MAX; n].into());
            }
            if c.classify.is_some() {
                f.classify = Some(vec![f32::NAN; n].into());
            }
            if c.zone.is_some() {
                f.zone_owner = Some(vec![0u16; n].into());
            }
            f.instances = dispatch
                .iter()
                .map(|d| match d {
                    super::index::Dispatch::Planned(i) => (i.node, i.cell),
                    super::index::Dispatch::Field(n) | super::index::Dispatch::Region(n) => {
                        (*n, (i32::MIN, i32::MIN))
                    }
                })
                .collect();
            for (wi, sp) in &c.spans {
                if let Some(i) = stored_index(wide, stored, *wi as usize) {
                    f.spans.push((i as u16, *sp));
                }
            }
            for (wi, e) in &c.provinces {
                if let Some(i) = stored_index(wide, stored, *wi as usize) {
                    f.provinces.push((i as u16, e.clone()));
                }
            }
            f.cells = CellStores(
                c.cells
                    .0
                    .iter()
                    .map(|(node, store)| (*node, store.crop(wide, stored)))
                    .collect(),
            );
        }
        let h = self.frame.height as i32;
        let sea = self.frame.sea as f64;
        let relief = self.frame.relief;
        let mut axes: SmallVec<[f64; MAX_AXES]> = SmallVec::new();
        for dz in 0..stored.d {
            let z = stored.z0 + dz as i32;
            for dx in 0..stored.w {
                let x = stored.x0 + dx as i32;
                let i = dz * stored.w + dx;
                let wi = (dz + 1) * wide.w + dx + 1;
                let g = ground_wide[wi];
                let (mut slope, aspect, curvature) = stencil(
                    g,
                    ground_wide[wi + 1],
                    ground_wide[wi - 1],
                    ground_wide[wi + wide.w],
                    ground_wide[wi - wide.w],
                );
                let top = solid_top(g).fclamp_i(0, h - 1);
                // What the biome classifier sees: final ground, unless a
                // landform wrote `classify_as` here.
                let mut class_g = g;
                if let Some(c) = &comp {
                    if let Some(hint) = &c.slope_hint {
                        if hint[wi].is_finite() {
                            slope = hint[wi];
                        }
                    }
                    if let Some(cl) = &c.classify {
                        if cl[wi].2 > 0 {
                            class_g = cl[wi].0;
                            f.classify.as_mut().unwrap()[i] = class_g as f32;
                        }
                    }
                    if let Some(z) = &c.zone {
                        if z[wi].2 > 0 {
                            f.zone[i] = z[wi].0;
                            f.zone_owner.as_mut().unwrap()[i] = z[wi].2;
                        }
                    }
                    if let Some(cc) = &c.cave_ceiling {
                        if cc[wi] != i32::MAX {
                            f.cave_ceiling.as_mut().unwrap()[i] =
                                cc[wi].fclamp_i(i16::MIN as i32, i16::MAX as i32 - 1) as i16;
                        }
                    }
                    if let Some(cl) = &c.claims {
                        let mut entries: SmallVec<[ClaimEntry; 2]> = cl[wi].clone();
                        entries.sort_by_key(|e| e.bit);
                        for e in entries {
                            f.claims.push((i as u16, e));
                        }
                    }
                }
                let class_top = solid_top(class_g).fclamp_i(0, h - 1);
                let temperature = grid.output(self.slots.temperature, x, z)
                    - self.climate.lapse * (g - sea) / relief;
                let moisture = grid.output(self.slots.moisture, x, z);
                axes.clear();
                for a in &self.climate.axes {
                    axes.push(match *a {
                        AxisSource::Temperature => temperature,
                        AxisSource::Moisture => moisture,
                        AxisSource::HeightShare => (class_g - sea) / relief,
                        AxisSource::Field(slot) => grid.output(slot, x, z),
                    });
                }
                f.ground[i] = g;
                f.top[i] = top as i16;
                f.slope[i] = slope as f32;
                f.aspect[i] = [aspect[0] as f32, aspect[1] as f32];
                f.curvature[i] = curvature as f32;
                f.temperature[i] = temperature as f32;
                f.moisture[i] = moisture as f32;
                f.biome[i] = self.biome_of(x, z, &axes, class_top);
                if let Some(layer) = self.sea.layer(top) {
                    f.water.sea_bottom[i] = layer.bottom as i16;
                }
                for (k, &slot) in self.slots.kept.iter().enumerate() {
                    f.kept[k * n + i] = grid.output(slot, x, z) as f32;
                }
            }
        }
        f
    }
}

/// Rounding width of the floor clamp, in blocks.
pub const FLOOR_ROUND: f64 = 4.0;

/// The stored index of wide index `wi` (the stored area grown by one), if
/// it lies in the stored area.
fn stored_index(wide: Area, stored: Area, wi: usize) -> Option<usize> {
    let x = wide.x0 + (wi % wide.w) as i32;
    let z = wide.z0 + (wi / wide.w) as i32;
    let (dx, dz) = (x - stored.x0, z - stored.z0);
    (dx >= 0 && dz >= 0 && (dx as usize) < stored.w && (dz as usize) < stored.d)
        .then(|| dz as usize * stored.w + dx as usize)
}

trait ClampI {
    fn fclamp_i(self, lo: i32, hi: i32) -> i32;
}

impl ClampI for i32 {
    fn fclamp_i(self, lo: i32, hi: i32) -> i32 {
        Ord::min(Ord::max(self, lo), hi)
    }
}
