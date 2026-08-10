//! Topology lanes: the dimension's shape archetype. The heightfield lane
//! composes field programs (continents, oceans, mountains); the geology
//! lane runs the solved plate/erosion backbone. Both answer the same
//! questions — surface height, steepness, prefetched chunk grids — so
//! stages, structures, and debug tools never branch on dimension
//! identity.

use serde::Serialize;

use crate::field::{FieldGraph, FieldProgram};
use crate::geology::{GeoModel, GeologySpec};
use crate::spec::GenError;

#[derive(Debug, Clone, Serialize)]
pub enum TopologySpec {
    Heightfield(HeightfieldLane),
    /// The solved coarse-geology backbone: analytic plates, stream-power
    /// erosion tiles fused under partition-of-unity weights. Requires a
    /// global sea in the hydrology spec (the solve is anchored on it).
    Geology(GeologySpec),
}

#[derive(Debug, Clone, Serialize)]
pub struct HeightfieldLane {
    /// Output is the base surface height in blocks (already spline-mapped).
    pub base_height: FieldGraph,
    pub relief: Vec<ReliefLayer>,
    /// Central-difference probe distance for the slope field.
    pub slope_probe: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReliefLayer {
    pub key: &'static str,
    /// Mask in 0..1; a zero gate skips the lift sample entirely.
    pub gate: FieldGraph,
    /// Contribution in blocks where the gate is open.
    pub lift: FieldGraph,
}

const GEO_PROBE: i32 = 2;

pub(crate) enum CompiledLane {
    Heightfield {
        base: FieldProgram,
        relief: Vec<(String, FieldProgram, FieldProgram)>,
        slope_probe: i32,
        min_y: i32,
        max_y: i32,
    },
    Geology {
        model: GeoModel,
        min_y: i32,
        max_y: i32,
    },
}

/// Raw lane heights prefetched over a chunk footprint plus the slope-probe
/// halo. Values are bit-identical to direct lane sampling — the grid only
/// removes the 5x re-evaluation per column that surface + steepness
/// probing would otherwise cost, which matters once base stacks carry many
/// octaves or a tile solve sits underneath.
pub(crate) struct LaneGrid {
    min_x: i32,
    min_z: i32,
    span_z: usize,
    probe: i32,
    min_y: i32,
    max_y: i32,
    heights: Vec<f64>,
}

impl LaneGrid {
    #[inline]
    fn height_f(&self, x: i32, z: i32) -> f64 {
        let ix = (x - self.min_x) as usize;
        let iz = (z - self.min_z) as usize;
        self.heights[ix * self.span_z + iz]
    }

    pub fn surface_raw(&self, x: i32, z: i32) -> i32 {
        (self.height_f(x, z).round() as i32).clamp(self.min_y, self.max_y)
    }

