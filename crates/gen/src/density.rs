//! 3D density in the terrain spine: the heightfield stops being the
//! whole answer inside a bounded band around the surface, where a signed
//! density delta can push rock outward or bite it inward. Overhangs,
//! ledge roofs, wave-cut notches, and window arches become possible —
//! and only where geology justifies them.
//!
//! Two restrained terms compose the delta:
//!
//! - **Strata shelving** (`ShelfSpec`): a resistant/soft bed cycle,
//!   phase-warped so beds dip and swell, modulated by a squashed 3D
//!   strength field so each bed is a lens rather than an infinite slab.
//!   Resistant beds hold their edge and protrude; soft beds recede. On a
//!   steep face this reads as ledges and roofs; where a soft bed pierces
//!   a thin crest, a window. On gentle ground the slope gate holds the
//!   whole term at zero — meadows stay heightfield-exact.
//! - **Waterline notching** (`NotchSpec`): an inward cut just above the
//!   local waterline — sea, solved lakes, or river reaches — on steep
//!   banks, varying along the shore. Undercut coasts and cut banks, with
//!   arches where a notch meets shelving on a thin headland.
//!
//! Both terms engage only *above* the column's waterline, so submerged
//! ground keeps its closed heightfield form and water bodies stay
//! coherent. The delta is hard-clamped to `amp` and faded to zero at the
//! band edge; caves and every other void below remain the carvers'.
//! Everything is a pure function of absolute position and the world
//! seed: any chunk, thread, or tile order reproduces the same rock.

use serde::Serialize;

use crate::noise::{Fractal, NoiseKind};
use crate::stream::{stream_seed, SaltPath, Subsystem};

#[derive(Debug, Clone, Serialize)]
pub struct DensitySpec {
    pub salt: SaltPath,
    /// Vertical half-band around the surface, in blocks, where density
    /// may reshape the column. Outside it the heightfield stands.
    pub band: f64,
    /// Hard bound on the density delta magnitude, in blocks.
    pub amp: f64,
    pub shelf: Option<ShelfSpec>,
    pub notch: Option<NotchSpec>,
}

/// Strata-bed shelving: resistant beds protrude, soft beds recede.
#[derive(Debug, Clone, Serialize)]
pub struct ShelfSpec {
    /// Bed cycle thickness in blocks (one resistant + one soft).
    pub spacing: f64,
    /// Share of the cycle that is resistant, 0..1.
    pub resistant_share: f64,
    /// Bed-phase warp in blocks and its horizontal wavelength: beds dip
    /// and swell instead of tracing level lines.
    pub warp_amp: f64,
    pub warp_scale: f64,
    /// Horizontal wavelength of the 3D bed-strength lenses.
    pub lens_scale: f64,
    /// Vertical squash of the lens field (>1): beds are flat bodies.
    pub lens_squash: f64,
    /// Slope window where shelving engages.
    pub slope: (f64, f64),
    /// Outward reach of a resistant bed and inward recess of a soft
    /// bed, in blocks (before the lens and gate scale it).
    pub relief: f64,
}

/// Waterline undercutting on steep banks and coasts.
#[derive(Debug, Clone, Serialize)]
pub struct NotchSpec {
    /// Maximum inward cut in blocks.
    pub depth: f64,
    /// Vertical extent above the waterline the notch spans.
    pub height: f64,
    /// Slope window where the notch engages.
    pub slope: (f64, f64),
    /// Along-shore variation wavelength.
    pub scale: f64,
    /// River channels within this reach put their water level on the
    /// column's waterline.
    pub river_reach: f64,
}

/// Per-column facts the stages gather once (2D) so the per-voxel test
/// stays cheap: the engage gates and the local waterline.
#[derive(Debug, Clone, Copy)]
pub struct DensityColumn {
    pub shelf_gate: f64,
    pub notch_gate: f64,
    /// The highest local water surface: sea, lake, or a river reach.
    /// Density only acts above it.
    pub waterline: f64,
}

impl DensityColumn {
    pub fn inert() -> Self {
        Self {
            shelf_gate: 0.0,
            notch_gate: 0.0,
            waterline: f64::NEG_INFINITY,
        }
    }

    pub fn is_inert(&self) -> bool {
        self.shelf_gate <= 0.0 && self.notch_gate <= 0.0
    }
}

pub struct CompiledDensity {
    band: f64,
    amp: f64,
    shelf: Option<CompiledShelf>,
    notch: Option<CompiledNotch>,
}

