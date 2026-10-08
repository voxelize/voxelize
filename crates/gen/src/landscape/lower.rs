//! Lowering owned mirrors to resolved, name-free forms.
//!
//! The climate partition lowers to v1's `ResolvedPartition` (biome ids,
//! axis indices, stream seeds) and is evaluated by v1's own partition math
//! through `CompiledPartition::from_resolved`. Flora sets lower to block
//! ids and biome masks, placed on v1's cluster lattice and stamped by v1's
//! tree forms (see [`super::flora`]).

use std::collections::BTreeMap;

use crate::climate::{
    BiomeId, CompiledOverlay, CompiledPartition, CompiledRegion, ResolvedPartition,
    ResolvedPartitionKind, MAX_AXES,
};
use crate::noise::{Fractal, NoiseKind};
use crate::stream::{stream_seed_bytes, Subsystem};

use super::fields::SaltClaims;
use super::flora::{LoweredCanopy, LoweredCommunity, LoweredEcology, LoweredFlora, LoweredSet};
use super::mirror::{AxisSourceM, BiomeSpecM, FloraSpecM, OverlayM, PartitionM};
use super::spec::{SpecError, WorldFrame};

/// Where a lowered climate axis reads its value.
#[derive(Clone, Debug, PartialEq)]
pub enum AxisSource {
    /// Temperature after the lapse.
    Temperature,
    /// Moisture.
    Moisture,
    /// `(top - sea) / relief`.
    HeightShare,
    /// A named field, by output slot.
    Field(usize),
}

/// The lowered climate: everything finalize needs per column.
pub(crate) struct LoweredClimate {
    /// Biome keys in id order.
    pub biome_keys: Vec<String>,
    /// Tints by biome id.
    pub tints: Vec<Option<[f64; 3]>>,
    /// v1's partition, built from resolved parts.
    pub partition: CompiledPartition,
    /// Axis sources in axis order.
    pub axes: Vec<AxisSource>,
    /// The lapse.
    pub lapse: f64,
}

