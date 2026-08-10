//! River networks. Two routings share one channel geometry and one
//! column contract: `Walker` rivers roll sources on upland lattice cells
//! and walk deterministic steepest-descent paths over the lane height
//! (heightfield worlds); `Drainage` rivers come from the geology lane's
//! solved flow accumulation. Every question a chunk asks (distance to
//! channel, water level, width) is answered from solved-tile polylines
//! cached under a pure key — chunk-order-free by construction.

use std::sync::{Arc, RwLock};

use hashbrown::HashMap;
use serde::Serialize;

use crate::channels::{ChannelField, ChannelProfile};
use crate::spec::GenError;
use crate::stream::{cell_id, mix64, stream_seed, HashStream, SaltPath, Subsystem};

pub use crate::channels::ChannelPoint as RiverPoint;

/// Rivers for one world: routing plus the blocks the river stage writes.
#[derive(Debug, Clone, Serialize)]
pub struct RiverSpec {
    pub materials: RiverMaterials,
    pub routing: RiverRouting,
}

/// Content blocks for the river stage: channel water, the dark wetted
/// bed under real water columns, and the bank/beach block for levees
/// and shore fringes (also used as the shallow bed).
#[derive(Debug, Clone, Serialize)]
pub struct RiverMaterials {
    pub water: &'static str,
    pub bed: &'static str,
    pub bank: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub enum RiverRouting {
    /// Source-and-descent solver over the lane height; heightfield lanes.
    Walker(WalkerRivers),
    /// The geology lane's solved drainage channels; requires that lane.
    Drainage,
}

#[derive(Debug, Clone, Serialize)]
pub struct WalkerRivers {
    pub salt: SaltPath,
    /// Network tile size in blocks; sources are rolled per tile.
    pub tile: i32,
    pub sources_per_tile: u8,
    /// Sources only ignite at or above this surface height.
    pub min_source_height: i32,
    /// Descent step bound (lattice steps of 8 blocks).
    pub max_steps: u16,
    /// Channel half-width from source to mouth.
    pub width: (f64, f64),
    /// Channel depth below the water surface, source to mouth.
    pub depth: (f64, f64),
    /// Containment band beyond the channel: terrain below the waterline
    /// clamps up to it, so channel water can never hang over air.
    pub bank: f64,
    /// Descent tolerance in blocks: the walker may notch through rises up
    /// to this tall (the channel carve cuts them), so micro-bumps and
    /// terrace lips cannot strand a river in a fake pond. Water level
    /// stays monotone regardless.
    pub carve_through: f64,
}

const DESCENT_STRIDE: i32 = 8;
const TILE_CACHE_CAP: usize = 256;

/// What the river does to one terrain column.
#[derive(Debug, Clone, Copy)]
pub enum RiverColumn {
    /// Inside the channel: carve to `bed`, water up to `water_y`.
    Channel { bed: i32, water_y: i32 },
    /// Containment band: terrain below `raise_to` clamps up to it.
    Bank { raise_to: i32, water_y: i32 },
    Outside,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum RiverEnd {
    Sea,
    Pond,
    Junction,
    StepBound,
}

pub struct SolvedTile {
    channels: ChannelField,
    /// Path summaries for tests and debug: node positions with water
    /// levels, and how each path ended.
    pub paths: Vec<(Vec<(i32, i32, f64)>, RiverEnd)>,
}

pub struct CompiledWalkerRivers {
    spec: WalkerRivers,
    seed: u64,
    sea_level: Option<i32>,
    cache: RwLock<HashMap<(i64, i64), Arc<SolvedTile>>>,
}

impl CompiledWalkerRivers {
    pub fn compile(
        spec: &WalkerRivers,
        sea_level: Option<i32>,
        world_seed: u32,
        dimension: &str,
        used_salts: &mut hashbrown::HashSet<&'static str>,
    ) -> Result<Self, GenError> {
        crate::spec::claim_salt(&spec.salt, used_salts)?;
        if spec.tile < 128 {
            return Err(GenError::Invalid {
                path: "rivers.walker.tile".to_string(),
                reason: format!("must be >= 128 blocks, got {}", spec.tile),
            });
        }
        if spec.width.0 <= 0.0 || spec.width.1 < spec.width.0 {
            return Err(GenError::Invalid {
                path: "rivers.walker.width".to_string(),
                reason: format!("span invalid: {:?}", spec.width),
            });
        }
        if spec.carve_through < 0.0 {
            return Err(GenError::Invalid {
                path: "rivers.walker.carve_through".to_string(),
                reason: "must be >= 0".to_string(),
            });
        }
        Ok(Self {
            spec: spec.clone(),
            seed: stream_seed(world_seed, dimension, Subsystem::Hydrology, &spec.salt, 0),
            sea_level,
            cache: RwLock::new(HashMap::new()),
        })
    }

