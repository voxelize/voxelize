//! Per-column provenance: everything that decided one column, as text and
//! JSON (`landscape_render --explain x,z`).
//!
//! This phase has no landforms, so a column's story is its fields, the
//! floor and ceiling clamps, the climate and the partition, the water, and
//! the paint. The full fold (instances, ground ops, claims, bands) joins
//! with composition in P2b.

use std::fmt::Write as _;

use serde::Serialize;
use smallvec::SmallVec;

use crate::climate::MAX_AXES;

use super::facts::{solid_top, Tier};
use super::fields::{compile_fields, Area, CompiledFields, FieldsConfig, SaltClaims, SPINE};
use super::lower::AxisSource;
use super::Landscape;

/// One column's provenance.
#[derive(Clone, Debug, Serialize)]
pub struct ColumnExplain {
    /// World x.
    pub x: i32,
    /// World z.
    pub z: i32,
    /// Every named field at the column, by name.
    pub fields: Vec<(String, f64)>,
    /// The spine field's value.
    pub spine: f64,
    /// After the floor clamp and the soft ceiling.
    pub ground: f64,
    /// The solid top.
    pub top: i32,
    /// L2 slope.
    pub slope: f64,
    /// Downhill aspect.
    pub aspect: [f64; 2],
    /// Laplacian.
    pub curvature: f64,
    /// Temperature before the lapse.
    pub temperature_field: f64,
    /// Temperature after the lapse.
    pub temperature: f64,
    /// Moisture.
    pub moisture: f64,
    /// Climate axis values, by key.
    pub axes: Vec<(String, f64)>,
    /// The blend's primary biome.
    pub biome_primary: String,
    /// The blend's runner-up and its weight.
    pub biome_secondary: Option<(String, f64)>,
    /// The biome after the border dither (what paint and flora use).
    pub biome: String,
    /// Water layers: kind id, body, bottom, level.
    pub water: Vec<(u16, u64, i32, i32)>,
    /// Paint, bottom up: `(lo, hi, role)`.
    pub paint: Vec<(i32, i32, String)>,
    /// Compile lints.
    pub lints: Vec<String>,
}

impl ColumnExplain {
    /// Human-readable lines.
    pub fn to_text(&self) -> String {
        let mut s = String::new();
        let _ = writeln!(s, "column ({}, {})", self.x, self.z);
        let _ = writeln!(s, "  fields:");
        for (n, v) in &self.fields {
            let _ = writeln!(s, "    {n:<24} {v:>12.4}");
        }
        let _ = writeln!(
            s,
            "  ground: spine {:.4} -> floor and ceiling -> {:.4}; top {}",
            self.spine, self.ground, self.top
        );
        let _ = writeln!(
            s,
            "  slope {:.4}, aspect ({:.3}, {:.3}), curvature {:.4}",
            self.slope, self.aspect[0], self.aspect[1], self.curvature
        );
        let _ = writeln!(
            s,
            "  temperature {:.4} (field {:.4}, lapse applied), moisture {:.4}",
            self.temperature, self.temperature_field, self.moisture
        );
        for (k, v) in &self.axes {
            let _ = writeln!(s, "  axis {k} = {v:.4}");
        }
        let _ = writeln!(
            s,
            "  biome: primary {}, runner-up {}, dithered -> {}",
            self.biome_primary,
            self.biome_secondary
                .as_ref()
                .map_or("none".to_string(), |(k, w)| format!("{k} ({w:.3})")),
            self.biome
        );
        if self.water.is_empty() {
            let _ = writeln!(s, "  water: dry");
        }
        for (kind, body, lo, hi) in &self.water {
            let _ = writeln!(s, "  water: kind {kind} body {body:016x} [{lo}, {hi}]");
        }
        for (lo, hi, role) in &self.paint {
            let _ = writeln!(s, "  paint [{lo}, {hi}] {role}");
        }
        for l in &self.lints {
            let _ = writeln!(s, "  {l}");
        }
        s
    }
}

impl Landscape {
    fn all_fields(&self) -> &CompiledFields {
        self.explain_fields.get_or_init(|| {
            let names: Vec<String> = self.spec.fields.keys().cloned().collect();
            let mut salts = SaltClaims::default();
            compile_fields(
                &self.spec.fields,
                &names,
                &FieldsConfig {
                    frame: &self.frame,
                    world_seed: self.identity.world_seed,
                    dimension: &self.identity.dimension,
                    taste: &super::spec::TasteGuards::warn(),
                    cse: true,
                },
                &mut salts,
            )
            .expect("a compiled spec recompiles")
        })
    }

    /// Every named field at one column.
    pub fn field_values(&self, x: i32, z: i32) -> Vec<(String, f64)> {
        let all = self.all_fields();
        let grid = all.evaluate(
            Area {
                x0: x,
                z0: z,
                w: 1,
                d: 1,
            },
            0,
            &self.tiles_explain,
        );
        self.spec
            .fields
            .keys()
            .enumerate()
            .map(|(i, n)| (n.clone(), grid.output(i, x, z)))
            .collect()
    }

    /// The provenance of one column.
    pub fn explain(&self, x: i32, z: i32) -> ColumnExplain {
        let fields = self.field_values(x, z);
        let get = |name: &str| {
            fields
                .iter()
                .find(|(n, _)| n == name)
                .map(|(_, v)| *v)
                .unwrap()
        };
        let spine = get(SPINE);
        let c = self.column(x, z, Tier::Full);
        debug_assert_eq!(
            solid_top(c.ground).clamp(0, self.frame.height as i32 - 1),
            c.top
        );
        let temperature_field = get(&self.spec.biomes.climate.temperature);
        let mut axes: SmallVec<[f64; MAX_AXES]> = SmallVec::new();
        let mut axes_named = Vec::new();
        for (a, m) in self.climate.axes.iter().zip(self.spec.biomes.axes.iter()) {
            let v = match a {
                AxisSource::Temperature => c.temperature,
                AxisSource::Moisture => c.moisture,
                AxisSource::HeightShare => (c.ground - self.frame.sea as f64) / self.frame.relief,
                AxisSource::Field(_) => match &m.source {
                    super::mirror::AxisSourceM::Field(name) => get(name),
                    _ => unreachable!(),
                },
            };
            axes.push(v);
            axes_named.push((m.key.clone(), v));
        }
        let keys = &self.climate.biome_keys;
        let b = c.biome;
        let facts = self.build_facts((x, z), 1, 0);
        let runs = self.paint_column(&facts, x, z);
        let mut paint = vec![(
            0,
            runs.top(),
            self.block_role(runs.fill()).unwrap_or("?").to_string(),
        )];
        for &(lo, hi, blk) in runs.overrides() {
            paint.push((lo, hi, self.block_role(blk).unwrap_or("?").to_string()));
        }
        ColumnExplain {
            x,
            z,
            spine,
            ground: c.ground,
            top: c.top,
            slope: c.slope,
            aspect: c.aspect,
            curvature: c.curvature,
            temperature_field,
            temperature: c.temperature,
            moisture: c.moisture,
            axes: axes_named,
            biome_primary: keys[b.primary.0 as usize].clone(),
            biome_secondary: if b.edge > 0 {
                Some((
                    keys[b.secondary.0 as usize].clone(),
                    b.edge as f64 / 65535.0,
                ))
            } else {
                None
            },
            biome: keys[b.id.0 as usize].clone(),
            water: c
                .water
                .layers
                .iter()
                .map(|l| (l.kind.0, l.body.0, l.bottom, l.level))
                .collect(),
            paint,
            fields,
            lints: self.lints.clone(),
        }
    }
}
