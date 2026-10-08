//! Per-column provenance: everything that decided one column, as text and
//! JSON (`landscape_render --explain x,z`).
//!
//! A column's story: its fields; every instance that touched it, with its
//! edge, exclusion and weight; each ground op in fold order with the
//! ground before and after and its `t`; the ground after each layer; the
//! floor and ceiling clamps; claims with weights and owners; the zone and
//! its owner; the cave ceiling; spans and province entries; the climate
//! and the partition; the water; and the paint. This is the tool for
//! debugging the two-pass fold.

use std::fmt::Write as _;

use serde::Serialize;
use smallvec::SmallVec;

use crate::climate::MAX_AXES;

use super::compose::{Claims, ComposeLog};
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
    /// After composition, before the floor and ceiling.
    pub composed: f64,
    /// The composition fold at this column.
    pub compose: ComposeLog,
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
    /// Claims: bit, weight, owner node.
    pub claims: Vec<(String, f64, String)>,
    /// The zone and the node that wrote it (`None` for the base).
    pub zone: Option<(String, Option<String>)>,
    /// The cave ceiling, if lowered.
    pub cave_ceiling: Option<i32>,
    /// Analytic spans: `(lo, hi, role)`.
    pub spans: Vec<(i32, i32, String)>,
    /// Province entries: kind, `[lo, hi]`, weight, owner node.
    pub provinces: Vec<(String, i32, i32, f64, String)>,
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
        if self.compose.instances.is_empty() {
            let _ = writeln!(s, "  instances: none");
        } else {
            let _ = writeln!(s, "  instances (composition order):");
            for i in &self.compose.instances {
                let _ = writeln!(
                    s,
                    "    #{:<2} {:<16} {:<18} {:<7} cell {:<14} edge {:.4} exclusion {:.4} weight {:.4}{}",
                    i.rank,
                    i.node,
                    i.kind,
                    i.layer,
                    i.cell.map_or("-".to_string(), |(a, b)| format!("({a}, {b})")),
                    i.edge,
                    i.exclusion,
                    i.weight,
                    if i.exclusive { " exclusive" } else { "" }
                );
            }
        }
        for o in &self.compose.ops {
            let _ = writeln!(
                s,
                "    op {:<16} {:<40} t {:.4}: {:.4} -> {:.4}",
                o.node, o.op, o.t, o.before, o.after
            );
        }
        for (layer, g) in &self.compose.layers {
            let _ = writeln!(s, "    after {layer}: {g:.4}");
        }
        let _ = writeln!(
            s,
            "  ground: spine {:.4} -> composed {:.4} -> floor and ceiling -> {:.4}; top {}",
            self.spine, self.composed, self.ground, self.top
        );
        for (bit, w, owner) in &self.claims {
            let _ = writeln!(s, "  claim {bit:<10} weight {w:.4} owner {owner}");
        }
        if let Some((z, owner)) = &self.zone {
            let _ = writeln!(
                s,
                "  zone {z} (owner {})",
                owner.as_deref().unwrap_or("base")
            );
        }
        if let Some(c) = self.cave_ceiling {
            let _ = writeln!(s, "  cave ceiling {c}");
        }
        for (lo, hi, role) in &self.spans {
            let _ = writeln!(s, "  span [{lo}, {hi}] {role}");
        }
        for (kind, lo, hi, w, owner) in &self.provinces {
            let _ = writeln!(
                s,
                "  province {kind} [{lo}, {hi}] weight {w:.4} owner {owner}"
            );
        }
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
        // The fold at this one column, recorded.
        let area = Area {
            x0: x,
            z0: z,
            w: 1,
            d: 1,
        };
        let grid = self.fields.evaluate(area, 0, &self.tiles);
        let base = grid.output(self.slots.ground, x, z);
        let dispatch = self.dispatch(area, &self.all_nodes);
        let (composed, compose) = if dispatch.is_empty() {
            (base, ComposeLog::default())
        } else {
            let st = self.compose(area, vec![base], &dispatch, Some((x, z)));
            (st.ground[0], st.log.map(|(_, l)| l).unwrap_or_default())
        };
        let owner_name = |rank: u16| -> String {
            self.order
                .get(rank as usize)
                .map_or("?".to_string(), |&n| self.node(n).id.clone())
        };
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
        let fi = facts.index(x, z).expect("the built column");
        let claims = c
            .claims
            .iter()
            .map(|e| {
                (
                    Claims::bit_name(e.bit),
                    e.weight as f64,
                    owner_name(e.owner),
                )
            })
            .collect();
        let zone = self.zones.name(c.zone).map(|z| {
            let owner = facts
                .zone_owner
                .as_ref()
                .map(|o| o[fi])
                .filter(|&r| r > 0)
                .map(|r| owner_name(r - 1));
            (z.to_string(), owner)
        });
        let spans = facts
            .spans_at(fi)
            .iter()
            .map(|sp| {
                (
                    sp.lo,
                    sp.hi,
                    self.block_role(sp.block).unwrap_or("?").to_string(),
                )
            })
            .collect();
        let provinces = facts
            .provinces_at(fi)
            .iter()
            .map(|e| {
                (
                    self.provinces[e.slot as usize].kind.to_string(),
                    e.lo,
                    e.hi,
                    e.weight as f64,
                    owner_name(e.owner),
                )
            })
            .collect();
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
            composed,
            compose,
            claims,
            zone,
            cave_ceiling: c.cave_ceiling,
            spans,
            provinces,
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
