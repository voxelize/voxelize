//! `surface_rules`: per-biome paint tables walked down from the top.
//!
//! Each biome owns a list of rules; at every depth below the top the first
//! rule whose conditions all hold places its role there. Depths no rule
//! claims keep what is under them (the fill, or an earlier surfacer's
//! paint), so a table need not be exhaustive. The walk goes as deep as the
//! deepest `Depth` condition in the table.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::climate::BiomeId;
use crate::landscape::spec::{Height, SpecError, Validate, Validator};
use crate::landscape::surface::{KeptRef, MaterialRuns, PaintColumn, PaintCtx, Surfacer, ZoneKey};

/// One paint condition.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum PaintCondM {
    /// Depth below the top, inclusive (the top voxel is depth 0).
    Depth {
        /// Shallowest.
        min: u16,
        /// Deepest.
        max: u16,
    },
    /// The voxel's y within `[min, max]`.
    Y {
        /// Lowest.
        min: Height,
        /// Highest.
        max: Height,
    },
    /// The column's top lies under water.
    UnderWater,
    /// The column's top is dry.
    AboveWater,
    /// Water over the top, in blocks, within `[min, max]`.
    WaterDepth {
        /// Shallowest.
        min: i32,
        /// Deepest.
        max: i32,
    },
    /// Slope within `[min, max)`.
    Slope {
        /// Lower bound.
        min: f64,
        /// Upper bound (exclusive).
        max: f64,
    },
    /// Curvature within `[min, max)`.
    Curvature {
        /// Lower bound.
        min: f64,
        /// Upper bound (exclusive).
        max: f64,
    },
    /// The downhill aspect's dot product with `dir` at least `min_dot`.
    Aspect {
        /// A direction (normalized here).
        dir: (f64, f64),
        /// Least dot product.
        min_dot: f64,
    },
    /// Temperature within `[min, max)`.
    Temperature {
        /// Lower bound.
        min: f64,
        /// Upper bound (exclusive).
        max: f64,
    },
    /// Moisture within `[min, max)`.
    Moisture {
        /// Lower bound.
        min: f64,
        /// Upper bound (exclusive).
        max: f64,
    },
    /// A kept field within `[min, max)`.
    Field {
        /// Field name (`keep: true`).
        field: String,
        /// Lower bound.
        min: f64,
        /// Upper bound (exclusive).
        max: f64,
    },
    /// The column's zone.
    Zone(String),
    /// A hash roll per voxel below `chance` (salted).
    Speckle {
        /// Its salt.
        salt: String,
        /// Probability.
        chance: f64,
    },
}

/// One rule: conditions and the role placed.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaintRuleM {
    /// Every condition must hold.
    pub when: Vec<PaintCondM>,
    /// The role placed.
    pub place: String,
}

/// Params of `surface_rules`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SurfaceRulesParams {
    /// Tables by biome key.
    pub tables: BTreeMap<String, Vec<PaintRuleM>>,
    /// The table of biomes without one of their own.
    pub default: Vec<PaintRuleM>,
}

impl Validate for SurfaceRulesParams {
    fn validate(&self, v: &mut Validator) {
        let all = self
            .tables
            .iter()
            .map(|(k, t)| (format!("tables.{k}"), t))
            .chain(std::iter::once(("default".to_string(), &self.default)));
        for (path, table) in all {
            for (i, rule) in table.iter().enumerate() {
                for (j, cond) in rule.when.iter().enumerate() {
                    let at = format!("{path}.{i}.when.{j}");
                    match cond {
                        PaintCondM::Depth { min, max } => v.check(
                            &at,
                            min <= max && *max <= 64,
                            "depth needs min <= max <= 64",
                        ),
                        PaintCondM::Speckle { chance, .. } => v.unit(&at, *chance),
                        PaintCondM::Slope { min, max }
                        | PaintCondM::Curvature { min, max }
                        | PaintCondM::Temperature { min, max }
                        | PaintCondM::Moisture { min, max }
                        | PaintCondM::Field { min, max, .. } => v.ordered(&at, (*min, *max)),
                        PaintCondM::WaterDepth { min, max } => {
                            v.check(&at, min <= max, "water depth needs min <= max")
                        }
                        _ => {}
                    }
                }
            }
        }
    }
}

enum Cond {
    Depth(i32, i32),
    Y(i32, i32),
    UnderWater,
    AboveWater,
    WaterDepth(i32, i32),
    Slope(f64, f64),
    Curvature(f64, f64),
    Aspect([f64; 2], f64),
    Temperature(f64, f64),
    Moisture(f64, f64),
    Field(KeptRef, f64, f64),
    Zone(ZoneKey),
    Speckle(u64, f64),
}

struct Rule {
    when: Vec<Cond>,
    place: Option<u32>,
}

struct Table {
    rules: Vec<Rule>,
    max_depth: i32,
}

/// Per-biome paint tables.
pub struct SurfaceRules {
    tables: Vec<Table>,
    by_biome: Vec<usize>,
}

