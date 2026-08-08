//! Carvers decide void shape only; fluid content comes from hydrology.
//! The tunnel-pair construction (near-zero intersection of two smooth 3D
//! fields) plus a cavern pocket field with a detail perturbation is the
//! proven recipe for winding tube webs and halls that do not read as bare
//! noise isosurfaces. All 3D sampling goes through world-anchored trilinear
//! lattices so neighboring chunks interpolate identical values.

use serde::Serialize;

use crate::noise::{smoothstep, Fractal, NoiseKind};
use crate::spec::GenError;
use crate::stream::{stream_seed, SaltPath, Subsystem};

#[derive(Debug, Clone, Serialize)]
pub enum CarverSpec {
    TunnelPair(TunnelPairSpec),
    Cavern(CavernSpec),
}

#[derive(Debug, Clone, Serialize)]
pub struct TunnelPairSpec {
    pub salt: SaltPath,
    pub frequency: f64,
    pub y_squash: f64,
    pub half_width: f64,
    pub width_mod_frequency: f64,
    pub width_mod_amplitude: f64,
    pub floor_y: i32,
    pub floor_fade: i32,
    pub min_roof_depth: i32,
    pub roof_fade: i32,
    pub deep_widen: Option<(i32, f64)>,
    pub entrances: EntranceSpec,
    pub mask_bit: u8,
}

#[derive(Debug, Clone, Serialize)]
pub struct EntranceSpec {
    pub is_enabled: bool,
    pub min_slope: f64,
    pub full_slope: f64,
    pub window: (f64, f64),
    pub mouth_widen: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CavernSpec {
    pub salt: SaltPath,
    pub frequency: f64,
    pub y_squash: f64,
    pub threshold: f64,
    pub max_y: i32,
    pub min_roof_depth: i32,
    pub detail_frequency: f64,
    pub detail_amplitude: f64,
    pub mask_bit: u8,
}

pub(crate) const LATTICE_STRIDE: i32 = 4;

pub(crate) struct DensityLattice {
    min_x: i32,
    min_y: i32,
    min_z: i32,
    ny: usize,
    nz: usize,
    values: Vec<f64>,
}

impl DensityLattice {
    fn build(
        min: (i32, i32, i32),
        max: (i32, i32, i32),
        sample: impl Fn(i32, i32, i32) -> f64,
    ) -> Self {
        let anchor = |v: i32| v.div_euclid(LATTICE_STRIDE) * LATTICE_STRIDE;
        let count = |lo: i32, hi: i32| {
            (hi.saturating_sub(lo).max(0).div_euclid(LATTICE_STRIDE) + 2) as usize
        };
        let (min_x, min_y, min_z) = (anchor(min.0), anchor(min.1), anchor(min.2));
        let (nx, ny, nz) = (
            count(min_x, max.0),
            count(min_y, max.1),
            count(min_z, max.2),
        );
        let mut values = Vec::with_capacity(nx * ny * nz);
        for ix in 0..nx {
            for iy in 0..ny {
                for iz in 0..nz {
                    values.push(sample(
                        min_x + ix as i32 * LATTICE_STRIDE,
                        min_y + iy as i32 * LATTICE_STRIDE,
                        min_z + iz as i32 * LATTICE_STRIDE,
                    ));
                }
            }
        }
        Self {
            min_x,
            min_y,
            min_z,
            ny,
            nz,
            values,
        }
    }

    #[inline]
    fn at(&self, ix: usize, iy: usize, iz: usize) -> f64 {
        self.values[(ix * self.ny + iy) * self.nz + iz]
    }

