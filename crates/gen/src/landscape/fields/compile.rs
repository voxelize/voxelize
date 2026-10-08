//! The field compiler: named fields to stage programs, with the analyses
//! and taste guards.
//!
//! **Semantics.** Every reference has point semantics: `Ref(f)` is field
//! `f` at this position. A full-rate field is inlined (and hash-consed, so
//! a field read by many is computed once per column); a strided field is
//! always read through its interpolation, so every reader sees the same
//! value. `SlopeOf(f)` and `CurvatureOf(f)` read `f` at the four
//! neighbouring columns, so `f` is materialized as a plane by an earlier
//! *stage* over a one-column-wider area. A point query and the chunk grid
//! run the same programs on the same positions, so they agree bit for bit.
//!
//! **Stages.** A full-rate field's stage is one more than the deepest
//! stencil target it reads (0 with none). Stencil targets become planes of
//! their stage; every other requested output is computed by the last
//! stage. Strided fields are evaluated on their own lattices first, in
//! dependency order.
//!
//! **Analyses** (lints and bounds only; they never change what is
//! computed): interval *range*, *bandwidth* (the shortest wavelength a
//! field carries, unknown through a crease), and a *Lipschitz* bound per
//! block (unknown where no safe bound is known), used by tile gates and by
//! the product rule.
//!
//! **Taste guards** run over every field the spine `ground` reads
//! ([`super::taste`]): Shape and cellular terms at or above
//! `min_ground_wavelength`, fine Grain amplitude on ground (through every
//! enclosing node's gain) at most `max_fine_amplitude`, strata and bench
//! terms at or above their periods, every warp within the fold limit, and
//! no unabsorbed crease or step on ground.

use std::collections::{BTreeMap, BTreeSet};

use crate::landscape::math::MinMax;
use crate::landscape::spec::{Domain, FieldDef, Resolution, SpecError, TasteGuards, WorldFrame};
use crate::stream::{stream_seed_bytes, Subsystem};

use super::eval::{CellKernel, NoiseKernel, MAX_KNOTS, NOISE_GAIN, PERLIN_GRADIENT_BOUND};
use super::ir::{Op, Program, ProgramBuilder, Reg, RouterTable, SplineTable};
use super::nodes::{CellMode, FieldExpr, NoiseM, TermRole};

/// The name of the spine field: final ground before composition.
pub const SPINE: &str = "ground";

/// Overshoot of the C1 bicubic over its nodes' range, as a share of that
/// range (the 2D Catmull-Rom weights' negative mass, rounded up).
const STRIDED_OVERSHOOT: f64 = 0.3;
/// Lipschitz growth through the bicubic, rounded up.
pub(super) const STRIDED_LIPSCHITZ: f64 = 1.6;

/// What the analyses know about a field or node.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Analysis {
    /// A conservative output interval.
    pub range: (f64, f64),
    /// The shortest wavelength carried, in blocks (`f64::INFINITY` for a
    /// constant), or `None` through a crease or other nonlinearity.
    pub wavelength: Option<f64>,
    /// A Lipschitz bound per block, or `None` when no safe bound is known.
    pub lipschitz: Option<f64>,
}

impl Analysis {
    fn constant(v: f64) -> Self {
        Self {
            range: (v, v),
            wavelength: Some(f64::INFINITY),
            lipschitz: Some(0.0),
        }
    }

    /// The larger magnitude of the range's ends.
    pub fn max_abs(&self) -> f64 {
        self.range.0.abs().fmax(self.range.1.abs())
    }
}

fn min_wave(a: Option<f64>, b: Option<f64>) -> Option<f64> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.fmin(b)),
        _ => None,
    }
}

/// The shortest wavelength of a product: components at `a` and `b`
/// multiply into one at `1 / (1/a + 1/b)` (a constant, at infinity, leaves
/// the other's).
fn product_wave(a: Option<f64>, b: Option<f64>) -> Option<f64> {
    match (a, b) {
        (Some(a), Some(b)) => Some(1.0 / (1.0 / a + 1.0 / b)),
        _ => None,
    }
}

fn add_l(a: Option<f64>, b: Option<f64>) -> Option<f64> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a + b),
        _ => None,
    }
}

fn mul_range(a: (f64, f64), b: (f64, f64)) -> (f64, f64) {
    let p = [a.0 * b.0, a.0 * b.1, a.1 * b.0, a.1 * b.1];
    let mut lo = p[0];
    let mut hi = p[0];
    for &v in &p[1..] {
        lo = lo.fmin(v);
        hi = hi.fmax(v);
    }
    (lo, hi)
}

fn hull(a: (f64, f64), b: (f64, f64)) -> (f64, f64) {
    (a.0.fmin(b.0), a.1.fmax(b.1))
}

/// One named field, compiled.
#[derive(Clone, Debug)]
pub struct FieldInfo {
    /// Its name.
    pub name: String,
    /// Its authored definition.
    pub def: FieldDef,
    /// Its analysis.
    pub analysis: Analysis,
    /// Stage of a full-rate field (0 for strided ones).
    pub stage: usize,
    /// Whether some output or stencil needs it (dead-node elimination).
    pub live: bool,
}

/// A strided field's lattice program.
#[derive(Clone, Debug)]
pub struct StridedField {
    /// Index into the field table.
    pub field: usize,
    /// Lattice stride (4 or 16).
    pub stride: i32,
    /// The program evaluated at each node; its one output is the value.
    pub program: Program,
    /// Strided fields its program reads.
    pub deps: Vec<u32>,
}

/// A materialized full-rate plane.
#[derive(Clone, Debug)]
pub struct PlaneInfo {
    /// Index into the field table.
    pub field: usize,
    /// The stage that computes it.
    pub stage: usize,
}

/// One stage: a program whose outputs are this stage's planes, in order.
#[derive(Clone, Debug)]
pub struct Stage {
    /// The program.
    pub program: Program,
    /// The planes its outputs fill, in output order.
    pub planes: Vec<u32>,
}

/// Every named field, compiled into stage programs.
#[derive(Debug)]
pub struct CompiledFields {
    /// Every field in name order.
    pub fields: Vec<FieldInfo>,
    /// Noise kernels.
    pub noise: Vec<NoiseKernel>,
    /// Cellular kernels.
    pub cells: Vec<CellKernel>,
    /// Strided fields in dependency order.
    pub strided: Vec<StridedField>,
    /// Materialized planes.
    pub planes: Vec<PlaneInfo>,
    /// Stages, first to last.
    pub stages: Vec<Stage>,
    /// The plane holding each requested output, in request order.
    pub outputs: Vec<u32>,
    /// Compile lints (warnings).
    pub lints: Vec<String>,
}

impl CompiledFields {
    /// Index of a field by name.
    pub fn field_index(&self, name: &str) -> Option<usize> {
        self.fields.iter().position(|f| f.name == name)
    }

    /// The analysis of a field by name.
    pub fn analysis(&self, name: &str) -> Option<Analysis> {
        self.field_index(name).map(|i| self.fields[i].analysis)
    }

