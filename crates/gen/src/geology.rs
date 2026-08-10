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

use crate::channels::{ChannelField, ChannelPoint, ChannelProfile};
use crate::spec::GenError;
use crate::stream::{cell_id, hash_unit, mix64, stream_seed, SaltPath, Subsystem};

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
    sea_level: i32,
    plate_seed: u64,
    swell_seed: u64,
    detail_seed: u64,
    relief_seed: u64,
    segment_seed: u64,
    rib_seed: u64,
    bench_seed: u64,
    meander_seed: u64,
    tiles: RwLock<HashMap<(i64, i64), Arc<GeoTile>>>,
    hydro: RwLock<HashMap<(i64, i64), Arc<TileHydro>>>,
}

impl GeoModel {
    pub fn compile(
        spec: &GeologySpec,
        sea_level: i32,
        world_seed: u32,
        dimension: &str,
        used_salts: &mut hashbrown::HashSet<&'static str>,
    ) -> Result<Self, GenError> {
        crate::spec::claim_salt(&spec.salt, used_salts)?;
        let invalid = |path: &str, reason: String| GenError::Invalid {
            path: path.to_string(),
            reason,
        };
        if spec.cell < 2 || spec.cell > 16 {
            return Err(invalid("geology.cell", format!("must be 2..=16, got {}", spec.cell)));
        }
        if spec.tile < 256 || spec.tile % spec.cell != 0 {
            return Err(invalid(
                "geology.tile",
                format!("must be >= 256 and divisible by cell, got {}", spec.tile),
            ));
        }
        if spec.halo_cells < 16 {
            return Err(invalid(
                "geology.halo_cells",
                format!("must be >= 16, got {}", spec.halo_cells),
            ));
        }
        if !(0.0..=1.0).contains(&spec.continental_share) {
            return Err(invalid("geology.continental_share", "must be within 0..=1".to_string()));
        }
        if spec.iterations == 0 || spec.fill_every == 0 {
            return Err(invalid("geology.iterations", "iterations and fill_every must be > 0".to_string()));
        }
        if spec.erode_k < 0.0 {
            return Err(invalid("geology.erode_k", "must be >= 0".to_string()));
        }
        // The stream-power exponent evaluates through an exact sqrt chain
        // (bit-stable across platforms, unlike powf): quarter multiples only.
        let quarters = spec.erode_m * 4.0;
        if !(quarters >= 1.0 && quarters <= 8.0 && quarters.fract() == 0.0) {
            return Err(invalid(
                "geology.erode_m",
                format!("must be a multiple of 0.25 in 0.25..=2.0, got {}", spec.erode_m),
            ));
        }
        if spec.channel_area < 4.0 || spec.channel_area_full <= spec.channel_area {
            return Err(invalid("geology.channel_area", "must satisfy 4 <= area < area_full".to_string()));
        }
        if spec.river_width.0 <= 0.0 || spec.river_width.1 < spec.river_width.0 {
            return Err(invalid("geology.river_width", format!("span invalid: {:?}", spec.river_width)));
        }
        let relief = &spec.relief;
        if relief.rib_amp < 0.0
            || relief.bench_amp < 0.0
            || (relief.rib_amp > 0.0 && relief.rib_scale < 2.0)
            || (relief.bench_amp > 0.0 && relief.bench_spacing < 2.0)
        {
            return Err(invalid("geology.relief", "amplitudes must be >= 0 and scales >= 2".to_string()));
        }
        if !(0.0..=0.45).contains(&relief.bench_tread) {
            return Err(invalid("geology.relief.bench_tread", "must be within 0..=0.45".to_string()));
        }
        if relief.rib_stretch < 1.0 {
            return Err(invalid("geology.relief.rib_stretch", "must be >= 1".to_string()));
        }
        if spec.meander_amp < 0.0 || (spec.meander_amp > 0.0 && spec.meander_scale < 8.0) {
            return Err(invalid("geology.meander", "amp must be >= 0 and scale >= 8".to_string()));
        }
        if !(0.0..=0.5).contains(&spec.riffle_amp)
            || (spec.riffle_amp > 0.0 && spec.riffle_scale < 8.0)
        {
            return Err(invalid("geology.riffle", "amp must be 0..=0.5 and scale >= 8".to_string()));
        }
        if spec.detail_floor < 0.0 || spec.detail_floor > 1.0 {
            return Err(invalid("geology.detail_floor", "must be within 0..=1".to_string()));
        }
        let moisture = &spec.moisture;
        if moisture.reach <= 0.0 || moisture.flow_half <= 0.0 || moisture.dry_height <= 0.0 {
            return Err(invalid("geology.moisture", "reach, flow_half, dry_height must be > 0".to_string()));
        }
        let seed = stream_seed(world_seed, dimension, Subsystem::Geology, &spec.salt, 0);
        Ok(Self {
            spec: spec.clone(),
            sea_level,
            plate_seed: mix64(seed ^ 0x706c_6174),
            swell_seed: mix64(seed ^ 0x7377_656c),
            detail_seed: mix64(seed ^ 0x6465_7461),
            relief_seed: mix64(seed ^ 0x7265_6c66),
            segment_seed: mix64(seed ^ 0x7365_676d),
            rib_seed: mix64(seed ^ 0x7269_6273),
            bench_seed: mix64(seed ^ 0x626e_6368),
            meander_seed: mix64(seed ^ 0x6d64_7273),
            tiles: RwLock::new(HashMap::new()),
            hydro: RwLock::new(HashMap::new()),
        })
    }

    pub fn spec(&self) -> &GeologySpec {
        &self.spec
    }

    // ------------------------------------------------------------------
    // Plate graph (analytic, shared identically by every tile)
    // ------------------------------------------------------------------

    fn plate_site(&self, lattice_x: i64, lattice_z: i64) -> PlateSite {
        let id = mix64(self.plate_seed ^ mix64(cell_id(lattice_x, lattice_z)));
        let jx = hash_unit(id) - 0.5;
        let jz = hash_unit(mix64(id ^ 0x1)) - 0.5;
        let mx = hash_unit(mix64(id ^ 0x2)) - 0.5;
        let mz = hash_unit(mix64(id ^ 0x3)) - 0.5;
        let norm = (mx * mx + mz * mz).sqrt().max(1e-9);
        PlateSite {
            x: (lattice_x as f64 + 0.5 + jx * 2.0 * self.spec.plate_jitter) * self.spec.plate_cell,
            z: (lattice_z as f64 + 0.5 + jz * 2.0 * self.spec.plate_jitter) * self.spec.plate_cell,
            vx: mx / norm,
            vz: mz / norm,
            is_continental: hash_unit(mix64(id ^ 0x4)) < self.spec.continental_share,
        }
    }

    /// The two nearest plate sites: the owner and the neighbor across
    /// the closest boundary.
    fn nearest_plates(&self, x: f64, z: f64) -> (PlateSite, f64, PlateSite, f64) {
        let cell = self.spec.plate_cell;
        let cx = (x / cell).floor() as i64;
        let cz = (z / cell).floor() as i64;
        let mut best: Option<(PlateSite, f64)> = None;
        let mut second: Option<(PlateSite, f64)> = None;
        for dx in -2..=2 {
            for dz in -2..=2 {
                let site = self.plate_site(cx + dx, cz + dz);
                let d = ((site.x - x) * (site.x - x) + (site.z - z) * (site.z - z)).sqrt();
                if best.map(|(_, bd)| d < bd).unwrap_or(true) {
                    second = best;
                    best = Some((site, d));
                } else if second.map(|(_, sd)| d < sd).unwrap_or(true) {
                    second = Some((site, d));
                }
            }
        }
        let (a, da) = best.expect("plate neighborhood nonempty");
        let (b, db) = second.expect("plate neighborhood has a second site");
        (a, da, b, db)
    }

