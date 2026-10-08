//! Trees, placed from final facts.
//!
//! Two lowered sources, both on v1's jittered cluster lattice (with v1's
//! disc offsets and weighted picks) and both stamped by v1's tree forms:
//!
//! - **sets**: azonal stands gated by biome, slope, height and a grove
//!   patch field;
//! - **communities**: the community field (v1's ecology: a jittered site
//!   lattice where each cell's site elects one eligible community, through
//!   v1's own name-free site and election), whose canopies plant only on
//!   ground their community owns, with ecotone species near patch borders.
//!   A meadow is a community with no canopy: it owns ground and keeps it
//!   open.
//!
//! What changes from v1 is what a site or trunk asks about its column: the
//! final facts (top, slope, moisture, biome, water), read from the chunk's
//! facts where it has them and from a point query elsewhere, which returns
//! the same bits. Every stand rolls a dominant and a companion species and a
//! shared maturity, and members repeat the dominant with probability
//! `cohesion`, so trees come in coherent groves, never sprinkled.
//!
//! A canopy crossing a chunk border writes identical voxels from both
//! sides: every chunk re-derives the same trees in the same order (sets in
//! key order, then communities in key order; clusters in lattice order;
//! members in index order).

use std::collections::HashMap;

use crate::ecology::{ecology_elect, ecology_nearest, ecology_site};
use crate::flora::{disc_offset, each_cluster, pick_weighted, TreeForm, TreeInstance};
use crate::landscape::math::MinMax;
use crate::noise::Fractal;
use crate::stream::{cell_id, mix64, HashStream};

use super::counters::{bump, Counter};
use super::facts::ColumnFact;

/// Members per cluster are indexed `cluster_x * MAX + point` (v1's rule).
const CLUSTER_MAX_POINTS: i64 = 8;

/// The widest canopy reach of v1's forms, in blocks from the trunk.
pub const MAX_CANOPY: i32 = 5;

/// One lowered set.
pub struct LoweredSet {
    pub(crate) seed: u64,
    pub(crate) cell: f64,
    pub(crate) chance: f64,
    pub(crate) gate: Option<(Fractal, (f64, f64))>,
    pub(crate) points: (i32, i32),
    pub(crate) spread: f64,
    pub(crate) species: Vec<(usize, f64)>,
    pub(crate) cohesion: f64,
    pub(crate) age_spread: f64,
    pub(crate) max_slope: f64,
    pub(crate) ground: Option<(f64, f64)>,
    pub(crate) biomes: Vec<bool>,
}

/// One lowered canopy.
pub struct LoweredCanopy {
    pub(crate) seed: u64,
    pub(crate) cell: f64,
    pub(crate) chance: f64,
    pub(crate) points: (i32, i32),
    pub(crate) spread: f64,
    pub(crate) species: Vec<(usize, f64)>,
    pub(crate) edge: Vec<(usize, f64)>,
    pub(crate) cohesion: f64,
    pub(crate) age_spread: f64,
    pub(crate) max_slope: f64,
}

/// One lowered community.
pub struct LoweredCommunity {
    pub(crate) biomes: Vec<bool>,
    pub(crate) ground: (f64, f64),
    pub(crate) max_slope: f64,
    pub(crate) moisture: (f64, f64),
    pub(crate) weight: f64,
    pub(crate) canopy: Option<LoweredCanopy>,
}

/// The lowered community field.
pub struct LoweredEcology {
    pub(crate) seed: u64,
    pub(crate) cell: f64,
    pub(crate) ecotone: f64,
    pub(crate) communities: Vec<LoweredCommunity>,
}

/// Memo of cell elections for one placement (cost only: every entry is a
/// pure function of its cell).
type Elections = HashMap<(i64, i64), Option<u16>>;

