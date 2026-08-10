//! Ground mosaic: the material story between the surface tables and the
//! plants. Tables answer "what does this biome's ground look like";
//! the mosaic answers what a *place* looks like — moisture-graded grass
//! tones, clustered substrate exposures, strata-varied rock, talus
//! aprons under faces, and a ragged aspect-aware snowline. Every term
//! is a pure function of (x, z, y, slope, aspect, moisture), so any
//! chunk order reproduces the same ground.

use serde::Serialize;
use voxelize::Registry;
use crate::{stream_seed, Fractal, NoiseKind, SaltPath, Subsystem};

#[derive(Debug, Clone, Serialize)]
pub struct MosaicSpec {
    pub salt: SaltPath,
    /// Grass tones by moisture: below `dry_below` the dry block, above
    /// `lush_above` the lush block, the table's own block between.
    pub tone_dry_below: f64,
    pub tone_lush_above: f64,
    /// Moisture units of border dither, driven by a noise field so the
    /// tone borders wander instead of tracing contour lines.
    pub tone_dither: f64,
    pub tone_scale: f64,
    /// The table block the tone grading replaces (the biome's grass).
    pub grass_block: &'static str,
    pub dry_block: &'static str,
    pub lush_block: &'static str,
    /// The table block strata banding replaces (the biome's stone).
    pub stone_block: &'static str,
    /// Clustered substrate exposures, checked in order over soft ground.
    pub patches: Vec<SubstratePatch>,
    /// Rock-family variation on exposed stone.
    pub strata: Option<StrataSpec>,
    /// Talus aprons under steep faces.
    pub talus: Option<TalusSpec>,
    /// Ragged snowline override.
    pub snow: Option<SnowSpec>,
}

/// One clustered exposure: dirt scars, gravel washes, mossy shade.
#[derive(Debug, Clone, Serialize)]
pub struct SubstratePatch {
    pub block: &'static str,
    /// Patch field wavelength in blocks.
    pub scale: f64,
    /// Field value in -1..1 above which the patch shows.
    pub threshold: f64,
    pub slope: (f64, f64),
    pub moisture: (f64, f64),
}

/// Rock family banding by warped elevation: one massif shows limestone
/// shoulders under granite crowns instead of one monotone stone.
#[derive(Debug, Clone, Serialize)]
pub struct StrataSpec {
    pub blocks: Vec<&'static str>,
    /// Vertical band thickness in blocks.
    pub spacing: f64,
    /// Band-phase warp in blocks and its wavelength.
    pub warp_amp: f64,
    pub warp_scale: f64,
}

/// Gravel/cobble aprons where a face rises just uphill.
#[derive(Debug, Clone, Serialize)]
pub struct TalusSpec {
    pub block: &'static str,
    /// How far uphill (blocks) to probe for the face.
    pub probe: i32,
    /// Rise over the probe that counts as a face.
    pub min_face_rise: f64,
    /// The apron's own slope window: talus rests below the wall, it is
    /// not the wall.
    pub slope: (f64, f64),
}

/// The snowline as weather writes it: dithered by noise, shifted by
/// aspect (lee faces hold snow lower), scoured to rock on steep ground.
#[derive(Debug, Clone, Serialize)]
pub struct SnowSpec {
    /// Nominal snowline elevation.
    pub line: f64,
    /// Transition band height in blocks (line +/- band/2 dithers).
    pub band: f64,
    /// Blocks of line shift by aspect: positive lowers the line on
    /// lee (north-facing, -z downslope) faces.
    pub aspect_shift: f64,
    /// Ragged-edge noise amplitude in blocks and wavelength.
    pub noise_amp: f64,
    pub noise_scale: f64,
    /// Slope above which snow scours off to the rock beneath.
    pub scour_slope: f64,
    pub snow_block: &'static str,
    pub rock_block: &'static str,
}

