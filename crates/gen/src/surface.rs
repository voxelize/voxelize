//! Surface rules: a thin, ordered material layer walked from the surface
//! down. Tables are compiled per biome; per-voxel evaluation is integer
//! compares over prefetched per-column context. Every table must end in an
//! unconditional rule — there is no implicit filler block.

use serde::Serialize;

use crate::field::{FieldGraph, FieldProgram};
use crate::spec::GenError;

#[derive(Debug, Clone, Serialize)]
pub struct SurfaceSpec {
    pub tables: Vec<(&'static str, SurfaceTable)>,
    /// Shared patch fields referenced by `FieldWindow` conditions.
    pub patch_fields: Vec<(&'static str, FieldGraph)>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SurfaceTable {
    pub rules: Vec<SurfaceRule>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SurfaceRule {
    pub when: Vec<SurfaceCond>,
    pub place: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub enum SurfaceCond {
    DepthBelowTop { min: u16, max: u16 },
    YRange { min: i32, max: i32 },
    IsUnderFluid,
    IsAboveFluid,
    /// Column steepness at or above `min` blocks-per-block.
    Steepness { min: f64 },
    /// Column steepness strictly below `max`; combined with `Steepness`
    /// this windows a band — scree between meadow and cliff face.
    SteepnessBelow { max: f64 },
    FieldWindow { field: &'static str, low: f64, high: f64 },
}

pub(crate) struct CompiledSurface {
    tables: Vec<CompiledTable>,
    table_keys: Vec<&'static str>,
    pub patch_programs: Vec<FieldProgram>,
    pub max_depth: u16,
}

struct CompiledTable {
    rules: Vec<CompiledRule>,
}

struct CompiledRule {
    when: Vec<CompiledCond>,
    place: u32,
}

enum CompiledCond {
    Depth { min: u16, max: u16 },
    YRange { min: i32, max: i32 },
    IsUnderFluid,
    IsAboveFluid,
    Steepness { min: f64 },
    SteepnessBelow { max: f64 },
    FieldWindow { field: usize, low: f64, high: f64 },
}

/// Per-column inputs the rule walk reads; computed once per column by the
/// surface stage.
pub(crate) struct SurfaceColumnCtx {
    pub steepness: f64,
    pub is_under_fluid: bool,
    pub patch_values: smallvec::SmallVec<[f64; 4]>,
}

impl CompiledSurface {
    pub fn compile(
        spec: &SurfaceSpec,
        resolve_block: &dyn Fn(&str) -> Result<u32, GenError>,
        world_seed: u32,
        dimension: &str,
        used_salts: &mut hashbrown::HashSet<&'static str>,
    ) -> Result<Self, GenError> {
        let mut patch_programs = Vec::new();
        let mut patch_keys = Vec::new();
        for (key, graph) in &spec.patch_fields {
            patch_programs.push(FieldProgram::compile(
                graph,
                &format!("surface.patch.{key}"),
                world_seed,
                dimension,
                used_salts,
            )?);
            patch_keys.push(*key);
        }

        let mut tables = Vec::new();
        let mut table_keys = Vec::new();
        let mut max_depth: u16 = 1;
        for (key, table) in &spec.tables {
            if table_keys.contains(key) {
                return Err(GenError::DuplicateSurfaceTable { key: key.to_string() });
            }
            if table.rules.is_empty() {
                return Err(GenError::SurfaceTableNotExhaustive { key: key.to_string() });
            }
            let last = table.rules.last().expect("nonempty");
            if !last.when.is_empty() {
                return Err(GenError::SurfaceTableNotExhaustive { key: key.to_string() });
            }
            let mut rules = Vec::new();
            for rule in &table.rules {
                let mut when = Vec::new();
                for cond in &rule.when {
                    when.push(match cond {
                        SurfaceCond::DepthBelowTop { min, max } => {
                            if max < min {
                                return Err(GenError::OutOfRange {
                                    path: format!("surface.{key}"),
                                    what: "depth range",
                                    got: *max as f64,
                                });
                            }
                            max_depth = max_depth.max(max + 1);
                            CompiledCond::Depth { min: *min, max: *max }
                        }
                        SurfaceCond::YRange { min, max } => CompiledCond::YRange { min: *min, max: *max },
                        SurfaceCond::IsUnderFluid => CompiledCond::IsUnderFluid,
                        SurfaceCond::IsAboveFluid => CompiledCond::IsAboveFluid,
                        SurfaceCond::Steepness { min } => CompiledCond::Steepness { min: *min },
                        SurfaceCond::SteepnessBelow { max } => {
                            CompiledCond::SteepnessBelow { max: *max }
                        }
                        SurfaceCond::FieldWindow { field, low, high } => {
                            let index = patch_keys.iter().position(|k| k == field).ok_or_else(|| {
                                GenError::UnknownPatchField {
                                    field: field.to_string(),
                                }
                            })?;
                            CompiledCond::FieldWindow {
                                field: index,
                                low: *low,
                                high: *high,
                            }
                        }
                    });
                }
                rules.push(CompiledRule {
                    when,
                    place: resolve_block(rule.place)?,
                });
            }
            tables.push(CompiledTable { rules });
            table_keys.push(*key);
        }

        Ok(Self {
            tables,
            table_keys,
            patch_programs,
            max_depth,
        })
    }

    pub fn table_index(&self, key: &str) -> Option<usize> {
        self.table_keys.iter().position(|k| *k == key)
    }

    pub fn place(&self, table: usize, depth: u16, y: i32, ctx: &SurfaceColumnCtx) -> u32 {
        for rule in &self.tables[table].rules {
            let mut is_match = true;
            for cond in &rule.when {
                let holds = match cond {
                    CompiledCond::Depth { min, max } => depth >= *min && depth <= *max,
                    CompiledCond::YRange { min, max } => y >= *min && y <= *max,
                    CompiledCond::IsUnderFluid => ctx.is_under_fluid,
                    CompiledCond::IsAboveFluid => !ctx.is_under_fluid,
                    CompiledCond::Steepness { min } => ctx.steepness >= *min,
                    CompiledCond::SteepnessBelow { max } => ctx.steepness < *max,
                    CompiledCond::FieldWindow { field, low, high } => {
                        let v = ctx.patch_values[*field];
                        v >= *low && v <= *high
                    }
                };
                if !holds {
                    is_match = false;
                    break;
                }
            }
            if is_match {
                return rule.place;
            }
        }
        unreachable!("surface tables are validated exhaustive at compile")
    }
}
