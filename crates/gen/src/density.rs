//! The 3D density spine: genuine positive-density terrain, not a
//! heightfield plus void carvers. Solidity inside a bounded band around
//! the lane surface follows
//!
//! `density(x, y, z) = (surface(x, z) - y) + amplitude * mask(x, z) * d3(x, y, z)`
//!
//! so a positive 3D term grows solid *above* the surface line (overhang
//! lips, arch spans over notches, shelf noses) and a negative term bites
//! *below* it (undercuts, wave notches, recessed soft strata) — while
//! everything outside the band keeps its 2D verdict untouched. Restraint
//! is structural: the term is bounded by `amplitude`, engaged only where
//! the authored 2D candidacy mask opens (cliff bands, rocky coasts, thin
//! crests — content decides from slope, rock exposure, and its own
//! fields), silenced around structures, and silenced below the waterline
//! outside the coastal notch band. Caves and aquifers stay carver-owned.
//!
//! All 3D sampling goes through the same world-anchored trilinear
//! lattices the carvers use, so neighboring chunks interpolate identical
//! values and the band is seam-free by construction.

use serde::Serialize;

use crate::carve::DensityLattice;
use crate::field::{FieldGraph, FieldProgram};
use crate::noise::{Fractal, NoiseKind};
use crate::spec::GenError;
use crate::stream::{hash_unit, mix64, stream_seed, SaltPath, Subsystem};

#[derive(Debug, Clone, Serialize)]
pub struct DensitySpec {
    pub salt: SaltPath,
    /// Maximum |3D contribution| in blocks (1..=8): the band half-width.
    /// Small amplitudes are the point — ledges and brows, not floating
    /// islands.
    pub amplitude: f64,
    pub frequency: f64,
    /// 3D fractal octaves (1..=4).
    pub octaves: u8,
    /// Vertical frequency squash: values below 1 stretch features
    /// vertically, favoring brows and notches over spheres.
    pub y_squash: f64,
    /// Per-column candidacy in 0..1: where the 3D term may engage at
    /// all. Authored from slope, rock exposure, crest thinness — the
    /// engine multiplies, content decides.
    pub mask: FieldGraph,
    /// Horizontal strata bias: resistant layers protrude into shelves
    /// and ledges, soft layers recess into undercuts.
    pub strata: Option<DensityStrata>,
    /// Blocks below the waterline the term may still engage (coastal
    /// wave notches on steep shores). Zero silences all underwater work.
    pub coastal_notch: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct DensityStrata {
    /// Layer thickness in blocks (>= 2).
    pub period: f64,
    /// Bias share in 0..=1 relative to the 3D noise term.
    pub contrast: f64,
}

pub struct CompiledDensity {
    field: Fractal,
    mask: FieldProgram,
    amplitude: f64,
    y_squash: f64,
    strata: Option<(f64, f64)>,
    strata_seed: u64,
    coastal_notch: i32,
    /// 1 / (1 + contrast): folds noise plus strata back into -1..1.
    norm: f64,
}

impl CompiledDensity {
    pub fn compile(
        spec: &DensitySpec,
        world_seed: u32,
        dimension: &str,
        used_salts: &mut hashbrown::HashSet<&'static str>,
    ) -> Result<Self, GenError> {
        crate::spec::claim_salt(&spec.salt, used_salts)?;
        if !(1.0..=8.0).contains(&spec.amplitude) {
            return Err(GenError::OutOfRange {
                path: "density.amplitude".to_string(),
                what: "band half-width (1..=8 blocks)",
                got: spec.amplitude,
            });
        }
        if spec.frequency <= 0.0 || !spec.frequency.is_finite() {
            return Err(GenError::OutOfRange {
                path: "density.frequency".to_string(),
                what: "3D noise frequency",
                got: spec.frequency,
            });
        }
        if spec.octaves == 0 || spec.octaves > 4 {
            return Err(GenError::OutOfRange {
                path: "density.octaves".to_string(),
                what: "3D noise octaves (1..=4)",
                got: spec.octaves as f64,
            });
        }
        if spec.y_squash <= 0.0 || !spec.y_squash.is_finite() {
            return Err(GenError::OutOfRange {
                path: "density.y_squash".to_string(),
                what: "vertical squash (positive)",
                got: spec.y_squash,
            });
        }
        if spec.coastal_notch < 0 {
            return Err(GenError::OutOfRange {
                path: "density.coastal_notch".to_string(),
                what: "coastal notch band (>= 0 blocks)",
                got: spec.coastal_notch as f64,
            });
        }
        let strata = match &spec.strata {
            Some(strata) => {
                if strata.period < 2.0 || !(0.0..=1.0).contains(&strata.contrast) {
                    return Err(GenError::Invalid {
                        path: "density.strata".to_string(),
                        reason: "needs period >= 2 and contrast within 0..=1".to_string(),
                    });
                }
                Some((strata.period, strata.contrast))
            }
            None => None,
        };
        let seed = stream_seed(world_seed, dimension, Subsystem::Fields, &spec.salt, 0);
        let mask = FieldProgram::compile(
            &spec.mask,
            "density.mask",
            world_seed,
            dimension,
            used_salts,
        )?;
        let contrast = strata.map(|(_, c)| c).unwrap_or(0.0);
        Ok(Self {
            field: Fractal::new(
                mix64(seed ^ 0xd3),
                spec.frequency,
                spec.octaves,
                0.5,
                2.0,
                NoiseKind::Fbm,
            ),
            mask,
            amplitude: spec.amplitude,
            y_squash: spec.y_squash,
            strata,
            strata_seed: mix64(seed ^ 0x57a7),
            coastal_notch: spec.coastal_notch,
            norm: 1.0 / (1.0 + contrast),
        })
    }

