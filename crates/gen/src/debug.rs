//! Author diagnostics: 2D map renders (biome, height, steepness, climate
//! axes, zone margin), the per-column seed-replay probe, structure locate
//! with candidate/rejection visibility, terrain statistics, and metrics.
//! These are first-class deliverables — a generator nobody can inspect is
//! a generator nobody can tune.

use serde_json::json;

use crate::diag::{band_shares, repetition_score, FieldGrid, FieldStats};
use crate::spec::CompiledGenerator;
use crate::stream::{fnv1a_64, mix64};

#[derive(Debug, Clone, Copy)]
pub enum MapLayer {
    Biome,
    Height,
    Steepness,
    /// Folded moisture 0..1 (geology drainage or river proximity).
    Moisture,
    Axis(usize),
    Margin,
}

#[derive(Debug, Clone, Copy)]
pub struct MapRequest {
    pub layer: MapLayer,
    pub center_x: i32,
    pub center_z: i32,
    pub radius: i32,
    pub stride: u8,
}

pub struct GenDebug<'a> {
    generator: &'a CompiledGenerator,
}

impl<'a> GenDebug<'a> {
    pub fn new(generator: &'a CompiledGenerator) -> Self {
        Self { generator }
    }

    /// Stable, distinguishable SRGB color per biome id (hashed, not
    /// authored — debug maps are diagnostics, not art).
    fn biome_color(&self, id: u16) -> [u8; 3] {
        let h = mix64(fnv1a_64(self.generator.biome_key(crate::climate::BiomeId(id)).as_bytes()));
        let r = 64 + (h & 0x7F) as u8;
        let g = 64 + ((h >> 8) & 0x7F) as u8;
        let b = 64 + ((h >> 16) & 0x7F) as u8;
        [r, g, b]
    }