    /// Uplift prior, boundary class, and solve-time uplift rate at one
    /// point: the authored macro-composition every tile agrees on.
    pub fn prior(&self, x: f64, z: f64) -> PriorSample {
        let spec = &self.spec;
        let sea = self.sea_level as f64;
        // The plate graph is queried through a domain warp: boundaries
        // bend into arcs, margins roughen, and island chains curve.
        let wx = x + self.value_fbm(mix64(self.plate_seed ^ 0x77), x, z, spec.plate_warp_scale, 3)
            * spec.plate_warp_amp;
        let wz = z + self.value_fbm(mix64(self.plate_seed ^ 0x78), x, z, spec.plate_warp_scale, 3)
            * spec.plate_warp_amp;
        let (own, d_own, other, d_other) = self.nearest_plates(wx, wz);

        // Continentality: land core inside continental plates, ramping
        // to abyssal across mixed boundaries over the margin width.
        let margin = d_other - d_own;
        let same_kind = own.is_continental == other.is_continental;
        let land_t = if same_kind {
            if own.is_continental {
                1.0
            } else {
                0.0
            }
        } else {
            let t = (margin / spec.margin_width).clamp(0.0, 1.0);
            if own.is_continental {
                t
            } else {
                1.0 - t
            }
        };
        let smooth = land_t * land_t * (3.0 - 2.0 * land_t);
        let mut height = sea + (-spec.base_ocean) + (spec.base_land + spec.base_ocean) * smooth;

        // Craton swells and province plateaus: inherited interior relief.
        height += self.value_fbm(self.swell_seed, x, z, spec.swell_scale, spec.swell_octaves)
            * spec.swell_amp
            * smooth;
        if spec.plateau_amp > 0.0 {
            let province =
                self.value_fbm(mix64(self.swell_seed ^ 0x70), x, z, spec.plateau_scale, 2);
            height += (province * spec.plateau_amp).max(0.0) * smooth;
        }

        // Boundary ribbon. n points from the owner's site toward the
        // neighbor's; approach > 0 means the plates close on each other.
        let boundary_dist = (margin * 0.5).max(0.0);
        let nx = other.x - own.x;
        let nz = other.z - own.z;
        let n_norm = (nx * nx + nz * nz).sqrt().max(1e-9);
        let nxu = nx / n_norm;
        let nzu = nz / n_norm;
        let approach = (own.vx - other.vx) * nxu + (own.vz - other.vz) * nzu;

        // Along-boundary coordinate for segmentation, in warped space so
        // massifs follow the bent spine.
        let along = wx * (-nzu) + wz * nxu;

        let mut class = BoundaryClass::Interior;
        let mut uplift_rate = 0.0;
        if approach > spec.convergence_floor {
            let strength = ((approach - spec.convergence_floor) / spec.belt_strength_span)
                .clamp(0.0, 1.0);
            let (belt, offset, is_trench_side) = match (own.is_continental, other.is_continental)
            {
                (true, true) => (&spec.belt_collision, 0.0, false),
                (true, false) => (&spec.belt_arc, spec.arc_inland_offset, false),
                (false, true) => (&spec.belt_arc, 0.0, true),
                (false, false) => (&spec.belt_island_arc, spec.island_arc_offset, false),
            };
            if is_trench_side {
                let trench = ridge_profile(boundary_dist, spec.trench_width);
                if trench > 0.02 {
                    class = BoundaryClass::Trench;
                    height -= spec.trench_depth * trench * strength;
                }
            } else {
                // The ribbon spine sits `offset` blocks behind the
                // boundary: collision sutures carry their chains, arcs
                // rise inland of their trench on full crust. The crest
                // ribbon rides on a broader, lower orogenic root — the
                // foothill apron a bare ribbon lacks.
                let spine_dist = (boundary_dist - offset).abs();
                let crest = ridge_profile(spine_dist, belt.width);
                let root = ridge_profile(spine_dist, belt.width * belt.root_width_factor);
                if crest > 0.02 || root > 0.02 {
                    let seg = self.segment_gate(along, belt.segment_scale, belt.segment_depth);
                    class = match (own.is_continental, other.is_continental) {
                        (true, true) => BoundaryClass::Collision,
                        (false, false) => BoundaryClass::IslandArc,
                        _ => BoundaryClass::VolcanicArc,
                    };
                    let lift = crest * seg + root * belt.root_share;
                    height += belt.height * lift * strength;
                    uplift_rate = spec.uplift_rate * belt.uplift * crest * seg * strength;
                }
            }
        } else if approach < -spec.convergence_floor && same_kind && own.is_continental {
            let rift = ridge_profile(boundary_dist, spec.rift_width);
            if rift > 0.02 {
                class = BoundaryClass::Rift;
                let strength = ((-approach - spec.convergence_floor) / spec.belt_strength_span)
                    .clamp(0.0, 1.0);
                height -= spec.rift_depth * rift * strength;
            }
        } else if approach.abs() <= spec.convergence_floor
            && boundary_dist < spec.margin_width * 0.25
        {
            class = BoundaryClass::Transform;
        }

        PriorSample {
            height,
            class,
            uplift_rate,
        }
    }

    /// Segmentation gate along a belt spine: 1 at massifs, dipping
    /// toward passes.
    fn segment_gate(&self, along: f64, scale: f64, depth: f64) -> f64 {
        if scale <= 1.0 || depth <= 0.0 {
            return 1.0;
        }
        let coarse = self.value_noise_1d(self.segment_seed, along / scale);
        let fine = self.value_noise_1d(mix64(self.segment_seed ^ 0x9), along / (scale * 0.37));
        let wave = (coarse * 0.7 + fine * 0.3).clamp(0.0, 1.0);
        1.0 - depth * (1.0 - wave)
    }

    fn value_noise_1d(&self, seed: u64, t: f64) -> f64 {
        let i = t.floor() as i64;
        let f = t - t.floor();
        let a = hash_unit(mix64(seed ^ mix64(i as u64)));
        let b = hash_unit(mix64(seed ^ mix64((i + 1) as u64)));
        let s = f * f * (3.0 - 2.0 * f);
        a + (b - a) * s
    }

    fn value_noise_2d(&self, seed: u64, x: f64, z: f64) -> f64 {
        let ixf = x.floor();
        let izf = z.floor();
        let fx = x - ixf;
        let fz = z - izf;
        let ix = ixf as i64;
        let iz = izf as i64;
        let corner = |dx: i64, dz: i64| hash_unit(mix64(seed ^ mix64(cell_id(ix + dx, iz + dz))));
        let sx = fx * fx * (3.0 - 2.0 * fx);
        let sz = fz * fz * (3.0 - 2.0 * fz);
        let top = corner(0, 0) + (corner(1, 0) - corner(0, 0)) * sx;
        let bottom = corner(0, 1) + (corner(1, 1) - corner(0, 1)) * sx;
        top + (bottom - top) * sz
    }

    /// Lattice value fbm in -1..1, used only for priors and sub-cell
    /// texture — never for the macro form.
    fn value_fbm(&self, seed: u64, x: f64, z: f64, scale: f64, octaves: u8) -> f64 {
        let mut amp = 1.0;
        let mut freq = 1.0 / scale.max(1.0);
        let mut sum = 0.0;
        let mut norm = 0.0;
        for octave in 0..octaves {
            let s = mix64(seed ^ (octave as u64 + 1).wrapping_mul(0x9e37_79b9_7f4a_7c15));
            sum += amp * (self.value_noise_2d(s, x * freq, z * freq) * 2.0 - 1.0);
            norm += amp;
            amp *= 0.5;
            freq *= 2.0;
        }
        sum / norm.max(1e-9)
    }

    // ------------------------------------------------------------------
    // Tile solve
    // ------------------------------------------------------------------

    /// Solve (or fetch) the tile whose interior starts at
    /// `(tile_x * tile, tile_z * tile)`.
    pub fn tile(&self, tile_x: i64, tile_z: i64) -> Arc<GeoTile> {
        if let Some(hit) = self.tiles.read().expect("geo tile cache").get(&(tile_x, tile_z)) {
            return Arc::clone(hit);
        }
        let solved = Arc::new(self.solve(tile_x, tile_z));
        let mut cache = self.tiles.write().expect("geo tile cache");
        if cache.len() >= TILE_CACHE_CAP {
            cache.clear();
        }
        cache.insert((tile_x, tile_z), Arc::clone(&solved));
        solved
    }