pub struct CompiledMosaic {
    tone_field: Fractal,
    tone_dry_below: f64,
    tone_lush_above: f64,
    tone_dither: f64,
    dry_id: u32,
    lush_id: u32,
    grass_id: u32,
    stone_id: u32,
    patches: Vec<CompiledPatch>,
    strata: Option<CompiledStrata>,
    talus: Option<CompiledTalus>,
    snow: Option<CompiledSnow>,
}

struct CompiledPatch {
    field: Fractal,
    block: u32,
    threshold: f64,
    slope: (f64, f64),
    moisture: (f64, f64),
}

struct CompiledStrata {
    blocks: Vec<u32>,
    spacing: f64,
    warp: Fractal,
    warp_amp: f64,
}

struct CompiledTalus {
    block: u32,
    probe: i32,
    min_face_rise: f64,
    slope: (f64, f64),
}

struct CompiledSnow {
    line: f64,
    band: f64,
    aspect_shift: f64,
    noise: Fractal,
    noise_amp: f64,
    scour_slope: f64,
    snow_id: u32,
    rock_id: u32,
}

/// Everything the mosaic needs to judge one column, gathered by the
/// surface stage from the geology model.
#[derive(Debug, Clone, Copy)]
pub struct ColumnSample {
    pub surface: i32,
    pub steepness: f64,
    pub moisture: f64,
    /// Normalized downslope direction, (0, 0) on flats.
    pub aspect: (f64, f64),
    /// Surface height `probe` blocks uphill (against the aspect), for
    /// talus face detection.
    pub uphill_surface: i32,
}

impl CompiledMosaic {
    /// Uphill probe distance the talus term needs, so the stage knows
    /// how far to sample; zero when talus is off.
    pub fn talus_probe(&self) -> i32 {
        self.talus.as_ref().map(|talus| talus.probe).unwrap_or(0)
    }

    pub fn compile(
        spec: &MosaicSpec,
        registry: &Registry,
        world_seed: u32,
        dimension: &str,
    ) -> Result<Self, String> {
        if spec.tone_dry_below > spec.tone_lush_above {
            return Err("mosaic: tone_dry_below must be <= tone_lush_above".to_string());
        }
        let seed = stream_seed(world_seed, dimension, Subsystem::Fields, &spec.salt, 3);
        let block_id = |name: &'static str| -> Result<u32, String> {
            registry
                .try_get_id_by_name(name)
                .ok_or_else(|| format!("mosaic: unknown block {name:?}"))
        };

        let mut patches = Vec::new();
        for (index, patch) in spec.patches.iter().enumerate() {
            if patch.scale < 4.0 {
                return Err(format!("mosaic patch {}: scale must be >= 4", patch.block));
            }
            patches.push(CompiledPatch {
                field: Fractal::new(
                    seed ^ (0x50 + index as u64),
                    1.0 / patch.scale,
                    2,
                    0.5,
                    2.0,
                    NoiseKind::Fbm,
                ),
                block: block_id(patch.block)?,
                threshold: patch.threshold,
                slope: patch.slope,
                moisture: patch.moisture,
            });
        }

        let strata = match &spec.strata {
            Some(strata) => {
                if strata.blocks.is_empty() || strata.spacing < 2.0 {
                    return Err("mosaic strata: needs blocks and spacing >= 2".to_string());
                }
                Some(CompiledStrata {
                    blocks: {
                        let mut blocks = Vec::new();
                        for name in &strata.blocks {
                            blocks.push(block_id(name)?);
                        }
                        blocks
                    },
                    spacing: strata.spacing,
                    warp: Fractal::new(
                        seed ^ 0x57,
                        1.0 / strata.warp_scale.max(4.0),
                        2,
                        0.5,
                        2.0,
                        NoiseKind::Fbm,
                    ),
                    warp_amp: strata.warp_amp,
                })
            }
            None => None,
        };

        let talus = match &spec.talus {
            Some(talus) => Some(CompiledTalus {
                block: block_id(talus.block)?,
                probe: talus.probe.max(1),
                min_face_rise: talus.min_face_rise,
                slope: talus.slope,
            }),
            None => None,
        };