    pub fn spec(&self) -> &WalkerRivers {
        &self.spec
    }

    pub fn max_reach(&self) -> f64 {
        self.spec.width.1 + self.spec.bank
    }

    /// Solve (or fetch) one tile. `height` is the generator's surface —
    /// rivers route by real terrain, and the carve-through tolerance keeps
    /// micro relief from bending a drainage line into a dead end.
    pub fn tile(
        &self,
        tile_x: i64,
        tile_z: i64,
        height: &dyn Fn(i32, i32) -> f64,
    ) -> Arc<SolvedTile> {
        if let Some(hit) = self
            .cache
            .read()
            .expect("river tile cache")
            .get(&(tile_x, tile_z))
        {
            return Arc::clone(hit);
        }
        let solved = Arc::new(self.solve(tile_x, tile_z, height));
        let mut cache = self.cache.write().expect("river tile cache");
        if cache.len() >= TILE_CACHE_CAP {
            cache.clear();
        }
        cache.insert((tile_x, tile_z), Arc::clone(&solved));
        solved
    }

    fn solve(&self, tile_x: i64, tile_z: i64, height: &dyn Fn(i32, i32) -> f64) -> SolvedTile {
        let spec = &self.spec;
        let tile = spec.tile as i64;
        let origin_x = tile_x * tile;
        let origin_z = tile_z * tile;

        let mut sources: Vec<(i32, i32, f64)> = Vec::new();
        let mut stream = HashStream::new(self.seed ^ mix64(cell_id(tile_x, tile_z)));
        for _ in 0..spec.sources_per_tile {
            let sx = origin_x as i32 + (stream.unit() * tile as f64) as i32;
            let sz = origin_z as i32 + (stream.unit() * tile as f64) as i32;
            let sx = sx.div_euclid(DESCENT_STRIDE) * DESCENT_STRIDE;
            let sz = sz.div_euclid(DESCENT_STRIDE) * DESCENT_STRIDE;
            let h = height(sx, sz);
            if h >= spec.min_source_height as f64 {
                sources.push((sx, sz, h));
            }
        }
        sources.sort_by(|a, b| {
            b.2.partial_cmp(&a.2)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.0.cmp(&b.0))
                .then(a.1.cmp(&b.1))
        });

        // Paths may wander one tile beyond their own on every side; the
        // sampling neighborhood bound depends on it.
        let window_min_x = ((tile_x - 1) * tile) as i32;
        let window_min_z = ((tile_z - 1) * tile) as i32;
        let window_max_x = ((tile_x + 2) * tile) as i32;
        let window_max_z = ((tile_z + 2) * tile) as i32;

        let mut visited: HashMap<(i32, i32), ()> = HashMap::new();
        let mut paths: Vec<(Vec<(i32, i32, f64)>, RiverEnd)> = Vec::new();