    pub fn render_map(&self, request: &MapRequest) -> Vec<u8> {
        let stride = request.stride.max(1) as i32;
        let span = (request.radius * 2 / stride).max(1) as usize;
        let mut pixels = vec![0u8; span * span * 3];

        let sea = self.generator.sea_level();
        for iz in 0..span {
            for ix in 0..span {
                let x = request.center_x - request.radius + ix as i32 * stride;
                let z = request.center_z - request.radius + iz as i32 * stride;
                let surface = self.generator.surface_raw(x, z);
                let rgb: [u8; 3] = match request.layer {
                    MapLayer::Biome => {
                        let blend = self.generator.blend_at(x, z, surface);
                        let mut color = self.biome_color(blend.primary.0);
                        if let Some(sea_level) = sea {
                            if surface <= sea_level {
                                color = [
                                    (color[0] / 3).saturating_add(20),
                                    (color[1] / 3).saturating_add(30),
                                    (color[2] / 2).saturating_add(80),
                                ];
                            }
                        }
                        color
                    }
                    MapLayer::Height => {
                        let t = (surface as f64 / self.generator.height as f64).clamp(0.0, 1.0);
                        let v = (t * 255.0) as u8;
                        if sea.map(|s| surface <= s).unwrap_or(false) {
                            [v / 3, v / 2, 160]
                        } else {
                            [v, v, v]
                        }
                    }
                    MapLayer::Steepness => {
                        let t = (self.generator.steepness(x, z) / 3.0).clamp(0.0, 1.0);
                        let v = (t * 255.0) as u8;
                        [v, 255 - v / 2, 64]
                    }
                    MapLayer::Moisture => {
                        let t = self.generator.moisture_at(x, z).clamp(0.0, 1.0);
                        let v = (t * 255.0) as u8;
                        [40, 255 - v / 2, v]
                    }
                    MapLayer::Axis(index) => {
                        let axes = self.generator.axes_at(x, z);
                        let value = axes.get(index).copied().unwrap_or(0.0);
                        let t = ((value + 1.0) / 2.0).clamp(0.0, 1.0);
                        let v = (t * 255.0) as u8;
                        [v, 255 - v, 128]
                    }
                    MapLayer::Margin => {
                        let blend = self.generator.blend_at(x, z, surface);
                        let t = (blend.margin as f64 / 48.0).clamp(0.0, 1.0);
                        let v = (t * 255.0) as u8;
                        [255 - v, v, 40]
                    }
                };
                let slot = (iz * span + ix) * 3;
                pixels[slot..slot + 3].copy_from_slice(&rgb);
            }
        }

        let mut out = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut out, span as u32, span as u32);
            encoder.set_color(png::ColorType::Rgb);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().expect("png header");
            writer.write_image_data(&pixels).expect("png data");
        }
        out
    }

    /// The seed-replay artifact: every field input, the partition decision
    /// with blend weights and margin, hydrology, and plans in reach.
    pub fn probe_column(&self, x: i32, z: i32) -> serde_json::Value {
        let generator = self.generator;
        let surface = generator.surface_raw(x, z);
        let blend = generator.blend_at(x, z, surface);
        let axes = generator.axes_at(x, z);
        let axis_report: Vec<serde_json::Value> = generator
            .axis_keys()
            .iter()
            .zip(axes.iter())
            .map(|(key, value)| json!({ "axis": key, "value": value }))
            .collect();
        let weights: Vec<serde_json::Value> = blend
            .weights
            .iter()
            .map(|(id, w)| {
                json!({
                    "biome": generator.biome_key(*id),
                    "weight": w,
                })
            })
            .collect();
        let plans = generator.plans_in_reach((x - 64, z - 64), (x + 64, z + 64));
        let plan_report: Vec<serde_json::Value> = plans
            .iter()
            .map(|plan| {
                json!({
                    "set": generator.structures().set_key(plan.set),
                    "member": plan.member,
                    "site": [plan.site.0, plan.site.1],
                    "anchor": [plan.anchor.0, plan.anchor.1, plan.anchor.2],
                    "bbox": [plan.bbox_min, plan.bbox_max],
                    "pieces": plan.pieces.len(),
                })
            })
            .collect();

        json!({
            "position": { "x": x, "z": z },
            "identity": {
                "preset": generator.identity.preset,
                "contentVersion": generator.identity.content_version.to_string(),
                "specHash": format!("{:016x}", generator.identity.spec_hash),
                "worldSeed": generator.identity.world_seed,
            },
            "axes": axis_report,
            "surfaceRaw": surface,
            "ground": generator.ground_at(x, z),
            "steepness": generator.steepness(x, z),
            "seaLevel": generator.sea_level(),
            "aquiferLevel": generator.aquifer_level(x, z),
            "moisture": generator.moisture_at(x, z),
            "lakeLevel": generator.lake_level(x, z),
            "river": generator.river_sample(x, z).map(|point| json!({
                "dist": point.dist,
                "waterY": point.water_y,
                "halfWidth": point.half_width,
                "depth": point.depth,
            })),
            "biome": {
                "primary": generator.biome_key(blend.primary),
                "weights": weights,
                "margin": blend.margin,
            },
            "plansInReach": plan_report,
        })
    }

    /// Terrain acceptance numbers over a window: height and steepness
    /// distributions, spectrum shares, and the repetition score. The
    /// anti-repetition tap — tune against these, not against adjectives.
    pub fn terrain_stats(
        &self,
        center_x: i32,
        center_z: i32,
        radius: i32,
        stride: i32,
    ) -> serde_json::Value {
        let generator = self.generator;
        let stride = stride.max(1);
        let size = ((radius * 2 / stride).max(16) as usize).min(512);
        let origin = (center_x - radius, center_z - radius);
        let heights = FieldGrid::sample(origin, size, stride, |x, z| {
            generator.surface_raw(x, z) as f64
        });
        let steepness = FieldGrid::sample(origin, size, stride, |x, z| generator.steepness(x, z));
        json!({
            "window": {
                "centerX": center_x,
                "centerZ": center_z,
                "radius": radius,
                "stride": stride,
                "samples": size * size,
            },
            "height": FieldStats::measure(heights.values()),
            "steepness": FieldStats::measure(steepness.values()),
            "heightBandShares": band_shares(&heights, 6),
            "repetitionScore": repetition_score(&heights, 0.3),
        })
    }

    pub fn locate(&self, set_key: &str, near_x: i32, near_z: i32, max: usize) -> serde_json::Value {
        let generator = self.generator;
        let Some(set) = generator.structures().set_index_of(set_key) else {
            return json!({ "error": format!("unknown structure set {set_key:?}") });
        };
        let hits = generator
            .structures()
            .locate(set, (near_x, near_z), max, generator);
        let report: Vec<serde_json::Value> = hits
            .iter()
            .map(|(site, anchor, is_placed)| {
                json!({
                    "site": [site.0, site.1],
                    "anchor": [anchor.0, anchor.1, anchor.2],
                    "isPlaced": is_placed,
                })
            })
            .collect();
        json!({ "set": set_key, "results": report })
    }

    pub fn metrics(&self) -> serde_json::Value {
        let generator = self.generator;
        let structures = generator.structures();
        let sets: Vec<serde_json::Value> = (0..structures.set_count())
            .map(|set| {
                let stats = structures.rejection_stats(set);
                let rejected: Vec<serde_json::Value> = stats
                    .rejected
                    .iter()
                    .map(|(reason, count)| json!({ "reason": format!("{reason:?}"), "count": count }))
                    .collect();
                let samples: Vec<serde_json::Value> = stats
                    .samples
                    .iter()
                    .map(|(site, reason)| {
                        json!({ "site": [site.0, site.1], "reason": format!("{reason:?}") })
                    })
                    .collect();
                json!({
                    "set": structures.set_key(set),
                    "placed": stats.placed,
                    "rejected": rejected,
                    "rejectionSamples": samples,
                })
            })
            .collect();
        json!({
            "identity": {
                "preset": generator.identity.preset,
                "contentVersion": generator.identity.content_version.to_string(),
                "formatVersion": generator.identity.format_version,
                "specHash": format!("{:016x}", generator.identity.spec_hash),
                "worldSeed": generator.identity.world_seed,
            },
            "biomes": (0..generator.biome_count())
                .map(|i| generator.biome_key(crate::climate::BiomeId(i as u16)))
                .collect::<Vec<_>>(),
            "structures": sets,
        })
    }

    pub fn fingerprint(&self, probes: &[(i32, i32)]) -> String {
        let generator = self.generator;
        let mut out = String::new();
        for &(x, z) in probes {
            let surface = generator.surface_raw(x, z);
            let blend = generator.blend_at(x, z, surface);
            out.push_str(&format!(
                "({x},{z}) surface={} biome={} margin={:.3} steep={:.3} aquifer={}\n",
                surface,
                generator.biome_key(blend.primary),
                blend.margin.min(9999.0),
                generator.steepness(x, z),
                generator.aquifer_level(x, z),
            ));
        }
        out
    }
}
