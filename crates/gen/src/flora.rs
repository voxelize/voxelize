//! Clustered named-species flora. Trees place on a two-level deterministic
//! lattice: grove clusters roll on jittered cells, gated by a low-frequency
//! patch field (woods with genuine clearings), and each live cluster
//! scatters members within its spread. Every tree is a real species — a
//! named log/leaf pair with its own silhouette — never generic filler.
//! Placement and stamping re-derive per chunk, so a canopy crossing a
//! border writes identical voxels from both sides.

use serde::Serialize;
use voxelize::Registry;
use crate::{cell_id, mix64, stream_seed, Fractal, HashStream, NoiseKind, SaltPath, Subsystem};

use crate::ecology::{CanopySpec, CellCache, CompiledEcology, Env};

const CLUSTER_MAX_POINTS: i64 = 8;

#[derive(Debug, Clone, Copy, Serialize)]
pub enum TreeForm {
    /// Tiered blob canopy with cleared corners; oaks and cherries.
    Round,
    /// Slim trunk, small high crown; birches.
    Slender,
    /// Stacked shrinking layers to a tip; spruces.
    Conic,
    /// Flat wide disc canopy on a forked trunk; acacias.
    Umbrella,
    /// Wide low double canopy with visible branch logs; dark oaks.
    Broad,
    /// Bare weathered trunk with stub branches; savanna landmarks.
    Snag,
}

#[derive(Debug, Clone, Serialize)]
pub struct SpeciesDef {
    pub key: &'static str,
    pub log: &'static str,
    pub leaves: &'static str,
    pub form: TreeForm,
}

#[derive(Debug, Clone, Serialize)]
pub struct FloraSetSpec {
    pub key: &'static str,
    pub salt: SaltPath,
    /// Biome keys this set plants in (delta-side check by key).
    pub biomes: Vec<&'static str>,
    /// Cluster-center lattice in blocks.
    pub cell: f64,
    pub cluster_chance: f64,
    /// 0.0 disables the grove-patch gate.
    pub gate_frequency: f64,
    /// Window over the raw patch fractal (practical range ~ +/-0.25).
    pub gate_window: (f64, f64),
    pub points: (u8, u8),
    pub spread: f64,
    /// Species mix: key and weight.
    pub species: Vec<(&'static str, f64)>,
    pub max_slope: f64,
    /// Only plant within this distance of a river channel (riparian sets).
    pub near_river: Option<f64>,
    /// Never plant closer than this to a channel center.
    pub avoid_river_within: f64,
    pub min_surface: Option<i32>,
    pub max_surface: Option<i32>,
}

#[derive(Debug, Clone, Copy)]
pub struct TreeInstance {
    pub x: i32,
    pub y: i32,
    pub z: i32,
    pub species: usize,
    /// Stamp scale (age): trunk heights and crown radii follow it.
    pub size: f64,
    pub seed: u64,
}

struct CompiledSpecies {
    log: u32,
    leaves: u32,
    form: TreeForm,
}

struct CompiledSet {
    spec: FloraSetSpec,
    seed: u64,
    gate: Option<Fractal>,
    species_indices: Vec<(usize, f64)>,
}

/// One community's canopy, lowered onto the same cluster engine the
/// azonal sets run: the community field gates the clusters, the mix
/// rolls per cluster, and edges swap toward the ecotone species.
struct CompiledCanopy {
    community: usize,
    spec: CanopySpec,
    seed: u64,
    species_indices: Vec<(usize, f64)>,
    edge_indices: Vec<(usize, f64)>,
}

pub struct CompiledFlora {
    species: Vec<CompiledSpecies>,
    sets: Vec<CompiledSet>,
    canopies: Vec<CompiledCanopy>,
    max_canopy: i32,
}

impl CompiledFlora {
    pub fn compile(
        sets: &[FloraSetSpec],
        species: &[SpeciesDef],
        ecology: Option<&CompiledEcology>,
        registry: &Registry,
        world_seed: u32,
        dimension: &str,
    ) -> Result<Self, String> {
        let mut compiled_species = Vec::new();
        for def in species {
            let resolve = |name: &'static str| -> Result<u32, String> {
                registry
                    .try_get_id_by_name(name)
                    .ok_or_else(|| format!("species {}: unknown block {name:?}", def.key))
            };
            compiled_species.push(CompiledSpecies {
                log: resolve(def.log)?,
                leaves: resolve(def.leaves)?,
                form: def.form,
            });
        }