    pub fn sample(&self, x: i32, y: i32, z: i32) -> f64 {
        let fx = (x - self.min_x) as f64 / LATTICE_STRIDE as f64;
        let fy = (y - self.min_y) as f64 / LATTICE_STRIDE as f64;
        let fz = (z - self.min_z) as f64 / LATTICE_STRIDE as f64;
        let (ix, iy, iz) = (fx as usize, fy as usize, fz as usize);
        let (tx, ty, tz) = (fx - ix as f64, fy - iy as f64, fz - iz as f64);
        let lerp = |a: f64, b: f64, t: f64| a + (b - a) * t;
        let c00 = lerp(self.at(ix, iy, iz), self.at(ix + 1, iy, iz), tx);
        let c10 = lerp(self.at(ix, iy + 1, iz), self.at(ix + 1, iy + 1, iz), tx);
        let c01 = lerp(self.at(ix, iy, iz + 1), self.at(ix + 1, iy, iz + 1), tx);
        let c11 = lerp(
            self.at(ix, iy + 1, iz + 1),
            self.at(ix + 1, iy + 1, iz + 1),
            tx,
        );
        lerp(lerp(c00, c10, ty), lerp(c01, c11, ty), tz)
    }
}

struct CompiledTunnelPair {
    spec: TunnelPairSpec,
    field_a: Fractal,
    field_b: Fractal,
    width_mod: Fractal,
    entrance_gate: Fractal,
}

struct CompiledCavern {
    spec: CavernSpec,
    field: Fractal,
    detail: Fractal,
}

pub(crate) struct CompiledCarvers {
    tunnels: Vec<CompiledTunnelPair>,
    caverns: Vec<CompiledCavern>,
}

pub struct CarveLattices {
    tunnels: Vec<(DensityLattice, DensityLattice)>,
    caverns: Vec<(DensityLattice, DensityLattice)>,
}

impl CompiledCarvers {
    pub fn compile(
        specs: &[CarverSpec],
        world_seed: u32,
        dimension: &str,
        used_salts: &mut hashbrown::HashSet<&'static str>,
    ) -> Result<Self, GenError> {
        let mut tunnels = Vec::new();
        let mut caverns = Vec::new();
        for spec in specs {
            match spec {
                CarverSpec::TunnelPair(t) => {
                    crate::spec::claim_salt(&t.salt, used_salts)?;
                    if t.half_width <= 0.0 || t.frequency <= 0.0 {
                        return Err(GenError::OutOfRange {
                            path: format!("carver.{}", t.salt.0),
                            what: "tunnel width/frequency",
                            got: t.half_width,
                        });
                    }
                    let seed = stream_seed(world_seed, dimension, Subsystem::Carvers, &t.salt, 0);
                    tunnels.push(CompiledTunnelPair {
                        field_a: Fractal::new(seed ^ 0x0A, t.frequency, 1, 0.5, 2.0, NoiseKind::Fbm),
                        field_b: Fractal::new(seed ^ 0x0B, t.frequency, 1, 0.5, 2.0, NoiseKind::Fbm),
                        width_mod: Fractal::new(
                            seed ^ 0x0C,
                            t.width_mod_frequency,
                            1,
                            0.5,
                            2.0,
                            NoiseKind::Fbm,
                        ),
                        entrance_gate: Fractal::new(
                            seed ^ 0x0D,
                            1.0 / 48.0,
                            1,
                            0.5,
                            2.0,
                            NoiseKind::Fbm,
                        ),
                        spec: t.clone(),
                    });
                }
                CarverSpec::Cavern(c) => {
                    crate::spec::claim_salt(&c.salt, used_salts)?;
                    let seed = stream_seed(world_seed, dimension, Subsystem::Carvers, &c.salt, 0);
                    caverns.push(CompiledCavern {
                        field: Fractal::new(seed ^ 0x1A, c.frequency, 2, 0.5, 2.0, NoiseKind::Fbm),
                        detail: Fractal::new(
                            seed ^ 0x1B,
                            c.detail_frequency,
                            1,
                            0.5,
                            2.0,
                            NoiseKind::Fbm,
                        ),
                        spec: c.clone(),
                    });
                }
            }
        }
        Ok(Self { tunnels, caverns })
    }

    pub fn is_empty(&self) -> bool {
        self.tunnels.is_empty() && self.caverns.is_empty()
    }

