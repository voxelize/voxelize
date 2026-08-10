//! Climate axes and biome partitions. Selection is a pure function of
//! (seed, column); blending returns weighted biome sets so borders can be
//! dithered and cross-faded instead of hard-flipped. Weight is a coherent
//! selection operation (zone shares, region table shares) — climate boxes
//! themselves carry no weights.

use serde::Serialize;
use smallvec::SmallVec;

use crate::field::{FieldGraph, FieldProgram};
use crate::noise::{smoothstep, Fractal, NoiseKind};
use crate::spec::GenError;
use crate::stream::{cell_id, stream_seed, HashStream, SaltPath, Subsystem};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub struct AxisKey(pub &'static str);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub struct BiomeKey(pub &'static str);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub struct BiomeId(pub u16);

pub const MAX_AXES: usize = 8;

#[derive(Debug, Clone, Serialize)]
pub struct ClimateSpec {
    pub axes: Vec<(AxisKey, FieldGraph)>,
}

/// Ground-cover dressing placed on top of solid surface columns by the
/// populate stage. A `cluster` field turns uniform speckle into coherent
/// groves and patches: the entry's chance is scaled by
/// `smoothstep(low, high, fbm(salt))`, so placement concentrates where the
/// cluster field opens and disappears where it closes.
#[derive(Debug, Clone, Serialize)]
pub struct DressingSpec {
    pub block: &'static str,
    pub chance: f64,
    pub cluster: Option<ClusterSpec>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClusterSpec {
    pub salt: SaltPath,
    pub frequency: f64,
    pub octaves: u8,
    pub low: f64,
    pub high: f64,
}

/// Engine-facing biome data: everything the generator consumes, nothing a
/// game renders. Presentation, fauna, and weather stay content-side keyed
/// by `key`.
#[derive(Debug, Clone, Serialize)]
pub struct BiomeGenParams {
    pub key: BiomeKey,
    pub surface_table: &'static str,
    pub carver_mask: u8,
    pub tags: Vec<&'static str>,
    pub dressing: Vec<DressingSpec>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BiomeSetSpec {
    pub registry: Vec<BiomeGenParams>,
    pub partition: BiomePartition,
    pub overlays: Vec<OverlayRule>,
}

#[derive(Debug, Clone, Serialize)]
pub enum BiomePartition {
    Single(BiomeKey),
    Zoned(ZonedPartition),
    ClimateMatched(ClimatePartition),
}

#[derive(Debug, Clone, Serialize)]
pub struct ZonedPartition {
    pub salt: SaltPath,
    pub cell_size: f64,
    pub jitter: f64,
    pub warp_amplitude: f64,
    pub entries: Vec<ZoneEntry>,
    pub transition: TransitionSpec,
}

#[derive(Debug, Clone, Serialize)]
pub struct ZoneEntry {
    pub biome: BiomeKey,
    pub weight: f64,
    /// Sites only take this entry where the axis value at the site passes
    /// the window; entries without constraints are the fallback pool.
    pub constraint: Option<AxisWindow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AxisWindow {
    pub axis: AxisKey,
    pub low: f64,
    pub high: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClimatePartition {
    pub axes: Vec<AxisKey>,
    pub regions: Vec<ClimateRegion>,
    /// Region-cell size in blocks; ignored with a single region.
    pub region_salt: SaltPath,
    pub region_cell: f64,
    pub transition: TransitionSpec,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClimateRegion {
    pub key: &'static str,
    pub share: f64,
    pub entries: Vec<ClimateBox>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClimateBox {
    pub biome: BiomeKey,
    pub bounds: Vec<(f64, f64)>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TransitionSpec {
    /// Blocks for `Zoned`, climate distance for `ClimateMatched`.
    pub width: f64,
}

#[derive(Debug, Clone, Serialize)]
pub enum OverlayRule {
    ShoreBand {
        biome: BiomeKey,
        from_below_sea: i32,
        to_above_sea: i32,
    },
    OpenWater {
        biome: BiomeKey,
        min_depth: i32,
    },
    Peaks {
        biome: BiomeKey,
        surface_above: i32,
    },
}

#[derive(Debug, Clone)]
pub struct BiomeBlend {
    pub primary: BiomeId,
    pub weights: SmallVec<[(BiomeId, f32); 4]>,
    /// Distance margin to the runner-up (climate space or blocks); the
    /// speckle early-warning diagnostic.
    pub margin: f32,
}

impl BiomeBlend {
    fn pure(id: BiomeId) -> Self {
        Self {
            primary: id,
            weights: smallvec::smallvec![(id, 1.0)],
            margin: f32::MAX,
        }
    }

    fn pair(primary: BiomeId, secondary: BiomeId, secondary_weight: f32, margin: f32) -> Self {
        if secondary_weight <= 0.0 || primary == secondary {
            let mut blend = Self::pure(primary);
            blend.margin = margin;
            return blend;
        }
        Self {
            primary,
            weights: smallvec::smallvec![
                (primary, 1.0 - secondary_weight),
                (secondary, secondary_weight)
            ],
            margin,
        }
    }

    pub fn secondary(&self) -> Option<(BiomeId, f32)> {
        self.weights.get(1).copied()
    }
}

pub(crate) struct CompiledClimate {
    pub axis_keys: Vec<AxisKey>,
    pub programs: Vec<FieldProgram>,
}

impl CompiledClimate {
    pub fn axis_index(&self, key: &AxisKey) -> Option<usize> {
        self.axis_keys.iter().position(|k| k == key)
    }

    pub fn sample_axes(&self, x: i32, z: i32, out: &mut SmallVec<[f64; MAX_AXES]>) {
        out.clear();
        for program in &self.programs {
            out.push(program.sample2(x, z));
        }
    }
}

pub(crate) fn compile_climate(
    spec: &ClimateSpec,
    world_seed: u32,
    dimension: &str,
    used_salts: &mut hashbrown::HashSet<&'static str>,
) -> Result<CompiledClimate, GenError> {
    if spec.axes.len() > MAX_AXES {
        return Err(GenError::TooManyAxes {
            got: spec.axes.len(),
            max: MAX_AXES,
        });
    }
    let mut axis_keys = Vec::new();
    let mut programs = Vec::new();
    for (key, graph) in &spec.axes {
        if axis_keys.contains(key) {
            return Err(GenError::DuplicateAxis { axis: key.0.to_string() });
        }
        programs.push(FieldProgram::compile(
            graph,
            &format!("climate.{}", key.0),
            world_seed,
            dimension,
            used_salts,
        )?);
        axis_keys.push(*key);
    }
    Ok(CompiledClimate { axis_keys, programs })
}

enum CompiledPartitionKind {
    Single(BiomeId),
    Zoned {
        seed: u64,
        cell_size: f64,
        jitter: f64,
        transition: f64,
        warp_amplitude: f64,
        warp_x: Fractal,
        warp_z: Fractal,
        entries: Vec<CompiledZoneEntry>,
    },
    Climate {
        axis_indices: Vec<usize>,
        regions: Vec<CompiledRegion>,
        region_seed: u64,
        region_cell: f64,
        transition: f64,
    },
}

struct CompiledZoneEntry {
    biome: BiomeId,
    weight: f64,
    constraint: Option<(usize, f64, f64)>,
}

struct CompiledRegion {
    share: f64,
    entries: Vec<(BiomeId, Vec<(f64, f64)>)>,
}

enum CompiledOverlay {
    ShoreBand { biome: BiomeId, from_below: i32, to_above: i32 },
    OpenWater { biome: BiomeId, min_depth: i32 },
    Peaks { biome: BiomeId, surface_above: i32 },
}

pub(crate) struct CompiledPartition {
    kind: CompiledPartitionKind,
    overlays: Vec<CompiledOverlay>,
}

impl CompiledPartition {
    pub fn compile(
        set: &BiomeSetSpec,
        climate: &CompiledClimate,
        resolve: &dyn Fn(&BiomeKey) -> Result<BiomeId, GenError>,
        world_seed: u32,
        dimension: &str,
        used_salts: &mut hashbrown::HashSet<&'static str>,
    ) -> Result<Self, GenError> {
        let kind = match &set.partition {
            BiomePartition::Single(key) => CompiledPartitionKind::Single(resolve(key)?),
            BiomePartition::Zoned(zoned) => {
                crate::spec::claim_salt(&zoned.salt, used_salts)?;
                if zoned.entries.is_empty() {
                    return Err(GenError::EmptyPartition);
                }
                if !zoned.entries.iter().any(|e| e.constraint.is_none()) {
                    return Err(GenError::NoFallbackZoneEntry);
                }
                let mut entries = Vec::new();
                for entry in &zoned.entries {
                    if entry.weight <= 0.0 {
                        return Err(GenError::OutOfRange {
                            path: format!("zone entry {}", entry.biome.0),
                            what: "zone weight (must be positive)",
                            got: entry.weight,
                        });
                    }
                    let constraint = match &entry.constraint {
                        Some(window) => {
                            let index = climate.axis_index(&window.axis).ok_or_else(|| {
                                GenError::UnknownAxis {
                                    axis: window.axis.0.to_string(),
                                }
                            })?;
                            Some((index, window.low, window.high))
                        }
                        None => None,
                    };
                    entries.push(CompiledZoneEntry {
                        biome: resolve(&entry.biome)?,
                        weight: entry.weight,
                        constraint,
                    });
                }
                let seed = stream_seed(world_seed, dimension, Subsystem::Partition, &zoned.salt, 0);
                CompiledPartitionKind::Zoned {
                    seed,
                    cell_size: zoned.cell_size,
                    jitter: zoned.jitter.clamp(0.0, 0.45),
                    transition: zoned.transition.width.max(0.0),
                    warp_amplitude: zoned.warp_amplitude,
                    warp_x: Fractal::new(
                        seed ^ 0xA1,
                        1.0 / (zoned.cell_size * 0.45),
                        2,
                        0.5,
                        2.0,
                        NoiseKind::Fbm,
                    ),
                    warp_z: Fractal::new(
                        seed ^ 0xB2,
                        1.0 / (zoned.cell_size * 0.45),
                        2,
                        0.5,
                        2.0,
                        NoiseKind::Fbm,
                    ),
                    entries,
                }
            }
            BiomePartition::ClimateMatched(matched) => {
                crate::spec::claim_salt(&matched.region_salt, used_salts)?;
                if matched.regions.is_empty()
                    || matched.regions.iter().any(|r| r.entries.is_empty())
                {
                    return Err(GenError::EmptyPartition);
                }
                let mut axis_indices = Vec::new();
                for axis in &matched.axes {
                    axis_indices.push(climate.axis_index(axis).ok_or_else(|| {
                        GenError::UnknownAxis {
                            axis: axis.0.to_string(),
                        }
                    })?);
                }
                let mut regions = Vec::new();
                for region in &matched.regions {
                    if region.share <= 0.0 {
                        return Err(GenError::OutOfRange {
                            path: format!("region {}", region.key),
                            what: "region share (must be positive)",
                            got: region.share,
                        });
                    }
                    let mut entries = Vec::new();
                    for boxed in &region.entries {
                        if boxed.bounds.len() != axis_indices.len() {
                            return Err(GenError::BoxAxisMismatch {
                                biome: boxed.biome.0.to_string(),
                                got: boxed.bounds.len(),
                                expected: axis_indices.len(),
                            });
                        }
                        for &(lo, hi) in &boxed.bounds {
                            if hi < lo {
                                return Err(GenError::OutOfRange {
                                    path: format!("box {}", boxed.biome.0),
                                    what: "box interval (high below low)",
                                    got: hi,
                                });
                            }
                        }
                        entries.push((resolve(&boxed.biome)?, boxed.bounds.clone()));
                    }
                    regions.push(CompiledRegion {
                        share: region.share,
                        entries,
                    });
                }
                CompiledPartitionKind::Climate {
                    axis_indices,
                    regions,
                    region_seed: stream_seed(
                        world_seed,
                        dimension,
                        Subsystem::Partition,
                        &matched.region_salt,
                        0,
                    ),
                    region_cell: matched.region_cell.max(1.0),
                    transition: matched.transition.width.max(1e-9),
                }
            }
        };

        let mut overlays = Vec::new();
        for rule in &set.overlays {
            overlays.push(match rule {
                OverlayRule::ShoreBand {
                    biome,
                    from_below_sea,
                    to_above_sea,
                } => CompiledOverlay::ShoreBand {
                    biome: resolve(biome)?,
                    from_below: *from_below_sea,
                    to_above: *to_above_sea,
                },
                OverlayRule::OpenWater { biome, min_depth } => CompiledOverlay::OpenWater {
                    biome: resolve(biome)?,
                    min_depth: *min_depth,
                },
                OverlayRule::Peaks {
                    biome,
                    surface_above,
                } => CompiledOverlay::Peaks {
                    biome: resolve(biome)?,
                    surface_above: *surface_above,
                },
            });
        }

        Ok(Self { kind, overlays })
    }

    /// Base blend from the partition alone (no overlays). Pure in
    /// (seed, column, axis values). Zoned site constraints sample the axis
    /// programs at the site position, so a site's identity is one answer
    /// world-wide regardless of which column asks.
    pub fn base_blend(
        &self,
        x: i32,
        z: i32,
        axes: &SmallVec<[f64; MAX_AXES]>,
        climate: &CompiledClimate,
    ) -> BiomeBlend {
        match &self.kind {
            CompiledPartitionKind::Single(id) => BiomeBlend::pure(*id),
            CompiledPartitionKind::Zoned {
                seed,
                cell_size,
                jitter,
                transition,
                warp_amplitude,
                warp_x,
                warp_z,
                entries,
            } => {
                let fx = x as f64 + warp_x.sample2(x as f64, z as f64) * warp_amplitude;
                let fz = z as f64 + warp_z.sample2(x as f64, z as f64) * warp_amplitude;
                let cx = (fx / cell_size).floor() as i64;
                let cz = (fz / cell_size).floor() as i64;

                let mut best: (f64, BiomeId) = (f64::MAX, BiomeId(0));
                let mut second: (f64, BiomeId) = (f64::MAX, BiomeId(0));
                for dcx in -1..=1 {
                    for dcz in -1..=1 {
                        let (ccx, ccz) = (cx + dcx, cz + dcz);
                        let mut stream =
                            HashStream::new(seed ^ crate::stream::mix64(cell_id(ccx, ccz)));
                        let site_x =
                            (ccx as f64 + 0.5 + (stream.unit() - 0.5) * 2.0 * jitter) * cell_size;
                        let site_z =
                            (ccz as f64 + 0.5 + (stream.unit() - 0.5) * 2.0 * jitter) * cell_size;
                        let biome = Self::zone_site_biome(
                            entries,
                            &mut stream,
                            site_x.round() as i32,
                            site_z.round() as i32,
                            climate,
                        );
                        let (dx, dz) = (fx - site_x, fz - site_z);
                        let dist = (dx * dx + dz * dz).sqrt();
                        if dist < best.0 {
                            if best.1 != biome {
                                second = best;
                            }
                            best = (dist, biome);
                        } else if dist < second.0 && biome != best.1 {
                            second = (dist, biome);
                        }
                    }
                }
                let margin = (second.0 - best.0).max(0.0);
                if *transition <= 0.0 || second.0 == f64::MAX {
                    let mut blend = BiomeBlend::pure(best.1);
                    blend.margin = margin as f32;
                    return blend;
                }
                let secondary_weight = (0.5 * (1.0 - margin / transition)).clamp(0.0, 0.5);
                BiomeBlend::pair(best.1, second.1, secondary_weight as f32, margin as f32)
            }
            CompiledPartitionKind::Climate {
                axis_indices,
                regions,
                region_seed,
                region_cell,
                transition,
            } => {
                let region = if regions.len() == 1 {
                    &regions[0]
                } else {
                    let cx = (x as f64 / region_cell).floor() as i64;
                    let cz = (z as f64 / region_cell).floor() as i64;
                    let mut stream =
                        HashStream::new(region_seed ^ crate::stream::mix64(cell_id(cx, cz)));
                    let shares: Vec<f64> = regions.iter().map(|r| r.share).collect();
                    &regions[stream.pick_weighted(&shares)]
                };

                let mut best: (f64, BiomeId) = (f64::MAX, BiomeId(0));
                let mut second: (f64, BiomeId) = (f64::MAX, BiomeId(0));
                for (biome, bounds) in &region.entries {
                    let mut dist2 = 0.0;
                    for (axis_slot, &(lo, hi)) in axis_indices.iter().zip(bounds.iter()) {
                        let v = axes[*axis_slot];
                        let dv = if v < lo {
                            lo - v
                        } else if v > hi {
                            v - hi
                        } else {
                            0.0
                        };
                        dist2 += dv * dv;
                    }
                    let dist = dist2.sqrt();
                    if dist < best.0 {
                        if best.1 != *biome {
                            second = best;
                        }
                        best = (dist, *biome);
                    } else if dist < second.0 && *biome != best.1 {
                        second = (dist, *biome);
                    }
                }
                let margin = (second.0 - best.0).max(0.0);
                let secondary_weight = if second.0 == f64::MAX {
                    0.0
                } else {
                    (0.5 * (1.0 - margin / transition)).clamp(0.0, 0.5)
                };
                BiomeBlend::pair(best.1, second.1, secondary_weight as f32, margin as f32)
            }
        }
    }

    fn zone_site_biome(
        entries: &[CompiledZoneEntry],
        stream: &mut HashStream,
        site_x: i32,
        site_z: i32,
        climate: &CompiledClimate,
    ) -> BiomeId {
        let passes = |entry: &CompiledZoneEntry| -> bool {
            match entry.constraint {
                None => true,
                Some((axis, low, high)) => {
                    let v = climate.programs[axis].sample2(site_x, site_z);
                    v >= low && v <= high
                }
            }
        };
        let weights: SmallVec<[f64; 8]> = entries.iter().map(|e| e.weight).collect();
        for _ in 0..4 {
            let pick = stream.pick_weighted(&weights);
            if passes(&entries[pick]) {
                return entries[pick].biome;
            }
        }
        // Deterministic fallback: heaviest entry that passes, else the
        // heaviest unconstrained entry (validated to exist at compile).
        let mut ranked: SmallVec<[usize; 8]> = (0..entries.len()).collect();
        ranked.sort_by(|&a, &b| {
            entries[b]
                .weight
                .partial_cmp(&entries[a].weight)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.cmp(&b))
        });
        for &index in &ranked {
            if passes(&entries[index]) {
                return entries[index].biome;
            }
        }
        ranked
            .iter()
            .map(|&i| &entries[i])
            .find(|e| e.constraint.is_none())
            .expect("compile guarantees an unconstrained zone entry")
            .biome
    }

    /// Overlays need terrain context; applied by the generator after the
    /// surface height is known.
    pub fn apply_overlays(&self, blend: BiomeBlend, surface: i32, sea_level: Option<i32>) -> BiomeBlend {
        let mut current = blend;
        for overlay in &self.overlays {
            match overlay {
                CompiledOverlay::ShoreBand {
                    biome,
                    from_below,
                    to_above,
                } => {
                    if let Some(sea) = sea_level {
                        if surface >= sea - from_below && surface <= sea + to_above {
                            current = BiomeBlend::pure(*biome);
                        }
                    }
                }
                CompiledOverlay::OpenWater { biome, min_depth } => {
                    if let Some(sea) = sea_level {
                        if sea - surface >= *min_depth {
                            current = BiomeBlend::pure(*biome);
                        }
                    }
                }
                CompiledOverlay::Peaks {
                    biome,
                    surface_above,
                } => {
                    if surface >= *surface_above {
                        current = BiomeBlend::pure(*biome);
                    }
                }
            }
        }
        current
    }
}

/// Compiled dressing entry: block resolved to an id, cluster field baked.
pub(crate) struct CompiledDressing {
    pub block: u32,
    pub chance: f64,
    pub cluster: Option<CompiledCluster>,
}

pub(crate) struct CompiledCluster {
    pub field: Fractal,
    pub low: f64,
    pub high: f64,
}

impl CompiledDressing {
    pub fn compile(
        spec: &DressingSpec,
        biome: &BiomeKey,
        resolve_block: &dyn Fn(&str) -> Result<u32, GenError>,
        world_seed: u32,
        dimension: &str,
        used_salts: &mut hashbrown::HashSet<&'static str>,
    ) -> Result<Self, GenError> {
        if !(0.0..=1.0).contains(&spec.chance) {
            return Err(GenError::OutOfRange {
                path: format!("biome.{}.dressing", biome.0),
                what: "dressing chance",
                got: spec.chance,
            });
        }
        let cluster = match &spec.cluster {
            Some(cluster) => {
                crate::spec::claim_salt(&cluster.salt, used_salts)?;
                if cluster.frequency <= 0.0 || !cluster.frequency.is_finite() {
                    return Err(GenError::OutOfRange {
                        path: format!("biome.{}.dressing.cluster", biome.0),
                        what: "cluster frequency",
                        got: cluster.frequency,
                    });
                }
                if cluster.octaves == 0 || cluster.octaves > 8 {
                    return Err(GenError::OutOfRange {
                        path: format!("biome.{}.dressing.cluster", biome.0),
                        what: "cluster octaves (1..=8)",
                        got: cluster.octaves as f64,
                    });
                }
                if cluster.high <= cluster.low {
                    return Err(GenError::OutOfRange {
                        path: format!("biome.{}.dressing.cluster", biome.0),
                        what: "cluster window (high must exceed low)",
                        got: cluster.high,
                    });
                }
                Some(CompiledCluster {
                    field: Fractal::new(
                        stream_seed(world_seed, dimension, Subsystem::Ecology, &cluster.salt, 0),
                        cluster.frequency,
                        cluster.octaves,
                        0.5,
                        2.0,
                        NoiseKind::Fbm,
                    ),
                    low: cluster.low,
                    high: cluster.high,
                })
            }
            None => None,
        };
        Ok(Self {
            block: resolve_block(spec.block)?,
            chance: spec.chance,
            cluster,
        })
    }

    /// Column-effective chance after cluster gating.
    pub fn chance_at(&self, x: i32, z: i32) -> f64 {
        match &self.cluster {
            Some(cluster) => {
                self.chance
                    * smoothstep(cluster.low, cluster.high, cluster.field.sample2(x as f64, z as f64))
            }
            None => self.chance,
        }
    }
}