impl LoweredEcology {
    /// The community a cell's site elects, if any.
    fn cell_owner(
        &self,
        cell_x: i64,
        cell_z: i64,
        sea: i32,
        column: &mut dyn FnMut(i32, i32) -> ColumnFact,
        memo: &mut Elections,
    ) -> Option<u16> {
        if let Some(hit) = memo.get(&(cell_x, cell_z)) {
            return *hit;
        }
        let (sx, sz) = ecology_site(self.seed, self.cell, cell_x, cell_z);
        let c = column(sx.round() as i32, sz.round() as i32);
        let owner = if c.top <= sea || !c.water.is_dry() {
            None
        } else {
            let top = c.top as f64;
            let mut total = 0.0;
            let mut eligible: smallvec::SmallVec<[(u16, f64); 8]> = smallvec::SmallVec::new();
            for (index, m) in self.communities.iter().enumerate() {
                if top < m.ground.0 || top > m.ground.1 {
                    continue;
                }
                if c.slope > m.max_slope {
                    continue;
                }
                if c.moisture < m.moisture.0 || c.moisture > m.moisture.1 {
                    continue;
                }
                if !m.biomes[c.biome.id.0 as usize] {
                    continue;
                }
                eligible.push((index as u16, m.weight));
                total += m.weight;
            }
            if eligible.is_empty() {
                None
            } else {
                Some(ecology_elect(self.seed, cell_x, cell_z, &eligible, total))
            }
        };
        memo.insert((cell_x, cell_z), owner);
        owner
    }

    /// Patch ownership at a column: the community and how interior the
    /// column sits (1 deep inside, falling to 0 at the border).
    pub(crate) fn owner_at(
        &self,
        x: i32,
        z: i32,
        sea: i32,
        column: &mut dyn FnMut(i32, i32) -> ColumnFact,
        memo: &mut Elections,
    ) -> Option<(usize, f64)> {
        let (cell, interior) = ecology_nearest(self.seed, self.cell, self.ecotone, x, z);
        let community = self.cell_owner(cell.0, cell.1, sea, column, memo)?;
        Some((community as usize, interior))
    }
}

/// Lowered flora: species (form, log, leaves; `None` when a role is
/// unbound), sets and the community field.
pub struct LoweredFlora {
    pub(crate) species: Vec<Option<(TreeForm, u32, u32)>>,
    pub(crate) sets: Vec<LoweredSet>,
    pub(crate) ecology: Option<LoweredEcology>,
}

/// One tree's size from its stand's maturity and its own age.
fn tree_size(maturity: f64, ps: &mut HashStream, age_spread: f64) -> f64 {
    let age = 1.0 + (ps.unit() * 2.0 - 1.0) * age_spread;
    (maturity * age).fclamp(0.6, 1.5)
}

impl LoweredFlora {
    /// Lowered parts.
    pub fn new(
        species: Vec<Option<(TreeForm, u32, u32)>>,
        sets: Vec<LoweredSet>,
        ecology: Option<LoweredEcology>,
    ) -> Self {
        Self {
            species,
            sets,
            ecology,
        }
    }