    fn solve(&self, tile_x: i64, tile_z: i64) -> GeoTile {
        let spec = &self.spec;
        let cell = spec.cell as f64;
        let interior = (spec.tile / spec.cell) as i32;
        let halo = spec.halo_cells;
        let side = (interior + 2 * halo) as usize;
        let origin_x = (tile_x * spec.tile as i64 - (halo * spec.cell) as i64) as i32;
        let origin_z = (tile_z * spec.tile as i64 - (halo * spec.cell) as i64) as i32;
        let sea = self.sea_level as f64;
        let count = side * side;

        // Init from the shared analytic prior plus tie-break relief.
        let mut height = vec![0.0f64; count];
        let mut uplift = vec![0.0f64; count];
        for ix in 0..side {
            for iz in 0..side {
                let x = origin_x as f64 + (ix as f64 + 0.5) * cell;
                let z = origin_z as f64 + (iz as f64 + 0.5) * cell;
                let prior = self.prior(x, z);
                let relief = self.value_fbm(self.relief_seed, x, z, cell * 6.0, 2);
                height[ix * side + iz] = prior.height + relief * spec.seed_relief;
                // Interiors keep a gentle uplift so dissection reaches a
                // rolling steady state instead of eroding to a plain.
                let land = ((prior.height - sea) / spec.base_land.max(1.0)).clamp(0.0, 1.0);
                uplift[ix * side + iz] =
                    prior.uplift_rate.max(spec.interior_uplift * land);
            }
        }

        let mut filled = vec![0.0f64; count];
        let mut receiver = vec![u32::MAX; count];
        let mut order: Vec<u32> = (0..count as u32).collect();
        let mut flow = vec![1.0f64; count];
        let mut lake = vec![false; count];

        let iterations = spec.iterations;
        for iteration in 0..iterations {
            // Receivers, drainage order, and flow accumulation only move
            // when the fill moves; between fills they are constants of
            // the receiver forest.
            if iteration % spec.fill_every == 0 {
                self.priority_flood(&height, &mut filled, &mut lake, side, sea);
                self.receivers(&filled, &mut receiver, side);
                order.sort_unstable_by(|a, b| {
                    filled[*b as usize]
                        .partial_cmp(&filled[*a as usize])
                        .unwrap_or(std::cmp::Ordering::Equal)
                        .then(a.cmp(b))
                });
                for f in flow.iter_mut() {
                    *f = 1.0;
                }
                for &index in &order {
                    let index = index as usize;
                    let recv = receiver[index] as usize;
                    if recv != index {
                        flow[recv] += flow[index];
                    }
                }
            }

            // Continued uplift, then implicit stream-power incision
            // (Braun–Willett): receivers are already final for this
            // fill, so walking cells from low to high solves
            //   h' = (h + f * h'_recv) / (1 + f),  f = K A^m dt / dx
            // exactly in one pass — unconditionally stable, so dt can be
            // geological and dissection reaches steady state in a
            // handful of iterations.
            for index in 0..count {
                height[index] += uplift[index] * spec.dt;
            }
            let k_dt = spec.erode_k * spec.dt;
            let quarters = (spec.erode_m * 4.0) as i32;
            for &index in order.iter().rev() {
                let index = index as usize;
                let recv = receiver[index] as usize;
                if recv == index || height[index] <= sea {
                    continue;
                }
                let dist = cell_distance(index, recv, side) * cell;
                let f = k_dt * quarter_power(flow[index], quarters) / dist;
                height[index] = (height[index] + f * height[recv]) / (1.0 + f);
            }

            // Hillslope diffusion (4-neighbor explicit step). Above the
            // snowline frost shattering rules, so creep drops to the
            // authored share and arêtes keep their serration.
            if spec.diffusion > 0.0 {
                let d_dt = spec.diffusion * spec.dt;
                let snapshot = height.clone();
                for ix in 1..side - 1 {
                    for iz in 1..side - 1 {
                        let index = ix * side + iz;
                        let lap = snapshot[index - side] + snapshot[index + side]
                            + snapshot[index - 1]
                            + snapshot[index + 1]
                            - 4.0 * snapshot[index];
                        let share = if snapshot[index] >= spec.snowline {
                            spec.high_diffusion_share
                        } else {
                            1.0
                        };
                        height[index] += d_dt * lap * share;
                    }
                }
            }

            // Talus relaxation: shed material down slopes beyond repose.
            if spec.talus > 0.0 {
                let limit = spec.talus;
                for ix in 1..side - 1 {
                    for iz in 1..side - 1 {
                        let index = ix * side + iz;
                        let mut lowest = index;
                        let mut lowest_h = height[index];
                        for (dx, dz, _) in NEIGHBORS8 {
                            let n = ((ix as i32 + dx) as usize) * side + (iz as i32 + dz) as usize;
                            if height[n] < lowest_h {
                                lowest_h = height[n];
                                lowest = n;
                            }
                        }
                        let drop = height[index] - lowest_h;
                        if lowest != index && drop > limit {
                            let shed = (drop - limit) * 0.5;
                            height[index] -= shed;
                            height[lowest] += shed;
                        }
                    }
                }
            }
        }

        // Glacial tail: widen hollows above the snowline into bowls while
        // leaving crests sharp (positive-curvature-weighted smoothing).
        for _ in 0..spec.glacial_iterations {
            let snapshot = height.clone();
            for ix in 1..side - 1 {
                for iz in 1..side - 1 {
                    let index = ix * side + iz;
                    if snapshot[index] < spec.snowline {
                        continue;
                    }
                    let mean = (snapshot[index - side]
                        + snapshot[index + side]
                        + snapshot[index - 1]
                        + snapshot[index + 1])
                        * 0.25;
                    if mean > snapshot[index] {
                        // A hollow: pull the floor up-and-outward toward
                        // the bowl profile.
                        height[index] += (mean - snapshot[index]) * spec.glacial_strength;
                    }
                }
            }
        }

        // Despike: a single-cell tower upsamples into a floating-looking
        // rock needle. A cell may stand at most `talus` above its
        // highest neighbor; ridge cells keep their crests because a
        // ridge always has two high neighbors along the divide.
        for _ in 0..2 {
            let snapshot = height.clone();
            for ix in 1..side - 1 {
                for iz in 1..side - 1 {
                    let index = ix * side + iz;
                    let mut highest = f64::MIN;
                    for (dx, dz, _) in NEIGHBORS8 {
                        let n = ((ix as i32 + dx) as usize) * side + (iz as i32 + dz) as usize;
                        highest = highest.max(snapshot[n]);
                    }
                    if snapshot[index] > highest + spec.talus {
                        height[index] = highest + spec.talus;
                    }
                }
            }
        }

        // Final hydrology fields for sampling and channel extraction.
        self.priority_flood(&height, &mut filled, &mut lake, side, sea);
        self.receivers(&filled, &mut receiver, side);
        order.sort_unstable_by(|a, b| {
            filled[*b as usize]
                .partial_cmp(&filled[*a as usize])
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.cmp(b))
        });
        for f in flow.iter_mut() {
            *f = 1.0;
        }
        for &index in &order {
            let index = index as usize;
            let recv = receiver[index] as usize;
            if recv != index {
                flow[recv] += flow[index];
            }
        }