struct CompiledShelf {
    spacing: f64,
    resistant_share: f64,
    warp: Fractal,
    warp_amp: f64,
    lens: Fractal,
    lens_squash: f64,
    slope: (f64, f64),
    relief: f64,
}

struct CompiledNotch {
    depth: f64,
    height: f64,
    slope: (f64, f64),
    shore: Fractal,
    river_reach: f64,
}

impl CompiledDensity {
    pub fn compile(
        spec: &DensitySpec,
        world_seed: u32,
        dimension: &str,
    ) -> Result<Self, String> {
        if spec.band < 4.0 {
            return Err("density.band must be >= 4 blocks".to_string());
        }
        if spec.amp <= 0.0 || spec.amp > spec.band {
            return Err("density.amp must be in (0, band]".to_string());
        }
        let seed = stream_seed(world_seed, dimension, Subsystem::Fields, &spec.salt, 7);

        let shelf = match &spec.shelf {
            Some(shelf) => {
                if shelf.spacing < 3.0 {
                    return Err("density shelf: spacing must be >= 3".to_string());
                }
                if !(0.05..=0.95).contains(&shelf.resistant_share) {
                    return Err("density shelf: resistant_share must be 0.05..=0.95".to_string());
                }
                if shelf.relief <= 0.0 {
                    return Err("density shelf: relief must be > 0".to_string());
                }
                Some(CompiledShelf {
                    spacing: shelf.spacing,
                    resistant_share: shelf.resistant_share,
                    warp: Fractal::new(
                        seed ^ 0xd0,
                        1.0 / shelf.warp_scale.max(8.0),
                        2,
                        0.5,
                        2.0,
                        NoiseKind::Fbm,
                    ),
                    warp_amp: shelf.warp_amp,
                    lens: Fractal::new(
                        seed ^ 0xd1,
                        1.0 / shelf.lens_scale.max(8.0),
                        2,
                        0.5,
                        2.0,
                        NoiseKind::Fbm,
                    ),
                    lens_squash: shelf.lens_squash.max(1.0),
                    slope: shelf.slope,
                    relief: shelf.relief,
                })
            }
            None => None,
        };

        let notch = match &spec.notch {
            Some(notch) => {
                if notch.depth <= 0.0 || notch.height < 2.0 {
                    return Err("density notch: depth > 0 and height >= 2 required".to_string());
                }
                Some(CompiledNotch {
                    depth: notch.depth,
                    height: notch.height,
                    slope: notch.slope,
                    shore: Fractal::new(
                        seed ^ 0xd2,
                        1.0 / notch.scale.max(8.0),
                        2,
                        0.5,
                        2.0,
                        NoiseKind::Fbm,
                    ),
                    river_reach: notch.river_reach,
                })
            }
            None => None,
        };

        Ok(Self {
            band: spec.band,
            amp: spec.amp,
            shelf,
            notch,
        })
    }

    pub fn band(&self) -> f64 {
        self.band
    }

    pub fn notch_river_reach(&self) -> f64 {
        self.notch.as_ref().map(|n| n.river_reach).unwrap_or(0.0)
    }

    /// The 2D gates for one column, from facts the stage already has.
    /// `waterline` is the highest local water surface the stage knows
    /// (sea level, lake level, river reach water).
    pub fn column(&self, slope: f64, waterline: f64) -> DensityColumn {
        let shelf_gate = self
            .shelf
            .as_ref()
            .map(|shelf| smooth_window(slope, shelf.slope))
            .unwrap_or(0.0);
        let notch_gate = self
            .notch
            .as_ref()
            .map(|notch| smooth_window(slope, notch.slope))
            .unwrap_or(0.0);
        DensityColumn {
            shelf_gate,
            notch_gate,
            waterline,
        }
    }

