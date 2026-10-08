//! `ecotones`: snow, the rock line, cliff rock and talus, by climate and
//! slope, with ragged edges.
//!
//! Every edge is broken twice: by a patch field (tens of blocks, so a
//! snowline wanders in tongues) and by a per-voxel hash only within a
//! narrow transition (so it frays without speckling the open ground).
//! Applied in this order, so snow (last) caps what lies under it:
//!
//! - talus where the slope sits in a window and the patch field opens;
//! - cliff rock where `smoothstep(lo, hi, slope)` beats `0.5 + gain * patch`;
//! - the rock line: above a height (± hash and patch), rock replaces soil;
//! - snow: `score = snow_temp - (temperature + patch_gain * patch +
//!   slope_gain * slope)`; full cover at `score >= full`, otherwise a hash
//!   roll with probability `score / full`.
//!
//! Columns under water are left to the paint tables.

use serde::{Deserialize, Serialize};

use crate::landscape::math::smoothstep;
use crate::landscape::spec::{Height, Size, SpecError, Validate, Validator};
use crate::landscape::surface::{MaterialRuns, PaintColumn, PaintCtx, PatchNoise, Surfacer};

/// The patch field every edge wanders by.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatchM {
    /// Its salt.
    pub salt: String,
    /// Its wavelength.
    pub wavelength: Size,
}

/// Snow cover.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SnowM {
    /// Snow role.
    pub role: String,
    /// Temperature at which snow starts.
    pub temperature: f64,
    /// Score at which cover is full (the fraying band's width).
    pub full: f64,
    /// Patch gain on temperature.
    pub patch_gain: f64,
    /// Slope gain on temperature (steep ground sheds snow).
    pub slope_gain: f64,
    /// Depth of the cover in voxels (1 caps the top voxel).
    pub depth: u16,
}

/// Bare rock above a height.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RockLineM {
    /// Rock role.
    pub role: String,
    /// The line.
    pub above: Height,
    /// Hash jitter in blocks (±).
    pub jitter: f64,
    /// Patch amplitude in blocks (±).
    pub patch: f64,
    /// Depth of the bare rock.
    pub depth: u16,
}

/// Rock on steep faces.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CliffM {
    /// Rock role.
    pub role: String,
    /// The slope window of the smoothstep.
    pub slope: (f64, f64),
    /// Patch gain on the 0.5 threshold.
    pub patch_gain: f64,
    /// Depth of the rock skin.
    pub depth: u16,
}

/// Scree on mid slopes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TalusM {
    /// Scree role.
    pub role: String,
    /// The slope window `[lo, hi)`.
    pub slope: (f64, f64),
    /// Scree only where the patch field exceeds this.
    pub patch_above: f64,
    /// Depth of the scree.
    pub depth: u16,
}

/// Params of `ecotones`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EcotonesParams {
    /// The patch field.
    pub patch: PatchM,
    /// Salt of the fraying hash.
    pub hash_salt: String,
    /// Snow, if any.
    pub snow: Option<SnowM>,
    /// The rock line, if any.
    pub rock_line: Option<RockLineM>,
    /// Cliff rock, if any.
    pub cliff: Option<CliffM>,
    /// Talus, if any.
    pub talus: Option<TalusM>,
}

impl Validate for EcotonesParams {
    fn validate(&self, v: &mut Validator) {
        v.check(
            "patch.wavelength",
            self.patch.wavelength.raw() >= 16.0,
            "patch wavelength must be at least 16 blocks",
        );
        if let Some(s) = &self.snow {
            v.check("snow.full", s.full > 0.0, "full must be positive");
            v.check(
                "snow.depth",
                (1..=4).contains(&s.depth),
                "depth must be 1..=4",
            );
        }
        if let Some(c) = &self.cliff {
            v.check(
                "cliff.slope",
                c.slope.0 < c.slope.1,
                "slope window must be ordered",
            );
        }
        if let Some(t) = &self.talus {
            v.check(
                "talus.slope",
                t.slope.0 < t.slope.1,
                "slope window must be ordered",
            );
        }
    }
}

struct Snow {
    block: Option<u32>,
    m: SnowM,
}

struct RockLine {
    block: Option<u32>,
    y: f64,
    m: RockLineM,
}

struct Cliff {
    block: Option<u32>,
    m: CliffM,
}

struct Talus {
    block: Option<u32>,
    m: TalusM,
}

/// Snow, rock line, cliff rock and talus.
pub struct Ecotones {
    patch: PatchNoise,
    seed: u64,
    snow: Option<Snow>,
    rock_line: Option<RockLine>,
    cliff: Option<Cliff>,
    talus: Option<Talus>,
}

impl Surfacer for Ecotones {
    const KIND: &'static str = "ecotones";
    const VERSION: u32 = 1;
    type Params = EcotonesParams;

    fn build(p: Self::Params, cx: &mut PaintCtx<'_>) -> Result<Self, SpecError> {
        let patch = cx.patch("patch", &p.patch.salt, p.patch.wavelength, 3)?;
        let seed = cx.hash_seed("hash_salt", &p.hash_salt)?;
        let snow = match p.snow {
            Some(m) => Some(Snow {
                block: cx.role("snow.role", &m.role)?,
                m,
            }),
            None => None,
        };
        let rock_line = match p.rock_line {
            Some(m) => Some(RockLine {
                block: cx.role("rock_line.role", &m.role)?,
                y: cx.frame().resolve(m.above),
                m,
            }),
            None => None,
        };
        let cliff = match p.cliff {
            Some(m) => Some(Cliff {
                block: cx.role("cliff.role", &m.role)?,
                m,
            }),
            None => None,
        };
        let talus = match p.talus {
            Some(m) => Some(Talus {
                block: cx.role("talus.role", &m.role)?,
                m,
            }),
            None => None,
        };
        Ok(Self {
            patch,
            seed,
            snow,
            rock_line,
            cliff,
            talus,
        })
    }

    fn paint(&self, col: &PaintColumn<'_>, runs: &mut MaterialRuns) {
        if col.under_water() {
            return;
        }
        let p = self.patch.at(col.x, col.z);
        if let Some(t) = &self.talus {
            if let Some(b) = t.block {
                if col.slope >= t.m.slope.0 && col.slope < t.m.slope.1 && p > t.m.patch_above {
                    runs.set_depth(0, t.m.depth as i32 - 1, b);
                }
            }
        }
        if let Some(c) = &self.cliff {
            if let Some(b) = c.block {
                if smoothstep(c.m.slope.0, c.m.slope.1, col.slope) > 0.5 + c.m.patch_gain * p {
                    runs.set_depth(0, c.m.depth as i32 - 1, b);
                }
            }
        }
        if let Some(r) = &self.rock_line {
            if let Some(b) = r.block {
                let jitter = (col.hash(self.seed, 0) - 0.5) * 2.0 * r.m.jitter;
                if col.top as f64 >= r.y + jitter + r.m.patch * p {
                    runs.set_depth(0, r.m.depth as i32 - 1, b);
                }
            }
        }
        if let Some(s) = &self.snow {
            if let Some(b) = s.block {
                let score = s.m.temperature
                    - (col.temperature + s.m.patch_gain * p + s.m.slope_gain * col.slope);
                let covered =
                    score >= s.m.full || (score > 0.0 && col.hash(self.seed, 1) < score / s.m.full);
                if covered {
                    runs.set_depth(0, s.m.depth as i32 - 1, b);
                }
            }
        }
    }
}