    /// Trees whose trunks stand in `[min, max)` (world columns), in the
    /// canonical order. `column` answers a column's facts.
    pub fn trees_in(
        &self,
        min: (i32, i32),
        max: (i32, i32),
        sea: i32,
        column: &mut dyn FnMut(i32, i32) -> ColumnFact,
    ) -> Vec<TreeInstance> {
        let mut trees = Vec::new();
        let inside = |x: i32, z: i32| x >= min.0 && x < max.0 && z >= min.1 && z < max.1;
        for set in &self.sets {
            let pad = set.spread.ceil() as i32;
            each_cluster(
                set.seed,
                set.cell,
                set.chance,
                (min.0 - pad, min.1 - pad),
                (max.0 + pad, max.1 + pad),
                &mut |cluster_x, cluster_z, center_x, center_z, stream| {
                    if let Some((gate, (lo, hi))) = &set.gate {
                        let v = gate.sample2(center_x as f64, center_z as f64);
                        if v < *lo || v > *hi {
                            return;
                        }
                    }
                    let dominant = pick_weighted(&set.species, stream);
                    let companion = pick_weighted(&set.species, stream);
                    let maturity = 1.0 + (stream.unit() * 2.0 - 1.0) * set.age_spread;
                    let count = stream.range_i(set.points);
                    for point in 0..count {
                        let mut ps = HashStream::new(
                            set.seed
                                ^ mix64(cell_id(
                                    cluster_x * CLUSTER_MAX_POINTS + point as i64,
                                    cluster_z,
                                )),
                        );
                        let (dx, dz) = disc_offset(&mut ps, set.spread);
                        let (x, z) = (center_x + dx, center_z + dz);
                        if !inside(x, z) {
                            continue;
                        }
                        let c = column(x, z);
                        if c.top <= sea || !c.water.is_dry() || c.slope > set.max_slope {
                            continue;
                        }
                        if !set.biomes[c.biome.id.0 as usize] {
                            continue;
                        }
                        if let Some((lo, hi)) = set.ground {
                            let top = c.top as f64;
                            if top < lo || top > hi {
                                continue;
                            }
                        }
                        let species = if ps.unit() <= set.cohesion {
                            dominant
                        } else {
                            companion
                        };
                        let size = tree_size(maturity, &mut ps, set.age_spread);
                        trees.push(TreeInstance {
                            x,
                            y: c.top,
                            z,
                            species,
                            size,
                            seed: ps.raw(),
                        });
                    }
                },
            );
        }
        if let Some(eco) = &self.ecology {
            let mut memo = Elections::new();
            for (index, community) in eco.communities.iter().enumerate() {
                let Some(canopy) = &community.canopy else {
                    continue;
                };
                let pad = canopy.spread.ceil() as i32;
                each_cluster(
                    canopy.seed,
                    canopy.cell,
                    canopy.chance,
                    (min.0 - pad, min.1 - pad),
                    (max.0 + pad, max.1 + pad),
                    &mut |cluster_x, cluster_z, center_x, center_z, stream| {
                        // Ownership gate: the stand exists only where the
                        // community field elected this community.
                        match eco.owner_at(center_x, center_z, sea, column, &mut memo) {
                            Some((owner, _)) if owner == index => {}
                            _ => return,
                        }
                        let dominant = pick_weighted(&canopy.species, stream);
                        let companion = pick_weighted(&canopy.species, stream);
                        let maturity = 1.0 + (stream.unit() * 2.0 - 1.0) * canopy.age_spread;
                        let count = stream.range_i(canopy.points);
                        for point in 0..count {
                            let mut ps = HashStream::new(
                                canopy.seed
                                    ^ mix64(cell_id(
                                        cluster_x * CLUSTER_MAX_POINTS + point as i64,
                                        cluster_z,
                                    )),
                            );
                            let (dx, dz) = disc_offset(&mut ps, canopy.spread);
                            let (x, z) = (center_x + dx, center_z + dz);
                            if !inside(x, z) {
                                continue;
                            }
                            let c = column(x, z);
                            if c.top <= sea || !c.water.is_dry() || c.slope > canopy.max_slope {
                                continue;
                            }
                            // Containment: the trunk itself stands on
                            // ground this community owns.
                            let Some((owner, interior)) =
                                eco.owner_at(x, z, sea, column, &mut memo)
                            else {
                                continue;
                            };
                            if owner != index {
                                continue;
                            }
                            let mut species = if ps.unit() <= canopy.cohesion {
                                dominant
                            } else {
                                companion
                            };
                            if !canopy.edge.is_empty() {
                                let edge = 1.0 - interior;
                                if ps.unit() < edge {
                                    species = pick_weighted(&canopy.edge, &mut ps);
                                }
                            }
                            let size = tree_size(maturity, &mut ps, canopy.age_spread);
                            trees.push(TreeInstance {
                                x,
                                y: c.top,
                                z,
                                species,
                                size,
                                seed: ps.raw(),
                            });
                        }
                    },
                );
            }
        }
        bump(Counter::Trees, trees.len() as u64);
        trees
    }

