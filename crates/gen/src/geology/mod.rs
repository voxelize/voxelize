//! Deterministic coarse-geology solver: the height backbone that replaces
//! per-point noise composition for showcase worlds.
//!
//! The visual grammar of real terrain — mountain chains with branching
//! ridges, dendritic valley networks, drainage that reaches the sea — is
//! the fingerprint of tectonic uplift sculpted by fluvial erosion. Noise
//! cannot fake that per-point, and Terrain Diffusion (arXiv:2512.08309)
//! learns it from real DEMs at GPU cost. This module reproduces the
//! grammar with the physics instead of the network, on the same
//! infinite-access contract the paper engineers for:
//!
//! - an analytic plate graph assigns every point a plate, a motion
//!   vector, and a boundary class (collision belt, volcanic arc, island
//!   arc, rift, trench, transform) — macro-composition is authored, not
//!   emergent from octaves;
//! - a per-tile stream-power erosion solve (priority-flood pit fill,
//!   steepest-descent receivers, flow accumulation, channel incision,
//!   hillslope diffusion, talus relaxation, and a glacial widening tail
//!   above the snowline) carves branching valleys and connected
//!   ridgelines into the uplift prior;
//! - overlapping tile solves fuse under partition-of-unity weights — the
//!   overlap-fusion idea InfiniteDiffusion uses to make windowed
//!   generation seamless — so heights are continuous everywhere, chunk
//!   order never matters, and any region can be queried cold.
//!
//! Everything is IEEE add/mul/sqrt/floor over stream-seeded hashes: same
//! seed, same world, any machine, any query order.

use std::collections::BinaryHeap;
use std::sync::{Arc, RwLock};

use hashbrown::HashMap;
use serde::Serialize;
use smallvec::SmallVec;
use crate::{cell_id, hash_unit, mix64, stream_seed, SaltPath, Subsystem};

use crate::channels::{ChannelField, ChannelPoint, ChannelProfile};

/// Town-authored geology: every knob that shapes the planet lives here.
#[derive(Debug, Clone, Serialize)]
pub struct GeologySpec {
    pub salt: SaltPath,
    /// Blocks per solve cell. 4 keeps ridge crests crisp after bicubic
    /// upsampling while a 1024-block tile stays a 256-cell grid.
    pub cell: i32,
    /// Interior tile span in blocks (stride of the tile lattice).
    pub tile: i32,
    /// Halo cells solved beyond the interior on every side: drainage
    /// context and the fusion band. Bigger halos mean longer coherent
    /// valleys and softer tile blending.
    pub halo_cells: i32,

    // -- plates: the macro-composition --
    /// Plate site lattice spacing in blocks.
    pub plate_cell: f64,
    /// Jitter of plate sites inside their lattice cell, 0..0.5.
    pub plate_jitter: f64,
    /// Domain-warp amplitude applied to the plate graph in blocks: bends
    /// boundaries into arcs and roughens margins — without it plates are
    /// ruler-straight Voronoi polygons.
    pub plate_warp_amp: f64,
    /// Warp wavelength in blocks.
    pub plate_warp_scale: f64,
    /// Fraction of plates that carry continental crust.
    pub continental_share: f64,
    /// Blocks the continental margin takes to fall to abyssal depth.
    pub margin_width: f64,
    /// Land interior height above sea level, before belts and erosion.
    pub base_land: f64,
    /// Abyssal plain depth below sea level (negative offset applied).
    pub base_ocean: f64,
    /// Low-frequency interior undulation amplitude (craton swells): the
    /// inherited relief the incision then carves valleys into — a flat
    /// prior has no slope and erosion never bites.
    pub swell_amp: f64,
    /// Swell wavelength in blocks.
    pub swell_scale: f64,
    /// Swell octave count: more octaves seed finer inherited relief.
    pub swell_octaves: u8,
    /// Province variation: some interiors are upland plateaus, others
    /// lowlands. Amplitude in blocks over `plateau_scale` wavelengths.
    pub plateau_amp: f64,
    pub plateau_scale: f64,