        let snow = match &spec.snow {
            Some(snow) => {
                if snow.band <= 0.0 {
                    return Err("mosaic snow: band must be > 0".to_string());
                }
                Some(CompiledSnow {
                    line: snow.line,
                    band: snow.band,
                    aspect_shift: snow.aspect_shift,
                    noise: Fractal::new(
                        seed ^ 0x5e,
                        1.0 / snow.noise_scale.max(4.0),
                        2,
                        0.5,
                        2.0,
                        NoiseKind::Fbm,
                    ),
                    noise_amp: snow.noise_amp,
                    scour_slope: snow.scour_slope,
                    snow_id: block_id(snow.snow_block)?,
                    rock_id: block_id(snow.rock_block)?,
                })
            }
            None => None,
        };

        Ok(Self {
            tone_field: Fractal::new(
                seed ^ 0x70,
                1.0 / spec.tone_scale.max(4.0),
                2,
                0.5,
                2.0,
                NoiseKind::Fbm,
            ),
            tone_dry_below: spec.tone_dry_below,
            tone_lush_above: spec.tone_lush_above,
            tone_dither: spec.tone_dither,
            dry_id: block_id(spec.dry_block)?,
            lush_id: block_id(spec.lush_block)?,
            grass_id: block_id(spec.grass_block)?,
            stone_id: block_id(spec.stone_block)?,
            patches,
            strata,
            talus,
            snow,
        })
    }

    /// The mosaic's answer for the top block of one dry-land column,
    /// given what the surface table placed there. Order: grass tone,
    /// substrate patches, strata on stone, talus, then snow — weather
    /// wins over everything under it.
    pub fn top_block(&self, x: i32, z: i32, placed: u32, sample: &ColumnSample) -> u32 {
        let fx = x as f64;
        let fz = z as f64;
        let mut block = placed;

        if block == self.grass_id {
            let dither = self.tone_field.sample2(fx, fz) * self.tone_dither;
            let moisture = sample.moisture + dither;
            if moisture < self.tone_dry_below {
                block = self.dry_id;
            } else if moisture > self.tone_lush_above {
                block = self.lush_id;
            }
        }

        let is_soft = block == self.grass_id || block == self.dry_id || block == self.lush_id;
        if is_soft {
            for patch in &self.patches {
                if sample.steepness < patch.slope.0 || sample.steepness > patch.slope.1 {
                    continue;
                }
                if sample.moisture < patch.moisture.0 || sample.moisture > patch.moisture.1 {
                    continue;
                }
                if patch.field.sample2(fx, fz) > patch.threshold {
                    block = patch.block;
                    break;
                }
            }
        }

        if block == self.stone_id {
            if let Some(strata) = &self.strata {
                let warp = strata.warp.sample2(fx, fz) * strata.warp_amp;
                let band = ((sample.surface as f64 + warp) / strata.spacing).floor();
                let index = (band.rem_euclid(strata.blocks.len() as f64)) as usize;
                block = strata.blocks[index.min(strata.blocks.len() - 1)];
            }
        }

        if let Some(talus) = &self.talus {
            let rise = (sample.uphill_surface - sample.surface) as f64;
            if rise >= talus.min_face_rise
                && sample.steepness >= talus.slope.0
                && sample.steepness <= talus.slope.1
            {
                block = talus.block;
            }
        }

        if let Some(snow) = &self.snow {
            // Lee shift: downslope pointing -z reads as a north face.
            let lee = -sample.aspect.1;
            let line = snow.line - lee * snow.aspect_shift
                + snow.noise.sample2(fx, fz) * snow.noise_amp;
            let y = sample.surface as f64;
            if y > line + snow.band * 0.5 {
                block = if sample.steepness >= snow.scour_slope {
                    snow.rock_id
                } else {
                    snow.snow_id
                };
            } else if y > line - snow.band * 0.5 {
                // Inside the band the noise already decided `line`;
                // the half above went snow, this half stays ground —
                // the wandering line IS the transition.
                if sample.steepness >= snow.scour_slope {
                    block = snow.rock_id;
                }
            }
        }

        block
    }
}