    /// Stamp `tree`: `set(x, y, z, block, soft)`, soft writes only into air.
    pub fn stamp(&self, tree: &TreeInstance, set: &mut dyn FnMut(i32, i32, i32, u32, bool)) {
        if let Some((form, log, leaves)) = self.species[tree.species] {
            crate::flora::stamp_form(form, log, leaves, tree, set);
        }
    }
}

#[cfg(test)]
mod tests {
    //! The community canopy port against v1's own ecology and flora, on a
    //! shared synthetic environment: the same seeds and parameters place
    //! the same trees.

    use super::*;
    use crate::climate::BiomeId;
    use crate::ecology::{
        CanopySpec, CellCache, CommunityDef, CompiledEcology, EcologySpec, Env, FloorSpec,
    };
    use crate::flora::{CompiledFlora, SpeciesDef};
    use crate::landscape::facts::BiomeCell;
    use crate::landscape::water::WaterColumn;
    use crate::stream::{stream_seed, SaltPath, Subsystem};
    use voxelize::{Block, Registry};

    fn surface(x: i32, z: i32) -> i32 {
        let h = mix64((x as i64 as u64).wrapping_mul(31) ^ (z as i64 as u64).wrapping_mul(1009));
        70 + ((x / 7 + z / 11).rem_euclid(9)) + (h % 2) as i32
    }

    fn biome_of(x: i32, z: i32) -> u16 {
        if (x / 40 + z / 50).rem_euclid(3) == 0 {
            1
        } else {
            0
        }
    }

    fn moisture(x: i32, z: i32) -> f64 {
        ((x + 2 * z).rem_euclid(100)) as f64 / 100.0
    }