        GeoTile {
            origin_x,
            origin_z,
            side,
            height: height.iter().map(|h| *h as f32).collect(),
            filled: filled.iter().map(|f| *f as f32).collect(),
            flow: flow.iter().map(|f| *f as f32).collect(),
            lake,
            receiver,
        }
    }

    /// Priority-flood pit fill: `filled` becomes the hydraulically
    /// corrected surface (every cell drains to an edge or the sea), and
    /// `lake` marks cells raised above their true height.
    fn priority_flood(
        &self,
        height: &[f64],
        filled: &mut [f64],
        lake: &mut [bool],
        side: usize,
        sea: f64,
    ) {
        const EPSILON: f64 = 1e-4;
        let count = side * side;
        let mut is_open = vec![false; count];
        let mut heap = BinaryHeap::new();
        for index in 0..count {
            filled[index] = height[index];
            let ix = index / side;
            let iz = index % side;
            let is_edge = ix == 0 || iz == 0 || ix == side - 1 || iz == side - 1;
            if is_edge || height[index] <= sea {
                is_open[index] = true;
                heap.push(FloodEntry {
                    level: height[index],
                    index,
                });
            }
        }
        while let Some(FloodEntry { level, index }) = heap.pop() {
            if filled[index] < level {
                continue;
            }
            let ix = (index / side) as i32;
            let iz = (index % side) as i32;
            for (dx, dz, _) in NEIGHBORS8 {
                let nx = ix + dx;
                let nz = iz + dz;
                if nx < 0 || nz < 0 || nx as usize >= side || nz as usize >= side {
                    continue;
                }
                let n = nx as usize * side + nz as usize;
                if is_open[n] {
                    continue;
                }
                is_open[n] = true;
                let required = level + EPSILON;
                if height[n] < required {
                    filled[n] = required;
                } else {
                    filled[n] = height[n];
                }
                heap.push(FloodEntry {
                    level: filled[n],
                    index: n,
                });
            }
        }
        for index in 0..count {
            lake[index] = filled[index] > height[index] + self.spec.lake_min_depth
                && filled[index] > sea;
        }
    }

    /// Steepest-descent receivers over the filled surface. Cells with no
    /// lower neighbor (edges, sea floor) drain to themselves.
    fn receivers(&self, filled: &[f64], receiver: &mut [u32], side: usize) {
        for ix in 0..side {
            for iz in 0..side {
                let index = ix * side + iz;
                let mut best = index;
                let mut best_slope = 0.0f64;
                for (dx, dz, dist) in NEIGHBORS8 {
                    let nx = ix as i32 + dx;
                    let nz = iz as i32 + dz;
                    if nx < 0 || nz < 0 || nx as usize >= side || nz as usize >= side {
                        continue;
                    }
                    let n = nx as usize * side + nz as usize;
                    let slope = (filled[index] - filled[n]) / dist;
                    if slope > best_slope {
                        best_slope = slope;
                        best = n;
                    }
                }
                receiver[index] = best as u32;
            }
        }
    }

    /// Emits one short segment per channel cell (cell centre to receiver
    /// centre), interior cells only so neighboring tiles never duplicate
    /// a reach. Water level is the filled surface: monotone downstream,
    /// flat across lakes.
    #[allow(clippy::too_many_arguments)]
    /// Hydrology for one tile: channel polylines and lake verdicts.
    /// Computed lazily and separately from the tile solve because both
    /// read the *fused* surface and the neighbors' solutions — data a
    /// single tile cannot see while it is still being solved.
    pub fn hydro(&self, tile_x: i64, tile_z: i64) -> Arc<TileHydro> {
        if let Some(hit) = self
            .hydro
            .read()
            .expect("geo hydro cache")
            .get(&(tile_x, tile_z))
        {
            return Arc::clone(hit);
        }
        let tile = self.tile(tile_x, tile_z);
        // Verdicts first: channel extraction must know which lakes
        // survive, because a rejected basin still owes the world its
        // river — the drainage runs on where the lake declined to be.
        let lake_keep = self.lake_verdicts(&tile);
        let solved = Arc::new(TileHydro {
            channels: self.extract_channels(&tile, &lake_keep),
            lake_keep,
        });
        let mut cache = self.hydro.write().expect("geo hydro cache");
        if cache.len() >= TILE_CACHE_CAP {
            cache.clear();
        }
        cache.insert((tile_x, tile_z), Arc::clone(&solved));
        solved
    }

    /// Channel water levels come from the *fused* surface, not the
    /// tile's own filled surface. Neighboring tiles erode the same
    /// geography a few blocks apart (each window truncates the
    /// watershed differently), and fusion is what hides that
    /// disagreement in the terrain — a channel level lifted straight
    /// out of one tile's fill re-exposes it as a wall of water at the
    /// seam. The fused surface is the one hydrology authority every
    /// tile agrees on.
    ///
    /// Along each tile's receiver forest the level is clamped monotone
    /// (`level[recv] <= level[cell]`), lake cells carry their own lake
    /// surface instead of the fused floor (a river must enter a lake at
    /// the lake's level, and leave below it), and lake-interior cells
    /// emit no segments — the lake overlay owns that water. Levels snap
    /// to integers (pool-and-drop): fractional levels floor differently
    /// column to column and the fluid simulation oscillates on the
    /// mixed-height source blocks forever.
    ///
    /// Only *kept* lakes suppress segments and carry lake-surface
    /// levels. A basin rejected by `lake_verdicts` renders no lake, so
    /// its cells fall back to the fused floor and keep their channel
    /// segments: the river runs through the dry depression and incises
    /// the spill lip like a breached-lake outlet gorge, instead of
    /// drainage vanishing into an empty pan at the seam.
    fn extract_channels(&self, tile: &GeoTile, lake_keep: &[bool]) -> ChannelField {
        let spec = &self.spec;
        let cell = spec.cell as f64;
        let side = tile.side;
        let halo = spec.halo_cells as usize;
        let sea = self.sea_level as f64;
        let count = side * side;

        let position = |index: usize| -> (f64, f64) {
            (
                tile.origin_x as f64 + ((index / side) as f64 + 0.5) * cell,
                tile.origin_z as f64 + ((index % side) as f64 + 0.5) * cell,
            )
        };

        // Node base levels: fused surface outside kept lakes, own lake
        // surface inside them.
        let kept = |index: usize| tile.lake[index] && lake_keep[index];
        let mut level = vec![0.0f64; count];
        for index in 0..count {
            let (x, z) = position(index);
            level[index] = if kept(index) {
                tile.filled[index] as f64
            } else {
                self.fused_height_raw(x, z)
            };
        }

        // Monotone clamp down the receiver forest, walked in drainage
        // order (highest fill first) so every upstream min arrives
        // before its receiver is read.
        let mut order: Vec<u32> = (0..count as u32).collect();
        order.sort_unstable_by(|a, b| {
            tile.filled[*b as usize]
                .partial_cmp(&tile.filled[*a as usize])
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.cmp(b))
        });
        for &index in &order {
            let index = index as usize;
            let recv = tile.receiver[index] as usize;
            if recv != index {
                level[recv] = level[recv].min(level[index]);
            }
        }

        let profile_at = |area: f64, x: f64, z: f64| -> ChannelProfile {
            let t = ((area - spec.channel_area) / (spec.channel_area_full - spec.channel_area))
                .clamp(0.0, 1.0)
                .sqrt();
            let mut depth = spec.river_depth.0 + (spec.river_depth.1 - spec.river_depth.0) * t;
            // Pool-and-riffle alternation along the reach: real rivers
            // are not one uniform trench, and the depth swing is what
            // makes pools read blue between bright riffles.
            if spec.riffle_amp > 0.0 {
                let swing = self.value_fbm(
                    mix64(self.meander_seed ^ 0x0041_ff1e),
                    x,
                    z,
                    spec.riffle_scale,
                    2,
                );
                depth = (depth * (1.0 + spec.riffle_amp * swing)).max(spec.river_depth.0 * 0.5);
            }
            ChannelProfile {
                half_width: spec.river_width.0 + (spec.river_width.1 - spec.river_width.0) * t,
                depth,
            }
        };

        // Meander displacement: cell-center drainage is a surveyed grid,
        // and a smooth angle field bends it into reaches. The offset is
        // a pure function of a node's absolute position, so neighboring
        // tiles displace the shared node identically; water levels ride
        // the node wherever it lands (they were derived from the fused
        // surface at the original cell, and the monotone clamp already
        // ran).
        let meander = |x: f64, z: f64, half_width: f64| -> (f64, f64) {
            if spec.meander_amp <= 0.0 {
                return (x, z);
            }
            // Direction from two independent smooth fields, normalized by
            // sqrt: trigonometry is not bit-stable across platforms.
            let dx = self.value_fbm(self.meander_seed, x, z, spec.meander_scale, 2);
            let dz = self.value_fbm(mix64(self.meander_seed ^ 0x5a), x, z, spec.meander_scale, 2);
            let norm = (dx * dx + dz * dz).sqrt();
            if norm < 1e-6 {
                return (x, z);
            }
            let amp = spec.meander_amp * half_width;
            (x + dx / norm * amp, z + dz / norm * amp)
        };

        let mut lines: Vec<(Vec<(f64, f64, f64)>, Vec<ChannelProfile>)> = Vec::new();
        for ix in halo..side - halo {
            for iz in halo..side - halo {
                let index = ix * side + iz;
                if (tile.flow[index] as f64) < spec.channel_area
                    || (tile.filled[index] as f64) <= sea
                    || level[index] <= sea
                {
                    continue;
                }
                let recv = tile.receiver[index] as usize;
                if recv == index || kept(index) || kept(recv) {
                    continue;
                }
                let (ax, az) = position(index);
                let (bx, bz) = position(recv);
                let profile_a = profile_at(tile.flow[index] as f64, ax, az);
                let profile_b = profile_at(tile.flow[recv] as f64, bx, bz);
                let (ax, az) = meander(ax, az, profile_a.half_width);
                let (bx, bz) = meander(bx, bz, profile_b.half_width);
                lines.push((
                    vec![
                        (ax, az, level[index].floor()),
                        (bx, bz, level[recv].floor()),
                    ],
                    vec![profile_a, profile_b],
                ));
            }
        }
        ChannelField::from_polylines(&lines, self.channel_margin())
    }

    /// Whole-basin dispute verdicts. A lake straddling a tile seam is
    /// contested when any covering neighbor solved the same ground
    /// without that lake (its window drained the pit through a
    /// truncated watershed) or with a materially different level. There
    /// is no authority to arbitrate — each window is honest about the
    /// geography it saw — and any water placed on one side of the seam
    /// spills forever against the other side's belief, so the entire
    /// basin stays dry on both sides: both tiles see the same
    /// disagreement and reach the same verdict.
    fn lake_verdicts(&self, tile: &GeoTile) -> Vec<bool> {
        let side = tile.side;
        let count = side * side;
        let cell = self.spec.cell as f64;
        let mut keep = vec![true; count];

        // Connected lake basins (4-neighborhood flood label).
        let mut basin = vec![u32::MAX; count];
        let mut basins: Vec<Vec<usize>> = Vec::new();
        for start in 0..count {
            if !tile.lake[start] || basin[start] != u32::MAX {
                continue;
            }
            let id = basins.len() as u32;
            let mut cells = Vec::new();
            let mut stack = vec![start];
            basin[start] = id;
            while let Some(index) = stack.pop() {
                cells.push(index);
                let ix = index / side;
                let iz = index % side;
                let mut push = |n: usize| {
                    if tile.lake[n] && basin[n] == u32::MAX {
                        basin[n] = id;
                        stack.push(n);
                    }
                };
                if ix > 0 {
                    push(index - side);
                }
                if ix + 1 < side {
                    push(index + side);
                }
                if iz > 0 {
                    push(index - 1);
                }
                if iz + 1 < side {
                    push(index + 1);
                }
            }
            basins.push(cells);
        }
        if basins.is_empty() {
            return keep;
        }

        // The neighboring solutions whose extents can overlap this tile.
        let stride = self.spec.tile as i64;
        let tile_x = (tile.origin_x as i64 + (self.spec.halo_cells * self.spec.cell) as i64)
            .div_euclid(stride);
        let tile_z = (tile.origin_z as i64 + (self.spec.halo_cells * self.spec.cell) as i64)
            .div_euclid(stride);
        let mut neighbors: Vec<Arc<GeoTile>> = Vec::new();
        for dtx in -1..=1i64 {
            for dtz in -1..=1i64 {
                if dtx == 0 && dtz == 0 {
                    continue;
                }
                neighbors.push(self.tile(tile_x + dtx, tile_z + dtz));
            }
        }

        for cells in &basins {
            let mut disputed = false;
            'scan: for &index in cells {
                let (x, z) = (
                    tile.origin_x as f64 + ((index / side) as f64 + 0.5) * cell,
                    tile.origin_z as f64 + ((index % side) as f64 + 0.5) * cell,
                );
                let own = tile.filled[index] as f64;
                for neighbor in &neighbors {
                    let Some(slot) = neighbor.slot_at(cell, x, z) else {
                        continue;
                    };
                    let agrees = neighbor.lake[slot]
                        && (neighbor.filled[slot] as f64 - own).abs() <= 1.0;
                    if !agrees {
                        disputed = true;
                        break 'scan;
                    }
                }
            }
            if disputed {
                for &index in cells {
                    keep[index] = false;
                }
            }
        }
        keep
    }

    // ------------------------------------------------------------------
    // Fused sampling
    // ------------------------------------------------------------------

    /// Tiles whose extent covers the point, with partition-of-unity
    /// weights. Each weight ramps to exactly zero at the tile's usable
    /// extent edge (extent minus the interpolation margin), so the fused
    /// field is continuous: a tile entering or leaving the covering set
    /// contributes nothing at the moment it does.
    fn covering_tiles(&self, x: f64, z: f64) -> SmallVec<[(i64, i64, Arc<GeoTile>, f64); 4]> {
        let spec = &self.spec;
        let stride = spec.tile as f64;
        let halo_blocks = (spec.halo_cells * spec.cell) as f64;
        let pad = 2.0 * spec.cell as f64;
        let band = (halo_blocks - pad).max(1.0);
        let mut out = SmallVec::new();
        let tile_x = (x / stride).floor() as i64;
        let tile_z = (z / stride).floor() as i64;
        for dtx in -1..=1i64 {
            for dtz in -1..=1i64 {
                let tx = tile_x + dtx;
                let tz = tile_z + dtz;
                let min_x = tx as f64 * stride - halo_blocks + pad;
                let max_x = (tx + 1) as f64 * stride + halo_blocks - pad;
                let min_z = tz as f64 * stride - halo_blocks + pad;
                let max_z = (tz + 1) as f64 * stride + halo_blocks - pad;
                if x < min_x || x >= max_x || z < min_z || z >= max_z {
                    continue;
                }
                let wx = ramp(x - min_x, band).min(ramp(max_x - x, band));
                let wz = ramp(z - min_z, band).min(ramp(max_z - z, band));
                let weight = wx * wz;
                if weight > 1e-9 {
                    out.push((tx, tz, self.tile(tx, tz), weight));
                }
            }
        }
        out
    }

    /// Partition-of-unity fusion of the covering tiles' solved heights:
    /// the seam-continuous surface, before ceiling compression and
    /// sub-cell detail. This is the single hydrology authority — lake
    /// and channel water levels must derive from it, never from one
    /// tile's own fill (see `extract_channels`).
    fn fused_height_raw(&self, x: f64, z: f64) -> f64 {
        let cell = self.spec.cell as f64;
        let mut sum = 0.0;
        let mut norm = 0.0;
        for (_, _, tile, weight) in self.covering_tiles(x, z) {
            sum += tile.height_at(cell, x, z) * weight;
            norm += weight;
        }
        if norm > 1e-9 {
            sum / norm
        } else {
            self.prior(x, z).height
        }
    }

    /// Fused, sub-cell-detailed surface height in blocks. Composition:
    /// solved coarse form, then three slope-engaged terms — isotropic
    /// texture, spur-and-gully corrugation (directional-basis ridged
    /// noise aligned to the local gradient), and warped strata benches
    /// that break long smooth flanks into risers and treads. All three
    /// calm along high-flow drainage lines so valley floors stay
    /// river-ready, and every term is a pure function of (x, z).
    pub fn surface_f(&self, x: i32, z: i32) -> f64 {
        let fx = x as f64;
        let fz = z as f64;
        let tiles = self.covering_tiles(fx, fz);
        let cell = self.spec.cell as f64;
        let mut sum = 0.0;
        let mut norm = 0.0;
        for (_, _, tile, weight) in &tiles {
            sum += tile.height_at(cell, fx, fz) * weight;
            norm += weight;
        }
        let fused = if norm > 1e-9 { sum / norm } else { self.prior(fx, fz).height };
        let coarse = self.compress_height(fused);
        let relief = &self.spec.relief;

        let wants_detail = self.spec.detail_amp > 0.0;
        let wants_ribs = relief.rib_amp > 0.0;
        let wants_bench = relief.bench_amp > 0.0;
        if !wants_detail && !wants_ribs && !wants_bench {
            return coarse;
        }

        // One gradient probe serves every slope-engaged term.
        let probe = cell;
        let (mut hx, mut hz, mut n2) = (0.0, 0.0, 0.0);
        for (_, _, tile, weight) in &tiles {
            hx += (tile.height_at(cell, fx + probe, fz) - tile.height_at(cell, fx - probe, fz))
                * weight;
            hz += (tile.height_at(cell, fx, fz + probe) - tile.height_at(cell, fx, fz - probe))
                * weight;
            n2 += weight;
        }
        let (gx, gz, slope) = if n2 > 1e-9 {
            let dx = hx / (n2 * 2.0 * probe);
            let dz = hz / (n2 * 2.0 * probe);
            (dx, dz, (dx.abs() + dz.abs()))
        } else {
            (0.0, 0.0, 0.0)
        };

        // One owner-tile resolve serves the drainage calm and the
        // waterline scan below.
        let (owner_x, owner_z, owner, ofx, ofz) = self.owner_tile(x, z);

        // Drainage calm: relief backs off where water concentrates, on
        // a quadratic falloff — hillslopes with modest flow keep their
        // texture, real drainage lines go smooth for the river carve.
        let calm = if relief.calm_flow > 0.0 {
            let flow = owner.flow_at(cell, ofx, ofz);
            let ratio = flow / relief.calm_flow;
            1.0 / (1.0 + ratio * ratio)
        } else {
            1.0
        };

        let mut height = coarse;

        // Landform terms stay off the waterline: a rib pinching a
        // strait shut or a bench ponding a shelf rewrites the coast the
        // ocean census was authored on. The waterline is the sea or any
        // *kept* lake within a couple of cells — a tarn's shore is a
        // waterline too, but a seam-rejected dry pan is not (its
        // breached-basin channel wants the relief that keeps it a
        // river valley). Lake levels compress like the terrain they
        // gate, so high tarns compare in the same height space.
        let waterline = self
            .kept_lake_level_near(owner_x, owner_z, &owner, ofx, ofz, 2)
            .map(|lake| self.compress_height(lake).max(self.sea_level as f64))
            .unwrap_or(self.sea_level as f64);
        let shore = smooth_window(
            coarse - waterline,
            (0.5, relief.shore_calm_band.max(1.0)),
        );

        if wants_detail {
            let floor = self.spec.detail_floor.clamp(0.0, 1.0);
            let rough = (floor + slope * 3.0 * (1.0 - floor)).clamp(floor.max(0.05), 1.0);
            let fine = self.value_fbm(self.detail_seed, fx, fz, self.spec.detail_scale, 3)
                * self.spec.detail_amp;
            // The broad band is form-scale: shore-calmed like the
            // landform terms so it cannot redraw coastlines.
            let broad = if self.spec.detail_broad_amp > 0.0 {
                self.value_fbm(
                    mix64(self.detail_seed ^ 0x000b_40ad),
                    fx,
                    fz,
                    self.spec.detail_broad_scale,
                    2,
                ) * self.spec.detail_broad_amp
                    * shore
            } else {
                0.0
            };
            height += (fine + broad) * rough * calm;
        }

        if wants_ribs {
            let engage = smooth_window(slope, relief.rib_slope) * calm * shore;
            if engage > 1e-3 {
                let rib = self.directional_ridged(fx, fz, gx, gz);
                height += rib * relief.rib_amp * engage;
            }
        }

        if wants_bench {
            let engage = smooth_window(slope, relief.bench_slope) * calm * shore;
            if engage > 1e-3 {
                let warp = self.value_fbm(self.bench_seed, fx, fz, relief.bench_warp_scale, 2)
                    * relief.bench_warp_amp;
                let banded = coarse + warp;
                let band = (banded / relief.bench_spacing).floor();
                let frac = banded / relief.bench_spacing - band;
                // Tread flattens, riser steepens: remap the in-band
                // fraction so most of the spacing lies flat and the
                // rest arrives as a near-vertical face.
                let tread = relief.bench_tread;
                let riser = ((frac - tread) / (1.0 - 2.0 * tread)).clamp(0.0, 1.0);
                let shaped = riser * riser * (3.0 - 2.0 * riser);
                let target = (band + shaped) * relief.bench_spacing - warp;
                let pull = (target - coarse).clamp(-relief.bench_amp, relief.bench_amp);
                height += pull * engage;
            }
        }

        height
    }

    /// Spur-and-gully corrugation: ridged value noise evaluated in four
    /// fixed anisotropic frames (0/45/90/135 degrees, stretched along
    /// their spine), blended by how well each frame's spine aligns with
    /// the local downslope direction. Fixed frames keep the field
    /// coherent where the gradient swings — sampling one frame that
    /// rotates with the gradient shears the noise into smears at every
    /// ridgeline. Output is in -1..1 with sharp gully minima.
    fn directional_ridged(&self, fx: f64, fz: f64, gx: f64, gz: f64) -> f64 {
        let relief = &self.spec.relief;
        let g_norm = (gx * gx + gz * gz).sqrt();
        if g_norm < 1e-9 {
            return 0.0;
        }
        let (dx, dz) = (gx / g_norm, gz / g_norm);
        const FRAC_1_SQRT_2: f64 = std::f64::consts::FRAC_1_SQRT_2;
        const FRAMES: [(f64, f64); 4] = [
            (1.0, 0.0),
            (FRAC_1_SQRT_2, FRAC_1_SQRT_2),
            (0.0, 1.0),
            (-FRAC_1_SQRT_2, FRAC_1_SQRT_2),
        ];
        let mut sum = 0.0;
        let mut norm = 0.0;
        for (index, (ex, ez)) in FRAMES.iter().enumerate() {
            let align = dx * ex + dz * ez;
            // cos(2*angle) from the dot product: same weight for a
            // spine and its reverse.
            let weight = (2.0 * align * align - 1.0).max(0.0);
            if weight < 1e-3 {
                continue;
            }
            let seed = mix64(self.rib_seed ^ (index as u64 + 1).wrapping_mul(0x9e37_79b9_7f4a_7c15));
            // Along-spine coordinate stretched: spurs elongate downhill.
            let along = (fx * ex + fz * ez) / (relief.rib_scale * relief.rib_stretch);
            let across = (-fx * ez + fz * ex) / relief.rib_scale;
            let mut value = 0.0;
            let mut amp = 1.0;
            let mut total = 0.0;
            for octave in 0..2u64 {
                let s = mix64(seed ^ (octave + 1).wrapping_mul(0x9e37_79b9_7f4a_7c15));
                let f = (1u64 << octave) as f64;
                value += amp * (self.value_noise_2d(s, along * f, across * f) * 2.0 - 1.0);
                total += amp;
                amp *= 0.5;
            }
            let signed = value / total;
            // Sharp gullies, broad spurs.
            let ridged = 2.0 * signed.abs() - 1.0;
            sum += ridged * weight;
            norm += weight;
        }
        if norm > 1e-9 {
            sum / norm
        } else {
            0.0
        }
    }

    /// Normalized downslope direction of the coarse form, or (0, 0) on
    /// flats: the aspect input for snow scour and substrate mosaics.
    pub fn aspect(&self, x: i32, z: i32) -> (f64, f64) {
        let fx = x as f64;
        let fz = z as f64;
        let cell = self.spec.cell as f64;
        let tiles = self.covering_tiles(fx, fz);
        let (mut hx, mut hz, mut norm) = (0.0, 0.0, 0.0);
        for (_, _, tile, weight) in &tiles {
            hx += (tile.height_at(cell, fx + cell, fz) - tile.height_at(cell, fx - cell, fz))
                * weight;
            hz += (tile.height_at(cell, fx, fz + cell) - tile.height_at(cell, fx, fz - cell))
                * weight;
            norm += weight;
        }
        if norm < 1e-9 {
            return (0.0, 0.0);
        }
        let g = ((hx / norm).powi(2) + (hz / norm).powi(2)).sqrt();
        if g < 1e-9 {
            (0.0, 0.0)
        } else {
            // Downslope points against the gradient.
            (-hx / (norm * g), -hz / (norm * g))
        }
    }

    /// Moisture 0..1: channel/lake/sea proximity, drainage flow, and
    /// height above sea, folded by the spec's weights. The ecology
    /// field, understory densities, and ground-tone mosaics all read
    /// this one answer.
    pub fn moisture(&self, x: i32, z: i32) -> f64 {
        let spec = &self.spec.moisture;
        let sea = self.sea_level as f64;
        let height = self.compress_height(self.fused_height_raw(x as f64, z as f64));
        if height <= sea {
            return 1.0;
        }
        let proximity = if self.lake_level(x, z).is_some() {
            1.0
        } else {
            match self.channel_within(x, z, spec.reach) {
                Some(point) => (1.0 - point.dist / spec.reach).clamp(0.0, 1.0),
                None => 0.0,
            }
        };
        let flow = self.flow(x, z);
        let flow_wet = flow / (flow + spec.flow_half);
        let dryness = ((height - sea) / spec.dry_height).clamp(0.0, 1.0);
        let total = spec.proximity_weight + spec.flow_weight + spec.elevation_weight;
        if total <= 1e-9 {
            return 0.0;
        }
        ((spec.proximity_weight * proximity
            + spec.flow_weight * flow_wet
            + spec.elevation_weight * (1.0 - dryness))
            / total)
            .clamp(0.0, 1.0)
    }

    pub fn surface(&self, x: i32, z: i32) -> i32 {
        self.surface_f(x, z).round() as i32
    }

    /// Flow accumulation (cells) from the owning tile: the moisture and
    /// drainage diagnostic.
    pub fn flow(&self, x: i32, z: i32) -> f64 {
        let (_, _, tile, fx, fz) = self.owner_tile(x, z);
        tile.flow_at(self.spec.cell as f64, fx, fz)
    }

    /// Soft ceiling: extreme heights compress toward `ceiling_max` on a
    /// rational curve instead of clipping the world roof into mesas.
    /// Applied identically to terrain, lake levels, and channel water so
    /// nothing ends up hanging over compressed ground.
    fn compress_height(&self, h: f64) -> f64 {
        if h <= self.spec.ceiling_start {
            return h;
        }
        let span = (self.spec.ceiling_max - self.spec.ceiling_start).max(1.0);
        let u = (h - self.spec.ceiling_start) / span;
        self.spec.ceiling_start + span * (u / (1.0 + u))
    }

    /// Lake water level from the owning tile's final pit fill: mountain
    /// tarns, valley ponds, rift lakes. Basins contested by a
    /// neighboring tile's solution answer dry (see `lake_verdicts`), and
    /// only interior cells answer at all: the lake flags live on the
    /// 4-block solve lattice, so a rim cell half in the basin would
    /// water columns that stand above the true shoreline — on a crest
    /// tarn that is a waterfall pouring down the mountainside.
    pub fn lake_level(&self, x: i32, z: i32) -> Option<f64> {
        let cell = self.spec.cell as f64;
        let (tile_x, tile_z, tile, fx, fz) = self.owner_tile(x, z);
        let (slot, level) = tile.lake_level_at(cell, fx, fz)?;
        if !self.hydro(tile_x, tile_z).lake_keep[slot] {
            return None;
        }
        let side = tile.side as i32;
        let ix = (slot / tile.side) as i32;
        let iz = (slot % tile.side) as i32;
        for dx in -1..=1i32 {
            for dz in -1..=1i32 {
                let cx = ix + dx;
                let cz = iz + dz;
                if cx < 0 || cz < 0 || cx >= side || cz >= side {
                    return None;
                }
                if !tile.lake[(cx * side + cz) as usize] {
                    return None;
                }
            }
        }
        Some(self.compress_height(level))
    }

    /// Highest *kept* lake surface within `band` cells of the column,
    /// if any: the shoreline question the relief calm asks. Rejected
    /// (contested) basins are not waterlines — they render dry and
    /// carry breached-basin channels that want their valley relief.
    fn kept_lake_level_near(
        &self,
        tile_x: i64,
        tile_z: i64,
        tile: &GeoTile,
        x: f64,
        z: f64,
        band: i32,
    ) -> Option<f64> {
        let slot = tile.slot_at(self.spec.cell as f64, x, z)?;
        let side = tile.side as i32;
        let ix = (slot / tile.side) as i32;
        let iz = (slot % tile.side) as i32;
        let mut keep: Option<Arc<TileHydro>> = None;
        let mut best: Option<f64> = None;
        for dx in -band..=band {
            for dz in -band..=band {
                let cx = ix + dx;
                let cz = iz + dz;
                if cx < 0 || cz < 0 || cx >= side || cz >= side {
                    continue;
                }
                let index = (cx * side + cz) as usize;
                if !tile.lake[index] {
                    continue;
                }
                let verdicts =
                    keep.get_or_insert_with(|| self.hydro(tile_x, tile_z));
                if !verdicts.lake_keep[index] {
                    continue;
                }
                let level = tile.filled[index] as f64;
                if best.map(|b| level > b).unwrap_or(true) {
                    best = Some(level);
                }
            }
        }
        best
    }

    fn owner_tile(&self, x: i32, z: i32) -> (i64, i64, Arc<GeoTile>, f64, f64) {
        let stride = self.spec.tile as f64;
        let fx = x as f64;
        let fz = z as f64;
        let tile_x = (fx / stride).floor() as i64;
        let tile_z = (fz / stride).floor() as i64;
        (tile_x, tile_z, self.tile(tile_x, tile_z), fx, fz)
    }

    /// Nearest river channel within reach; queried across the owner and
    /// the up-to-three neighbors whose extents cover the point. Safe
    /// across tiles because every tile's channel levels derive from the
    /// shared fused surface (`extract_channels`), so overlapping
    /// answers agree to within the pool-and-drop quantum.
    pub fn river_sample(&self, x: i32, z: i32) -> Option<ChannelPoint> {
        self.channel_within(x, z, self.spec.river_width.1 + self.spec.river_bank)
    }

    /// Nearest channel within an arbitrary reach, bounded by the field's
    /// bucket registration (`channel_margin`) — the moisture and ecology
    /// queries ask farther than the river carve does.
    pub fn channel_within(&self, x: i32, z: i32, reach: f64) -> Option<ChannelPoint> {
        let reach = reach.min(self.channel_margin());
        let tiles = self.covering_tiles(x as f64, z as f64);
        let mut best: Option<ChannelPoint> = None;
        for (tile_x, tile_z, _, _) in tiles {
            let hydro = self.hydro(tile_x, tile_z);
            if let Some(point) = hydro.channels.sample(x, z, reach) {
                if best.map(|b| point.dist < b.dist).unwrap_or(true) {
                    best = Some(point);
                }
            }
        }
        best.map(|mut point| {
            point.water_y = self.compress_height(point.water_y);
            point
        })
    }

    /// The one margin channel fields register buckets for: every
    /// consumer's reach (river carve, moisture, riparian ecology) plus
    /// the worst meander displacement must fit inside it.
    fn channel_margin(&self) -> f64 {
        let spec = &self.spec;
        let carve = spec.river_width.1 + spec.river_bank;
        let meander = spec.meander_amp * spec.river_width.1;
        carve.max(spec.moisture.reach) + meander
    }

    pub fn river_reach(&self) -> f64 {
        self.spec.river_width.1 + self.spec.river_bank
    }

    /// Classify one column against the nearest channel — same semantics
    /// as the walker rivers' classification, driven by this spec's bank.
    pub fn river_column(&self, point: &ChannelPoint) -> crate::rivers::RiverColumn {
        crate::rivers::classify_column(point, self.spec.river_bank)
    }

    /// Deterministic per-tile digest used by tests and diagnostics.
    pub fn tile_digest(&self, tile_x: i64, tile_z: i64) -> u64 {
        let tile = self.tile(tile_x, tile_z);
        let mut digest = 0xcbf2_9ce4_8422_2325u64;
        for h in &tile.height {
            digest = mix64(digest ^ h.to_bits() as u64);
        }
        digest
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

/// `x^(quarters/4)` for nonnegative `x` through exact IEEE sqrt and
/// integer powers — the bit-stable stand-in for `powf`.
fn quarter_power(x: f64, quarters: i32) -> f64 {
    x.max(0.0).sqrt().sqrt().powi(quarters)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn test_spec() -> GeologySpec {
        GeologySpec {
            salt: SaltPath("geo.test"),
            cell: 8,
            tile: 512,
            halo_cells: 48,
            plate_cell: 900.0,
            plate_jitter: 0.35,
            plate_warp_amp: 150.0,
            plate_warp_scale: 520.0,
            continental_share: 0.55,
            margin_width: 260.0,
            base_land: 22.0,
            base_ocean: 40.0,
            swell_amp: 20.0,
            swell_scale: 420.0,
            swell_octaves: 4,
            plateau_amp: 20.0,
            plateau_scale: 900.0,
            belt_collision: BeltSpec {
                height: 90.0,
                width: 240.0,
                segment_scale: 360.0,
                segment_depth: 0.5,
                uplift: 1.0,
                root_share: 0.4,
                root_width_factor: 2.2,
            },
            belt_arc: BeltSpec {
                height: 80.0,
                width: 220.0,
                segment_scale: 320.0,
                segment_depth: 0.5,
                uplift: 0.8,
                root_share: 0.35,
                root_width_factor: 2.0,
            },
            arc_inland_offset: 180.0,
            belt_island_arc: BeltSpec {
                height: 50.0,
                width: 140.0,
                segment_scale: 260.0,
                segment_depth: 0.6,
                uplift: 0.5,
                root_share: 0.3,
                root_width_factor: 1.8,
            },
            island_arc_offset: 50.0,
            rift_depth: 20.0,
            rift_width: 170.0,
            trench_depth: 18.0,
            trench_width: 110.0,
            convergence_floor: 0.15,
            belt_strength_span: 0.55,
            iterations: 10,
            fill_every: 3,
            erode_k: 0.05,
            erode_m: 0.5,
            dt: 20.0,
            interior_uplift: 0.04,
            diffusion: 0.006,
            high_diffusion_share: 0.3,
            talus: 6.0,
            uplift_rate: 0.1,
            seed_relief: 6.0,
            snowline: 150.0,
            glacial_iterations: 4,
            glacial_strength: 0.3,
            lake_min_depth: 2.5,
            ceiling_start: 190.0,
            ceiling_max: 240.0,
            channel_area: 60.0,
            channel_area_full: 2500.0,
            river_width: (2.0, 6.0),
            river_depth: (1.0, 3.0),
            river_bank: 4.0,
            detail_amp: 1.5,
            detail_scale: 24.0,
            detail_broad_amp: 1.2,
            detail_broad_scale: 70.0,
            detail_floor: 0.25,
            relief: ReliefSpec {
                rib_amp: 3.0,
                rib_scale: 18.0,
                rib_stretch: 2.5,
                rib_slope: (0.35, 1.0),
                bench_amp: 3.0,
                bench_spacing: 9.0,
                bench_tread: 0.34,
                bench_warp_amp: 7.0,
                bench_warp_scale: 90.0,
                bench_slope: (0.8, 1.6),
                calm_flow: 120.0,
                shore_calm_band: 6.0,
            },
            moisture: MoistureSpec {
                reach: 30.0,
                flow_half: 90.0,
                dry_height: 90.0,
                proximity_weight: 0.5,
                flow_weight: 0.25,
                elevation_weight: 0.25,
            },
            meander_amp: 1.1,
            meander_scale: 70.0,
            riffle_amp: 0.3,
            riffle_scale: 44.0,
        }
    }

    fn compile_test(spec: &GeologySpec, seed: u32, dimension: &str) -> GeoModel {
        let mut salts = hashbrown::HashSet::new();
        GeoModel::compile(spec, 80, seed, dimension, &mut salts).expect("compiles")
    }

    #[test]
    fn every_land_cell_drains_to_an_outlet() {
        let model = compile_test(&test_spec(), 77, "geo_test");
        let tile = model.tile(0, 0);
        let side = tile.side;
        let sea = model.sea_level as f32;

        // Rebuild receivers from the tile's own filled surface — the
        // same data the solve used last.
        let filled: Vec<f64> = tile.filled.iter().map(|f| *f as f64).collect();
        let mut receiver = vec![u32::MAX; side * side];
        model.receivers(&filled, &mut receiver, side);

        let mut land = 0usize;
        let mut drained = 0usize;
        for start in 0..side * side {
            if tile.height[start] <= sea {
                continue;
            }
            land += 1;
            let mut current = start;
            let mut is_drained = false;
            for _ in 0..side * side {
                let next = receiver[current] as usize;
                let ix = current / side;
                let iz = current % side;
                let is_edge = ix == 0 || iz == 0 || ix == side - 1 || iz == side - 1;
                if tile.height[current] <= sea || is_edge || next == current {
                    // Sea, tile edge, or a filled-lake outlet plateau:
                    // all legitimate ends of a drainage walk.
                    is_drained = true;
                    break;
                }
                current = next;
            }
            if is_drained {
                drained += 1;
            }
        }
        let share = drained as f64 / land.max(1) as f64;
        println!("drainage: {drained}/{land} land cells reach an outlet ({share:.4})");
        assert!(share >= 0.999, "non-draining terrain: {share:.4}");
    }

    #[test]
    fn fused_surface_is_continuous_across_tile_boundaries() {
        let model = compile_test(&test_spec(), 91, "geo_seam");
        let boundary = model.spec.tile; // x = 512 is a stride boundary
        let mut worst_at_boundary = 0.0f64;
        let mut worst_elsewhere = 0.0f64;
        for z in (-200..200).step_by(7) {
            let mut previous = model.surface_f(boundary - 40, z);
            for x in (boundary - 39)..(boundary + 40) {
                let here = model.surface_f(x, z);
                let step = (here - previous).abs();
                if (x - boundary).abs() <= 1 {
                    worst_at_boundary = worst_at_boundary.max(step);
                } else {
                    worst_elsewhere = worst_elsewhere.max(step);
                }
                previous = here;
            }
        }
        println!(
            "fusion continuity: worst step at boundary {worst_at_boundary:.2}, elsewhere {worst_elsewhere:.2}"
        );
        // The boundary must not introduce steps beyond what the terrain
        // itself produces anywhere else in the band.
        assert!(
            worst_at_boundary <= worst_elsewhere * 1.5 + 1.0,
            "tile seam visible: {worst_at_boundary:.2} vs {worst_elsewhere:.2}"
        );
    }

    #[test]
    fn channel_levels_are_continuous_across_tile_boundaries() {
        let model = compile_test(&test_spec(), 91, "geo_seam");
        let boundary = model.spec.tile; // x = 512 is a stride boundary

        // Wherever a channel crosses the seam, the water level sampled
        // just west and just east of it must agree to the pool-and-drop
        // quantum. Before levels derived from the fused surface, the
        // two tiles' own fills disagreed by up to the inter-tile
        // erosion divergence — five-block walls of water at the seam.
        let mut crossings = 0;
        let mut worst = 0.0f64;
        for z in (-1500..1500).step_by(4) {
            let west = model.river_sample(boundary - 2, z);
            let east = model.river_sample(boundary + 2, z);
            let (Some(west), Some(east)) = (west, east) else {
                continue;
            };
            if west.dist > west.half_width || east.dist > east.half_width {
                continue;
            }
            crossings += 1;
            worst = worst.max((west.water_y - east.water_y).abs());
        }
        println!("seam crossings: {crossings}, worst level step {worst:.2}");
        assert!(crossings > 0, "no channel crossed the test seam; widen the scan");
        assert!(
            worst <= 2.0,
            "channel water level jumps {worst:.2} blocks at a tile seam"
        );
    }

    #[test]
    fn contested_seam_basins_answer_dry_on_both_sides() {
        let model = compile_test(&test_spec(), 91, "geo_seam");
        let cell = model.spec.cell as f64;
        let boundary = model.spec.tile;

        // Wherever the two windows disagree about a lake in the seam
        // band, the verdict must silence both: a lake placed on one
        // side of a belief boundary spills against the other side
        // forever. Agreement means both answer, disagreement means
        // neither does.
        let mut disputed = 0;
        let mut agreed = 0;
        for x in (boundary - 400..boundary + 400).step_by(4) {
            for z in (-1200..1200).step_by(4) {
                let west_tile = model.tile(
                    ((x as f64) / model.spec.tile as f64).floor() as i64 - 1,
                    (z as f64 / model.spec.tile as f64).floor() as i64,
                );
                let own_tile = model.tile(
                    ((x as f64) / model.spec.tile as f64).floor() as i64,
                    (z as f64 / model.spec.tile as f64).floor() as i64,
                );
                let own = own_tile.lake_level_at(cell, x as f64, z as f64);
                let is_covered = west_tile.slot_at(cell, x as f64, z as f64).is_some();
                if !is_covered {
                    continue; // the neighbor holds no belief here
                }
                let neighbor = west_tile.lake_level_at(cell, x as f64, z as f64);
                match (own, neighbor) {
                    (Some((_, a)), Some((_, b))) if (a - b).abs() <= 1.0 => {
                        agreed += 1;
                    }
                    (Some(_), Some(_)) | (Some(_), None) => {
                        // Contested (level clash, or the neighbor
                        // covers this ground without the lake): the
                        // model must not water it.
                        if model.lake_level(x, z).is_some() {
                            disputed += 1;
                        }
                    }
                    _ => {}
                }
            }
        }
        println!("agreed lake cells: {agreed}, contested-but-watered: {disputed}");
        assert_eq!(
            disputed, 0,
            "{disputed} contested seam lake cells still answer with water"
        );
    }

    #[test]
    fn rejected_seam_basins_keep_their_rivers() {
        // The dry verdict silences the lake, not the drainage: a cell
        // in a rejected basin that carries channel-grade flow must
        // still sample a river channel, or seam disputes turn whole
        // reaches into empty depressions. Rejected basins with real
        // flow are rare, so walk a deterministic seed ladder until one
        // window holds evidence.
        let mut rejected_channel_cells = 0usize;
        let mut wet = 0usize;
        for seed in [91u32, 17, 23, 47, 65] {
            let model = compile_test(&test_spec(), seed, "geo_seam");
            let spec = model.spec.clone();
            let cell = spec.cell as f64;
            let halo = spec.halo_cells as usize;
            let sea = 80.0f64;
            for tile_x in -2..=2i64 {
                for tile_z in -2..=2i64 {
                    let tile = model.tile(tile_x, tile_z);
                    let hydro = model.hydro(tile_x, tile_z);
                    let side = tile.side;
                    for ix in halo..side - halo {
                        for iz in halo..side - halo {
                            let index = ix * side + iz;
                            if !tile.lake[index] || hydro.lake_keep[index] {
                                continue;
                            }
                            if (tile.flow[index] as f64) < spec.channel_area
                                || (tile.filled[index] as f64) <= sea
                            {
                                continue;
                            }
                            let x = tile.origin_x as f64 + (ix as f64 + 0.5) * cell;
                            let z = tile.origin_z as f64 + (iz as f64 + 0.5) * cell;
                            if model.fused_height_raw(x, z) <= sea {
                                continue;
                            }
                            rejected_channel_cells += 1;
                            if model
                                .river_sample(x.round() as i32, z.round() as i32)
                                .is_some()
                            {
                                wet += 1;
                            }
                        }
                    }
                }
            }
            if rejected_channel_cells > 0 {
                println!("evidence found at seed {seed}");
                break;
            }
        }
        println!(
            "rejected-basin channel cells: {rejected_channel_cells}, still carrying a channel: {wet}"
        );
        assert!(
            rejected_channel_cells > 0,
            "scan window found no rejected-basin channel cells; widen the window or move the seed so this test tests something"
        );
        assert!(
            wet * 10 >= rejected_channel_cells * 9,
            "{}/{} rejected-basin channel cells lost their river",
            rejected_channel_cells - wet,
            rejected_channel_cells
        );
    }

    #[test]
    fn geology_is_query_order_independent() {
        let spec = test_spec();
        let forward = compile_test(&spec, 123, "geo_order");
        let reverse = compile_test(&spec, 123, "geo_order");

        let points: Vec<(i32, i32)> = (0..60)
            .map(|i| (((i * 97) % 1400) - 700, ((i * 61) % 1400) - 700))
            .collect();

        let heights_forward: Vec<f64> =
            points.iter().map(|(x, z)| forward.surface_f(*x, *z)).collect();
        let heights_reverse: Vec<f64> = points
            .iter()
            .rev()
            .map(|(x, z)| reverse.surface_f(*x, *z))
            .collect();

        for (index, (x, z)) in points.iter().enumerate() {
            let a = heights_forward[index];
            let b = heights_reverse[points.len() - 1 - index];
            assert!(
                a.to_bits() == b.to_bits(),
                "query order changed the surface at ({x},{z}): {a} vs {b}"
            );
        }
        assert_eq!(forward.tile_digest(0, 0), reverse.tile_digest(0, 0));
    }
}