    // -- boundary ribbons --
    /// Collision belts (continent meets continent): the great chains.
    pub belt_collision: BeltSpec,
    /// Volcanic arcs (ocean subducts under continent): coastal ranges.
    pub belt_arc: BeltSpec,
    /// Blocks the volcanic arc spine sits inland of the boundary, on
    /// full continental crust — on the margin ramp itself an arc can
    /// only ever make hills.
    pub arc_inland_offset: f64,
    /// Island arcs (ocean meets ocean): offshore chains.
    pub belt_island_arc: BeltSpec,
    /// Blocks the island arc spine sits back from the boundary.
    pub island_arc_offset: f64,
    /// Rift floors (continent diverges): lowered basins.
    pub rift_depth: f64,
    pub rift_width: f64,
    /// Oceanic trench alongside subduction fronts.
    pub trench_depth: f64,
    pub trench_width: f64,
    /// Convergence dead zone: |approach| below this is a transform
    /// boundary with no ribbon.
    pub convergence_floor: f64,
    /// Approach span over which a ribbon reaches full authored height:
    /// strength = clamp((approach - floor) / span). Without it typical
    /// collisions only ever lift a third of the authored belt.
    pub belt_strength_span: f64,

    // -- erosion solve --
    pub iterations: u16,
    /// Priority-flood pit-fill cadence, in iterations.
    pub fill_every: u16,
    /// Stream-power constant K. Incision solves implicitly along the
    /// receiver forest (Braun–Willett), so `dt` can be geological and a
    /// handful of iterations reaches the deeply dissected state that
    /// explicit stepping needs hundreds for.
    pub erode_k: f64,
    pub erode_m: f64,
    pub dt: f64,
    /// Uplift rate for continental interiors (blocks per unit time):
    /// sets the steady-state relief of the dissected uplands — zero
    /// interior uplift erodes toward a featureless plain.
    pub interior_uplift: f64,
    /// Hillslope diffusion constant (soil creep; rounds foothills).
    pub diffusion: f64,
    /// Diffusion multiplier above the snowline: frost shattering, not
    /// soil creep, rules high crests — full diffusion up there planes
    /// the arêtes into slabs.
    pub high_diffusion_share: f64,
    /// Talus threshold in blocks per cell; steeper faces shed material.
    pub talus: f64,
    /// Belt uplift in blocks per unit time while the solve runs: young
    /// mountains stay sharp because they rise as they erode.
    pub uplift_rate: f64,
    /// Initial tie-break relief in blocks: without it the first
    /// receivers on a flat prior are axis-aligned and the network starts
    /// griddy.
    pub seed_relief: f64,

    // -- glacial tail pass --
    /// Height above which the glacial pass widens valley heads.
    pub snowline: f64,
    /// Iterations of cirque widening at the end of the solve.
    pub glacial_iterations: u16,
    /// Strength of hollow-widening above the snowline, 0..1.
    pub glacial_strength: f64,

    /// Minimum fill depth (blocks) for a pit to count as a lake: the
    /// epsilon fill otherwise turns every shallow swell dip into a
    /// block-deep puddle the size of a county.
    pub lake_min_depth: f64,

    // -- ceiling --
    /// Soft compression start: heights above it squeeze toward
    /// `ceiling_max` on a rational curve, so extreme peaks cannot clip
    /// the world roof into mesa tops.
    pub ceiling_start: f64,
    pub ceiling_max: f64,

    // -- channels --
    /// Flow accumulation (cells) at which drainage becomes a river.
    pub channel_area: f64,
    /// Flow accumulation at which a river reaches full profile.
    pub channel_area_full: f64,
    /// River channel half-width at threshold and at full flow.
    pub river_width: (f64, f64),
    /// Channel depth below the water surface at threshold and full flow.
    pub river_depth: (f64, f64),
    /// Containment band beyond the channel, in blocks.
    pub river_bank: f64,

    // -- sub-cell detail --
    /// Amplitude in blocks of slope-modulated sub-cell texture. Texture,
    /// not form: the macro shape is entirely the solve's.
    pub detail_amp: f64,
    /// Detail wavelength in blocks.
    pub detail_scale: f64,
    /// A second, broader texture band: what keeps gentle gradients from
    /// quantizing into perfect contour stairs. Same slope response as
    /// the fine band.
    pub detail_broad_amp: f64,
    pub detail_broad_scale: f64,
    /// Slope-response floor 0..1: even dead-flat ground keeps this
    /// share of the texture, so contour lines wander on plains too.
    pub detail_floor: f64,

    /// Sub-cell landforms: buttress ribs, gully incisions, strata
    /// benches. Form between the solve's 4-block cells, where isotropic
    /// texture alone leaves smooth pyramids wearing contour rings.
    pub relief: ReliefSpec,
    /// The moisture answer ecology reads: water proximity, drainage
    /// flow, and height above sea folded to 0..1.
    pub moisture: MoistureSpec,