    pub fn steepness(&self, x: i32, z: i32) -> f64 {
        let d = self.probe;
        let gx = (self.height_f(x + d, z) - self.height_f(x - d, z)).abs();
        let gz = (self.height_f(x, z + d) - self.height_f(x, z - d)).abs();
        (gx + gz) / (2.0 * d as f64)
    }
}

impl CompiledLane {
    pub fn compile(
        spec: &TopologySpec,
        height: u32,
        sea_level: Option<i32>,
        world_seed: u32,
        dimension: &str,
        used_salts: &mut hashbrown::HashSet<&'static str>,
    ) -> Result<Self, GenError> {
        match spec {
            TopologySpec::Heightfield(lane) => {
                if lane.slope_probe < 1 || lane.slope_probe > 8 {
                    return Err(GenError::OutOfRange {
                        path: "lane.slope_probe".to_string(),
                        what: "slope probe distance (1..=8)",
                        got: lane.slope_probe as f64,
                    });
                }
                let base = FieldProgram::compile(
                    &lane.base_height,
                    "lane.base_height",
                    world_seed,
                    dimension,
                    used_salts,
                )?;
                let mut relief = Vec::new();
                for layer in &lane.relief {
                    let gate = FieldProgram::compile(
                        &layer.gate,
                        &format!("lane.relief.{}.gate", layer.key),
                        world_seed,
                        dimension,
                        used_salts,
                    )?;
                    let lift = FieldProgram::compile(
                        &layer.lift,
                        &format!("lane.relief.{}.lift", layer.key),
                        world_seed,
                        dimension,
                        used_salts,
                    )?;
                    relief.push((layer.key.to_string(), gate, lift));
                }
                Ok(Self::Heightfield {
                    base,
                    relief,
                    slope_probe: lane.slope_probe,
                    min_y: 1,
                    max_y: height as i32 - 1,
                })
            }
            TopologySpec::Geology(geology) => {
                let Some(sea) = sea_level else {
                    return Err(GenError::Invalid {
                        path: "topology.geology".to_string(),
                        reason: "the geology lane requires hydrology.sea (the solve anchors on it)"
                            .to_string(),
                    });
                };
                if geology.ceiling_max >= (height as f64) - 1.0 {
                    return Err(GenError::Invalid {
                        path: "geology.ceiling_max".to_string(),
                        reason: format!(
                            "must stay below the dimension height {} (got {})",
                            height, geology.ceiling_max
                        ),
                    });
                }
                let model =
                    GeoModel::compile(geology, sea, world_seed, dimension, used_salts)?;
                Ok(Self::Geology {
                    model,
                    min_y: 1,
                    max_y: height as i32 - 1,
                })
            }
        }
    }

    pub fn geo(&self) -> Option<&GeoModel> {
        match self {
            Self::Geology { model, .. } => Some(model),
            Self::Heightfield { .. } => None,
        }
    }

    /// Raw lane height, before structure ground patches. Gates short-circuit
    /// their lift programs, preserving the gate-ordered laziness discipline.
    pub fn surface_raw(&self, x: i32, z: i32) -> i32 {
        let (min_y, max_y) = self.bounds();
        (self.surface_raw_f(x, z).round() as i32).clamp(min_y, max_y)
    }

    pub fn surface_raw_f(&self, x: i32, z: i32) -> f64 {
        match self {
            Self::Heightfield { base, relief, .. } => {
                let mut height = base.sample2(x, z);
                for (_, gate, lift) in relief {
                    let g = gate.sample2(x, z);
                    if g > 1e-9 {
                        height += g * lift.sample2(x, z);
                    }
                }
                height
            }
            Self::Geology { model, .. } => model.surface_f(x, z),
        }
    }

    /// Blocks-per-block relief slope by central differences over the raw
    /// height field.
    pub fn steepness(&self, x: i32, z: i32) -> f64 {
        let d = self.probe();
        let gx = (self.surface_raw_f(x + d, z) - self.surface_raw_f(x - d, z)).abs();
        let gz = (self.surface_raw_f(x, z + d) - self.surface_raw_f(x, z - d)).abs();
        (gx + gz) / (2.0 * d as f64)
    }

    /// Prefetches raw heights for `[min, max)` plus the probe halo.
    pub fn grid(&self, min: (i32, i32), max: (i32, i32)) -> LaneGrid {
        let probe = self.probe();
        let (min_y, max_y) = self.bounds();
        let min_x = min.0 - probe;
        let min_z = min.1 - probe;
        let span_x = (max.0 - min.0 + 2 * probe) as usize;
        let span_z = (max.1 - min.1 + 2 * probe) as usize;
        let mut heights = Vec::with_capacity(span_x * span_z);
        for ix in 0..span_x {
            for iz in 0..span_z {
                heights.push(self.surface_raw_f(min_x + ix as i32, min_z + iz as i32));
            }
        }
        LaneGrid {
            min_x,
            min_z,
            span_z,
            probe,
            min_y,
            max_y,
            heights,
        }
    }

    fn probe(&self) -> i32 {
        match self {
            Self::Heightfield { slope_probe, .. } => *slope_probe,
            Self::Geology { .. } => GEO_PROBE,
        }
    }

    fn bounds(&self) -> (i32, i32) {
        match self {
            Self::Heightfield { min_y, max_y, .. } | Self::Geology { min_y, max_y, .. } => {
                (*min_y, *max_y)
            }
        }
    }
}