    /// Ops across every program (for reports and the CSE tests).
    pub fn op_count(&self) -> usize {
        self.stages
            .iter()
            .map(|s| s.program.ops.len())
            .sum::<usize>()
            + self
                .strided
                .iter()
                .map(|s| s.program.ops.len())
                .sum::<usize>()
    }
}

/// Inputs to the compiler.
pub struct FieldsConfig<'a> {
    /// The resolved frame.
    pub frame: &'a WorldFrame,
    /// World seed.
    pub world_seed: u32,
    /// Dimension key.
    pub dimension: &'a str,
    /// Taste guards.
    pub taste: &'a TasteGuards,
    /// Hash-consing on (always, outside the CSE-equivalence tests).
    pub cse: bool,
}

/// The world-wide salt namespace: every salt claimed once, `engine.`
/// reserved.
#[derive(Debug, Default)]
pub struct SaltClaims {
    claims: BTreeMap<String, (String, String)>,
}

impl SaltClaims {
    /// Claim `salt` for `owner` (a spec path), with `key` naming exactly
    /// what it seeds: a second claim with the same key shares the stream
    /// (the same noise written twice); any other second claim refuses.
    pub fn claim(&mut self, salt: &str, owner: &str, key: &str) -> Result<bool, SpecError> {
        if salt.starts_with(crate::spec::ENGINE_SALT_PREFIX) {
            return Err(SpecError::new(
                owner,
                format!("salt {salt:?} uses the reserved \"engine.\" namespace"),
            ));
        }
        if salt.is_empty() {
            return Err(SpecError::new(owner, "empty salt"));
        }
        match self.claims.get(salt) {
            Some((first, k)) if k == key => {
                let _ = first;
                Ok(false)
            }
            Some((first, _)) => Err(SpecError::new(
                owner,
                format!("salt {salt:?} is already claimed by {first}"),
            )),
            None => {
                self.claims
                    .insert(salt.to_string(), (owner.to_string(), key.to_string()));
                Ok(true)
            }
        }
    }

    /// Every claimed salt, sorted.
    pub fn salts(&self) -> impl Iterator<Item = &str> {
        self.claims.keys().map(|s| s.as_str())
    }
}

pub(super) struct Ctx<'a> {
    pub(super) defs: &'a BTreeMap<String, FieldDef>,
    pub(super) cfg: &'a FieldsConfig<'a>,
    salts: &'a mut SaltClaims,
    noise: Vec<NoiseKernel>,
    noise_by_salt: BTreeMap<String, u32>,
    cells: Vec<CellKernel>,
    cell_by_salt: BTreeMap<String, u32>,
    analyses: BTreeMap<String, Analysis>,
    pub(super) lints: Vec<String>,
    pub(super) strict_errors: Vec<SpecError>,
}

pub(super) fn path_of(name: &str) -> String {
    format!("fields.{name}.graph")
}