    /// Channel node displacement as a multiple of local channel width:
    /// drainage runs cell-center to cell-center on a 4-block lattice,
    /// and without displacement every reach reads as surveyed canal.
    pub meander_amp: f64,
    /// Wavelength in blocks of the meander displacement field.
    pub meander_scale: f64,
    /// Pool-and-riffle depth modulation along the channel: share of the
    /// node depth (0..0.5) the along-channel noise adds and removes, so
    /// reaches alternate deep pools with shallow riffles instead of one
    /// uniform trench.
    pub riffle_amp: f64,
    /// Wavelength in blocks of the pool-riffle alternation.
    pub riffle_scale: f64,

    pub sea_level: i32,
}

/// Slope-engaged sub-cell landforms. All amplitudes in blocks; zero
/// amplitude disables a term.
#[derive(Debug, Clone, Serialize)]
pub struct ReliefSpec {
    /// Spur-and-gully corrugation amplitude at full engagement.
    pub rib_amp: f64,
    /// Across-slope corrugation wavelength in blocks.
    pub rib_scale: f64,
    /// Downslope stretch of corrugation cells (>1 elongates spurs
    /// downhill; 1 is isotropic).
    pub rib_stretch: f64,
    /// Slope window (engage, saturate) for the corrugation.
    pub rib_slope: (f64, f64),
    /// Max vertical pull toward the strata band grid.
    pub bench_amp: f64,
    /// Vertical spacing between resistant strata bands in blocks.
    pub bench_spacing: f64,
    /// Tread share of each band (0..0.45): how much of the spacing lies
    /// flat before the riser.
    pub bench_tread: f64,
    /// Band-phase warp amplitude in blocks — what keeps benches from
    /// forming level rings around every hill.
    pub bench_warp_amp: f64,
    /// Horizontal wavelength of the band-phase warp.
    pub bench_warp_scale: f64,
    /// Slope window (engage, saturate) for benching.
    pub bench_slope: (f64, f64),
    /// Flow accumulation (cells) at which relief has calmed to half:
    /// valley floors and drainage lines stay smooth for rivers.
    pub calm_flow: f64,
    /// Height above sea (blocks) where ribs and benches reach full
    /// strength; at and below the waterline they are off, so coasts,
    /// shelves, and straits keep exactly the solved shoreline.
    pub shore_calm_band: f64,
}

/// Folds water proximity, drainage flow, and height above sea into the
/// 0..1 moisture ecology reads. Weights are shares of the answer.
#[derive(Debug, Clone, Serialize)]
pub struct MoistureSpec {
    /// Reach in blocks of channel/lake proximity wetting.
    pub reach: f64,
    /// Flow accumulation (cells) at which drainage wetting is half.
    pub flow_half: f64,
    /// Height above sea in blocks at which elevation has fully dried
    /// the column.
    pub dry_height: f64,
    pub proximity_weight: f64,
    pub flow_weight: f64,
    pub elevation_weight: f64,
}

/// One uplift ribbon class along a plate boundary.
#[derive(Debug, Clone, Serialize)]
pub struct BeltSpec {
    /// Peak prior uplift in blocks at the ribbon spine.
    pub height: f64,
    /// Ribbon half-width in blocks.
    pub width: f64,
    /// Along-spine segmentation wavelength in blocks: breaks the ribbon
    /// into massifs and passes instead of a uniform wall.
    pub segment_scale: f64,
    /// 0..1 share of the ribbon segmentation can suppress at passes.
    pub segment_depth: f64,
    /// Continued-uplift multiplier while the solve runs.
    pub uplift: f64,
    /// The orogenic root: a second, broader and lower uplift under the
    /// crest ribbon — the foothill apron. Share of `height` it carries.
    pub root_share: f64,
    /// Root half-width as a multiple of `width`.
    pub root_width_factor: f64,
}

const NEIGHBORS8: [(i32, i32, f64); 8] = [
    (-1, 0, 1.0),
    (1, 0, 1.0),
    (0, -1, 1.0),
    (0, 1, 1.0),
    (-1, -1, std::f64::consts::SQRT_2),
    (-1, 1, std::f64::consts::SQRT_2),
    (1, -1, std::f64::consts::SQRT_2),
    (1, 1, std::f64::consts::SQRT_2),
];

const TILE_CACHE_CAP: usize = 64;

/// Boundary classes the plate graph can assign to a point.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum BoundaryClass {
    Interior,
    Collision,
    VolcanicArc,
    IslandArc,
    Rift,
    Trench,
    Transform,
}

#[derive(Debug, Clone, Copy)]
struct PlateSite {
    x: f64,
    z: f64,
    vx: f64,
    vz: f64,
    is_continental: bool,
}

