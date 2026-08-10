//! Community-field ecology: biogeography, not palette confetti.
//!
//! One deterministic field assigns every patch of ground to at most one
//! *plant community* — a named assemblage with its own canopy mix,
//! ecotone edge species, forest-floor understory, and environmental
//! envelope (biome, elevation, slope, moisture). Species therefore
//! arrive where their community lives and nowhere else: a cherry grove
//! is a place, not a per-tree dice roll inside an oak wood.
//!
//! The field is a jittered site lattice (like the engine's zoned biome
//! partition, one octave down in scale). Each cell samples its site's
//! environment, keeps the communities whose envelopes accept it, and
//! rolls one owner by weight. Patch borders carry an ecotone parameter
//! so edges read as transition bands — birch fringing a spruce stand —
//! instead of fence lines. Every decision hashes from absolute
//! positions, so any chunk, thread, or tile order reproduces the same
//! mosaic.

use hashbrown::HashMap;
use serde::Serialize;

use crate::spec::GenError;
use crate::stream::{cell_id, hash_unit, mix64, stream_seed, HashStream, SaltPath, Subsystem};

/// The ecology field and its communities for one world.
#[derive(Debug, Clone, Serialize)]
pub struct EcologySpec {
    pub salt: SaltPath,
    /// Community patch lattice pitch in blocks.
    pub cell: f64,
    /// Ecotone band as a share of the cell (0..0.5): patches blend
    /// their edges across this margin.
    pub ecotone: f64,
    /// Moisture reach in blocks for worlds without a geology backbone:
    /// lane worlds derive moisture from river distance alone.
    pub lane_moisture_reach: f64,
    pub communities: Vec<CommunityDef>,
}