/// Compile every field in `defs`, materializing `outputs` (field names).
pub fn compile_fields(
    defs: &BTreeMap<String, FieldDef>,
    outputs: &[String],
    cfg: &FieldsConfig<'_>,
    salts: &mut SaltClaims,
) -> Result<CompiledFields, SpecError> {
    let names: Vec<String> = defs.keys().cloned().collect();
    // Validate shapes and references.
    for (name, def) in defs {
        validate_def(name, def)?;
    }
    for out in outputs {
        if !defs.contains_key(out) {
            return Err(SpecError::new(
                format!("fields.{out}"),
                "a required field is not declared",
            ));
        }
    }
    let deps = dependencies(defs)?;
    detect_cycles(defs, &deps)?;

    // Strided fields may not depend on a stencil, directly or through a
    // full-rate field they inline.
    let has_stencil = stencil_reach(defs, &deps);
    for (name, def) in defs {
        if let Resolution::Stride(_) = def.resolution {
            if has_stencil.contains(name) {
                return Err(SpecError::new(
                    path_of(name),
                    "a strided field may not read SlopeOf or CurvatureOf (directly or through a full-rate field)",
                ));
            }
        }
    }
    for (name, d) in &deps {
        for t in &d.stencils {
            if !matches!(defs[t].resolution, Resolution::Full) {
                return Err(SpecError::new(
                    path_of(name),
                    format!("SlopeOf/CurvatureOf target {t:?} must be a full-rate field"),
                ));
            }
        }
    }

    // Natural stages.
    let mut natural: BTreeMap<String, usize> = BTreeMap::new();
    for name in &names {
        natural_stage(name, defs, &deps, &mut natural);
    }

    // Liveness: outputs and everything they read.
    let mut live: BTreeSet<String> = BTreeSet::new();
    let mut stack: Vec<String> = outputs.to_vec();
    while let Some(n) = stack.pop() {
        if live.insert(n.clone()) {
            let d = &deps[&n];
            stack.extend(d.refs.iter().cloned());
            stack.extend(d.stencils.iter().cloned());
        }
    }
    let targets: BTreeSet<String> = live
        .iter()
        .flat_map(|n| deps[n].stencils.iter().cloned())
        .collect();

    let mut ctx = Ctx {
        defs,
        cfg,
        salts,
        noise: Vec::new(),
        noise_by_salt: BTreeMap::new(),
        cells: Vec::new(),
        cell_by_salt: BTreeMap::new(),
        analyses: BTreeMap::new(),
        lints: Vec::new(),
        strict_errors: Vec::new(),
    };

    // Analyses (memoized per field) and kernels for every field, live or
    // not, so salts are claimed whatever the outputs.
    for name in &names {
        ctx.analyze_field(name)?;
    }
    for name in &names {
        let def = &defs[name];
        ctx.claim_kernels(name, &def.graph)?;
    }

    // Domain and declared-range checks.
    for name in &names {
        let def = &defs[name];
        let a = ctx.analyses[name];
        if def.domain == Domain::Macro {
            match a.wavelength {
                Some(w) if w < 128.0 => {
                    return Err(SpecError::new(
                        path_of(name),
                        format!("a Macro field carries a {w:.1}-block wavelength; Macro needs at least 128"),
                    ))
                }
                None => ctx.lints.push(format!(
                    "lint MacroBandwidthUnknown: fields.{name} is Macro but its bandwidth is unknown (a crease or nonlinear node)"
                )),
                _ => {}
            }
        }
        if let Some((lo, hi)) = def.range {
            if !(a.range.0 >= lo && a.range.1 <= hi) {
                return Err(SpecError::new(
                    format!("fields.{name}.range"),
                    format!(
                        "the analysed range [{:.4}, {:.4}] is not within the declared [{lo}, {hi}]",
                        a.range.0, a.range.1
                    ),
                ));
            }
        }
    }

    // Taste guards over everything the spine reads.
    if defs.contains_key(SPINE) {
        ctx.taste(&deps)?;
    }
    if let Some(e) = ctx.strict_errors.first() {
        return Err(e.clone());
    }

    // Strided fields, in dependency order.
    let mut strided_order: Vec<String> = Vec::new();
    {
        let mut done: BTreeSet<String> = BTreeSet::new();
        fn visit(
            n: &str,
            defs: &BTreeMap<String, FieldDef>,
            deps: &BTreeMap<String, Deps>,
            done: &mut BTreeSet<String>,
            out: &mut Vec<String>,
        ) {
            if done.contains(n) {
                return;
            }
            done.insert(n.to_string());
            for r in &deps[n].refs {
                visit(r, defs, deps, done, out);
            }
            if matches!(defs[n].resolution, Resolution::Stride(_)) {
                out.push(n.to_string());
            }
        }
        for name in &live {
            visit(name, defs, &deps, &mut done, &mut strided_order);
        }
    }
    let strided_index: BTreeMap<String, u32> = strided_order
        .iter()
        .enumerate()
        .map(|(i, n)| (n.clone(), i as u32))
        .collect();

    // Planes: stencil targets at their natural stage; other outputs at the
    // last stage.
    let last = live
        .iter()
        .filter(|n| matches!(defs[*n].resolution, Resolution::Full))
        .map(|n| natural[n])
        .max()
        .unwrap_or(0);
    let mut planes: Vec<PlaneInfo> = Vec::new();
    let mut plane_of: BTreeMap<String, u32> = BTreeMap::new();
    for t in &targets {
        plane_of.insert(t.clone(), planes.len() as u32);
        planes.push(PlaneInfo {
            field: names.iter().position(|n| n == t).unwrap(),
            stage: natural[t],
        });
    }
    for out in outputs {
        if plane_of.contains_key(out) {
            continue;
        }
        plane_of.insert(out.clone(), planes.len() as u32);
        planes.push(PlaneInfo {
            field: names.iter().position(|n| n == out).unwrap(),
            stage: last,
        });
    }

    let mut strided: Vec<StridedField> = Vec::new();
    for name in &strided_order {
        let Resolution::Stride(s) = defs[name].resolution else {
            unreachable!()
        };
        let mut b = ProgramBuilder::new();
        b.cse = cfg.cse;
        let mut deps_read: BTreeSet<u32> = BTreeSet::new();
        let r = {
            let mut lower = Lower {
                ctx: &mut ctx,
                b: &mut b,
                stage: usize::MAX,
                plane_of: &BTreeMap::new(),
                planes: &[],
                strided_index: &strided_index,
                self_strided: Some(name.as_str()),
                strided_read: &mut deps_read,
            };
            lower.expr(name, &defs[name].graph)?
        };
        b.output(r);
        strided.push(StridedField {
            field: names.iter().position(|n| n == name).unwrap(),
            stride: s as i32,
            program: b.finish(),
            deps: deps_read.into_iter().collect(),
        });
    }

    let mut stages: Vec<Stage> = Vec::new();
    for k in 0..=last {
        let mut b = ProgramBuilder::new();
        b.cse = cfg.cse;
        let mut stage_planes = Vec::new();
        let mut unused = BTreeSet::new();
        for (p, info) in planes.iter().enumerate() {
            if info.stage != k {
                continue;
            }
            let name = names[info.field].clone();
            let r = if let Some(&s) = strided_index.get(&name) {
                // A strided output is its interpolation, as every reader
                // sees it.
                b.push(Op::Strided(s))
            } else {
                let mut lower = Lower {
                    ctx: &mut ctx,
                    b: &mut b,
                    stage: k,
                    plane_of: &plane_of,
                    planes: &planes,
                    strided_index: &strided_index,
                    self_strided: None,
                    strided_read: &mut unused,
                };
                lower.field_value(&name)?
            };
            b.output(r);
            stage_planes.push(p as u32);
        }
        stages.push(Stage {
            program: b.finish(),
            planes: stage_planes,
        });
    }

    let fields = names
        .iter()
        .map(|n| FieldInfo {
            name: n.clone(),
            def: defs[n].clone(),
            analysis: ctx.analyses[n],
            stage: natural[n],
            live: live.contains(n),
        })
        .collect();
    let out_planes = outputs.iter().map(|o| plane_of[o]).collect();
    let Ctx {
        noise,
        cells,
        lints,
        ..
    } = ctx;
    Ok(CompiledFields {
        fields,
        noise,
        cells,
        strided,
        planes,
        stages,
        outputs: out_planes,
        lints,
    })
}

#[derive(Default, Debug)]
pub(super) struct Deps {
    pub(super) refs: BTreeSet<String>,
    pub(super) stencils: BTreeSet<String>,
}

fn dependencies(defs: &BTreeMap<String, FieldDef>) -> Result<BTreeMap<String, Deps>, SpecError> {
    let mut out = BTreeMap::new();
    for (name, def) in defs {
        let mut d = Deps::default();
        let mut missing: Option<String> = None;
        def.graph.walk(&mut |e| match e {
            FieldExpr::Ref(t) => {
                if !defs.contains_key(t) {
                    missing.get_or_insert_with(|| t.clone());
                }
                d.refs.insert(t.clone());
            }
            FieldExpr::SlopeOf(t) | FieldExpr::CurvatureOf(t) => {
                if !defs.contains_key(t) {
                    missing.get_or_insert_with(|| t.clone());
                }
                d.stencils.insert(t.clone());
            }
            _ => {}
        });
        if let Some(t) = missing {
            return Err(SpecError::new(
                path_of(name),
                format!("reads undeclared field {t:?}"),
            ));
        }
        out.insert(name.clone(), d);
    }
    Ok(out)
}

fn detect_cycles(
    defs: &BTreeMap<String, FieldDef>,
    deps: &BTreeMap<String, Deps>,
) -> Result<(), SpecError> {
    // 0 = unvisited, 1 = on the stack, 2 = done.
    fn dfs(
        n: &str,
        deps: &BTreeMap<String, Deps>,
        state: &mut BTreeMap<String, u8>,
        stack: &mut Vec<String>,
    ) -> Option<Vec<String>> {
        state.insert(n.to_string(), 1);
        stack.push(n.to_string());
        let d = &deps[n];
        for t in d.refs.iter().chain(d.stencils.iter()) {
            match state.get(t.as_str()).copied().unwrap_or(0) {
                1 => {
                    let start = stack.iter().position(|s| s == t).unwrap();
                    let mut cycle: Vec<String> = stack[start..].to_vec();
                    cycle.push(t.clone());
                    return Some(cycle);
                }
                0 => {
                    if let Some(c) = dfs(t, deps, state, stack) {
                        return Some(c);
                    }
                }
                _ => {}
            }
        }
        stack.pop();
        state.insert(n.to_string(), 2);
        None
    }
    let mut state = BTreeMap::new();
    for name in defs.keys() {
        if state.get(name.as_str()).copied().unwrap_or(0) == 0 {
            let mut stack = Vec::new();
            if let Some(cycle) = dfs(name, deps, &mut state, &mut stack) {
                return Err(SpecError::new(
                    path_of(&cycle[0]),
                    format!("field cycle: {}", cycle.join(" -> ")),
                ));
            }
        }
    }
    Ok(())
}

