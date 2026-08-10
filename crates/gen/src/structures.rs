//! Plan-sliced structures: everything with extent is a deterministic plan
//! derived from (world seed, set salt, site), bounded by a declared box,
//! and written slice-by-slice by every chunk it intersects. Plans read
//! terrain through a pure view and never read chunk voxels, so every chunk
//! derives identical plans regardless of generation order.

use std::sync::{Arc, Mutex, RwLock};

use hashbrown::HashMap;
use serde::Serialize;

use crate::spec::GenError;
use crate::stream::{cell_id, mix64, stream_seed, HashStream, SaltPath, Subsystem};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub enum Dir4 {
    North, // -z
    South, // +z
    West,  // -x
    East,  // +x
}

impl Dir4 {
    fn opposite(self) -> Self {
        match self {
            Dir4::North => Dir4::South,
            Dir4::South => Dir4::North,
            Dir4::West => Dir4::East,
            Dir4::East => Dir4::West,
        }
    }

    fn angle(self) -> u8 {
        match self {
            Dir4::North => 0,
            Dir4::East => 1,
            Dir4::South => 2,
            Dir4::West => 3,
        }
    }

    fn rotated(self, quarter_turns: u8) -> Self {
        match (self.angle() + quarter_turns) % 4 {
            0 => Dir4::North,
            1 => Dir4::East,
            2 => Dir4::South,
            _ => Dir4::West,
        }
    }