/// One plant community: environmental envelope, canopy, and floor.
#[derive(Debug, Clone, Serialize)]
pub struct CommunityDef {
    pub key: &'static str,
    /// Biome keys whose ground this community can own.
    pub biomes: Vec<&'static str>,
    /// Surface elevation envelope at the site.
    pub surface: (i32, i32),
    /// Site slope ceiling.
    pub max_slope: f64,
    /// Site moisture envelope, 0..1.
    pub moisture: (f64, f64),
    /// Selection weight among the communities eligible at a site.
    pub weight: f64,
    /// Canopy planting. `None` is a real community with no trees —
    /// a wet meadow owns ground and floor without a canopy.
    pub canopy: Option<CanopySpec>,
    /// Ecotone replacements: within the edge band, canopy picks swap to
    /// these with probability rising toward the border.
    pub edge_species: Vec<(&'static str, f64)>,
    /// Forest-floor understory.
    pub floor: FloorSpec,
}

/// Canopy structure within a community's patches.
#[derive(Debug, Clone, Serialize)]
pub struct CanopySpec {
    /// Grove-cluster lattice pitch in blocks.
    pub cell: f64,
    pub cluster_chance: f64,
    pub points: (u8, u8),
    pub spread: f64,
    /// Species mix: key and weight. The mix is rolled per *cluster*
    /// (dominant plus companion), never per tree.
    pub species: Vec<(&'static str, f64)>,
    /// Probability a cluster member repeats the cluster's dominant
    /// species instead of its companion: stand cohesion.
    pub cohesion: f64,
    /// Tree size spread (0..0.5): cluster maturity and per-tree age
    /// multiply into stamp scale, so stands carry height structure.
    pub age_spread: f64,
    pub max_slope: f64,
    pub avoid_river_within: f64,
}

/// Understory and ground-cover plants a community's floor carries.
#[derive(Debug, Clone, Serialize)]
pub struct FloorSpec {
    /// Chance per owned column of a floor plant.
    pub density: f64,
    /// Weighted palette of registry block names. Leaves blocks read as
    /// shrubs; tufts, ferns and flowers as themselves.
    pub plants: Vec<(&'static str, f64)>,
    /// Density multiplier inside the riparian band.
    pub riparian_boost: f64,
    /// Riparian band width in blocks from the channel line.
    pub riparian_band: f64,
}

/// Environment probes the field samples through — the same closures the
/// flora placer already receives, so ecology stays engine-agnostic.
pub struct Env<'a> {
    pub surface: &'a dyn Fn(i32, i32) -> i32,
    pub steepness: &'a dyn Fn(i32, i32) -> f64,
    pub biome_key: &'a dyn Fn(i32, i32, i32) -> &'static str,
    pub river_dist: &'a dyn Fn(i32, i32) -> f64,
    pub moisture: &'a dyn Fn(i32, i32) -> f64,
    pub sea_level: Option<i32>,
}

/// A patch ownership answer: which community, and how interior the
/// query point sits (0 at the border, 1 fully inside the ecotone).
#[derive(Debug, Clone, Copy)]
pub struct Owner {
    pub community: usize,
    pub interior: f64,
}

/// Per-chunk memo for cell decisions. Purely a cache: every entry is a
/// pure function of the cell and the world seed.
#[derive(Default)]
pub struct CellCache {
    cells: HashMap<(i64, i64), Option<u16>>,
}

pub struct CompiledEcology {
    spec: EcologySpec,
    seed: u64,
}

impl CompiledEcology {
    pub fn compile(
        spec: &EcologySpec,
        world_seed: u32,
        dimension: &str,
        used_salts: &mut hashbrown::HashSet<&'static str>,
    ) -> Result<Self, GenError> {
        crate::spec::claim_salt(&spec.salt, used_salts)?;
        let invalid = |path: String, reason: String| GenError::Invalid { path, reason };
        if spec.cell < 16.0 {
            return Err(invalid(
                "ecology.cell".to_string(),
                format!("must be >= 16 blocks, got {}", spec.cell),
            ));
        }
        if !(0.0..=0.5).contains(&spec.ecotone) {
            return Err(invalid(
                "ecology.ecotone".to_string(),
                "must be within 0..=0.5".to_string(),
            ));
        }
        if spec.communities.is_empty() {
            return Err(invalid(
                "ecology.communities".to_string(),
                "needs at least one community".to_string(),
            ));
        }
        for community in &spec.communities {
            let path = |what: &str| format!("ecology.community.{}.{what}", community.key);
            if community.weight <= 0.0 {
                return Err(invalid(path("weight"), "must be > 0".to_string()));
            }
            if let Some(canopy) = &community.canopy {
                if canopy.points.0 == 0 || canopy.points.1 < canopy.points.0 {
                    return Err(invalid(path("canopy.points"), "must be 1..=max".to_string()));
                }
                if !(0.0..=1.0).contains(&canopy.cohesion) {
                    return Err(invalid(path("canopy.cohesion"), "must be 0..=1".to_string()));
                }
                if !(0.0..=0.5).contains(&canopy.age_spread) {
                    return Err(invalid(path("canopy.age_spread"), "must be 0..=0.5".to_string()));
                }
            }
            let floor = &community.floor;
            if !(0.0..=1.0).contains(&floor.density) {
                return Err(invalid(path("floor.density"), "must be 0..=1".to_string()));
            }
        }
        let seed = stream_seed(world_seed, dimension, Subsystem::Ecology, &spec.salt, 1);
        Ok(Self {
            spec: spec.clone(),
            seed,
        })
    }

    pub fn spec(&self) -> &EcologySpec {
        &self.spec
    }

    pub fn communities(&self) -> &[CommunityDef] {
        &self.spec.communities
    }

    /// Jittered site of one lattice cell.
    fn site(&self, cell_x: i64, cell_z: i64) -> (f64, f64) {
        let id = mix64(self.seed ^ mix64(cell_id(cell_x, cell_z)));
        let jx = (hash_unit(id) - 0.5) * 0.85;
        let jz = (hash_unit(mix64(id ^ 0x11)) - 0.5) * 0.85;
        (
            (cell_x as f64 + 0.5 + jx) * self.spec.cell,
            (cell_z as f64 + 0.5 + jz) * self.spec.cell,
        )
    }