/// Lower the biome spec. `field_slot` maps a field name to its output
/// slot (the caller requests the field as an output).
pub(crate) fn lower_climate(
    spec: &BiomeSpecM,
    frame: &WorldFrame,
    world_seed: u32,
    dimension: &str,
    salts: &mut SaltClaims,
    field_slot: &mut dyn FnMut(&str) -> Result<usize, SpecError>,
) -> Result<LoweredClimate, SpecError> {
    if spec.biomes.is_empty() {
        return Err(SpecError::new(
            "biomes.biomes",
            "declare at least one biome",
        ));
    }
    let biome_keys: Vec<String> = spec.biomes.keys().cloned().collect();
    let tints = spec.biomes.values().map(|b| b.tint).collect();
    let biome = |path: &str, key: &str| -> Result<BiomeId, SpecError> {
        biome_keys
            .iter()
            .position(|k| k == key)
            .map(|i| BiomeId(i as u16))
            .ok_or_else(|| SpecError::new(path, format!("unknown biome {key:?}")))
    };
    if spec.axes.len() > MAX_AXES {
        return Err(SpecError::new(
            "biomes.axes",
            format!("{} axes; the cap is {MAX_AXES}", spec.axes.len()),
        ));
    }
    let mut axes = Vec::new();
    let mut axis_keys: Vec<&str> = Vec::new();
    for (i, a) in spec.axes.iter().enumerate() {
        if axis_keys.contains(&a.key.as_str()) {
            return Err(SpecError::new(
                format!("biomes.axes.{i}.key"),
                format!("duplicate axis {:?}", a.key),
            ));
        }
        axis_keys.push(&a.key);
        axes.push(match &a.source {
            AxisSourceM::Temperature => AxisSource::Temperature,
            AxisSourceM::Moisture => AxisSource::Moisture,
            AxisSourceM::HeightShare => AxisSource::HeightShare,
            AxisSourceM::Field(name) => AxisSource::Field(
                field_slot(name)
                    .map_err(|e| SpecError::new(format!("biomes.axes.{i}.source"), e.message))?,
            ),
        });
    }
    let kind = match &spec.partition {
        PartitionM::Single(key) => ResolvedPartitionKind::Single(biome("biomes.partition", key)?),
        PartitionM::Climate {
            axes: used,
            regions,
            region_salt,
            region_cell,
            transition,
        } => {
            let mut axis_indices = Vec::new();
            for (i, key) in used.iter().enumerate() {
                axis_indices.push(axis_keys.iter().position(|k| k == key).ok_or_else(|| {
                    SpecError::new(
                        format!("biomes.partition.axes.{i}"),
                        format!("unknown axis {key:?}"),
                    )
                })?);
            }
            if regions.is_empty() {
                return Err(SpecError::new("biomes.partition.regions", "no regions"));
            }
            let mut out = Vec::new();
            for (r, region) in regions.iter().enumerate() {
                let rp = format!("biomes.partition.regions.{r}");
                if !(region.share > 0.0) {
                    return Err(SpecError::new(
                        format!("{rp}.share"),
                        "share must be positive",
                    ));
                }
                if region.boxes.is_empty() {
                    return Err(SpecError::new(format!("{rp}.boxes"), "no boxes"));
                }
                let mut entries = Vec::new();
                for (b, boxed) in region.boxes.iter().enumerate() {
                    let bp = format!("{rp}.boxes.{b}");
                    if boxed.bounds.len() != axis_indices.len() {
                        return Err(SpecError::new(
                            format!("{bp}.bounds"),
                            format!(
                                "{} intervals for {} partition axes",
                                boxed.bounds.len(),
                                axis_indices.len()
                            ),
                        ));
                    }
                    if boxed.bounds.iter().any(|&(lo, hi)| !(lo <= hi)) {
                        return Err(SpecError::new(
                            format!("{bp}.bounds"),
                            "an interval is not ordered",
                        ));
                    }
                    entries.push((
                        biome(&format!("{bp}.biome"), &boxed.biome)?,
                        boxed.bounds.clone(),
                    ));
                }
                out.push(CompiledRegion {
                    share: region.share,
                    entries,
                });
            }
            if !(*transition > 0.0) {
                return Err(SpecError::new(
                    "biomes.partition.transition",
                    "must be positive",
                ));
            }
            salts.claim(region_salt, "biomes.partition.region_salt", "partition")?;
            ResolvedPartitionKind::Climate {
                axis_indices,
                regions: out,
                region_seed: stream_seed_bytes(
                    world_seed,
                    dimension,
                    Subsystem::Partition,
                    region_salt.as_bytes(),
                    0,
                ),
                region_cell: frame.span(*region_cell),
                transition: *transition,
            }
        }
    };
    let mut overlays = Vec::new();
    for (i, o) in spec.overlays.iter().enumerate() {
        let p = format!("biomes.overlays.{i}");
        overlays.push(match o {
            OverlayM::ShoreBand {
                biome: key,
                below,
                above,
            } => CompiledOverlay::ShoreBand {
                biome: biome(&p, key)?,
                from_below: *below,
                to_above: *above,
            },
            OverlayM::OpenWater {
                biome: key,
                min_depth,
            } => CompiledOverlay::OpenWater {
                biome: biome(&p, key)?,
                min_depth: *min_depth,
            },
            OverlayM::Peaks { biome: key, above } => CompiledOverlay::Peaks {
                biome: biome(&p, key)?,
                surface_above: frame.resolve(*above).floor() as i32,
            },
        });
    }
    Ok(LoweredClimate {
        biome_keys,
        tints,
        partition: CompiledPartition::from_resolved(ResolvedPartition { kind, overlays }),
        axes,
        lapse: spec.climate.lapse,
    })
}