fn lower_table(
    cx: &mut PaintCtx<'_>,
    path: &str,
    rules: &[PaintRuleM],
) -> Result<Table, SpecError> {
    let mut out = Vec::new();
    let mut max_depth = 0;
    for (i, rule) in rules.iter().enumerate() {
        let mut when = Vec::new();
        for (j, cond) in rule.when.iter().enumerate() {
            let at = format!("{path}.{i}.when.{j}");
            when.push(match cond {
                PaintCondM::Depth { min, max } => {
                    max_depth = Ord::max(max_depth, *max as i32);
                    Cond::Depth(*min as i32, *max as i32)
                }
                PaintCondM::Y { min, max } => {
                    let f = cx.frame();
                    Cond::Y(
                        f.resolve(*min).floor() as i32,
                        f.resolve(*max).floor() as i32,
                    )
                }
                PaintCondM::UnderWater => Cond::UnderWater,
                PaintCondM::AboveWater => Cond::AboveWater,
                PaintCondM::WaterDepth { min, max } => Cond::WaterDepth(*min, *max),
                PaintCondM::Slope { min, max } => Cond::Slope(*min, *max),
                PaintCondM::Curvature { min, max } => Cond::Curvature(*min, *max),
                PaintCondM::Aspect { dir, min_dot } => {
                    let n = (dir.0 * dir.0 + dir.1 * dir.1).sqrt();
                    if !(n > 0.0) {
                        return Err(SpecError::new(
                            format!("{}.{at}", cx.path()),
                            "aspect direction must be non-zero",
                        ));
                    }
                    Cond::Aspect([dir.0 / n, dir.1 / n], *min_dot)
                }
                PaintCondM::Temperature { min, max } => Cond::Temperature(*min, *max),
                PaintCondM::Moisture { min, max } => Cond::Moisture(*min, *max),
                PaintCondM::Field { field, min, max } => {
                    Cond::Field(cx.field(&at, field)?, *min, *max)
                }
                PaintCondM::Zone(key) => Cond::Zone(cx.zone(&at, key)?),
                PaintCondM::Speckle { salt, chance } => {
                    Cond::Speckle(cx.hash_seed(&at, salt)?, *chance)
                }
            });
        }
        let place = cx.role(&format!("{path}.{i}.place"), &rule.place)?;
        out.push(Rule { when, place });
    }
    Ok(Table {
        rules: out,
        max_depth,
    })
}

impl Surfacer for SurfaceRules {
    const KIND: &'static str = "surface_rules";
    const VERSION: u32 = 1;
    type Params = SurfaceRulesParams;

    fn build(params: Self::Params, cx: &mut PaintCtx<'_>) -> Result<Self, SpecError> {
        let biomes: Vec<String> = cx.biome_keys().to_vec();
        for key in params.tables.keys() {
            cx.biome(&format!("tables.{key}"), key)?;
        }
        let mut tables = vec![lower_table(cx, "default", &params.default)?];
        let mut by_biome = vec![0usize; biomes.len()];
        for (key, rules) in &params.tables {
            let id: BiomeId = cx.biome(&format!("tables.{key}"), key)?;
            tables.push(lower_table(cx, &format!("tables.{key}"), rules)?);
            by_biome[id.0 as usize] = tables.len() - 1;
        }
        Ok(Self { tables, by_biome })
    }

    fn paint(&self, col: &PaintColumn<'_>, runs: &mut MaterialRuns) {
        let table = &self.tables[self.by_biome[col.biome.0 as usize]];
        let water_depth = col.water_depth();
        let under = col.under_water();
        for d in 0..=table.max_depth {
            let y = col.top - d;
            if y < 0 {
                break;
            }
            for rule in &table.rules {
                let holds = rule.when.iter().all(|c| match *c {
                    Cond::Depth(lo, hi) => d >= lo && d <= hi,
                    Cond::Y(lo, hi) => y >= lo && y <= hi,
                    Cond::UnderWater => under,
                    Cond::AboveWater => !under,
                    Cond::WaterDepth(lo, hi) => water_depth >= lo && water_depth <= hi,
                    Cond::Slope(lo, hi) => col.slope >= lo && col.slope < hi,
                    Cond::Curvature(lo, hi) => col.curvature >= lo && col.curvature < hi,
                    Cond::Aspect(dir, min) => {
                        col.aspect[0] * dir[0] + col.aspect[1] * dir[1] >= min
                    }
                    Cond::Temperature(lo, hi) => col.temperature >= lo && col.temperature < hi,
                    Cond::Moisture(lo, hi) => col.moisture >= lo && col.moisture < hi,
                    Cond::Field(f, lo, hi) => {
                        let v = col.field(f);
                        v >= lo && v < hi
                    }
                    Cond::Zone(z) => col.zone == z,
                    Cond::Speckle(seed, chance) => col.hash(seed, y) < chance,
                });
                if holds {
                    if let Some(b) = rule.place {
                        runs.set(y, y, b);
                    }
                    break;
                }
            }
        }
    }
}