/// Fields that read a stencil, directly or through refs.
fn stencil_reach(
    defs: &BTreeMap<String, FieldDef>,
    deps: &BTreeMap<String, Deps>,
) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    fn reaches(n: &str, deps: &BTreeMap<String, Deps>, memo: &mut BTreeMap<String, bool>) -> bool {
        if let Some(&v) = memo.get(n) {
            return v;
        }
        memo.insert(n.to_string(), false);
        let d = &deps[n];
        let v = !d.stencils.is_empty() || d.refs.iter().any(|r| reaches(r, deps, memo));
        memo.insert(n.to_string(), v);
        v
    }
    let mut memo = BTreeMap::new();
    for name in defs.keys() {
        if reaches(name, deps, &mut memo) {
            out.insert(name.clone());
        }
    }
    out
}

fn natural_stage(
    n: &str,
    defs: &BTreeMap<String, FieldDef>,
    deps: &BTreeMap<String, Deps>,
    memo: &mut BTreeMap<String, usize>,
) -> usize {
    if let Some(&s) = memo.get(n) {
        return s;
    }
    let d = &deps[n];
    let mut s = 0;
    for t in &d.stencils {
        s = Ord::max(s, natural_stage(t, defs, deps, memo) + 1);
    }
    for r in &d.refs {
        // A strided field is read through its lattice, which has no stage.
        if matches!(defs[r].resolution, Resolution::Full) {
            s = Ord::max(s, natural_stage(r, defs, deps, memo));
        }
    }
    memo.insert(n.to_string(), s);
    s
}

fn validate_def(name: &str, def: &FieldDef) -> Result<(), SpecError> {
    if let Resolution::Stride(s) = def.resolution {
        if s != 4 && s != 16 {
            return Err(SpecError::new(
                format!("fields.{name}.resolution"),
                format!("Stride({s}): strides are 4 or 16"),
            ));
        }
    }
    if let Some((lo, hi)) = def.range {
        if !(lo.is_finite() && hi.is_finite() && lo <= hi) {
            return Err(SpecError::new(
                format!("fields.{name}.range"),
                "range must be finite and ordered",
            ));
        }
    }
    let path = path_of(name);
    let mut err: Option<String> = None;
    let mut fail = |m: String| {
        err.get_or_insert(m);
    };
    def.graph.walk(&mut |e| match e {
        FieldExpr::Const(v) if !v.is_finite() => fail("a constant is not finite".into()),
        FieldExpr::Relief(v) if !v.is_finite() => fail("a relief share is not finite".into()),
        FieldExpr::Height(h) if !h.raw().is_finite() => fail("a height is not finite".into()),
        FieldExpr::Noise(n) => {
            if !(1..=8).contains(&n.octaves) {
                fail(format!(
                    "noise {:?}: octaves {} is outside 1..=8",
                    n.salt, n.octaves
                ));
            }
            if !(n.wavelength.raw() > 0.0 && n.wavelength.raw().is_finite()) {
                fail(format!("noise {:?}: wavelength must be positive", n.salt));
            }
            if !(n.persistence > 0.0 && n.persistence <= 1.0) {
                fail(format!("noise {:?}: persistence must be in (0, 1]", n.salt));
            }
            if !(n.lacunarity >= 1.0 && n.lacunarity <= 4.0) {
                fail(format!("noise {:?}: lacunarity must be in [1, 4]", n.salt));
            }
            if !n.amp.is_finite() {
                fail(format!("noise {:?}: amp must be finite", n.salt));
            }
            if let Some(w) = &n.warp {
                if !(w.amp.raw() >= 0.0 && w.amp.raw().is_finite()) {
                    fail(format!(
                        "noise {:?}: warp amp must be finite and non-negative",
                        n.salt
                    ));
                }
            }
        }
        FieldExpr::Cellular(c) => {
            if !(c.wavelength.raw() > 0.0 && c.wavelength.raw().is_finite()) {
                fail(format!(
                    "cellular {:?}: wavelength must be positive",
                    c.salt
                ));
            }
            if !(0.0..=1.0).contains(&c.jitter) {
                fail(format!("cellular {:?}: jitter must be in 0..=1", c.salt));
            }
            if !c.amp.is_finite() {
                fail(format!("cellular {:?}: amp must be finite", c.salt));
            }
        }
        FieldExpr::Div { eps, .. } if !(*eps > 0.0 && eps.is_finite()) => {
            fail("Div eps must be positive and finite".into())
        }
        FieldExpr::SMin { k, .. } | FieldExpr::SMax { k, .. } | FieldExpr::SAbs { k, .. }
            if !(*k > 0.0 && k.is_finite()) =>
        {
            fail("smooth min, max and abs need a finite k > 0".into())
        }
        FieldExpr::Clamp { lo, hi, .. } if !(lo <= hi && lo.is_finite() && hi.is_finite()) => {
            fail("Clamp needs finite lo <= hi".into())
        }
        FieldExpr::Affine { mul, add, .. } if !(mul.is_finite() && add.is_finite()) => {
            fail("Affine needs a finite factor and offset".into())
        }
        FieldExpr::Smoothstep { e0, e1, .. } | FieldExpr::Smootherstep { e0, e1, .. }
            if !(e0 != e1 && e0.is_finite() && e1.is_finite()) =>
        {
            fail("a smoothstep window needs distinct finite edges".into())
        }
        FieldExpr::Bias { b, .. } if !(*b > 0.0 && *b < 1.0) => fail("Bias needs 0 < b < 1".into()),
        FieldExpr::Gain { g, .. } if !(*g > 0.0 && *g < 1.0) => fail("Gain needs 0 < g < 1".into()),
        FieldExpr::PowSmooth { e, .. } if !(*e > 0.0 && *e <= 64.0) => {
            fail("PowSmooth needs 0 < e <= 64".into())
        }
        FieldExpr::Terrace { step, softness, .. }
            if !(*step > 0.0 && step.is_finite() && *softness > 0.0 && *softness <= 1.0) =>
        {
            fail("Terrace needs step > 0 and 0 < softness <= 1".into())
        }
        FieldExpr::Pulse {
            period,
            softness,
            role,
            ..
        } => {
            if !(*period > 0.0 && period.is_finite() && *softness > 0.0 && *softness <= 1.0) {
                fail("Pulse needs period > 0 and 0 < softness <= 1".into());
            }
            if !matches!(role, TermRole::Strata | TermRole::Bench) {
                fail("a Pulse is a Strata or Bench term".into());
            }
        }
        FieldExpr::Select { at, blend, .. }
            if !(*blend >= 0.0 && blend.is_finite() && at.is_finite()) =>
        {
            fail("Select needs a finite threshold and a finite blend >= 0".into())
        }
        FieldExpr::Spline { knots, .. } => {
            if knots.len() < 2 || knots.len() > MAX_KNOTS {
                fail(format!("a spline needs 2..={MAX_KNOTS} knots"));
            } else if !knots.windows(2).all(|w| w[0].0 < w[1].0)
                || knots.iter().any(|k| !k.0.is_finite() || !k.1.is_finite())
            {
                fail("spline knots need finite, strictly increasing x".into());
            }
        }
        FieldExpr::Router { knots, .. } => {
            if knots.len() < 2 || knots.len() > MAX_KNOTS {
                fail(format!("a router needs 2..={MAX_KNOTS} knots"));
            } else if !knots.windows(2).all(|w| w[0].0 < w[1].0)
                || knots.iter().any(|k| !k.0.is_finite())
            {
                fail("router knots need finite, strictly increasing x".into());
            }
        }
        FieldExpr::Sum(v) | FieldExpr::Product(v) if v.is_empty() => {
            fail("an empty Sum or Product".into())
        }
        _ => {}
    });
    match err {
        Some(m) => Err(SpecError::new(path, m)),
        None => Ok(()),
    }
}