/// Lower flora: species to block ids by role, sets to seeds and biome
/// masks.
pub fn lower_flora(
    spec: &FloraSpecM,
    frame: &WorldFrame,
    world_seed: u32,
    dimension: &str,
    roles: &BTreeMap<String, Option<u32>>,
    biome_keys: &[String],
    salts: &mut SaltClaims,
) -> Result<LoweredFlora, SpecError> {
    let species_keys: Vec<&String> = spec.species.keys().collect();
    let mut species = Vec::new();
    for (key, s) in &spec.species {
        let role = |field: &str, role: &str| -> Result<Option<u32>, SpecError> {
            roles.get(role).copied().ok_or_else(|| {
                SpecError::new(
                    format!("flora.species.{key}.{field}"),
                    format!("undeclared role {role:?}"),
                )
            })
        };
        let log = role("log", &s.log)?;
        let leaves = role("leaves", &s.leaves)?;
        species.push(match (log, leaves) {
            (Some(l), Some(f)) => Some((s.form.into(), l, f)),
            _ => None,
        });
    }
    let mut sets = Vec::new();
    for (key, set) in &spec.sets {
        let p = format!("flora.sets.{key}");
        if set.points.0 == 0 || set.points.1 < set.points.0 || set.points.1 > 8 {
            return Err(SpecError::new(
                format!("{p}.points"),
                "points must be 1..=8, ordered",
            ));
        }
        if !(0.0..=1.0).contains(&set.chance) || !(0.0..=1.0).contains(&set.cohesion) {
            return Err(SpecError::new(
                p.clone(),
                "chance and cohesion must lie in 0..=1",
            ));
        }
        if !(0.0..=0.5).contains(&set.age_spread) {
            return Err(SpecError::new(
                format!("{p}.age_spread"),
                "must lie in 0..=0.5",
            ));
        }
        if !(set.spread >= 0.0 && set.spread <= 24.0) {
            return Err(SpecError::new(format!("{p}.spread"), "must lie in 0..=24"));
        }
        let cell = frame.span(set.cell);
        if !(cell >= 8.0) {
            return Err(SpecError::new(
                format!("{p}.cell"),
                "the cluster lattice needs at least 8 blocks",
            ));
        }
        salts.claim(&set.salt, &format!("{p}.salt"), "flora")?;
        let seed = stream_seed_bytes(
            world_seed,
            dimension,
            Subsystem::Structures,
            set.salt.as_bytes(),
            0,
        );
        let gate = match &set.gate {
            Some(g) => Some((
                Fractal::new(
                    seed ^ 0x6F,
                    1.0 / frame.span(g.wavelength),
                    2,
                    0.5,
                    2.0,
                    NoiseKind::Fbm,
                ),
                g.window,
            )),
            None => None,
        };
        let mut mix = Vec::new();
        for (i, (sp, w)) in set.species.iter().enumerate() {
            let index = species_keys.iter().position(|k| *k == sp).ok_or_else(|| {
                SpecError::new(
                    format!("{p}.species.{i}"),
                    format!("unknown species {sp:?}"),
                )
            })?;
            if !(*w > 0.0) {
                return Err(SpecError::new(
                    format!("{p}.species.{i}"),
                    "weights must be positive",
                ));
            }
            mix.push((index, *w));
        }
        if mix.is_empty() {
            return Err(SpecError::new(
                format!("{p}.species"),
                "a set needs species",
            ));
        }
        let mut biomes = vec![false; biome_keys.len()];
        for (i, b) in set.biomes.iter().enumerate() {
            let id = biome_keys.iter().position(|k| k == b).ok_or_else(|| {
                SpecError::new(format!("{p}.biomes.{i}"), format!("unknown biome {b:?}"))
            })?;
            biomes[id] = true;
        }
        sets.push(LoweredSet {
            seed,
            cell,
            chance: set.chance,
            gate,
            points: (set.points.0 as i32, set.points.1 as i32),
            spread: set.spread,
            species: mix,
            cohesion: set.cohesion,
            age_spread: set.age_spread,
            max_slope: set.max_slope,
            ground: set
                .ground
                .map(|(lo, hi)| (frame.resolve(lo), frame.resolve(hi))),
            biomes,
        });
    }
    let ecology = match &spec.ecology {
        Some(e) => Some(lower_ecology(
            e,
            frame,
            world_seed,
            dimension,
            &species_keys,
            biome_keys,
            salts,
        )?),
        None => None,
    };
    Ok(LoweredFlora::new(species, sets, ecology))
}

fn species_mix(
    path: &str,
    mix: &[(String, f64)],
    species_keys: &[&String],
) -> Result<Vec<(usize, f64)>, SpecError> {
    let mut out = Vec::new();
    for (i, (sp, w)) in mix.iter().enumerate() {
        let index = species_keys.iter().position(|k| *k == sp).ok_or_else(|| {
            SpecError::new(format!("{path}.{i}"), format!("unknown species {sp:?}"))
        })?;
        if !(*w > 0.0) {
            return Err(SpecError::new(
                format!("{path}.{i}"),
                "weights must be positive",
            ));
        }
        out.push((index, *w));
    }
    Ok(out)
}