        let resolve_mix = |context: &str,
                           mix: &[(&'static str, f64)]|
         -> Result<Vec<(usize, f64)>, String> {
            let mut indices = Vec::new();
            for (key, weight) in mix {
                let index = species
                    .iter()
                    .position(|def| def.key == *key)
                    .ok_or_else(|| format!("{context}: unknown species {key}"))?;
                indices.push((index, *weight));
            }
            Ok(indices)
        };

        let mut compiled_sets = Vec::new();
        for set in sets {
            if set.points.0 == 0
                || set.points.1 < set.points.0
                || (set.points.1 as i64) > CLUSTER_MAX_POINTS
            {
                return Err(format!("flora set {}: points must be 1..=8", set.key));
            }
            let seed = stream_seed(world_seed, dimension, Subsystem::Structures, &set.salt, 0);
            let gate = if set.gate_frequency > 0.0 {
                Some(Fractal::new(
                    seed ^ 0x6F,
                    set.gate_frequency,
                    2,
                    0.5,
                    2.0,
                    NoiseKind::Fbm,
                ))
            } else {
                None
            };
            let species_indices = resolve_mix(&format!("flora set {}", set.key), &set.species)?;
            compiled_sets.push(CompiledSet {
                spec: set.clone(),
                seed,
                gate,
                species_indices,
            });
        }

        let mut canopies = Vec::new();
        if let Some(ecology) = ecology {
            for (index, community) in ecology.communities().iter().enumerate() {
                let Some(canopy) = &community.canopy else {
                    continue;
                };
                if canopy.points.0 == 0
                    || canopy.points.1 < canopy.points.0
                    || (canopy.points.1 as i64) > CLUSTER_MAX_POINTS
                {
                    return Err(format!(
                        "community {}: canopy points must be 1..=8",
                        community.key
                    ));
                }
                let seed = stream_seed(
                    world_seed,
                    dimension,
                    Subsystem::Structures,
                    &SaltPath(community.key),
                    2,
                );
                canopies.push(CompiledCanopy {
                    community: index,
                    spec: canopy.clone(),
                    seed,
                    species_indices: resolve_mix(
                        &format!("community {}", community.key),
                        &canopy.species,
                    )?,
                    edge_indices: resolve_mix(
                        &format!("community {} edge", community.key),
                        &community.edge_species,
                    )?,
                });
            }
        }

        Ok(Self {
            species: compiled_species,
            sets: compiled_sets,
            canopies,
            max_canopy: 5,
        })
    }

    /// Horizontal margin a chunk must look beyond itself for trees whose
    /// canopy can reach in.
    pub fn reach(&self) -> i32 {
        let spread = self
            .sets
            .iter()
            .map(|set| set.spec.spread)
            .chain(self.canopies.iter().map(|canopy| canopy.spec.spread))
            .fold(0.0f64, f64::max);
        spread.ceil() as i32 + self.max_canopy
    }

    /// Deterministic tree instances whose trunks fall inside the padded
    /// window. Azonal sets place on their own gates; community canopies
    /// place only on the ground their community owns, with the species
    /// mix rolled per cluster (dominant plus companion) and ecotone
    /// edges swapping toward the community's edge species.
    pub fn trees_in(
        &self,
        min: (i32, i32),
        max: (i32, i32),
        env: &Env,
        ecology: Option<&CompiledEcology>,
        cache: &mut CellCache,
    ) -> Vec<TreeInstance> {
        let mut trees = Vec::new();

        for set in &self.sets {
            let spec = &set.spec;
            let pad = spec.spread.ceil() as i32 + self.max_canopy;
            self.each_cluster(
                set.seed,
                spec.cell,
                spec.cluster_chance,
                (min.0 - pad, min.1 - pad),
                (max.0 + pad, max.1 + pad),
                &mut |cluster_x, cluster_z, center_x, center_z, cluster_stream| {
                    if let Some(gate) = &set.gate {
                        let value = gate.sample2(center_x as f64, center_z as f64);
                        if value < spec.gate_window.0 || value > spec.gate_window.1 {
                            return;
                        }
                    }
                    let count =
                        cluster_stream.range_i((spec.points.0 as i32, spec.points.1 as i32));
                    for point in 0..count {
                        let mut point_stream = HashStream::new(
                            set.seed
                                ^ mix64(cell_id(
                                    cluster_x * CLUSTER_MAX_POINTS + point as i64,
                                    cluster_z,
                                )),
                        );
                        let (dx, dz) = disc_offset(&mut point_stream, spec.spread);
                        let x = center_x + dx;
                        let z = center_z + dz;
                        if x < min.0 - pad || x >= max.0 + pad || z < min.1 - pad || z >= max.1 + pad
                        {
                            continue;
                        }

                        let y = (env.surface)(x, z);
                        if let Some(sea) = env.sea_level {
                            if y <= sea {
                                continue;
                            }
                        }
                        if let Some(min_surface) = spec.min_surface {
                            if y < min_surface {
                                continue;
                            }
                        }
                        if let Some(max_surface) = spec.max_surface {
                            if y > max_surface {
                                continue;
                            }
                        }
                        if (env.steepness)(x, z) > spec.max_slope {
                            continue;
                        }
                        if !spec.biomes.iter().any(|b| *b == (env.biome_key)(x, y, z)) {
                            continue;
                        }
                        let dist = (env.river_dist)(x, z);
                        if dist < spec.avoid_river_within {
                            continue;
                        }
                        if let Some(near) = spec.near_river {
                            if dist > near {
                                continue;
                            }
                        }

                        let species = Self::pick_weighted(&set.species_indices, &mut point_stream);
                        trees.push(TreeInstance {
                            x,
                            y,
                            z,
                            species,
                            size: 1.0,
                            seed: point_stream.raw(),
                        });
                    }
                },
            );
        }

        let Some(ecology) = ecology else {
            return trees;
        };

        for canopy in &self.canopies {
            let spec = &canopy.spec;
            let pad = spec.spread.ceil() as i32 + self.max_canopy;
            self.each_cluster(
                canopy.seed,
                spec.cell,
                spec.cluster_chance,
                (min.0 - pad, min.1 - pad),
                (max.0 + pad, max.1 + pad),
                &mut |cluster_x, cluster_z, center_x, center_z, cluster_stream| {
                    // Ownership gate: the cluster exists only where the
                    // community field elected this community.
                    let owner = ecology.owner_at(center_x, center_z, env, cache);
                    let Some(owner) = owner else {
                        return;
                    };
                    if owner.community != canopy.community {
                        return;
                    }

                    // The cluster's stand identity: a dominant species,
                    // a companion, and a shared maturity.
                    let dominant =
                        Self::pick_weighted(&canopy.species_indices, cluster_stream);
                    let companion =
                        Self::pick_weighted(&canopy.species_indices, cluster_stream);
                    let maturity =
                        1.0 + (cluster_stream.unit() * 2.0 - 1.0) * spec.age_spread;

                    let count =
                        cluster_stream.range_i((spec.points.0 as i32, spec.points.1 as i32));
                    for point in 0..count {
                        let mut point_stream = HashStream::new(
                            canopy.seed
                                ^ mix64(cell_id(
                                    cluster_x * CLUSTER_MAX_POINTS + point as i64,
                                    cluster_z,
                                )),
                        );
                        let (dx, dz) = disc_offset(&mut point_stream, spec.spread);
                        let x = center_x + dx;
                        let z = center_z + dz;
                        if x < min.0 - pad || x >= max.0 + pad || z < min.1 - pad || z >= max.1 + pad
                        {
                            continue;
                        }

                        let y = (env.surface)(x, z);
                        if let Some(sea) = env.sea_level {
                            if y <= sea {
                                continue;
                            }
                        }
                        if (env.steepness)(x, z) > spec.max_slope {
                            continue;
                        }
                        if (env.river_dist)(x, z) < spec.avoid_river_within {
                            continue;
                        }

                        // Containment: the trunk itself must stand on
                        // ground this community owns. Cluster centers are
                        // gated above, but members scatter up to `spread`
                        // and can land in a neighboring patch — without
                        // this check a border grove throws its species
                        // deep into foreign stands (the cherry-outside-
                        // groves failure).
                        let member_owner = ecology.owner_at(x, z, env, cache);
                        let Some(member_owner) = member_owner else {
                            continue;
                        };
                        if member_owner.community != canopy.community {
                            continue;
                        }

                        // Stand cohesion, then the ecotone: members repeat
                        // the dominant, sometimes the companion; near the
                        // patch border the edge species take over with
                        // probability rising toward the line.
                        let mut species = if point_stream.unit() <= spec.cohesion {
                            dominant
                        } else {
                            companion
                        };
                        if !canopy.edge_indices.is_empty() {
                            let edge = 1.0 - member_owner.interior;
                            if point_stream.unit() < edge {
                                species =
                                    Self::pick_weighted(&canopy.edge_indices, &mut point_stream);
                            }
                        }

                        let age = 1.0 + (point_stream.unit() * 2.0 - 1.0) * spec.age_spread;
                        let size = (maturity * age).clamp(0.6, 1.5);
                        trees.push(TreeInstance {
                            x,
                            y,
                            z,
                            species,
                            size,
                            seed: point_stream.raw(),
                        });
                    }
                },
            );
        }

        trees
    }

    /// Shared cluster-lattice walk: rolls each cell's existence and
    /// jittered center, then hands the stream to the caller.
    fn each_cluster(
        &self,
        seed: u64,
        cell: f64,
        chance: f64,
        min: (i32, i32),
        max: (i32, i32),
        visit: &mut dyn FnMut(i64, i64, i32, i32, &mut HashStream),
    ) {
        let lo_cx = (min.0 as f64 / cell).floor() as i64;
        let hi_cx = (max.0 as f64 / cell).floor() as i64;
        let lo_cz = (min.1 as f64 / cell).floor() as i64;
        let hi_cz = (max.1 as f64 / cell).floor() as i64;
        for cluster_x in lo_cx..=hi_cx {
            for cluster_z in lo_cz..=hi_cz {
                let mut cluster_stream =
                    HashStream::new(seed ^ mix64(cell_id(cluster_x, cluster_z) ^ 0xC1));
                if cluster_stream.unit() > chance {
                    continue;
                }
                let center_x =
                    ((cluster_x as f64 + 0.2 + cluster_stream.unit() * 0.6) * cell) as i32;
                let center_z =
                    ((cluster_z as f64 + 0.2 + cluster_stream.unit() * 0.6) * cell) as i32;
                visit(cluster_x, cluster_z, center_x, center_z, &mut cluster_stream);
            }
        }
    }

    fn pick_weighted(entries: &[(usize, f64)], stream: &mut HashStream) -> usize {
        let total: f64 = entries.iter().map(|(_, w)| w).sum();
        let mut roll = stream.unit() * total;
        for (index, weight) in entries {
            roll -= weight;
            if roll <= 0.0 {
                return *index;
            }
        }
        entries.last().map(|(index, _)| *index).unwrap_or(0)
    }

    /// Stamp one tree through `set`: the closure receives world coords, the
    /// block id, and whether the write is soft (leaves — only into air).
    /// `size` scales trunk heights continuously and crown radii by one
    /// discrete step at the extremes, so a stand carries saplings,
    /// grown trees, and emergents instead of one repeated silhouette.
    pub fn stamp(&self, tree: &TreeInstance, set: &mut dyn FnMut(i32, i32, i32, u32, bool)) {
        let species = &self.species[tree.species];
        let mut stream = HashStream::new(tree.seed);
        let (x, y, z) = (tree.x, tree.y + 1, tree.z);
        let log = species.log;
        let leaves = species.leaves;
        let size = tree.size;
        let scaled = |base: i32| -> i32 { ((base as f64) * size).round().max(2.0) as i32 };
        let crown_step: i32 = if size >= 1.25 {
            1
        } else if size <= 0.8 {
            -1
        } else {
            0
        };

        match species.form {
            TreeForm::Round => {
                let trunk = scaled(4 + stream.range_i((0, 2)));
                for dy in 0..trunk {
                    set(x, y + dy, z, log, false);
                }
                let base = y + trunk - 2;
                for layer in 0..3 {
                    let radius: i32 = ([2, 2, 1][layer as usize] + crown_step).max(1);
                    for dx in -radius..=radius {
                        for dz in -radius..=radius {
                            if dx.abs() == radius && dz.abs() == radius && layer < 2 {
                                continue;
                            }
                            set(x + dx, base + layer, z + dz, leaves, true);
                        }
                    }
                }
                set(x, base + 3, z, leaves, true);
            }
            TreeForm::Slender => {
                let trunk = scaled(6 + stream.range_i((0, 2)));
                for dy in 0..trunk {
                    set(x, y + dy, z, log, false);
                }
                let base = y + trunk - 2;
                for layer in 0..2 {
                    for dx in -1..=1 {
                        for dz in -1..=1 {
                            if dx == 0 && dz == 0 && layer == 0 {
                                continue;
                            }
                            set(x + dx, base + layer, z + dz, leaves, true);
                        }
                    }
                }
                set(x, base + 2, z, leaves, true);
                set(x, base + 3, z, leaves, true);
            }
            TreeForm::Conic => {
                let trunk = scaled(7 + stream.range_i((0, 3)));
                for dy in 0..trunk {
                    set(x, y + dy, z, log, false);
                }
                let mut radius: i32 = (2 + crown_step).max(1);
                let mut layer_y = y + 2;
                while layer_y < y + trunk {
                    for dx in -radius..=radius {
                        for dz in -radius..=radius {
                            if dx.abs() == radius && dz.abs() == radius {
                                continue;
                            }
                            set(x + dx, layer_y, z + dz, leaves, true);
                        }
                    }
                    layer_y += 2;
                    if radius > 1 {
                        radius -= 1;
                    }
                }
                set(x, y + trunk, z, leaves, true);
                set(x, y + trunk + 1, z, leaves, true);
            }
            TreeForm::Umbrella => {
                let trunk = scaled(4 + stream.range_i((0, 2)));
                let lean_x = stream.range_i((-1, 1));
                for dy in 0..trunk {
                    let bend = if dy > trunk / 2 { lean_x } else { 0 };
                    set(x + bend, y + dy, z, log, false);
                }
                let top = y + trunk;
                let cx = x + lean_x;
                let disc = (3 + crown_step).max(2);
                let disc_sq = disc * disc;
                for dx in -disc..=disc {
                    for dz in -disc..=disc {
                        let d2 = dx * dx + dz * dz;
                        if d2 <= disc_sq && d2 >= 2 {
                            set(cx + dx, top, z + dz, leaves, true);
                        }
                    }
                }
                for dx in -1i32..=1 {
                    for dz in -1i32..=1 {
                        set(cx + dx, top + 1, z + dz, leaves, true);
                    }
                }
            }
            TreeForm::Broad => {
                let trunk = scaled(4 + stream.range_i((0, 2)));
                for dy in 0..trunk {
                    set(x, y + dy, z, log, false);
                }
                set(x - 1, y + trunk - 2, z, log, false);
                set(x + 1, y + trunk - 2, z + 1, log, false);
                let base = y + trunk - 1;
                let wide = (3 + crown_step).max(2);
                for dx in -wide..=wide {
                    for dz in -wide..=wide {
                        if dx.abs() == wide && dz.abs() == wide {
                            continue;
                        }
                        set(x + dx, base, z + dz, leaves, true);
                    }
                }
                for dx in -1i32..=1 {
                    for dz in -1i32..=1 {
                        set(x + dx, base + 1, z + dz, leaves, true);
                    }
                }
            }
            TreeForm::Snag => {
                let trunk = scaled(3 + stream.range_i((0, 3)));
                for dy in 0..trunk {
                    set(x, y + dy, z, log, false);
                }
                set(x + 1, y + trunk - 1, z, log, false);
                set(x, y + trunk, z + 1, log, false);
            }
        }
    }
}

/// Uniform draw from a disc of `radius` blocks by rejection over the
/// unit square: trigonometry is not bit-stable across platforms, and
/// four attempts accept with probability ~0.996. The rare full miss
/// pulls the last attempt onto the unit circle.
fn disc_offset(stream: &mut HashStream, radius: f64) -> (i32, i32) {
    let mut px = 0.0;
    let mut pz = 0.0;
    let mut is_inside = false;
    for _ in 0..4 {
        px = stream.unit() * 2.0 - 1.0;
        pz = stream.unit() * 2.0 - 1.0;
        if px * px + pz * pz <= 1.0 {
            is_inside = true;
            break;
        }
    }
    if !is_inside {
        let norm = (px * px + pz * pz).sqrt().max(1e-9);
        px /= norm;
        pz /= norm;
    }
    ((px * radius) as i32, (pz * radius) as i32)
}