impl Ctx<'_> {
    fn analyze_field(&mut self, name: &str) -> Result<Analysis, SpecError> {
        if let Some(a) = self.analyses.get(name) {
            return Ok(*a);
        }
        let def = &self.defs[name];
        let mut a = self.analyze(name, &def.graph)?;
        if let Resolution::Stride(_) = def.resolution {
            let w = a.range.1 - a.range.0;
            a.range = (
                a.range.0 - STRIDED_OVERSHOOT * w,
                a.range.1 + STRIDED_OVERSHOOT * w,
            );
            a.lipschitz = a.lipschitz.map(|l| l * STRIDED_LIPSCHITZ);
        }
        self.analyses.insert(name.to_string(), a);
        Ok(a)
    }

    pub(super) fn noise_lipschitz(&self, n: &NoiseM) -> f64 {
        let f = 1.0 / self.cfg.frame.span(n.wavelength);
        let mut num = 0.0;
        let mut den = 0.0;
        let mut amp = 1.0;
        let mut freq = f;
        for _ in 0..n.octaves {
            num += amp * freq;
            den += amp;
            amp *= n.persistence;
            freq *= n.lacunarity;
        }
        n.amp.abs() * NOISE_GAIN * PERLIN_GRADIENT_BOUND * num / den
    }

    pub(super) fn noise_wavelength(&self, n: &NoiseM) -> f64 {
        let mut w = self.cfg.frame.span(n.wavelength);
        for _ in 1..n.octaves {
            w /= n.lacunarity;
        }
        w
    }

    pub(super) fn analyze(&mut self, field: &str, e: &FieldExpr) -> Result<Analysis, SpecError> {
        use FieldExpr as E;
        let frame = self.cfg.frame;
        Ok(match e {
            E::Const(v) => Analysis::constant(*v),
            E::Height(h) => Analysis::constant(frame.resolve(*h)),
            E::Relief(v) => Analysis::constant(v * frame.relief * frame.relief_scale),
            E::Ref(t) => self.analyze_field(t)?,
            E::SlopeOf(t) => {
                let a = self.analyze_field(t)?;
                Analysis {
                    range: (0.0, a.lipschitz.unwrap_or(f64::INFINITY)),
                    wavelength: a.wavelength,
                    lipschitz: None,
                }
            }
            E::CurvatureOf(t) => {
                let a = self.analyze_field(t)?;
                let w = 4.0 * (a.range.1 - a.range.0);
                let w = match a.lipschitz {
                    Some(l) => w.fmin(4.0 * l),
                    None => w,
                };
                Analysis {
                    range: (-w, w),
                    wavelength: a.wavelength,
                    lipschitz: None,
                }
            }
            E::Noise(n) => {
                let bound = n.amp.abs() * NOISE_GAIN;
                let mut wavelength = Some(self.noise_wavelength(n));
                let mut lipschitz = Some(self.noise_lipschitz(n));
                if let Some(w) = &n.warp {
                    let ax = self.analyze(field, &w.x)?;
                    let az = self.analyze(field, &w.z)?;
                    let amp = frame.span(w.amp);
                    // A warp shortens wavelengths by 1 + its fold: amp times
                    // the inputs' steepest slope, in sinusoid units (amp 2 pi
                    // / lambda for a unit fbm input at lambda).
                    let fold = match (
                        min_wave(ax.wavelength, az.wavelength),
                        ax.lipschitz,
                        az.lipschitz,
                    ) {
                        (Some(_), Some(lx), Some(lz)) => {
                            Some(amp * lx.fmax(lz) * super::taste::FOLD_PER_LIPSCHITZ)
                        }
                        _ => None,
                    };
                    wavelength = match (wavelength, fold) {
                        (Some(base), Some(fold)) => Some(base / (1.0 + fold)),
                        _ => None,
                    };
                    lipschitz = match (lipschitz, add_l(ax.lipschitz, az.lipschitz)) {
                        (Some(l), Some(lw)) => Some(l * (1.0 + amp * lw)),
                        _ => None,
                    };
                }
                Analysis {
                    range: (-bound, bound),
                    wavelength,
                    lipschitz,
                }
            }
            E::Cellular(c) => {
                let cell = frame.span(c.wavelength);
                let (top, slope) = match c.mode {
                    CellMode::F1 => (1.5, 1.0),
                    CellMode::F2MinusF1 => (2.5, 2.0),
                };
                let a = c.amp;
                Analysis {
                    range: if a >= 0.0 {
                        (0.0, top * a)
                    } else {
                        (top * a, 0.0)
                    },
                    wavelength: None,
                    lipschitz: Some(slope * a.abs() / cell),
                }
            }
            E::Sum(v) => {
                let mut acc = Analysis::constant(0.0);
                for t in v {
                    let a = self.analyze(field, t)?;
                    acc = Analysis {
                        range: (acc.range.0 + a.range.0, acc.range.1 + a.range.1),
                        wavelength: min_wave(acc.wavelength, a.wavelength),
                        lipschitz: add_l(acc.lipschitz, a.lipschitz),
                    };
                }
                acc
            }
            E::Product(v) => {
                let mut acc = Analysis::constant(1.0);
                for t in v {
                    let a = self.analyze(field, t)?;
                    let l = match (acc.lipschitz, a.lipschitz) {
                        (Some(la), Some(lb)) => Some(acc.max_abs() * lb + a.max_abs() * la),
                        _ => None,
                    };
                    acc = Analysis {
                        range: mul_range(acc.range, a.range),
                        wavelength: product_wave(acc.wavelength, a.wavelength),
                        lipschitz: l,
                    };
                }
                acc
            }
            E::Sub(a, b) => {
                let (a, b) = (self.analyze(field, a)?, self.analyze(field, b)?);
                Analysis {
                    range: (a.range.0 - b.range.1, a.range.1 - b.range.0),
                    wavelength: min_wave(a.wavelength, b.wavelength),
                    lipschitz: add_l(a.lipschitz, b.lipschitz),
                }
            }
            E::Div { num, den, eps } => {
                let (a, b) = (self.analyze(field, num)?, self.analyze(field, den)?);
                let range = if b.range.0 >= *eps || b.range.1 <= -eps {
                    let inv = (1.0 / b.range.1, 1.0 / b.range.0);
                    mul_range(a.range, (inv.0.fmin(inv.1), inv.0.fmax(inv.1)))
                } else {
                    let m = a.max_abs() / eps;
                    (-m, m)
                };
                Analysis {
                    range,
                    wavelength: min_wave(a.wavelength, b.wavelength),
                    lipschitz: None,
                }
            }
            E::Neg(x) => {
                let a = self.analyze(field, x)?;
                Analysis {
                    range: (-a.range.1, -a.range.0),
                    ..a
                }
            }
            E::Abs(x) => {
                let a = self.analyze(field, x)?;
                let lo = if a.range.0 <= 0.0 && a.range.1 >= 0.0 {
                    0.0
                } else {
                    a.range.0.abs().fmin(a.range.1.abs())
                };
                Analysis {
                    range: (lo, a.max_abs()),
                    wavelength: None,
                    lipschitz: a.lipschitz,
                }
            }
            E::Sqrt(x) => {
                let a = self.analyze(field, x)?;
                Analysis {
                    range: (a.range.0.fmax(0.0).sqrt(), a.range.1.fmax(0.0).sqrt()),
                    wavelength: a.wavelength,
                    lipschitz: None,
                }
            }
            E::Min(a, b) | E::Max(a, b) => {
                let is_min = matches!(e, E::Min(..));
                let (a, b) = (self.analyze(field, a)?, self.analyze(field, b)?);
                let range = if is_min {
                    (a.range.0.fmin(b.range.0), a.range.1.fmin(b.range.1))
                } else {
                    (a.range.0.fmax(b.range.0), a.range.1.fmax(b.range.1))
                };
                Analysis {
                    range,
                    wavelength: None,
                    lipschitz: match (a.lipschitz, b.lipschitz) {
                        (Some(x), Some(y)) => Some(x.fmax(y)),
                        _ => None,
                    },
                }
            }
            E::SMin { a, b, k } | E::SMax { a, b, k } => {
                let is_min = matches!(e, E::SMin { .. });
                let (a, b) = (self.analyze(field, a)?, self.analyze(field, b)?);
                let range = if is_min {
                    (
                        a.range.0.fmin(b.range.0) - 0.25 * k,
                        a.range.1.fmin(b.range.1),
                    )
                } else {
                    (
                        a.range.0.fmax(b.range.0),
                        a.range.1.fmax(b.range.1) + 0.25 * k,
                    )
                };
                Analysis {
                    range,
                    wavelength: min_wave(a.wavelength, b.wavelength),
                    lipschitz: match (a.lipschitz, b.lipschitz) {
                        (Some(x), Some(y)) => Some(x.fmax(y)),
                        _ => None,
                    },
                }
            }
            E::SAbs { x, k } => {
                let a = self.analyze(field, x)?;
                let lo = if a.range.0 <= 0.0 && a.range.1 >= 0.0 {
                    0.0
                } else {
                    a.range.0.abs().fmin(a.range.1.abs())
                };
                Analysis {
                    range: (lo, a.max_abs() + 0.25 * k),
                    wavelength: a.wavelength,
                    lipschitz: a.lipschitz,
                }
            }
            E::Clamp { x, lo, hi } => {
                let a = self.analyze(field, x)?;
                Analysis {
                    range: (a.range.0.fclamp(*lo, *hi), a.range.1.fclamp(*lo, *hi)),
                    wavelength: None,
                    lipschitz: a.lipschitz,
                }
            }
            E::Affine { x, mul, add } => {
                let a = self.analyze(field, x)?;
                let (p, q) = (a.range.0 * mul + add, a.range.1 * mul + add);
                Analysis {
                    range: (p.fmin(q), p.fmax(q)),
                    wavelength: a.wavelength,
                    lipschitz: a.lipschitz.map(|l| l * mul.abs()),
                }
            }
            E::Smoothstep { x, e0, e1 } | E::Smootherstep { x, e0, e1 } => {
                let quintic = matches!(e, E::Smootherstep { .. });
                let a = self.analyze(field, x)?;
                let f = |v: f64| {
                    if quintic {
                        crate::landscape::math::smootherstep(*e0, *e1, v)
                    } else {
                        crate::landscape::math::smoothstep(*e0, *e1, v)
                    }
                };
                let (p, q) = (f(a.range.0), f(a.range.1));
                let peak = if quintic { 1.875 } else { 1.5 };
                Analysis {
                    range: (p.fmin(q), p.fmax(q)),
                    wavelength: a.wavelength,
                    lipschitz: a.lipschitz.map(|l| peak * l / (e1 - e0).abs()),
                }
            }
            E::Lerp { a, b, t } => {
                let (a, b, t) = (
                    self.analyze(field, a)?,
                    self.analyze(field, b)?,
                    self.analyze(field, t)?,
                );
                let range = if t.range.0 >= 0.0 && t.range.1 <= 1.0 {
                    hull(a.range, b.range)
                } else {
                    let d = (b.range.0 - a.range.1, b.range.1 - a.range.0);
                    let m = mul_range(d, t.range);
                    (a.range.0 + m.0, a.range.1 + m.1)
                };
                let tmax = t.max_abs();
                let one_minus = (1.0 - t.range.0).abs().fmax((1.0 - t.range.1).abs());
                let diff = (b.range.1 - a.range.0)
                    .abs()
                    .fmax((b.range.0 - a.range.1).abs());
                let l = match (a.lipschitz, b.lipschitz, t.lipschitz) {
                    (Some(la), Some(lb), Some(lt)) => Some(la * one_minus + lb * tmax + diff * lt),
                    _ => None,
                };
                Analysis {
                    range,
                    wavelength: min_wave(min_wave(a.wavelength, b.wavelength), t.wavelength),
                    lipschitz: l,
                }
            }
            E::Bias { x, b } => {
                let a = self.analyze(field, x)?;
                let f = |v: f64| crate::landscape::math::bias(v.fclamp(0.0, 1.0), *b);
                Analysis {
                    range: (f(a.range.0), f(a.range.1)),
                    wavelength: a.wavelength,
                    lipschitz: a.lipschitz.map(|l| l * (b / (1.0 - b)).fmax((1.0 - b) / b)),
                }
            }
            E::Gain { x, g } => {
                let a = self.analyze(field, x)?;
                let f = |v: f64| crate::landscape::math::gain(v.fclamp(0.0, 1.0), *g);
                Analysis {
                    range: (
                        f(a.range.0).fmin(f(a.range.1)),
                        f(a.range.0).fmax(f(a.range.1)),
                    ),
                    wavelength: a.wavelength,
                    lipschitz: None,
                }
            }
            E::PowSmooth { x, e: ex } => {
                let a = self.analyze(field, x)?;
                let f = |v: f64| crate::landscape::math::pow_smooth(v.fclamp(0.0, 1.0), *ex);
                Analysis {
                    range: (f(a.range.0), f(a.range.1)),
                    wavelength: a.wavelength,
                    lipschitz: if *ex >= 1.0 {
                        a.lipschitz.map(|l| l * ex)
                    } else {
                        None
                    },
                }
            }
            E::Terrace { x, step, softness } => {
                let a = self.analyze(field, x)?;
                let w = (0.5 * softness).fclamp(1e-6, 0.5);
                Analysis {
                    range: (
                        step * (a.range.0 / step).floor(),
                        step * ((a.range.1 / step).floor() + 1.0),
                    ),
                    wavelength: None,
                    lipschitz: a.lipschitz.map(|l| l * 0.75 / w),
                }
            }
            E::Select {
                cond, a, b, blend, ..
            } => {
                let (c, a, b) = (
                    self.analyze(field, cond)?,
                    self.analyze(field, a)?,
                    self.analyze(field, b)?,
                );
                let diff = (b.range.1 - a.range.0)
                    .abs()
                    .fmax((b.range.0 - a.range.1).abs());
                let l = if *blend > 0.0 {
                    match (a.lipschitz, b.lipschitz, c.lipschitz) {
                        (Some(la), Some(lb), Some(lc)) => Some(la + lb + diff * 1.5 * lc / blend),
                        _ => None,
                    }
                } else {
                    None
                };
                Analysis {
                    range: hull(a.range, b.range),
                    wavelength: if *blend > 0.0 {
                        min_wave(min_wave(a.wavelength, b.wavelength), c.wavelength)
                    } else {
                        None
                    },
                    lipschitz: l,
                }
            }
            E::Spline { x, knots } => {
                let a = self.analyze(field, x)?;
                let mut lo = knots[0].1;
                let mut hi = knots[0].1;
                let mut secant: f64 = 0.0;
                for w in knots.windows(2) {
                    lo = lo.fmin(w[1].1);
                    hi = hi.fmax(w[1].1);
                    secant = secant.fmax(((w[1].1 - w[0].1) / (w[1].0 - w[0].0)).abs());
                }
                Analysis {
                    range: (lo, hi),
                    wavelength: a.wavelength,
                    lipschitz: a.lipschitz.map(|l| l * 4.0 * secant),
                }
            }
            E::Router { x, knots } => {
                let a = self.analyze(field, x)?;
                let mut range: Option<(f64, f64)> = None;
                let mut wavelength = a.wavelength;
                for (_, k) in knots {
                    let ka = self.analyze(field, k)?;
                    range = Some(match range {
                        None => ka.range,
                        Some(r) => hull(r, ka.range),
                    });
                    wavelength = min_wave(wavelength, ka.wavelength);
                }
                Analysis {
                    range: range.unwrap(),
                    wavelength,
                    lipschitz: None,
                }
            }
            E::Pulse {
                x,
                period,
                softness,
                ..
            } => {
                let a = self.analyze(field, x)?;
                let w = (0.5 * softness).fclamp(1e-6, 0.5);
                Analysis {
                    range: (0.0, 1.0),
                    wavelength: None,
                    lipschitz: a.lipschitz.map(|l| l * 1.5 / (w * period)),
                }
            }
        })
    }

    fn claim_kernels(&mut self, field: &str, e: &FieldExpr) -> Result<(), SpecError> {
        let mut found: Vec<FieldExpr> = Vec::new();
        e.walk(&mut |n| {
            if matches!(n, FieldExpr::Noise(_) | FieldExpr::Cellular(_)) {
                found.push(n.clone());
            }
        });
        for n in found {
            match n {
                FieldExpr::Noise(n) => {
                    self.noise_kernel(field, &n)?;
                }
                FieldExpr::Cellular(c) => {
                    self.cell_kernel(field, &c)?;
                }
                _ => unreachable!(),
            }
        }
        Ok(())
    }

    fn noise_kernel(&mut self, field: &str, n: &NoiseM) -> Result<u32, SpecError> {
        // The whole node, warp included: one salt never seeds two
        // differently shaped or differently warped terms.
        let key = super::super::canon::to_canonical(n).expect("serializes");
        self.salts
            .claim(&n.salt, &path_of(field), &format!("noise:{key}"))?;
        if let Some(&k) = self.noise_by_salt.get(&n.salt) {
            return Ok(k);
        }
        let seed = stream_seed_bytes(
            self.cfg.world_seed,
            self.cfg.dimension,
            Subsystem::Fields,
            n.salt.as_bytes(),
            0,
        );
        let k = NoiseKernel::new(
            seed,
            1.0 / self.cfg.frame.span(n.wavelength),
            n.octaves,
            n.persistence,
            n.lacunarity,
            n.amp,
        );
        self.noise.push(k);
        let i = (self.noise.len() - 1) as u32;
        self.noise_by_salt.insert(n.salt.clone(), i);
        Ok(i)
    }

    fn cell_kernel(&mut self, field: &str, c: &super::nodes::CellularM) -> Result<u32, SpecError> {
        let key = super::super::canon::to_canonical(&(&c.wavelength, &c.mode, c.jitter, c.amp))
            .expect("serializes");
        self.salts
            .claim(&c.salt, &path_of(field), &format!("cell:{key}"))?;
        if let Some(&k) = self.cell_by_salt.get(&c.salt) {
            return Ok(k);
        }
        let seed = stream_seed_bytes(
            self.cfg.world_seed,
            self.cfg.dimension,
            Subsystem::Fields,
            c.salt.as_bytes(),
            0,
        );
        self.cells.push(CellKernel {
            seed,
            cell: self.cfg.frame.span(c.wavelength),
            jitter: c.jitter,
            amp: c.amp,
            f2_minus_f1: matches!(c.mode, CellMode::F2MinusF1),
        });
        let i = (self.cells.len() - 1) as u32;
        self.cell_by_salt.insert(c.salt.clone(), i);
        Ok(i)
    }
}

