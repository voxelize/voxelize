//! Hydrology: one pure material function answers "what fills a void here"
//! for every stage that opens one — cave shape and fluid content stay
//! independent axes. Aquifers are interpolated cell water tables: bounded,
//! seam-free, a model rather than a simulation.

use serde::Serialize;

use crate::spec::GenError;
use crate::stream::{cell_id, hash_unit, mix64, stream_seed, SaltPath, Subsystem};

#[derive(Debug, Clone, Serialize)]
pub struct HydrologySpec {
    pub sea: Option<SeaSpec>,
    pub aquifers: Option<AquiferSpec>,
    pub lava: Option<LavaSpec>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SeaSpec {
    pub level: i32,
    pub fluid: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct AquiferSpec {
    pub salt: SaltPath,
    /// Water-table cell size in blocks.
    pub cell: f64,
    pub level_range: (i32, i32),
    /// A carved voxel only floods when at least this much rock roofs it,
    /// so tables never weep through open hillsides.
    pub min_roof: i32,
    pub fluid: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct LavaSpec {
    pub level: i32,
    pub fluid: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VoidMaterial {
    Air,
    Fluid(u32),
}

pub(crate) struct CompiledHydrology {
    pub sea: Option<(i32, u32)>,
    aquifer: Option<CompiledAquifer>,
    lava: Option<(i32, u32)>,
}

struct CompiledAquifer {
    seed: u64,
    cell: f64,
    level_lo: i32,
    level_hi: i32,
    min_roof: i32,
    fluid: u32,
}

impl CompiledHydrology {
    pub fn compile(
        spec: &HydrologySpec,
        resolve_block: &dyn Fn(&str) -> Result<u32, GenError>,
        world_seed: u32,
        dimension: &str,
        used_salts: &mut hashbrown::HashSet<&'static str>,
    ) -> Result<Self, GenError> {
        let sea = match &spec.sea {
            Some(sea) => Some((sea.level, resolve_block(sea.fluid)?)),
            None => None,
        };
        let aquifer = match &spec.aquifers {
            Some(aq) => {
                crate::spec::claim_salt(&aq.salt, used_salts)?;
                if aq.level_range.1 < aq.level_range.0 {
                    return Err(GenError::OutOfRange {
                        path: "hydrology.aquifers.level_range".to_string(),
                        what: "aquifer level range",
                        got: aq.level_range.1 as f64,
                    });
                }
                if let Some((sea_level, _)) = sea {
                    if aq.level_range.1 > sea_level {
                        return Err(GenError::OutOfRange {
                            path: "hydrology.aquifers.level_range".to_string(),
                            what: "aquifer tables must cap at sea level",
                            got: aq.level_range.1 as f64,
                        });
                    }
                }
                Some(CompiledAquifer {
                    seed: stream_seed(world_seed, dimension, Subsystem::Hydrology, &aq.salt, 0),
                    cell: aq.cell.max(8.0),
                    level_lo: aq.level_range.0,
                    level_hi: aq.level_range.1,
                    min_roof: aq.min_roof.max(1),
                    fluid: resolve_block(aq.fluid)?,
                })
            }
            None => None,
        };
        let lava = match &spec.lava {
            Some(lava) => Some((lava.level, resolve_block(lava.fluid)?)),
            None => None,
        };
        Ok(Self { sea, aquifer, lava })
    }

    /// Material for a voxel some stage decided is not solid. `roof_depth`
    /// is solid rock above the voxel in this column (already known by the
    /// carve pass); `surface` is the column's terrain height.
    pub fn void_material(&self, x: i32, y: i32, z: i32, surface: i32, roof_depth: i32) -> VoidMaterial {
        if let Some((lava_level, lava)) = self.lava {
            if y <= lava_level {
                return VoidMaterial::Fluid(lava);
            }
        }
        if let Some((sea_level, sea_fluid)) = self.sea {
            if y <= sea_level && y > surface {
                return VoidMaterial::Fluid(sea_fluid);
            }
        }
        if let Some(aquifer) = &self.aquifer {
            if roof_depth >= aquifer.min_roof {
                let table = self.aquifer_level(x, z);
                if y <= table {
                    return VoidMaterial::Fluid(aquifer.fluid);
                }
            }
        }
        VoidMaterial::Air
    }

    /// Bilinear interpolation of per-cell hashed table levels: continuous
    /// across cells and chunk borders by construction.
    pub fn aquifer_level(&self, x: i32, z: i32) -> i32 {
        let Some(aquifer) = &self.aquifer else {
            return i32::MIN;
        };
        let fx = x as f64 / aquifer.cell;
        let fz = z as f64 / aquifer.cell;
        let cx = fx.floor();
        let cz = fz.floor();
        let tx = fx - cx;
        let tz = fz - cz;
        let level_at = |dx: i64, dz: i64| -> f64 {
            let h = mix64(aquifer.seed ^ mix64(cell_id(cx as i64 + dx, cz as i64 + dz)));
            aquifer.level_lo as f64 + hash_unit(h) * (aquifer.level_hi - aquifer.level_lo) as f64
        };
        let l00 = level_at(0, 0);
        let l10 = level_at(1, 0);
        let l01 = level_at(0, 1);
        let l11 = level_at(1, 1);
        let top = l00 + (l10 - l00) * tx;
        let bottom = l01 + (l11 - l01) * tx;
        (top + (bottom - top) * tz).floor() as i32
    }

    pub fn sea_level(&self) -> Option<i32> {
        self.sea.map(|(level, _)| level)
    }
}