    fn step(self) -> (i32, i32) {
        match self {
            Dir4::North => (0, -1),
            Dir4::South => (0, 1),
            Dir4::West => (-1, 0),
            Dir4::East => (1, 0),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Socket {
    pub key: &'static str,
    pub at: (u16, u16, u16),
    pub facing: Dir4,
    pub accepts: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct PieceDef {
    pub key: &'static str,
    pub size: (u16, u16, u16),
    /// Palette index per cell (x-major, then y, then z); 0 = untouched.
    pub cells: Vec<u16>,
    pub palette: Vec<&'static str>,
    pub sockets: Vec<Socket>,
    /// Local-space cell that lands on the growth anchor (ground contact).
    pub anchor: (u16, u16, u16),
}

pub struct PieceBuilder {
    key: &'static str,
    size: (u16, u16, u16),
    cells: Vec<u16>,
    palette: Vec<&'static str>,
    sockets: Vec<Socket>,
    anchor: (u16, u16, u16),
}

impl PieceBuilder {
    pub fn new(key: &'static str, w: u16, h: u16, d: u16) -> Self {
        Self {
            key,
            size: (w, h, d),
            cells: vec![0; w as usize * h as usize * d as usize],
            palette: vec!["<air>"],
            sockets: Vec::new(),
            anchor: (w / 2, 0, d / 2),
        }
    }

    fn palette_index(&mut self, block: &'static str) -> u16 {
        if let Some(index) = self.palette.iter().position(|b| *b == block) {
            return index as u16;
        }
        self.palette.push(block);
        (self.palette.len() - 1) as u16
    }

    fn cell_slot(&self, x: u16, y: u16, z: u16) -> usize {
        (x as usize * self.size.1 as usize + y as usize) * self.size.2 as usize + z as usize
    }

    pub fn set(mut self, x: u16, y: u16, z: u16, block: &'static str) -> Self {
        let index = self.palette_index(block);
        let slot = self.cell_slot(x, y, z);
        self.cells[slot] = index;
        self
    }

    pub fn fill(
        mut self,
        from: (u16, u16, u16),
        to: (u16, u16, u16),
        block: &'static str,
    ) -> Self {
        let index = self.palette_index(block);
        for x in from.0..=to.0 {
            for y in from.1..=to.1 {
                for z in from.2..=to.2 {
                    let slot = self.cell_slot(x, y, z);
                    self.cells[slot] = index;
                }
            }
        }
        self
    }

    pub fn walls(
        mut self,
        from: (u16, u16, u16),
        to: (u16, u16, u16),
        block: &'static str,
    ) -> Self {
        let index = self.palette_index(block);
        for x in from.0..=to.0 {
            for y in from.1..=to.1 {
                for z in from.2..=to.2 {
                    let is_shell = x == from.0 || x == to.0 || z == from.2 || z == to.2;
                    if is_shell {
                        let slot = self.cell_slot(x, y, z);
                        self.cells[slot] = index;
                    }
                }
            }
        }
        self
    }

    pub fn clear(mut self, from: (u16, u16, u16), to: (u16, u16, u16)) -> Self {
        for x in from.0..=to.0 {
            for y in from.1..=to.1 {
                for z in from.2..=to.2 {
                    let slot = self.cell_slot(x, y, z);
                    self.cells[slot] = 0;
                }
            }
        }
        self
    }

    pub fn socket(mut self, key: &'static str, at: (u16, u16, u16), facing: Dir4, accepts: &'static str) -> Self {
        self.sockets.push(Socket {
            key,
            at,
            facing,
            accepts,
        });
        self
    }

    pub fn anchor(mut self, at: (u16, u16, u16)) -> Self {
        self.anchor = at;
        self
    }

    pub fn build(self) -> PieceDef {
        PieceDef {
            key: self.key,
            size: self.size,
            cells: self.cells,
            palette: self.palette,
            sockets: self.sockets,
            anchor: self.anchor,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Pool {
    pub key: &'static str,
    pub entries: Vec<(&'static str, f64)>,
    pub terminators: Vec<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
pub enum StructureSource {
    Single { piece: &'static str },
    Pooled {
        start_pool: &'static str,
        max_depth: u8,
        max_pieces: u16,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct StructureMember {
    pub key: &'static str,
    pub weight: f64,
    pub source: StructureSource,
}

#[derive(Debug, Clone, Serialize)]
pub enum PlacementPolicy {
    CellSites { cell: f64, chance: f64, jitter: f64 },
    RandomSpread {
        spacing_chunks: u16,
        separation_chunks: u16,
    },
}

#[derive(Debug, Clone, Serialize)]
pub enum PlacementConstraint {
    BiomeTag(&'static str),
    SurfaceHeight { min: i32, max: i32 },
    MaxSlope(f64),
    MinDistFromOrigin(f64),
    ExcludeNear { set: &'static str, min_dist: f64 },
    RequiresFluidFloor { min_depth: i32 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum RejectionReason {
    BiomeTag,
    SurfaceHeight,
    MaxSlope,
    MinDistFromOrigin,
    ExcludeNear,
    RequiresFluidFloor,
    GrowthFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub enum PopulatePhase {
    Landmark,
    Major,
    Minor,
    Flora,
}

#[derive(Debug, Clone, Serialize)]
pub enum AdaptationSpec {
    None,
    Platform { falloff: u8 },
}

#[derive(Debug, Clone, Serialize)]
pub struct StructureSetSpec {
    pub key: &'static str,
    pub salt: SaltPath,
    pub members: Vec<StructureMember>,
    pub placement: PlacementPolicy,
    pub constraints: Vec<PlacementConstraint>,
    pub adaptation: AdaptationSpec,
    pub max_reach: (u16, u16, u16),
    pub phase: PopulatePhase,
}

/// Pure terrain access for plan building and constraints; implemented by
/// the compiled generator. Surface here is the raw lane height — plans may
/// not observe their own adaptation.
pub trait TerrainView: Sync {
    fn surface_raw(&self, x: i32, z: i32) -> i32;
    fn steepness(&self, x: i32, z: i32) -> f64;
    fn biome_has_tag(&self, x: i32, z: i32, tag: &str) -> bool;
    fn sea_level(&self) -> Option<i32>;
}

#[derive(Debug, Clone)]
pub struct PlacedPiece {
    pub piece: usize,
    pub rotation: u8,
    pub min: (i32, i32, i32),
}

#[derive(Debug)]
pub struct StructurePlan {
    pub set: usize,
    pub member: &'static str,
    pub site: (i64, i64),
    pub anchor: (i32, i32, i32),
    pub bbox_min: (i32, i32, i32),
    pub bbox_max: (i32, i32, i32),
    pub pieces: Vec<PlacedPiece>,
    pub ground_patch: Option<GroundPatch>,
}

#[derive(Debug, Clone)]
pub struct GroundPatch {
    pub min_x: i32,
    pub min_z: i32,
    pub max_x: i32,
    pub max_z: i32,
    pub target_y: i32,
    pub falloff: u8,
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct RejectionStats {
    pub placed: u64,
    pub rejected: Vec<(RejectionReason, u64)>,
    pub samples: Vec<((i64, i64), RejectionReason)>,
}

impl RejectionStats {
    fn record(&mut self, site: (i64, i64), reason: RejectionReason) {
        match self.rejected.iter_mut().find(|(r, _)| *r == reason) {
            Some((_, count)) => *count += 1,
            None => self.rejected.push((reason, 1)),
        }
        if self.samples.len() < 32 {
            self.samples.push((site, reason));
        }
    }
}

struct CompiledPiece {
    def: PieceDef,
    palette_blocks: Vec<u32>,
}

impl CompiledPiece {
    fn rotated_size(&self, rotation: u8) -> (i32, i32, i32) {
        let (w, h, d) = self.def.size;
        if rotation % 2 == 0 {
            (w as i32, h as i32, d as i32)
        } else {
            (d as i32, h as i32, w as i32)
        }
    }

    /// Maps a local cell to its offset within the rotated footprint.
    fn rotate_cell(&self, x: u16, y: u16, z: u16, rotation: u8) -> (i32, i32, i32) {
        let (w, _, d) = self.def.size;
        let (x, z) = (x as i32, z as i32);
        let (w, d) = (w as i32, d as i32);
        let (rx, rz) = match rotation % 4 {
            0 => (x, z),
            1 => (d - 1 - z, x),
            2 => (w - 1 - x, d - 1 - z),
            _ => (z, w - 1 - x),
        };
        (rx, y as i32, rz)
    }
}

struct CompiledSet {
    spec: StructureSetSpec,
    member_weights: Vec<f64>,
    resolved_constraints: Vec<PlacementConstraint>,
}

pub struct CompiledStructures {
    pieces: Vec<CompiledPiece>,
    piece_index: HashMap<&'static str, usize>,
    pools: Vec<Pool>,
    pool_index: HashMap<&'static str, usize>,
    sets: Vec<CompiledSet>,
    set_index: HashMap<&'static str, usize>,
    world_seed: u32,
    dimension: String,
    chunk_size: i32,
    plan_cache: RwLock<HashMap<(usize, i64, i64), Option<Arc<StructurePlan>>>>,
    rejections: Vec<Mutex<RejectionStats>>,
}

pub(crate) const PLAN_CACHE_CAP: usize = 4096;

impl CompiledStructures {
    pub fn compile(
        pieces: &[PieceDef],
        pools: &[Pool],
        sets: &[StructureSetSpec],
        resolve_block: &dyn Fn(&str) -> Result<u32, GenError>,
        world_seed: u32,
        dimension: &str,
        chunk_size: i32,
        used_salts: &mut hashbrown::HashSet<&'static str>,
    ) -> Result<Self, GenError> {
        let mut compiled_pieces = Vec::new();
        let mut piece_index = HashMap::new();
        for piece in pieces {
            if piece_index.contains_key(piece.key) {
                return Err(GenError::DuplicatePiece {
                    key: piece.key.to_string(),
                });
            }
            let expected = piece.size.0 as usize * piece.size.1 as usize * piece.size.2 as usize;
            if piece.cells.len() != expected {
                return Err(GenError::PieceShapeMismatch {
                    key: piece.key.to_string(),
                });
            }
            let mut palette_blocks = Vec::with_capacity(piece.palette.len());
            for (slot, name) in piece.palette.iter().enumerate() {
                if slot == 0 {
                    palette_blocks.push(0);
                    continue;
                }
                palette_blocks.push(resolve_block(name)?);
            }
            piece_index.insert(piece.key, compiled_pieces.len());
            compiled_pieces.push(CompiledPiece {
                def: piece.clone(),
                palette_blocks,
            });
        }

        let mut pool_index = HashMap::new();
        for (slot, pool) in pools.iter().enumerate() {
            if pool.entries.is_empty() {
                return Err(GenError::EmptyPool {
                    key: pool.key.to_string(),
                });
            }
            for (piece, weight) in &pool.entries {
                if !piece_index.contains_key(piece) {
                    return Err(GenError::UnknownPiece {
                        key: piece.to_string(),
                    });
                }
                if *weight <= 0.0 {
                    return Err(GenError::OutOfRange {
                        path: format!("pool.{}", pool.key),
                        what: "pool entry weight",
                        got: *weight,
                    });
                }
            }
            for piece in &pool.terminators {
                if !piece_index.contains_key(piece) {
                    return Err(GenError::UnknownPiece {
                        key: piece.to_string(),
                    });
                }
            }
            pool_index.insert(pool.key, slot);
        }

        let mut compiled_sets = Vec::new();
        let mut set_index = HashMap::new();
        for set in sets {
            if set_index.contains_key(set.key) {
                return Err(GenError::DuplicateSet {
                    key: set.key.to_string(),
                });
            }
            crate::spec::claim_salt(&set.salt, used_salts)?;
            if set.members.is_empty() {
                return Err(GenError::EmptyPartition);
            }
            for member in &set.members {
                match &member.source {
                    StructureSource::Single { piece } => {
                        if !piece_index.contains_key(piece) {
                            return Err(GenError::UnknownPiece {
                                key: piece.to_string(),
                            });
                        }
                    }
                    StructureSource::Pooled {
                        start_pool,
                        max_depth,
                        max_pieces,
                    } => {
                        if !pool_index.contains_key(start_pool) {
                            return Err(GenError::UnknownPool {
                                key: start_pool.to_string(),
                            });
                        }
                        if *max_depth == 0 || *max_pieces == 0 {
                            return Err(GenError::OutOfRange {
                                path: format!("set.{}.{}", set.key, member.key),
                                what: "pool growth bounds (must be nonzero)",
                                got: 0.0,
                            });
                        }
                    }
                }
            }
            set_index.insert(set.key, compiled_sets.len());
            compiled_sets.push(CompiledSet {
                member_weights: set.members.iter().map(|m| m.weight).collect(),
                resolved_constraints: set.constraints.clone(),
                spec: set.clone(),
            });
        }

        for set in &compiled_sets {
            for constraint in &set.resolved_constraints {
                if let PlacementConstraint::ExcludeNear { set: other, .. } = constraint {
                    if !set_index.contains_key(other) {
                        return Err(GenError::UnknownSet {
                            key: other.to_string(),
                        });
                    }
                }
            }
        }

        // Fillability: every socket tag must resolve to a pool, and any
        // pool a socket can draw from must be able to terminate — an
        // unfillable doorway is a boot error, not a hole in a wall.
        for piece in &compiled_pieces {
            for socket in &piece.def.sockets {
                let Some(&pool_slot) = pool_index.get(socket.accepts) else {
                    return Err(GenError::UnknownPool {
                        key: socket.accepts.to_string(),
                    });
                };
                if pools[pool_slot].terminators.is_empty() {
                    return Err(GenError::PoolCannotTerminate {
                        key: socket.accepts.to_string(),
                    });
                }
            }
        }

        let rejections = (0..compiled_sets.len())
            .map(|_| Mutex::new(RejectionStats::default()))
            .collect();

        Ok(Self {
            pieces: compiled_pieces,
            piece_index,
            pools: pools.to_vec(),
            pool_index,
            sets: compiled_sets,
            set_index,
            world_seed,
            dimension: dimension.to_string(),
            chunk_size,
            plan_cache: RwLock::new(HashMap::new()),
            rejections,
        })
    }

    pub fn set_count(&self) -> usize {
        self.sets.len()
    }

    pub fn set_key(&self, index: usize) -> &'static str {
        self.sets[index].spec.key
    }

    pub fn set_index_of(&self, key: &str) -> Option<usize> {
        self.set_index.get(key).copied()
    }

    pub fn phase_order(&self) -> Vec<usize> {
        let mut order: Vec<usize> = (0..self.sets.len()).collect();
        order.sort_by_key(|&i| (self.sets[i].spec.phase, self.sets[i].spec.key));
        order
    }

    /// Placement and build draw from independent lanes of the site's
    /// stream, so how many rolls placement consumed can never shift what a
    /// structure grows into.
    fn site_stream(&self, set: usize, site: (i64, i64), lane: u64) -> HashStream {
        HashStream::new(
            stream_seed(
                self.world_seed,
                &self.dimension,
                Subsystem::Structures,
                &self.sets[set].spec.salt,
                cell_id(site.0, site.1),
            ) ^ mix64(lane),
        )
    }

    const LANE_PLACEMENT: u64 = 0x51;
    const LANE_BUILD: u64 = 0xB1;

    /// Candidate anchor for a site, before constraints; `None` when the
    /// site rolls empty (which is absence, not rejection).
    pub fn candidate_anchor(&self, set: usize, site: (i64, i64), view: &dyn TerrainView) -> Option<(i32, i32, i32)> {
        let mut stream = self.site_stream(set, site, Self::LANE_PLACEMENT);
        let (x, z) = match &self.sets[set].spec.placement {
            PlacementPolicy::CellSites { cell, chance, jitter } => {
                if stream.unit() > *chance {
                    return None;
                }
                let jx = (stream.unit() - 0.5) * 2.0 * jitter;
                let jz = (stream.unit() - 0.5) * 2.0 * jitter;
                (
                    ((site.0 as f64 + 0.5 + jx) * cell).round() as i32,
                    ((site.1 as f64 + 0.5 + jz) * cell).round() as i32,
                )
            }
            PlacementPolicy::RandomSpread {
                spacing_chunks,
                separation_chunks,
            } => {
                let spacing = *spacing_chunks as i64;
                let span = (spacing - *separation_chunks as i64).max(1) as f64;
                let chunk_x = site.0 * spacing + (stream.unit() * span) as i64;
                let chunk_z = site.1 * spacing + (stream.unit() * span) as i64;
                let size = self.chunk_size as i64;
                (
                    (chunk_x * size + size / 2) as i32,
                    (chunk_z * size + size / 2) as i32,
                )
            }
        };
        let y = view.surface_raw(x, z);
        Some((x, y, z))
    }

    fn check_constraints(
        &self,
        set: usize,
        anchor: (i32, i32, i32),
        view: &dyn TerrainView,
    ) -> Result<(), RejectionReason> {
        let (x, y, z) = anchor;
        for constraint in &self.sets[set].resolved_constraints {
            match constraint {
                PlacementConstraint::BiomeTag(tag) => {
                    if !view.biome_has_tag(x, z, tag) {
                        return Err(RejectionReason::BiomeTag);
                    }
                }
                PlacementConstraint::SurfaceHeight { min, max } => {
                    if y < *min || y > *max {
                        return Err(RejectionReason::SurfaceHeight);
                    }
                }
                PlacementConstraint::MaxSlope(max) => {
                    if view.steepness(x, z) > *max {
                        return Err(RejectionReason::MaxSlope);
                    }
                }
                PlacementConstraint::MinDistFromOrigin(min) => {
                    let dist = ((x as f64).powi(2) + (z as f64).powi(2)).sqrt();
                    if dist < *min {
                        return Err(RejectionReason::MinDistFromOrigin);
                    }
                }
                PlacementConstraint::ExcludeNear { set: other, min_dist } => {
                    let other_index = self.set_index[other];
                    let sites = self.sites_near(other_index, (x, z), *min_dist);
                    for site in sites {
                        if let Some(other_anchor) = self.candidate_anchor(other_index, site, view) {
                            let dx = (other_anchor.0 - x) as f64;
                            let dz = (other_anchor.2 - z) as f64;
                            if (dx * dx + dz * dz).sqrt() < *min_dist {
                                return Err(RejectionReason::ExcludeNear);
                            }
                        }
                    }
                }
                PlacementConstraint::RequiresFluidFloor { min_depth } => {
                    match view.sea_level() {
                        Some(sea) if sea - y >= *min_depth => {}
                        _ => return Err(RejectionReason::RequiresFluidFloor),
                    }
                }
            }
        }
        Ok(())
    }

    fn sites_near(&self, set: usize, center: (i32, i32), radius: f64) -> Vec<(i64, i64)> {
        let mut sites = Vec::new();
        match &self.sets[set].spec.placement {
            PlacementPolicy::CellSites { cell, .. } => {
                let r = (radius / cell).ceil() as i64 + 1;
                let cx = (center.0 as f64 / cell).floor() as i64;
                let cz = (center.1 as f64 / cell).floor() as i64;
                for dx in -r..=r {
                    for dz in -r..=r {
                        sites.push((cx + dx, cz + dz));
                    }
                }
            }
            PlacementPolicy::RandomSpread { spacing_chunks, .. } => {
                let region = *spacing_chunks as f64 * self.chunk_size as f64;
                let r = (radius / region).ceil() as i64 + 1;
                let cx = (center.0 as f64 / region).floor() as i64;
                let cz = (center.1 as f64 / region).floor() as i64;
                for dx in -r..=r {
                    for dz in -r..=r {
                        sites.push((cx + dx, cz + dz));
                    }
                }
            }
        }
        sites
    }

    pub fn plan_for_site(
        &self,
        set: usize,
        site: (i64, i64),
        view: &dyn TerrainView,
    ) -> Option<Arc<StructurePlan>> {
        if let Some(cached) = self.plan_cache.read().expect("plan cache").get(&(set, site.0, site.1)) {
            return cached.clone();
        }
        let plan = self.build_plan(set, site, view);
        let mut cache = self.plan_cache.write().expect("plan cache");
        if cache.len() >= PLAN_CACHE_CAP {
            cache.clear();
        }
        cache.insert((set, site.0, site.1), plan.clone());
        plan
    }

    fn build_plan(
        &self,
        set: usize,
        site: (i64, i64),
        view: &dyn TerrainView,
    ) -> Option<Arc<StructurePlan>> {
        let anchor = self.candidate_anchor(set, site, view)?;
        if let Err(reason) = self.check_constraints(set, anchor, view) {
            self.rejections[set]
                .lock()
                .expect("rejection stats")
                .record(site, reason);
            return None;
        }

        let mut stream = self.site_stream(set, site, Self::LANE_BUILD);
        let spec = &self.sets[set].spec;
        let member_index = stream.pick_weighted(&self.sets[set].member_weights);
        let member = &spec.members[member_index];

        let pieces = match &member.source {
            StructureSource::Single { piece } => {
                let piece_id = self.piece_index[piece];
                let rotation = (stream.raw() % 4) as u8;
                let placed = self.place_piece(piece_id, rotation, anchor);
                vec![placed]
            }
            StructureSource::Pooled {
                start_pool,
                max_depth,
                max_pieces,
            } => {
                match self.grow(
                    self.pool_index[start_pool],
                    *max_depth,
                    *max_pieces,
                    anchor,
                    &mut stream,
                ) {
                    Some(pieces) => pieces,
                    None => {
                        self.rejections[set]
                            .lock()
                            .expect("rejection stats")
                            .record(site, RejectionReason::GrowthFailed);
                        return None;
                    }
                }
            }
        };

        let mut bbox_min = (i32::MAX, i32::MAX, i32::MAX);
        let mut bbox_max = (i32::MIN, i32::MIN, i32::MIN);
        for placed in &pieces {
            let size = self.pieces[placed.piece].rotated_size(placed.rotation);
            bbox_min.0 = bbox_min.0.min(placed.min.0);
            bbox_min.1 = bbox_min.1.min(placed.min.1);
            bbox_min.2 = bbox_min.2.min(placed.min.2);
            bbox_max.0 = bbox_max.0.max(placed.min.0 + size.0);
            bbox_max.1 = bbox_max.1.max(placed.min.1 + size.1);
            bbox_max.2 = bbox_max.2.max(placed.min.2 + size.2);
        }

        let reach = spec.max_reach;
        let is_within_reach = (bbox_max.0 - bbox_min.0) <= reach.0 as i32 * 2
            && (bbox_max.1 - bbox_min.1) <= reach.1 as i32 * 2
            && (bbox_max.2 - bbox_min.2) <= reach.2 as i32 * 2;
        if !is_within_reach {
            self.rejections[set]
                .lock()
                .expect("rejection stats")
                .record(site, RejectionReason::GrowthFailed);
            return None;
        }

        let ground_patch = match spec.adaptation {
            AdaptationSpec::None => None,
            AdaptationSpec::Platform { falloff } => Some(GroundPatch {
                min_x: bbox_min.0,
                min_z: bbox_min.2,
                max_x: bbox_max.0,
                max_z: bbox_max.2,
                target_y: anchor.1,
                falloff,
            }),
        };

        self.rejections[set].lock().expect("rejection stats").placed += 1;

        Some(Arc::new(StructurePlan {
            set,
            member: member.key,
            site,
            anchor,
            bbox_min,
            bbox_max,
            pieces,
            ground_patch,
        }))
    }

    fn place_piece(&self, piece: usize, rotation: u8, anchor: (i32, i32, i32)) -> PlacedPiece {
        let compiled = &self.pieces[piece];
        let a = compiled.def.anchor;
        let rotated_anchor = compiled.rotate_cell(a.0, a.1, a.2, rotation);
        PlacedPiece {
            piece,
            rotation,
            min: (
                anchor.0 - rotated_anchor.0,
                anchor.1 - rotated_anchor.1,
                anchor.2 - rotated_anchor.2,
            ),
        }
    }

    fn grow(
        &self,
        start_pool: usize,
        max_depth: u8,
        max_pieces: u16,
        anchor: (i32, i32, i32),
        stream: &mut HashStream,
    ) -> Option<Vec<PlacedPiece>> {
        let start_piece = self.draw_from_pool(start_pool, stream)?;
        let root = self.place_piece(start_piece, (stream.raw() % 4) as u8, anchor);

        let mut placed: Vec<PlacedPiece> = vec![root];
        let mut occupied: Vec<((i32, i32, i32), (i32, i32, i32))> = Vec::new();
        let record = |placed_piece: &PlacedPiece,
                      occupied: &mut Vec<((i32, i32, i32), (i32, i32, i32))>,
                      pieces: &[CompiledPiece]| {
            let size = pieces[placed_piece.piece].rotated_size(placed_piece.rotation);
            occupied.push((
                placed_piece.min,
                (
                    placed_piece.min.0 + size.0,
                    placed_piece.min.1 + size.1,
                    placed_piece.min.2 + size.2,
                ),
            ));
        };
        record(&placed[0], &mut occupied, &self.pieces);

        let mut frontier: Vec<(usize, u8)> = vec![(0, 0)]; // (placed index, depth)
        let mut fuel = max_pieces as i32 - 1;

        while let Some((parent_index, depth)) = frontier.pop() {
            if depth >= max_depth {
                continue;
            }
            let parent = placed[parent_index].clone();
            let parent_piece = &self.pieces[parent.piece];
            for socket in &parent_piece.def.sockets {
                if fuel <= 0 {
                    break;
                }
                let socket_local =
                    parent_piece.rotate_cell(socket.at.0, socket.at.1, socket.at.2, parent.rotation);
                let world_socket = (
                    parent.min.0 + socket_local.0,
                    parent.min.1 + socket_local.1,
                    parent.min.2 + socket_local.2,
                );
                let facing = socket.facing.rotated(parent.rotation);
                let step = facing.step();
                let target = (world_socket.0 + step.0, world_socket.1, world_socket.2 + step.1);

                let is_terminal = depth + 1 >= max_depth;
                let pool_slot = self.pool_index[socket.accepts];
                let candidate = if is_terminal {
                    self.draw_terminator(pool_slot, stream)
                } else {
                    self.draw_from_pool(pool_slot, stream)
                };
                let Some(candidate_piece) = candidate else {
                    continue;
                };

                let compiled = &self.pieces[candidate_piece];
                let Some(mate) = compiled
                    .def
                    .sockets
                    .iter()
                    .find(|s| s.accepts == socket.accepts)
                else {
                    continue;
                };
                // Rotate the candidate so its mating socket faces back.
                let needed = facing.opposite();
                let rotation = (needed.angle() + 4 - mate.facing.angle()) % 4;
                let mate_local = compiled.rotate_cell(mate.at.0, mate.at.1, mate.at.2, rotation);
                let min = (
                    target.0 - mate_local.0,
                    target.1 - mate_local.1,
                    target.2 - mate_local.2,
                );
                let size = compiled.rotated_size(rotation);
                let max = (min.0 + size.0, min.1 + size.1, min.2 + size.2);
                let is_clear = occupied.iter().all(|(omin, omax)| {
                    max.0 <= omin.0
                        || min.0 >= omax.0
                        || max.1 <= omin.1
                        || min.1 >= omax.1
                        || max.2 <= omin.2
                        || min.2 >= omax.2
                });
                if !is_clear {
                    continue;
                }
                let new_piece = PlacedPiece {
                    piece: candidate_piece,
                    rotation,
                    min,
                };
                record(&new_piece, &mut occupied, &self.pieces);
                placed.push(new_piece);
                frontier.push((placed.len() - 1, depth + 1));
                fuel -= 1;
            }
        }
        Some(placed)
    }

    fn draw_from_pool(&self, pool: usize, stream: &mut HashStream) -> Option<usize> {
        let pool = &self.pools[pool];
        let weights: Vec<f64> = pool.entries.iter().map(|(_, w)| *w).collect();
        let pick = stream.pick_weighted(&weights);
        Some(self.piece_index[pool.entries[pick].0])
    }

    fn draw_terminator(&self, pool: usize, stream: &mut HashStream) -> Option<usize> {
        let pool = &self.pools[pool];
        if pool.terminators.is_empty() {
            return None;
        }
        let pick = (stream.raw() % pool.terminators.len() as u64) as usize;
        Some(self.piece_index[pool.terminators[pick]])
    }

    /// Sites whose plans could intersect the given XZ bounds.
    pub fn sites_in_reach(&self, set: usize, min: (i32, i32), max: (i32, i32)) -> Vec<(i64, i64)> {
        let reach = self.sets[set].spec.max_reach;
        let pad = reach.0.max(reach.2) as i32 + 1;
        self.sites_covering(
            set,
            (min.0 - pad, min.1 - pad),
            (max.0 + pad, max.1 + pad),
        )
    }

    fn sites_covering(&self, set: usize, min: (i32, i32), max: (i32, i32)) -> Vec<(i64, i64)> {
        let mut sites = Vec::new();
        match &self.sets[set].spec.placement {
            PlacementPolicy::CellSites { cell, .. } => {
                let lo_x = (min.0 as f64 / cell).floor() as i64;
                let hi_x = (max.0 as f64 / cell).floor() as i64;
                let lo_z = (min.1 as f64 / cell).floor() as i64;
                let hi_z = (max.1 as f64 / cell).floor() as i64;
                for sx in lo_x..=hi_x {
                    for sz in lo_z..=hi_z {
                        sites.push((sx, sz));
                    }
                }
            }
            PlacementPolicy::RandomSpread { spacing_chunks, .. } => {
                let region = *spacing_chunks as f64 * self.chunk_size as f64;
                let lo_x = (min.0 as f64 / region).floor() as i64;
                let hi_x = (max.0 as f64 / region).floor() as i64;
                let lo_z = (min.1 as f64 / region).floor() as i64;
                let hi_z = (max.1 as f64 / region).floor() as i64;
                for sx in lo_x..=hi_x {
                    for sz in lo_z..=hi_z {
                        sites.push((sx, sz));
                    }
                }
            }
        }
        sites
    }

    pub fn plans_in_reach(
        &self,
        min: (i32, i32),
        max: (i32, i32),
        view: &dyn TerrainView,
    ) -> Vec<Arc<StructurePlan>> {
        let mut plans = Vec::new();
        for set in self.phase_order() {
            for site in self.sites_in_reach(set, min, max) {
                if let Some(plan) = self.plan_for_site(set, site, view) {
                    let is_touching = plan.bbox_max.0 > min.0
                        && plan.bbox_min.0 < max.0
                        && plan.bbox_max.2 > min.1
                        && plan.bbox_min.2 < max.1;
                    if is_touching {
                        plans.push(plan);
                    }
                }
            }
        }
        plans
    }

    /// Writes the slice of `plan` that falls inside [min, max) into the
    /// sink. The sink is the chunk; out-of-slice cells are never touched.
    pub fn apply_slice(
        &self,
        plan: &StructurePlan,
        min: (i32, i32, i32),
        max: (i32, i32, i32),
        set_block: &mut dyn FnMut(i32, i32, i32, u32),
    ) {
        for placed in &plan.pieces {
            let compiled = &self.pieces[placed.piece];
            let (w, h, d) = compiled.def.size;
            for x in 0..w {
                for y in 0..h {
                    for z in 0..d {
                        let slot = (x as usize * h as usize + y as usize) * d as usize + z as usize;
                        let palette_slot = compiled.def.cells[slot];
                        if palette_slot == 0 {
                            continue;
                        }
                        let offset = compiled.rotate_cell(x, y, z, placed.rotation);
                        let world = (
                            placed.min.0 + offset.0,
                            placed.min.1 + offset.1,
                            placed.min.2 + offset.2,
                        );
                        let is_inside = world.0 >= min.0
                            && world.0 < max.0
                            && world.1 >= min.1
                            && world.1 < max.1
                            && world.2 >= min.2
                            && world.2 < max.2;
                        if is_inside {
                            set_block(
                                world.0,
                                world.1,
                                world.2,
                                compiled.palette_blocks[palette_slot as usize],
                            );
                        }
                    }
                }
            }
        }
    }

    pub fn is_protected(&self, plans: &[Arc<StructurePlan>], x: i32, y: i32, z: i32) -> bool {
        plans.iter().any(|plan| {
            x >= plan.bbox_min.0 - 1
                && x < plan.bbox_max.0 + 1
                && y >= plan.bbox_min.1 - 1
                && y < plan.bbox_max.1 + 1
                && z >= plan.bbox_min.2 - 1
                && z < plan.bbox_max.2 + 1
        })
    }

    pub fn rejection_stats(&self, set: usize) -> RejectionStats {
        self.rejections[set].lock().expect("rejection stats").clone()
    }

    pub fn locate(
        &self,
        set: usize,
        near: (i32, i32),
        max_results: usize,
        view: &dyn TerrainView,
    ) -> Vec<((i64, i64), (i32, i32, i32), bool)> {
        let mut results = Vec::new();
        for ring in 0..8i64 {
            let radius = 512.0 * (ring + 1) as f64;
            for site in self.sites_covering(
                set,
                (near.0 - radius as i32, near.1 - radius as i32),
                (near.0 + radius as i32, near.1 + radius as i32),
            ) {
                if results.iter().any(|(s, _, _)| *s == site) {
                    continue;
                }
                if let Some(anchor) = self.candidate_anchor(set, site, view) {
                    let is_placed = self.plan_for_site(set, site, view).is_some();
                    results.push((site, anchor, is_placed));
                }
            }
            if results.len() >= max_results {
                break;
            }
        }
        results.sort_by_key(|(_, anchor, _)| {
            let dx = (anchor.0 - near.0) as i64;
            let dz = (anchor.2 - near.1) as i64;
            dx * dx + dz * dz
        });
        results.truncate(max_results);
        results
    }
}