/// Lowers trees into one program.
struct Lower<'c, 'a> {
    ctx: &'c mut Ctx<'a>,
    b: &'c mut ProgramBuilder,
    /// The stage being built (`usize::MAX` for a strided lattice program).
    stage: usize,
    plane_of: &'c BTreeMap<String, u32>,
    planes: &'c [PlaneInfo],
    strided_index: &'c BTreeMap<String, u32>,
    /// The strided field whose own lattice this program evaluates.
    self_strided: Option<&'c str>,
    strided_read: &'c mut BTreeSet<u32>,
}

impl Lower<'_, '_> {
    /// A field's value at this position: its own expression, inlined.
    fn field_value(&mut self, name: &str) -> Result<Reg, SpecError> {
        let def = &self.ctx.defs[name];
        self.expr(name, &def.graph)
    }

    fn reference(&mut self, field: &str, target: &str) -> Result<Reg, SpecError> {
        let def = &self.ctx.defs[target];
        if let Resolution::Stride(_) = def.resolution {
            if self.self_strided == Some(target) {
                // Unreachable: cycles are refused.
                return Err(SpecError::new(
                    path_of(field),
                    "a strided field reads itself",
                ));
            }
            let s = self.strided_index[target];
            self.strided_read.insert(s);
            return Ok(self.b.push(Op::Strided(s)));
        }
        if self.stage != usize::MAX {
            if let Some(&p) = self.plane_of.get(target) {
                if self.planes[p as usize].stage < self.stage {
                    return Ok(self.b.push(Op::Plane(p)));
                }
            }
        }
        let _ = field;
        self.field_value(target)
    }

