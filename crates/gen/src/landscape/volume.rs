//! Volume: province plumbing and the direct evaluator.
//!
//! The volume model is a heightfield everywhere, with density only inside
//! declared y bands on the columns that hold province entries, faded at
//! the band's floor and ceiling and by each entry's weight (its owner's
//! `edge · exclusion`). With `d_hf(y) = ground + 0.5 − y`, entry weight
//! `w_i`, band fade `f_i(y)` over `b = TasteGuards::min_band_fade`,
//! `u_i = w_i · f_i(y)` and `F_i` the province's fade depth:
//!
//! - **Refine**: `d = d_hf + Σ u_i · (1 − N_i) · (d_i − d_hf)`, with `N_i`
//!   the NO_BANDS weight when its owner composes before entry `i`;
//! - **Add**: `d_add = max_i (u_i · d_i − (1 − u_i) · F_i)`;
//! - **Carve**: `c_i' = v_i · c_i − (1 − v_i) · F_i` with
//!   `v_i = u_i · (1 − NC) · (1 − R_i) · smoothstep(0, 4, ceiling − y)`, `NC`
//!   the NO_CAVES weight and `R_i` the ROCK weight when another node owns
//!   it;
//! - a voxel is solid when `max(d, d_add) > 0` or a span holds it, and not
//!   `max_i c_i' > 0`; a span writes its block only where the heightfield
//!   is air (painted ground stays painted).
//!
//! This build evaluates every entry directly at every voxel of its band.
//! The world-aligned lattice set, exact culling, painting of band faces
//! and the water seal arrive with the volume pass proper; the formulas
//! above are its contract and stay.

use std::any::Any;

use super::compose::{ClaimEntry, Claims, ProvinceEntry, SolidSpan};
use super::math::{smoothstep, MinMax};
use super::plugin::{Effect, LatticeView, Province, VoxelAt};

/// A province behind a pointer.
pub(crate) trait DynProvince: Send + Sync {
    fn density_any(&self, p: &dyn Any, at: VoxelAt) -> f64;
    fn fade_depth(&self) -> f64;
}

impl<P: Province> DynProvince for P {
    fn density_any(&self, p: &dyn Any, at: VoxelAt) -> f64 {
        let p = p
            .downcast_ref::<P::Params>()
            .expect("province params match their province");
        self.density(p, at, &LatticeView::empty())
    }
    fn fade_depth(&self) -> f64 {
        Province::fade_depth(self)
    }
}

/// A registered province.
pub(crate) struct ProvinceRt {
    pub kind: &'static str,
    pub version: u32,
    pub effect: Effect,
    pub owner: u16,
    pub imp: Box<dyn DynProvince>,
}

/// The volume of one column: what the writer changes against the
/// heightfield.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum VoxelChange {
    /// Solid where the heightfield is air (fill it).
    Solid,
    /// Air where the heightfield is solid (carve it).
    Air,
    /// A span's block.
    Span(u32),
}

/// Evaluate the column's spans and province entries over `[ylo, yhi]`
/// against continuous ground `ground` (heightfield solid where
/// `ground + 0.5 − y > 0`), calling `out(y, change)` for every voxel that
/// differs from the heightfield.
#[allow(clippy::too_many_arguments)]
pub(crate) fn column_volume(
    x: i32,
    z: i32,
    ground: f64,
    spans: &[SolidSpan],
    entries: &[&ProvinceEntry],
    provinces: &[ProvinceRt],
    claims: &[ClaimEntry],
    cave_ceiling: i32,
    band_fade: f64,
    height: i32,
    out: &mut dyn FnMut(i32, VoxelChange),
) {
    let mut lo = i32::MAX;
    let mut hi = i32::MIN;
    for s in spans {
        lo = Ord::min(lo, s.lo);
        hi = Ord::max(hi, s.hi);
    }
    for e in entries {
        lo = Ord::min(lo, e.lo);
        hi = Ord::max(hi, e.hi);
    }
    if lo > hi {
        return;
    }
    let lo = Ord::max(lo, 0);
    let hi = Ord::min(hi, height - 1);
    let weight_of = |bit: Claims| -> Option<&ClaimEntry> {
        let b = bit.0.trailing_zeros() as u8;
        claims.iter().find(|c| c.bit == b)
    };
    let no_bands = weight_of(Claims::NO_BANDS);
    let no_caves = weight_of(Claims::NO_CAVES).map_or(0.0, |c| c.weight as f64);
    let rock = weight_of(Claims::ROCK);
    let b = band_fade.fmax(1e-6);
    for y in lo..=hi {
        let yf = y as f64;
        let d_hf = ground + 0.5 - yf;
        let at = VoxelAt::new(x, y, z);
        let mut d = d_hf;
        let mut d_add = f64::NEG_INFINITY;
        let mut carve = f64::NEG_INFINITY;
        for e in entries {
            if y < e.lo || y > e.hi {
                continue;
            }
            let fade = smoothstep(e.lo as f64, e.lo as f64 + b, yf)
                * (1.0 - smoothstep(e.hi as f64 - b, e.hi as f64, yf));
            let u = e.weight as f64 * fade;
            if !(u > 0.0) {
                continue;
            }
            let p = &provinces[e.slot as usize];
            let di = p.imp.density_any(&*e.params, at);
            let depth = p.imp.fade_depth();
            match p.effect {
                Effect::Refine => {
                    let n = match no_bands {
                        Some(c) if c.owner < e.owner => c.weight as f64,
                        _ => 0.0,
                    };
                    d += u * (1.0 - n) * (di - d_hf);
                }
                Effect::Add => {
                    d_add = d_add.fmax(u * di - (1.0 - u) * depth);
                }
                Effect::Carve => {
                    let r = match rock {
                        Some(c) if c.owner != e.owner => c.weight as f64,
                        _ => 0.0,
                    };
                    let ceiling = if cave_ceiling == i32::MAX {
                        1.0
                    } else {
                        smoothstep(0.0, 4.0, cave_ceiling as f64 - yf)
                    };
                    let v = u * (1.0 - no_caves) * (1.0 - r) * ceiling;
                    carve = carve.fmax(v * di - (1.0 - v) * depth);
                }
            }
        }
        let span = spans.iter().rev().find(|s| y >= s.lo && y <= s.hi);
        let dense = d.fmax(d_add) > 0.0;
        let solid = (dense || span.is_some()) && !(carve > 0.0);
        let hf_solid = d_hf > 0.0;
        match (hf_solid, solid) {
            (false, true) => match span {
                Some(s) if !dense => out(y, VoxelChange::Span(s.block)),
                _ => out(y, VoxelChange::Solid),
            },
            (true, false) => out(y, VoxelChange::Air),
            // Painted ground stays painted where a span overlaps it.
            (true, true) | (false, false) => {}
        }
    }
}
