//! Topology lanes: the dimension's shape archetype. The heightfield lane
//! implements continents, oceans, and mountains; slab-cavern and
//! island-field lanes extend this enum — dimension identity never branches
//! inside generation code.

use serde::Serialize;

use crate::field::{FieldGraph, FieldProgram};
use crate::spec::GenError;

#[derive(Debug, Clone, Serialize)]
pub enum TopologySpec {
    Heightfield(HeightfieldLane),
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

pub(crate) struct CompiledLane {
    base: FieldProgram,
    relief: Vec<(String, FieldProgram, FieldProgram)>,
    slope_probe: i32,
    min_y: i32,
    max_y: i32,
}

/// Raw lane heights prefetched over a chunk footprint plus the slope-probe
/// halo. Values are bit-identical to direct lane sampling — the grid only
/// removes the 5x re-evaluation per column that surface + steepness
/// probing would otherwise cost, which matters once base stacks carry many
/// octaves.
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
        world_seed: u32,
        dimension: &str,
        used_salts: &mut hashbrown::HashSet<&'static str>,
    ) -> Result<Self, GenError> {
        let TopologySpec::Heightfield(lane) = spec;
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
        Ok(Self {
            base,
            relief,
            slope_probe: lane.slope_probe,
            min_y: 1,
            max_y: height as i32 - 1,
        })
    }

    /// Raw lane height, before structure ground patches. Gates short-circuit
    /// their lift programs, preserving the gate-ordered laziness discipline.
    pub fn surface_raw(&self, x: i32, z: i32) -> i32 {
        (self.surface_raw_f(x, z).round() as i32).clamp(self.min_y, self.max_y)
    }

    pub fn surface_raw_f(&self, x: i32, z: i32) -> f64 {
        let mut height = self.base.sample2(x, z);
        for (_, gate, lift) in &self.relief {
            let g = gate.sample2(x, z);
            if g > 1e-9 {
                height += g * lift.sample2(x, z);
            }
        }
        height
    }

    /// Blocks-per-block relief slope by central differences over the raw
    /// height field.
    pub fn steepness(&self, x: i32, z: i32) -> f64 {
        let d = self.slope_probe;
        let gx = (self.surface_raw_f(x + d, z) - self.surface_raw_f(x - d, z)).abs();
        let gz = (self.surface_raw_f(x, z + d) - self.surface_raw_f(x, z - d)).abs();
        (gx + gz) / (2.0 * d as f64)
    }

    /// Prefetches raw heights for `[min, max)` plus the probe halo.
    pub fn grid(&self, min: (i32, i32), max: (i32, i32)) -> LaneGrid {
        let probe = self.slope_probe;
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
            min_y: self.min_y,
            max_y: self.max_y,
            heights,
        }
    }
}