        for (sx, sz, sh) in sources {
            let mut path: Vec<(i32, i32, f64)> = Vec::new();
            let mut own: HashMap<(i32, i32), ()> = HashMap::new();
            let (mut cx, mut cz) = (sx, sz);
            let mut level = sh;
            let mut end = RiverEnd::StepBound;

            for _ in 0..spec.max_steps {
                path.push((cx, cz, level));
                own.insert((cx, cz), ());

                if let Some(sea) = self.sea_level {
                    if level <= sea as f64 + 0.5 {
                        end = RiverEnd::Sea;
                        break;
                    }
                }

                // Lowest neighbor that is not this path's own trail. The
                // walk may climb up to `carve_through` over a lip — the
                // channel carve cuts the lip down to the water level, so a
                // shallow bowl spills instead of stranding the river; a
                // deep bowl genuinely ends as a pond.
                let mut best: Option<(i32, i32, f64)> = None;
                for (dx, dz) in [
                    (-DESCENT_STRIDE, 0),
                    (DESCENT_STRIDE, 0),
                    (0, -DESCENT_STRIDE),
                    (0, DESCENT_STRIDE),
                    (-DESCENT_STRIDE, -DESCENT_STRIDE),
                    (-DESCENT_STRIDE, DESCENT_STRIDE),
                    (DESCENT_STRIDE, -DESCENT_STRIDE),
                    (DESCENT_STRIDE, DESCENT_STRIDE),
                ] {
                    let (nx, nz) = (cx + dx, cz + dz);
                    if nx < window_min_x
                        || nx >= window_max_x
                        || nz < window_min_z
                        || nz >= window_max_z
                        || own.contains_key(&(nx, nz))
                    {
                        continue;
                    }
                    let nh = height(nx, nz);
                    let is_better = match best {
                        None => true,
                        Some((_, _, bh)) => nh < bh,
                    };
                    if is_better {
                        best = Some((nx, nz, nh));
                    }
                }

                match best {
                    Some((nx, nz, _)) if visited.contains_key(&(nx, nz)) => {
                        // Another river's channel: converge into it.
                        path.push((nx, nz, level));
                        end = RiverEnd::Junction;
                        break;
                    }
                    Some((nx, nz, nh)) if nh <= level + spec.carve_through => {
                        cx = nx;
                        cz = nz;
                        level = level.min(nh);
                    }
                    _ => {
                        end = RiverEnd::Pond;
                        break;
                    }
                }
            }

            if path.len() >= 4 {
                for cell in own.keys() {
                    visited.insert(*cell, ());
                }
                paths.push((path, end));
            }
        }

        let mut lines: Vec<(Vec<(f64, f64, f64)>, Vec<ChannelProfile>)> = Vec::new();
        for (path, _) in &paths {
            let len = path.len().max(2) as f64;
            let grow = |t: f64| t.sqrt();
            let mut line = Vec::with_capacity(path.len());
            let mut profiles = Vec::with_capacity(path.len());
            for (index, node) in path.iter().enumerate() {
                let t = index as f64 / len;
                line.push((node.0 as f64, node.1 as f64, node.2));
                profiles.push(ChannelProfile {
                    half_width: spec.width.0 + (spec.width.1 - spec.width.0) * grow(t),
                    depth: spec.depth.0 + (spec.depth.1 - spec.depth.0) * grow(t),
                });
            }
            lines.push((line, profiles));
        }

        SolvedTile {
            channels: ChannelField::from_polylines(&lines, self.max_reach()),
            paths,
        }
    }

    /// Nearest river sample within reach. Checks the 3x3 tiles around the
    /// query point: a path never leaves its solving tile by more than one
    /// tile, so the neighborhood bound is exact.
    pub fn sample(&self, x: i32, z: i32, height: &dyn Fn(i32, i32) -> f64) -> Option<RiverPoint> {
        let tile = self.spec.tile as i64;
        let tile_x = (x as i64).div_euclid(tile);
        let tile_z = (z as i64).div_euclid(tile);
        let reach = self.max_reach();

        let mut best: Option<RiverPoint> = None;
        for dtx in -1..=1 {
            for dtz in -1..=1 {
                let solved = self.tile(tile_x + dtx, tile_z + dtz, height);
                if let Some(point) = solved.channels.sample(x, z, reach) {
                    if best.map(|b| point.dist < b.dist).unwrap_or(true) {
                        best = Some(point);
                    }
                }
            }
        }
        best
    }

    /// Classify one column against the nearest channel.
    pub fn column(&self, point: &RiverPoint) -> RiverColumn {
        classify_column(point, self.spec.bank)
    }
}

/// Shared column classification: inside the half-width the channel cuts
/// to an eased bed; inside the bank band terrain clamps up to one above
/// the waterline; beyond it the river does not touch the column.
pub(crate) fn classify_column(point: &RiverPoint, bank: f64) -> RiverColumn {
    let water_y = point.water_y.floor() as i32;
    if point.dist < point.half_width {
        let t = 1.0 - point.dist / point.half_width;
        let ease = t * t * (3.0 - 2.0 * t);
        let bed = point.water_y - 1.0 - point.depth * ease;
        RiverColumn::Channel {
            bed: bed.floor() as i32,
            water_y,
        }
    } else if point.dist < point.half_width + bank {
        RiverColumn::Bank {
            raise_to: water_y + 1,
            water_y,
        }
    } else {
        RiverColumn::Outside
    }
}