    pub fn build_lattices(&self, min: (i32, i32, i32), max: (i32, i32, i32)) -> CarveLattices {
        let tunnels = self
            .tunnels
            .iter()
            .map(|t| {
                let squash = t.spec.y_squash;
                (
                    DensityLattice::build(min, max, |x, y, z| {
                        t.field_a.sample3(x as f64, y as f64 * squash, z as f64)
                    }),
                    DensityLattice::build(min, max, |x, y, z| {
                        t.field_b.sample3(x as f64, y as f64 * squash, z as f64)
                    }),
                )
            })
            .collect();
        let caverns = self
            .caverns
            .iter()
            .map(|c| {
                let squash = c.spec.y_squash;
                let cap_y = c.spec.max_y + LATTICE_STRIDE;
                (
                    DensityLattice::build(min, (max.0, max.1.min(cap_y), max.2), |x, y, z| {
                        c.field.sample3(x as f64, y as f64 * squash, z as f64)
                    }),
                    DensityLattice::build(min, (max.0, max.1.min(cap_y), max.2), |x, y, z| {
                        c.detail.sample3(x as f64, y as f64, z as f64)
                    }),
                )
            })
            .collect();
        CarveLattices { tunnels, caverns }
    }

    /// Whether any enabled carver opens this voxel. `biome_mask` is the
    /// column biome's carver opt-in bits; `steepness` gates entrances.
    pub fn is_carved(
        &self,
        lattices: &CarveLattices,
        x: i32,
        y: i32,
        z: i32,
        surface: i32,
        steepness: f64,
        biome_mask: u8,
    ) -> bool {
        let roof_depth = surface - y;

        for (t, (lat_a, lat_b)) in self.tunnels.iter().zip(&lattices.tunnels) {
            let spec = &t.spec;
            if biome_mask & (1 << spec.mask_bit) == 0 {
                continue;
            }
            if y <= spec.floor_y || y > surface {
                continue;
            }
            let mut width = spec.half_width
                * (1.0
                    + t.width_mod.sample2(x as f64, z as f64) * spec.width_mod_amplitude);
            if let Some((deep_y, widen)) = spec.deep_widen {
                if y < deep_y {
                    width *= widen;
                }
            }
            width *= smoothstep(
                spec.floor_y as f64,
                (spec.floor_y + spec.floor_fade) as f64,
                y as f64,
            );

            let buried_t = smoothstep(
                spec.min_roof_depth as f64,
                (spec.min_roof_depth + spec.roof_fade) as f64,
                roof_depth as f64,
            );
            let mouth_t = if spec.entrances.is_enabled {
                let slope_gate = smoothstep(
                    spec.entrances.min_slope,
                    spec.entrances.full_slope,
                    steepness,
                );
                if slope_gate > 0.0 {
                    let gate = smoothstep(
                        spec.entrances.window.0,
                        spec.entrances.window.1,
                        t.entrance_gate.sample2(x as f64, z as f64),
                    );
                    slope_gate * gate * (1.0 + spec.entrances.mouth_widen)
                } else {
                    0.0
                }
            } else {
                0.0
            };
            let effective = width * buried_t.max(mouth_t);
            if effective <= 0.0 {
                continue;
            }
            if lat_a.sample(x, y, z).abs() < effective && lat_b.sample(x, y, z).abs() < effective {
                return true;
            }
        }

        for (c, (lat_field, lat_detail)) in self.caverns.iter().zip(&lattices.caverns) {
            let spec = &c.spec;
            if biome_mask & (1 << spec.mask_bit) == 0 {
                continue;
            }
            if y > spec.max_y || roof_depth < spec.min_roof_depth || y <= 2 {
                continue;
            }
            let field = lat_field.sample(x, y, z);
            if field <= spec.threshold - spec.detail_amplitude {
                continue;
            }
            let detail = lat_detail.sample(x, y, z);
            if field > spec.threshold - detail * spec.detail_amplitude {
                return true;
            }
        }

        false
    }
}