    /// The community a cell's site elects, if any. Pure per cell; the
    /// cache only memoizes.
    fn cell_owner(&self, cell_x: i64, cell_z: i64, env: &Env, cache: &mut CellCache) -> Option<u16> {
        if let Some(hit) = cache.cells.get(&(cell_x, cell_z)) {
            return *hit;
        }
        let (site_x, site_z) = self.site(cell_x, cell_z);
        let x = site_x.round() as i32;
        let z = site_z.round() as i32;
        let surface = (env.surface)(x, z);
        let owner = if env.sea_level.map(|sea| surface <= sea).unwrap_or(false) {
            None
        } else {
            let slope = (env.steepness)(x, z);
            let moisture = (env.moisture)(x, z);
            let biome = (env.biome_key)(x, surface, z);
            let mut total = 0.0;
            let mut eligible: smallvec::SmallVec<[(u16, f64); 8]> = smallvec::SmallVec::new();
            for (index, community) in self.spec.communities.iter().enumerate() {
                if surface < community.surface.0 || surface > community.surface.1 {
                    continue;
                }
                if slope > community.max_slope {
                    continue;
                }
                if moisture < community.moisture.0 || moisture > community.moisture.1 {
                    continue;
                }
                if !community.biomes.iter().any(|b| *b == biome) {
                    continue;
                }
                eligible.push((index as u16, community.weight));
                total += community.weight;
            }
            if eligible.is_empty() {
                None
            } else {
                let mut stream =
                    HashStream::new(mix64(self.seed ^ mix64(cell_id(cell_x, cell_z)) ^ 0x99));
                let mut roll = stream.unit() * total;
                let mut picked = eligible[eligible.len() - 1].0;
                for (index, weight) in &eligible {
                    roll -= weight;
                    if roll <= 0.0 {
                        picked = *index;
                        break;
                    }
                }
                Some(picked)
            }
        };
        cache.cells.insert((cell_x, cell_z), owner);
        owner
    }

    /// Patch ownership at a point: nearest site's community plus the
    /// interior parameter from the two nearest site distances.
    pub fn owner_at(&self, x: i32, z: i32, env: &Env, cache: &mut CellCache) -> Option<Owner> {
        let cell = self.spec.cell;
        let fx = x as f64;
        let fz = z as f64;
        let base_x = (fx / cell).floor() as i64;
        let base_z = (fz / cell).floor() as i64;

        let mut best = f64::MAX;
        let mut second = f64::MAX;
        let mut best_cell = (base_x, base_z);
        for dx in -1..=1i64 {
            for dz in -1..=1i64 {
                let cx = base_x + dx;
                let cz = base_z + dz;
                let (sx, sz) = self.site(cx, cz);
                let d = ((sx - fx).powi(2) + (sz - fz).powi(2)).sqrt();
                if d < best {
                    second = best;
                    best = d;
                    best_cell = (cx, cz);
                } else if d < second {
                    second = d;
                }
            }
        }

        let community = self.cell_owner(best_cell.0, best_cell.1, env, cache)?;
        let ecotone = (self.spec.ecotone * cell).max(1e-9);
        let interior = ((second - best) / ecotone).clamp(0.0, 1.0);
        Some(Owner {
            community: community as usize,
            interior,
        })
    }

    /// Community distribution over a window, for diagnostics and the
    /// outlier tests: counts per community key plus open ground.
    pub fn census(
        &self,
        min: (i32, i32),
        max: (i32, i32),
        step: i32,
        env: &Env,
    ) -> Vec<(&'static str, usize)> {
        let mut cache = CellCache::default();
        let mut counts = vec![0usize; self.spec.communities.len() + 1];
        let mut x = min.0;
        while x < max.0 {
            let mut z = min.1;
            while z < max.1 {
                match self.owner_at(x, z, env, &mut cache) {
                    Some(owner) => counts[owner.community] += 1,
                    None => *counts.last_mut().expect("census counts") += 1,
                }
                z += step;
            }
            x += step;
        }
        let mut out: Vec<(&'static str, usize)> = self
            .spec
            .communities
            .iter()
            .enumerate()
            .map(|(index, community)| (community.key, counts[index]))
            .collect();
        out.push(("open", counts[self.spec.communities.len()]));
        out
    }
}