/// Prior sample: the authored macro-composition at one point.
#[derive(Debug, Clone, Copy)]
pub struct PriorSample {
    pub height: f64,
    pub class: BoundaryClass,
    pub uplift_rate: f64,
}

/// The solved coarse grid over one tile extent (interior plus halo).
pub struct GeoTile {
    origin_x: i32,
    origin_z: i32,
    /// Cells per side (interior + 2 * halo).
    side: usize,
    /// Solved surface height in blocks (world y).
    height: Vec<f32>,
    /// Hydraulically filled surface: equals height except in lakes,
    /// where it is the lake's water level.
    filled: Vec<f32>,
    /// Flow accumulation in cells.
    flow: Vec<f32>,
    /// Lake mask from the final pit fill.
    lake: Vec<bool>,
    /// Steepest-descent receiver of every cell over the filled surface.
    receiver: Vec<u32>,
}

/// Hydrology derived from a solved tile plus its already-solved
/// neighbors: channel polylines with fused water levels, and the
/// per-cell verdict on which lakes may actually hold water. Split from
/// `GeoTile` because it reads the *fused* surface — computing it inside
/// the tile solve would recurse.
pub struct TileHydro {
    pub channels: ChannelField,
    /// Per-cell: false when the cell's lake basin is contested by a
    /// neighboring tile's solution and must stay dry (see
    /// `lake_verdicts`).
    lake_keep: Vec<bool>,
}

impl GeoTile {
    #[inline]
    fn slot(&self, ix: i32, iz: i32) -> usize {
        ix as usize * self.side + iz as usize
    }

    /// Bicubic (Catmull-Rom) height at block coordinates: continuous and
    /// C1 across cell boundaries inside the tile extent. The result is
    /// clamped to the range of the four surrounding cells — raw
    /// Catmull-Rom overshoots ~12% of a step, which at a 40-block gorge
    /// wall is a five-block overhang lip hanging into the air.
    fn height_at(&self, cell: f64, x: f64, z: f64) -> f64 {
        let gx = (x - self.origin_x as f64) / cell;
        let gz = (z - self.origin_z as f64) / cell;
        let ixf = gx.floor();
        let izf = gz.floor();
        let fx = gx - ixf;
        let fz = gz - izf;
        let ix = ixf as i32;
        let iz = izf as i32;
        let side = self.side as i32;
        let fetch = |dx: i32, dz: i32| -> f64 {
            let cx = (ix + dx).clamp(0, side - 1);
            let cz = (iz + dz).clamp(0, side - 1);
            self.height[self.slot(cx, cz)] as f64
        };
        let mut rows = [0.0f64; 4];
        for (row, item) in rows.iter_mut().enumerate() {
            let dz = row as i32 - 1;
            *item = catmull(fetch(-1, dz), fetch(0, dz), fetch(1, dz), fetch(2, dz), fx);
        }
        let value = catmull(rows[0], rows[1], rows[2], rows[3], fz);
        let c00 = fetch(0, 0);
        let c10 = fetch(1, 0);
        let c01 = fetch(0, 1);
        let c11 = fetch(1, 1);
        let low = c00.min(c10).min(c01).min(c11);
        let high = c00.max(c10).max(c01).max(c11);
        value.clamp(low, high)
    }

    /// Bilinear flow accumulation at block coordinates.
    fn flow_at(&self, cell: f64, x: f64, z: f64) -> f64 {
        let side = self.side;
        let gx = ((x - self.origin_x as f64) / cell).clamp(0.0, (side - 1) as f64);
        let gz = ((z - self.origin_z as f64) / cell).clamp(0.0, (side - 1) as f64);
        let ix = (gx.floor() as usize).min(side - 2);
        let iz = (gz.floor() as usize).min(side - 2);
        let fx = gx - ix as f64;
        let fz = gz - iz as f64;
        let f00 = self.flow[ix * side + iz] as f64;
        let f10 = self.flow[(ix + 1) * side + iz] as f64;
        let f01 = self.flow[ix * side + iz + 1] as f64;
        let f11 = self.flow[(ix + 1) * side + iz + 1] as f64;
        f00 * (1.0 - fx) * (1.0 - fz) + f10 * fx * (1.0 - fz) + f01 * (1.0 - fx) * fz
            + f11 * fx * fz
    }

    /// Nearest-cell slot for block coordinates, when they fall inside
    /// this tile's solved extent.
    fn slot_at(&self, cell: f64, x: f64, z: f64) -> Option<usize> {
        let gx = ((x - self.origin_x as f64) / cell).round() as i32;
        let gz = ((z - self.origin_z as f64) / cell).round() as i32;
        let side = self.side as i32;
        if gx < 0 || gz < 0 || gx >= side || gz >= side {
            return None;
        }
        Some(self.slot(gx, gz))
    }