    fn un(&mut self, field: &str, x: &FieldExpr) -> Result<Reg, SpecError> {
        self.expr(field, x)
    }

    fn expr(&mut self, field: &str, e: &FieldExpr) -> Result<Reg, SpecError> {
        use FieldExpr as E;
        let frame = self.ctx.cfg.frame;
        Ok(match e {
            E::Const(v) => self.b.push(Op::Const(*v)),
            E::Height(h) => self.b.push(Op::Const(frame.resolve(*h))),
            E::Relief(v) => self
                .b
                .push(Op::Const(v * frame.relief * frame.relief_scale)),
            E::Ref(t) => self.reference(field, t)?,
            E::SlopeOf(t) | E::CurvatureOf(t) => {
                let p = *self.plane_of.get(t).ok_or_else(|| {
                    SpecError::new(
                        path_of(field),
                        format!("stencil target {t:?} has no plane here"),
                    )
                })?;
                if self.stage == usize::MAX || self.planes[p as usize].stage >= self.stage {
                    return Err(SpecError::new(
                        path_of(field),
                        format!("stencil of {t:?} is not computed by an earlier stage"),
                    ));
                }
                self.b.push(Op::Stencil {
                    plane: p,
                    curvature: matches!(e, E::CurvatureOf(_)),
                })
            }
            E::Noise(n) => {
                let kernel = self.ctx.noise_kernel(field, n)?;
                let warp = match &n.warp {
                    None => None,
                    Some(w) => {
                        let x = self.expr(field, &w.x)?;
                        let z = self.expr(field, &w.z)?;
                        Some((x, z, frame.span(w.amp)))
                    }
                };
                self.b.push(Op::Noise { kernel, warp })
            }
            E::Cellular(c) => {
                let kernel = self.ctx.cell_kernel(field, c)?;
                self.b.push(Op::Cellular { kernel })
            }
            E::Sum(v) => {
                let mut acc = self.expr(field, &v[0])?;
                for t in &v[1..] {
                    let r = self.expr(field, t)?;
                    acc = self.b.push(Op::Add(acc, r));
                }
                acc
            }
            E::Product(v) => {
                let mut acc = self.expr(field, &v[0])?;
                for t in &v[1..] {
                    let r = self.expr(field, t)?;
                    acc = self.b.push(Op::Mul(acc, r));
                }
                acc
            }
            E::Sub(a, b) => {
                let (a, b) = (self.expr(field, a)?, self.expr(field, b)?);
                self.b.push(Op::Sub(a, b))
            }
            E::Div { num, den, eps } => {
                let (n, d) = (self.expr(field, num)?, self.expr(field, den)?);
                self.b.push(Op::Div {
                    num: n,
                    den: d,
                    eps: *eps,
                })
            }
            E::Neg(x) => {
                let r = self.un(field, x)?;
                self.b.push(Op::Neg(r))
            }
            E::Abs(x) => {
                let r = self.un(field, x)?;
                self.b.push(Op::Abs(r))
            }
            E::Sqrt(x) => {
                let r = self.un(field, x)?;
                self.b.push(Op::Sqrt(r))
            }
            E::Min(a, b) => {
                let (a, b) = (self.expr(field, a)?, self.expr(field, b)?);
                self.b.push(Op::Min(a, b))
            }
            E::Max(a, b) => {
                let (a, b) = (self.expr(field, a)?, self.expr(field, b)?);
                self.b.push(Op::Max(a, b))
            }
            E::SMin { a, b, k } => {
                let (a, b) = (self.expr(field, a)?, self.expr(field, b)?);
                self.b.push(Op::SMin { a, b, k: *k })
            }
            E::SMax { a, b, k } => {
                let (a, b) = (self.expr(field, a)?, self.expr(field, b)?);
                self.b.push(Op::SMax { a, b, k: *k })
            }
            E::SAbs { x, k } => {
                let a = self.un(field, x)?;
                let n = self.b.push(Op::Neg(a));
                self.b.push(Op::SMax { a, b: n, k: *k })
            }
            E::Clamp { x, lo, hi } => {
                let r = self.un(field, x)?;
                self.b.push(Op::Clamp {
                    x: r,
                    lo: *lo,
                    hi: *hi,
                })
            }
            E::Affine { x, mul, add } => {
                let r = self.un(field, x)?;
                self.b.push(Op::Affine {
                    x: r,
                    mul: *mul,
                    add: *add,
                })
            }
            E::Smoothstep { x, e0, e1 } => {
                let r = self.un(field, x)?;
                self.b.push(Op::Smoothstep {
                    x: r,
                    e0: *e0,
                    e1: *e1,
                })
            }
            E::Smootherstep { x, e0, e1 } => {
                let r = self.un(field, x)?;
                self.b.push(Op::Smootherstep {
                    x: r,
                    e0: *e0,
                    e1: *e1,
                })
            }
            E::Lerp { a, b, t } => {
                let (a, b, t) = (
                    self.expr(field, a)?,
                    self.expr(field, b)?,
                    self.expr(field, t)?,
                );
                self.b.push(Op::Lerp { a, b, t })
            }
            E::Bias { x, b } => {
                let r = self.un(field, x)?;
                self.b.push(Op::Bias { x: r, b: *b })
            }
            E::Gain { x, g } => {
                let r = self.un(field, x)?;
                self.b.push(Op::Gain { x: r, g: *g })
            }
            E::PowSmooth { x, e } => {
                let r = self.un(field, x)?;
                self.b.push(Op::PowSmooth { x: r, e: *e })
            }
            E::Terrace { x, step, softness } => {
                let r = self.un(field, x)?;
                self.b.push(Op::Terrace {
                    x: r,
                    step: *step,
                    softness: *softness,
                })
            }
            E::Select {
                cond,
                a,
                b,
                at,
                blend,
            } => {
                let (c, a, b) = (
                    self.expr(field, cond)?,
                    self.expr(field, a)?,
                    self.expr(field, b)?,
                );
                self.b.push(Op::Select {
                    cond: c,
                    a,
                    b,
                    at: *at,
                    blend: *blend,
                })
            }
            E::Spline { x, knots } => {
                let r = self.un(field, x)?;
                let spline = self.b.spline(SplineTable::new(knots.clone()));
                self.b.push(Op::Spline { x: r, spline })
            }
            E::Router { x, knots } => {
                let r = self.un(field, x)?;
                let mut table = Vec::with_capacity(knots.len());
                for (kx, k) in knots {
                    table.push((*kx, self.expr(field, k)?));
                }
                let router = self.b.router(RouterTable { knots: table });
                self.b.push(Op::Router { x: r, router })
            }
            E::Pulse {
                x,
                period,
                softness,
                ..
            } => {
                let r = self.un(field, x)?;
                self.b.push(Op::Pulse {
                    x: r,
                    period: *period,
                    softness: *softness,
                })
            }
        })
    }
}