    /// Band half-width in whole blocks: outside `surface ± band` the 2D
    /// verdict stands and no 3D sampling happens.
    pub fn band(&self) -> i32 {
        self.amplitude.ceil() as i32
    }

    /// Column candidacy in 0..1; a zero skips the column's band entirely.
    pub fn mask_at(&self, x: i32, z: i32) -> f64 {
        self.mask.sample2(x, z).clamp(0.0, 1.0)
    }

    /// World-anchored trilinear lattice over the chunk band, sampled at
    /// the same 4-block stride the carvers use.
    pub fn build_lattice(&self, min: (i32, i32, i32), max: (i32, i32, i32)) -> DensityLattice {
        let squash = self.y_squash;
        let field = self.field.clone();
        DensityLattice::build(min, max, move |x, y, z| {
            field.sample3(x as f64, y as f64 * squash, z as f64)
        })
    }

    /// Horizontal strata bias in -contrast..contrast: constant within a
    /// layer, so resistant layers protrude as ledges along their whole
    /// outcrop and soft layers recess.
    fn strata_bias(&self, y: i32) -> f64 {
        let Some((period, contrast)) = self.strata else {
            return 0.0;
        };
        let layer = (y as f64 / period).floor() as i64;
        (hash_unit(mix64(self.strata_seed ^ mix64(layer as u64))) * 2.0 - 1.0) * contrast
    }

    /// The signed 3D contribution in blocks at one voxel, before the
    /// waterline gate: `amplitude * mask * (noise + strata) / (1 + contrast)`.
    fn contribution(&self, lattice: &DensityLattice, x: i32, y: i32, z: i32, mask: f64) -> f64 {
        self.amplitude * mask * (lattice.sample(x, y, z) + self.strata_bias(y)) * self.norm
    }

    /// Solid verdict for one voxel in the band. `surface` is the lane
    /// surface (structure-adapted), `mask` the column candidacy — pass 0
    /// to silence the term (structure footprints). Outside the band the
    /// answer is the 2D verdict by construction.
    pub fn is_solid(
        &self,
        lattice: &DensityLattice,
        x: i32,
        y: i32,
        z: i32,
        surface: i32,
        mask: f64,
        sea_level: Option<i32>,
    ) -> bool {
        let relief = (surface - y) as f64;
        if relief >= self.amplitude {
            return true;
        }
        if relief <= -self.amplitude || mask <= 0.0 {
            return relief > 0.0;
        }
        if let Some(sea) = sea_level {
            if y < sea - self.coastal_notch {
                return relief > 0.0;
            }
        }
        relief + self.contribution(lattice, x, y, z, mask) > 0.0
    }

    /// Topmost solid y of a column within the band: where flora roots
    /// and probes stand. Above `surface + band` is always air, so the
    /// scan is bounded.
    pub fn top_solid(
        &self,
        lattice: &DensityLattice,
        x: i32,
        z: i32,
        surface: i32,
        mask: f64,
        sea_level: Option<i32>,
    ) -> i32 {
        let band = self.band();
        for y in ((surface - band)..=(surface + band)).rev() {
            if self.is_solid(lattice, x, y, z, surface, mask, sea_level) {
                return y;
            }
        }
        surface - band
    }

    /// `top_solid` with a minimal single-column lattice: world-anchored
    /// strides make its values identical to any chunk lattice covering
    /// the same column, so sparse callers (tree roots, probes) agree with
    /// the shape stage exactly.
    pub fn top_solid_at(
        &self,
        x: i32,
        z: i32,
        surface: i32,
        mask: f64,
        sea_level: Option<i32>,
    ) -> i32 {
        let band = self.band();
        let lattice = self.build_lattice(
            (x, surface - band, z),
            (x + 1, surface + band + 1, z + 1),
        );
        self.top_solid(&lattice, x, z, surface, mask, sea_level)
    }
}