fn biome_mask(path: &str, keys: &[String], biome_keys: &[String]) -> Result<Vec<bool>, SpecError> {
    let mut mask = vec![false; biome_keys.len()];
    for (i, b) in keys.iter().enumerate() {
        let id = biome_keys
            .iter()
            .position(|k| k == b)
            .ok_or_else(|| SpecError::new(format!("{path}.{i}"), format!("unknown biome {b:?}")))?;
        mask[id] = true;
    }
    Ok(mask)
}

/// Lower the community field: seeds as v1 derives them (the field from
/// the salt's cell 1, each canopy from cell 1000 + its community index).
fn lower_ecology(
    e: &super::mirror::EcologyM,
    frame: &WorldFrame,
    world_seed: u32,
    dimension: &str,
    species_keys: &[&String],
    biome_keys: &[String],
    salts: &mut SaltClaims,
) -> Result<LoweredEcology, SpecError> {
    let cell = frame.span(e.cell);
    if !(cell >= 16.0) {
        return Err(SpecError::new(
            "flora.ecology.cell",
            "the patch lattice needs at least 16 blocks",
        ));
    }
    if !(0.0..=0.5).contains(&e.ecotone) {
        return Err(SpecError::new(
            "flora.ecology.ecotone",
            "must lie in 0..=0.5",
        ));
    }
    if e.communities.is_empty() {
        return Err(SpecError::new(
            "flora.ecology.communities",
            "declare at least one community",
        ));
    }
    salts.claim(&e.salt, "flora.ecology.salt", "ecology")?;
    let seed_of = |cell: u64| {
        stream_seed_bytes(
            world_seed,
            dimension,
            Subsystem::Structures,
            e.salt.as_bytes(),
            cell,
        )
    };
    let mut communities = Vec::new();
    for (index, (key, m)) in e.communities.iter().enumerate() {
        let p = format!("flora.ecology.communities.{key}");
        if !(m.weight > 0.0) {
            return Err(SpecError::new(format!("{p}.weight"), "must be positive"));
        }
        let canopy = match &m.canopy {
            None => None,
            Some(c) => {
                if c.points.0 == 0 || c.points.1 < c.points.0 || c.points.1 > 8 {
                    return Err(SpecError::new(
                        format!("{p}.canopy.points"),
                        "points must be 1..=8, ordered",
                    ));
                }
                if !(0.0..=1.0).contains(&c.cohesion) || !(0.0..=0.5).contains(&c.age_spread) {
                    return Err(SpecError::new(
                        format!("{p}.canopy"),
                        "cohesion must lie in 0..=1 and age_spread in 0..=0.5",
                    ));
                }
                let ccell = frame.span(c.cell);
                if !(ccell >= 8.0)
                    || !(0.0..=1.0).contains(&c.chance)
                    || !(0.0..=24.0).contains(&c.spread)
                {
                    return Err(SpecError::new(
                        format!("{p}.canopy"),
                        "a canopy needs cell >= 8, chance in 0..=1 and spread in 0..=24",
                    ));
                }
                let species =
                    species_mix(&format!("{p}.canopy.species"), &c.species, species_keys)?;
                if species.is_empty() {
                    return Err(SpecError::new(
                        format!("{p}.canopy.species"),
                        "a canopy needs species",
                    ));
                }
                Some(LoweredCanopy {
                    seed: seed_of(1000 + index as u64),
                    cell: ccell,
                    chance: c.chance,
                    points: (c.points.0 as i32, c.points.1 as i32),
                    spread: c.spread,
                    species,
                    edge: species_mix(&format!("{p}.edge_species"), &m.edge_species, species_keys)?,
                    cohesion: c.cohesion,
                    age_spread: c.age_spread,
                    max_slope: c.max_slope,
                })
            }
        };
        communities.push(LoweredCommunity {
            biomes: biome_mask(&format!("{p}.biomes"), &m.biomes, biome_keys)?,
            ground: (frame.resolve(m.ground.0), frame.resolve(m.ground.1)),
            max_slope: m.max_slope,
            moisture: m.moisture,
            weight: m.weight,
            canopy,
        });
    }
    Ok(LoweredEcology {
        seed: seed_of(1),
        cell,
        ecotone: e.ecotone,
        communities,
    })
}