    /// Whether (x, y, z) is solid, given the column's heightfield
    /// surface and its 2D prep. The heightfield answer is `y <= surface`;
    /// inside the band the delta bends it.
    #[inline]
    pub fn solid(&self, x: i32, y: i32, z: i32, surface: i32, column: &DensityColumn) -> bool {
        let base = (surface - y) as f64;
        let dy = (y - surface) as f64;
        if dy.abs() >= self.band || column.is_inert() {
            return base >= 0.0;
        }
        // Nothing moves at or below the waterline: submerged ground
        // keeps its closed form so water bodies stay coherent.
        let fy = y as f64;
        if fy <= column.waterline + 1.0 {
            return base >= 0.0;
        }

        let fx = x as f64;
        let fz = z as f64;
        let envelope = 1.0 - smoothstep(self.band * 0.5, self.band, dy.abs());
        let mut delta = 0.0;

        if column.shelf_gate > 0.0 {
            if let Some(shelf) = &self.shelf {
                let warp = shelf.warp.sample2(fx, fz) * shelf.warp_amp;
                let phase = ((fy + warp) / shelf.spacing).rem_euclid(1.0);
                // Smooth square wave over the bed cycle: +1 deep in a
                // resistant bed, -1 deep in a soft bed, with narrow
                // transitions so bed edges are faces, not dithering.
                let r = shelf.resistant_share;
                let t = 0.12;
                let bias = if phase < r {
                    let up = smoothstep(0.0, t, phase);
                    let down = 1.0 - smoothstep(r - t, r, phase);
                    (up.min(down)) * 2.0 - 1.0
                } else {
                    let up = smoothstep(r, r + t, phase);
                    let down = 1.0 - smoothstep(1.0 - t, 1.0, phase);
                    -((up.min(down)) * 2.0 - 1.0)
                };
                let lens = shelf
                    .lens
                    .sample3(fx, fy * shelf.lens_squash, fz);
                let strength = (0.55 + 0.45 * lens).max(0.0);
                delta += bias * shelf.relief * strength * column.shelf_gate;
            }
        }

        if column.notch_gate > 0.0 && column.waterline.is_finite() {
            if let Some(notch) = &self.notch {
                let rise = fy - column.waterline;
                if rise > 0.0 && rise < notch.height {
                    // Deepest right above the water, closing upward.
                    let shape = 1.0 - smoothstep(0.0, notch.height, rise);
                    let vary = 0.5 + 0.5 * notch.shore.sample2(fx, fz);
                    delta -= notch.depth * shape * vary * column.notch_gate;
                }
            }
        }

        let delta = (delta * envelope).clamp(-self.amp, self.amp);
        base + delta > 0.0
    }
}