    #[test]
    fn community_canopies_match_v1() {
        let mut registry = Registry::new();
        registry.register_blocks(&[Block::new("L").id(1).build(), Block::new("F").id(2).build()]);
        let species = vec![
            SpeciesDef {
                key: "a",
                log: "L",
                leaves: "F",
                form: crate::flora::TreeForm::Round,
            },
            SpeciesDef {
                key: "b",
                log: "L",
                leaves: "F",
                form: crate::flora::TreeForm::Slender,
            },
        ];
        let canopy = |sp: Vec<(&'static str, f64)>| CanopySpec {
            cell: 18.0,
            cluster_chance: 0.7,
            points: (2, 6),
            spread: 6.0,
            species: sp,
            cohesion: 0.7,
            age_spread: 0.3,
            max_slope: 9.0,
            avoid_river_within: 0.0,
        };
        let floor = FloorSpec {
            density: 0.0,
            plants: vec![],
            riparian_boost: 1.0,
            riparian_band: 0.0,
        };
        let spec = EcologySpec {
            salt: SaltPath("eco.test"),
            cell: 64.0,
            ecotone: 0.3,
            lane_moisture_reach: 1.0,
            communities: vec![
                CommunityDef {
                    key: "wood",
                    biomes: vec!["b0"],
                    surface: (60, 90),
                    max_slope: 9.0,
                    moisture: (0.0, 0.7),
                    weight: 2.0,
                    canopy: Some(canopy(vec![("a", 2.0), ("b", 1.0)])),
                    edge_species: vec![("b", 1.0)],
                    floor: floor.clone(),
                },
                CommunityDef {
                    key: "meadow",
                    biomes: vec!["b0", "b1"],
                    surface: (60, 90),
                    max_slope: 9.0,
                    moisture: (0.0, 1.0),
                    weight: 1.0,
                    canopy: None,
                    edge_species: vec![],
                    floor: floor.clone(),
                },
                CommunityDef {
                    key: "pale",
                    biomes: vec!["b1"],
                    surface: (60, 90),
                    max_slope: 9.0,
                    moisture: (0.2, 1.0),
                    weight: 1.0,
                    canopy: Some(canopy(vec![("b", 1.0)])),
                    edge_species: vec![],
                    floor,
                },
            ],
        };
        let (seed_world, dim) = (99u32, "surface");
        let eco = CompiledEcology::compile(&spec, seed_world, dim).unwrap();
        let flora =
            CompiledFlora::compile(&[], &species, Some(&eco), &registry, seed_world, dim).unwrap();
        let sea = 60;
        let steep = |_: i32, _: i32| 0.1;
        let key = |x: i32, _: i32, z: i32| if biome_of(x, z) == 1 { "b1" } else { "b0" };
        let far = |_: i32, _: i32| 1e9;
        let env = Env {
            surface: &surface,
            steepness: &steep,
            biome_key: &key,
            river_dist: &far,
            moisture: &moisture,
            sea_level: Some(sea),
        };
        let (min, max) = ((-200, -150), (260, 310));
        let mut cache = CellCache::default();
        let want = flora.trees_in(min, max, &env, Some(&eco), &mut cache);

        // The same thing, lowered.
        let field_seed = stream_seed(seed_world, dim, Subsystem::Structures, &spec.salt, 1);
        let canopy_seed =
            |i: u64| stream_seed(seed_world, dim, Subsystem::Structures, &spec.salt, 1000 + i);
        let lowered = |i: usize, c: &CommunityDef| LoweredCommunity {
            biomes: vec![c.biomes.contains(&"b0"), c.biomes.contains(&"b1")],
            ground: (c.surface.0 as f64, c.surface.1 as f64),
            max_slope: c.max_slope,
            moisture: c.moisture,
            weight: c.weight,
            canopy: c.canopy.as_ref().map(|k| LoweredCanopy {
                seed: canopy_seed(i as u64),
                cell: k.cell,
                chance: k.cluster_chance,
                points: (k.points.0 as i32, k.points.1 as i32),
                spread: k.spread,
                species: k
                    .species
                    .iter()
                    .map(|(s, w)| (species.iter().position(|d| d.key == *s).unwrap(), *w))
                    .collect(),
                edge: c
                    .edge_species
                    .iter()
                    .map(|(s, w)| (species.iter().position(|d| d.key == *s).unwrap(), *w))
                    .collect(),
                cohesion: k.cohesion,
                age_spread: k.age_spread,
                max_slope: k.max_slope,
            }),
        };
        // v1 seeds each canopy by its community's index.
        let communities = spec
            .communities
            .iter()
            .enumerate()
            .map(|(i, c)| lowered(i, c))
            .collect();
        let ours = LoweredFlora::new(
            vec![None, None],
            vec![],
            Some(LoweredEcology {
                seed: field_seed,
                cell: spec.cell,
                ecotone: spec.ecotone,
                communities,
            }),
        );
        let mut column = |x: i32, z: i32| ColumnFact {
            x,
            z,
            ground: surface(x, z) as f64,
            top: surface(x, z),
            slope: 0.1,
            aspect: [0.0, 0.0],
            curvature: 0.0,
            temperature: 0.5,
            moisture: moisture(x, z),
            biome: BiomeCell {
                id: BiomeId(biome_of(x, z)),
                primary: BiomeId(biome_of(x, z)),
                secondary: BiomeId(biome_of(x, z)),
                edge: 0,
            },
            zone: super::super::surface::ZoneKey::NONE,
            water: WaterColumn::default(),
            kept: Default::default(),
        };
        let got = ours.trees_in(min, max, sea, &mut column);
        // v1 also lists trunks in a padded ring around the window; both
        // place every trunk inside it, in the same lattice order.
        let inside = |t: &&TreeInstance| t.x >= min.0 && t.x < max.0 && t.z >= min.1 && t.z < max.1;
        let key_of = |t: &TreeInstance| (t.x, t.y, t.z, t.species, t.size.to_bits(), t.seed);
        let want: Vec<_> = want.iter().filter(inside).map(key_of).collect();
        let got: Vec<_> = got.iter().filter(inside).map(key_of).collect();
        assert!(want.len() > 20, "the fixture plants trees ({})", want.len());
        assert_eq!(want, got);
    }
}