    /// Lake water level at block coordinates, if the nearest cell sits
    /// under a solved lake.
    fn lake_level_at(&self, cell: f64, x: f64, z: f64) -> Option<(usize, f64)> {
        let slot = self.slot_at(cell, x, z)?;
        if self.lake[slot] {
            Some((slot, self.filled[slot] as f64))
        } else {
            None
        }
    }

}

fn catmull(p0: f64, p1: f64, p2: f64, p3: f64, t: f64) -> f64 {
    let t2 = t * t;
    let t3 = t2 * t;
    0.5 * ((2.0 * p1)
        + (p2 - p0) * t
        + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
        + (3.0 * p1 - p0 - 3.0 * p2 + p3) * t3)
}

/// Heap entry for priority-flood: min-heap by fill level.
#[derive(PartialEq)]
struct FloodEntry {
    level: f64,
    index: usize,
}

impl Eq for FloodEntry {}

impl Ord for FloodEntry {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // Reverse for a min-heap; break level ties by index so ordering
        // is total and deterministic.
        other
            .level
            .partial_cmp(&self.level)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(other.index.cmp(&self.index))
    }
}

impl PartialOrd for FloodEntry {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

/// Compiled geology model: plate graph + tile solver + fused sampling.
pub struct GeoModel {
    spec: GeologySpec,
    plate_seed: u64,
    swell_seed: u64,
    detail_seed: u64,
    relief_seed: u64,
    segment_seed: u64,
    rib_seed: u64,
    bench_seed: u64,
    meander_seed: u64,
    /// Widest reach any consumer asks of the channel field beyond the
    /// solver's own (riparian flora, ecology floors, density notches).
    extra_reach: f64,
    tiles: RwLock<HashMap<(i64, i64), Arc<GeoTile>>>,
    hydro: RwLock<HashMap<(i64, i64), Arc<TileHydro>>>,
}

mod hydro;
mod query;
mod solve;

#[cfg(test)]
mod tests;

const GEO_PROBE: i32 = 2;

/// Prefetched fused heights over a chunk footprint plus probe halo;
/// bit-identical to direct `surface_f` sampling.
pub struct GeoGrid {
    min_x: i32,
    min_z: i32,
    span_z: usize,
    probe: i32,
    heights: Vec<f64>,
}

impl GeoGrid {
    #[inline]
    fn height_f(&self, x: i32, z: i32) -> f64 {
        let ix = (x - self.min_x) as usize;
        let iz = (z - self.min_z) as usize;
        self.heights[ix * self.span_z + iz]
    }

    pub fn surface_raw(&self, x: i32, z: i32) -> i32 {
        self.height_f(x, z).round() as i32
    }

    pub fn steepness(&self, x: i32, z: i32) -> f64 {
        let d = self.probe;
        let gx = (self.height_f(x + d, z) - self.height_f(x - d, z)).abs();
        let gz = (self.height_f(x, z + d) - self.height_f(x, z - d)).abs();
        (gx + gz) / (2.0 * d as f64)
    }
}

/// Smoothstep over an (engage, saturate) window: 0 below, 1 above.
fn smooth_window(value: f64, window: (f64, f64)) -> f64 {
    let (lo, hi) = window;
    if hi <= lo {
        return if value >= hi { 1.0 } else { 0.0 };
    }
    let t = ((value - lo) / (hi - lo)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn cell_distance(a: usize, b: usize, side: usize) -> f64 {
    let ax = (a / side) as f64;
    let az = (a % side) as f64;
    let bx = (b / side) as f64;
    let bz = (b % side) as f64;
    let dx = ax - bx;
    let dz = az - bz;
    (dx * dx + dz * dz).sqrt().max(1.0)
}

/// Linear ramp 0..1 over `band` blocks.
fn ramp(distance: f64, band: f64) -> f64 {
    (distance / band.max(1.0)).clamp(0.0, 1.0)
}

/// Ridge cross-profile: 1 at the spine, 0 beyond `width`. Quadratic in
/// the falloff so the profile lands flat at the foot but keeps a sharp
/// crest — a smoothstep here makes hundred-block plateau tops.
fn ridge_profile(dist: f64, width: f64) -> f64 {
    if width <= 1e-9 {
        return 0.0;
    }
    let t = (1.0 - (dist / width).clamp(0.0, 1.0)).max(0.0);
    t * t
}