#[inline]
fn smoothstep(edge0: f64, edge1: f64, x: f64) -> f64 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[inline]
fn smooth_window(value: f64, window: (f64, f64)) -> f64 {
    let (low, high) = window;
    if high <= low {
        return 0.0;
    }
    let span = (high - low) * 0.25;
    let rise = smoothstep(low, low + span, value);
    let fall = 1.0 - smoothstep(high - span, high, value);
    rise.min(fall)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> DensitySpec {
        DensitySpec {
            salt: SaltPath("test.density"),
            band: 14.0,
            amp: 6.0,
            shelf: Some(ShelfSpec {
                spacing: 9.0,
                resistant_share: 0.55,
                warp_amp: 4.0,
                warp_scale: 60.0,
                lens_scale: 40.0,
                lens_squash: 3.0,
                slope: (0.8, 8.0),
                relief: 4.5,
            }),
            notch: Some(NotchSpec {
                depth: 3.5,
                height: 5.0,
                slope: (0.7, 8.0),
                scale: 48.0,
                river_reach: 24.0,
            }),
        }
    }

    fn compiled() -> CompiledDensity {
        CompiledDensity::compile(&spec(), 777, "test_dim").expect("density compiles")
    }

    /// A synthetic cliff: the surface climbs 1.4 blocks per block of x.
    /// Steep enough to fully engage both gates.
    fn cliff_surface(x: i32) -> i32 {
        60 + (x as f64 * 1.4) as i32
    }

    #[test]
    fn deterministic_across_compiles() {
        let a = compiled();
        let b = CompiledDensity::compile(&spec(), 777, "test_dim").expect("density compiles");
        let column = a.column(1.6, 40.0);
        for x in -40..40 {
            let surface = cliff_surface(x);
            for z in -8..8 {
                for y in (surface - 16)..(surface + 16) {
                    assert_eq!(
                        a.solid(x, y, z, surface, &column),
                        b.solid(x, y, z, surface, &column),
                        "divergence at ({x}, {y}, {z})"
                    );
                }
            }
        }
    }

    #[test]
    fn heightfield_stands_outside_the_band() {
        let density = compiled();
        let column = density.column(2.0, 40.0);
        let surface = 90;
        for y in [surface - 15, surface - 40, surface + 15, surface + 40] {
            assert_eq!(
                density.solid(5, y, 5, surface, &column),
                y <= surface,
                "band leak at dy {}",
                y - surface
            );
        }
    }

    #[test]
    fn submerged_ground_is_untouched() {
        let density = compiled();
        // Waterline right through the band: everything at or below it
        // must answer exactly like the heightfield.
        let surface = 80;
        let column = density.column(2.0, 82.0);
        for x in -30..30 {
            for z in -30..30 {
                for y in (surface - 13)..=82 {
                    assert_eq!(
                        density.solid(x, y, z, surface, &column),
                        y <= surface,
                        "submerged deviation at ({x}, {y}, {z})"
                    );
                }
            }
        }
    }

    #[test]
    fn gentle_ground_is_inert() {
        let density = compiled();
        let column = density.column(0.2, 40.0);
        assert!(column.is_inert(), "flat ground must not engage density");
    }

    /// The feature must actually exist: on an engaged cliff the band
    /// carries both protrusions (solid above the nominal surface) and
    /// recesses (air below it) in real quantity.
    #[test]
    fn cliffs_carry_overhangs_and_recesses() {
        let density = compiled();
        let column = density.column(1.8, f64::NEG_INFINITY);
        let mut protrusions = 0usize;
        let mut recesses = 0usize;
        let mut roofed = 0usize;
        for x in -60..60 {
            let surface = cliff_surface(x);
            for z in -60..60 {
                let mut prev_solid = true;
                for y in (surface - 12)..(surface + 12) {
                    let solid = density.solid(x, y, z, surface, &column);
                    if solid && y > surface {
                        protrusions += 1;
                    }
                    if !solid && y <= surface {
                        recesses += 1;
                    }
                    // A solid directly above air: an overhang roof.
                    if solid && !prev_solid {
                        roofed += 1;
                    }
                    prev_solid = solid;
                }
            }
        }
        assert!(
            protrusions > 2_000,
            "too few protruding-bed voxels: {protrusions}"
        );
        assert!(recesses > 2_000, "too few recessed voxels: {recesses}");
        assert!(roofed > 500, "too few overhang roofs: {roofed}");
    }

    /// The structural invariant behind "no floating fantasy blobs":
    /// every solid voxel in the band connects through solid neighbors to
    /// the guaranteed ground body below the band.
    #[test]
    fn band_solids_all_connect_to_the_ground_body() {
        let density = compiled();
        let column = density.column(1.8, f64::NEG_INFINITY);

        // Window over the synthetic cliff. y is sampled relative to each
        // column's own surface, so use absolute bounds wide enough for
        // the whole ramp.
        let (x0, x1) = (-24i32, 24i32);
        let (z0, z1) = (-24i32, 24i32);
        let y0 = cliff_surface(x0) - 16;
        let y1 = cliff_surface(x1 - 1) + 16;

        let width = (x1 - x0) as usize;
        let depth = (z1 - z0) as usize;
        let height = (y1 - y0) as usize;
        let index = |x: i32, y: i32, z: i32| -> usize {
            (((x - x0) as usize) * depth + (z - z0) as usize) * height + (y - y0) as usize
        };

        let mut solid = vec![false; width * depth * height];
        for x in x0..x1 {
            let surface = cliff_surface(x);
            for z in z0..z1 {
                for y in y0..y1 {
                    solid[index(x, y, z)] = density.solid(x, y, z, surface, &column);
                }
            }
        }

        // Flood from every below-band voxel (guaranteed ground).
        let mut connected = vec![false; solid.len()];
        let mut stack = Vec::new();
        for x in x0..x1 {
            let surface = cliff_surface(x);
            for z in z0..z1 {
                let y = surface - 15;
                if y >= y0 && y < y1 {
                    let i = index(x, y, z);
                    if solid[i] && !connected[i] {
                        connected[i] = true;
                        stack.push((x, y, z));
                    }
                }
            }
        }
        while let Some((x, y, z)) = stack.pop() {
            for (dx, dy, dz) in [
                (1, 0, 0),
                (-1, 0, 0),
                (0, 1, 0),
                (0, -1, 0),
                (0, 0, 1),
                (0, 0, -1),
            ] {
                let (nx, ny, nz) = (x + dx, y + dy, z + dz);
                if nx < x0 || nx >= x1 || nz < z0 || nz >= z1 || ny < y0 || ny >= y1 {
                    continue;
                }
                let i = index(nx, ny, nz);
                if solid[i] && !connected[i] {
                    connected[i] = true;
                    stack.push((nx, ny, nz));
                }
            }
        }

        // Interior voxels only: a solid clipped by the window edge can
        // legitimately connect through ground outside the window.
        let margin = 8;
        let mut floaters = 0usize;
        for x in (x0 + margin)..(x1 - margin) {
            for z in (z0 + margin)..(z1 - margin) {
                for y in (y0 + 1)..y1 {
                    let i = index(x, y, z);
                    if solid[i] && !connected[i] {
                        floaters += 1;
                    }
                }
            }
        }
        assert_eq!(floaters, 0, "floating solids disconnected from ground");
    }
}
