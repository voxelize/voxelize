//! Taste guards (docs/landscape.md, section 3.3) over every field the spine
//! `ground` reads. `TasteGuards::strict()` refuses a violation; `warn()`
//! lists it in the compile report.
//!
//! - **Shape terms.** Noise of role Shape, Strata or Bench carries no
//!   wavelength under `min_ground_wavelength` (a domain warp's shortening
//!   included), and no cellular term has cells that small: cellular pits
//!   are cavity-like erosion.
//! - **Fine amplitude.** A Grain term under `min_ground_wavelength`
//!   reaches ground through a chain of nodes, and its amplitude on ground
//!   is its own bound times the chain's *gain*: a product scales by the
//!   other factors' bounds, an affine by its factor, a smooth node by its
//!   steepest slope, a stencil reader by the term's own slope or curvature
//!   at its wavelength. Summed over every term and path, it stays at
//!   `max_fine_amplitude`, so a constant multiplier cannot hide a loud
//!   grain.
//! - **Warp fold.** A warp folds by `amp` times the steepest slope of its
//!   inputs, in the design's sinusoid units (`amp * 2 pi / lambda` for a
//!   unit fbm input at `lambda`, exactly), so the inputs' own amplitude
//!   counts; it stays at `warp_fold_limit`. `MixedScale` refuses a warp
//!   whose amplitude and input wavelengths mix `Span` and `Blocks`, since
//!   its fold would then change with the scale knob.
//! - **Benches.** A pulse keeps its period (`min_strata_period` or
//!   `min_bench_period`) and a riser softness of at least
//!   [`MIN_RISER_SOFTNESS`]. A terrace on ground is a bench term: risers
//!   at least `min_bench_period` blocks tall on ground, and the same
//!   softness floor.
//! - **`CreaseOnGround`.** A crease (`Abs`, `Min`, `Max`, `Clamp`, the
//!   clamps inside `Bias`, `Gain` and `PowSmooth`, `Sqrt`, cellular
//!   distance, `SlopeOf`) or a step (a hard `Select`, or any crease read
//!   through a stencil) that reaches ground. A smooth wrapper absorbs a
//!   crease when it is flat at every value the crease sits at:
//!   `smoothstep(Abs(n), 0, w)` is C1 and stays legal, `SAbs` absorbs a
//!   crease at 0, a clamp one outside its bounds, and a strided field is
//!   C1 by its bicubic whatever it samples.
//! - **`LiteralHeight`** (with `forbid_literal_heights`): no `Height::Abs`
//!   in a field the spine reads; ground heights are frame-relative.
//!
//! Gains and creases are conservative bounds over the range analysis, like
//! the analyses themselves: they never change what is computed.

use std::collections::{BTreeMap, BTreeSet};

use crate::landscape::math::{pow_smooth_d, smootherstep, smoothstep, MinMax, TAU};
use crate::landscape::spec::{Height, Resolution, Size, SpecError, TasteGuards};

use super::compile::{path_of, Ctx, Deps, SPINE, STRIDED_LIPSCHITZ};
use super::eval::{NOISE_GAIN, PERLIN_GRADIENT_BOUND};
use super::nodes::{CellMode, FieldExpr, TermRole};

/// Converts a Lipschitz bound into the design's fold units: a unit fbm
/// octave at `lambda` has the bound `NOISE_GAIN * PERLIN_GRADIENT_BOUND /
/// lambda` and the fold ratio `2 pi / lambda`.
pub(super) const FOLD_PER_LIPSCHITZ: f64 = TAU / (NOISE_GAIN * PERLIN_GRADIENT_BOUND);

/// The smallest riser share of a step, for pulses and terraces on ground.
pub const MIN_RISER_SOFTNESS: f64 = 0.1;

/// A router's gain from one knot value: the Hermite basis plus
/// Fritsch-Carlson tangents (each at most three secants) stay under
/// `1 + 2 * 3 * 4/27 < 2`.
const ROUTER_KNOT_GAIN: f64 = 2.0;

/// `a * b`, with `0 * inf = 0`: a path that carries nothing adds nothing.
fn mul(a: f64, b: f64) -> f64 {
    if a == 0.0 || b == 0.0 {
        0.0
    } else {
        a * b
    }
}

/// How strongly a field reaches the spine: bounds on `|d ground / d f|`
/// (`value`), on the gain of the field's gradient (`slope`, through
/// `SlopeOf` readers) and of its second derivatives (`curv`, through
/// `CurvatureOf` readers).
#[derive(Clone, Copy, Debug, Default)]
struct Gain {
    value: f64,
    slope: f64,
    curv: f64,
}

impl Gain {
    fn scaled(self, k: f64) -> Self {
        Self {
            value: mul(self.value, k),
            slope: mul(self.slope, k),
            curv: mul(self.curv, k),
        }
    }

    fn add(&mut self, o: Gain) {
        self.value += o.value;
        self.slope += o.slope;
        self.curv += o.curv;
    }

    /// The ground amplitude of content of amplitude `a` at wavelength `w`
    /// inside a field with this gain.
    fn reach(self, a: f64, w: f64) -> f64 {
        let k = TAU / w;
        mul(a, self.value) + mul(a, mul(self.slope, k)) + mul(a, mul(self.curv, 2.0 * k * k))
    }
}

/// What the gain walk collects.
#[derive(Default)]
struct Reach {
    gains: BTreeMap<String, Gain>,
    /// Each fine Grain term and its amplitude on ground.
    fine: Vec<(String, f64)>,
}

/// A crease or step in a node's output that nothing has absorbed yet.
#[derive(Clone, Debug)]
struct Crease {
    /// Where it comes from, for the message.
    origin: String,
    /// The output values it sits at; `None` anywhere in the output range.
    at: Option<(f64, f64)>,
    /// A cusp (unbounded slope beside it): absorbed only strictly inside a
    /// flat region.
    cusp: bool,
    /// A jump: absorbed only where a wrapper is flat over all of it.
    step: bool,
}

impl Crease {
    fn new(origin: String, at: Option<(f64, f64)>) -> Self {
        Self {
            origin,
            at,
            cusp: false,
            step: false,
        }
    }

    fn moved(mut self, at: Option<(f64, f64)>) -> Self {
        self.at = at;
        self
    }

    /// The same crease with its values mapped by `f` (monotone).
    fn mapped(self, f: impl Fn(f64) -> f64) -> Self {
        let at = self.at.map(|(lo, hi)| {
            let (p, q) = (f(lo), f(hi));
            (p.fmin(q), p.fmax(q))
        });
        self.moved(at)
    }

    /// Whether it lies strictly outside `[lo, hi]` (where a wrapper is
    /// constant), given the wrapper's input range `x`.
    fn beyond(&self, lo: f64, hi: f64, x: (f64, f64)) -> bool {
        let (a, b) = self.at.unwrap_or(x);
        b < lo || a > hi
    }

    /// Whether a wrapper flat on `(-inf, lo]` and `[hi, inf)` absorbs it,
    /// given the wrapper's input range `x`.
    fn absorbed_outside(&self, lo: f64, hi: f64, x: (f64, f64)) -> bool {
        let (a, b) = self.at.unwrap_or(x);
        if self.cusp {
            b < lo || a > hi
        } else {
            b <= lo || a >= hi
        }
    }
}

/// The spine and every field it reads, each before the fields it reads.
fn spine_order(deps: &BTreeMap<String, Deps>) -> Vec<String> {
    fn visit(
        n: &str,
        deps: &BTreeMap<String, Deps>,
        seen: &mut BTreeSet<String>,
        out: &mut Vec<String>,
    ) {
        if !seen.insert(n.to_string()) {
            return;
        }
        let d = &deps[n];
        for t in d.refs.iter().chain(d.stencils.iter()) {
            visit(t, deps, seen, out);
        }
        out.push(n.to_string());
    }
    let mut out = Vec::new();
    visit(SPINE, deps, &mut BTreeSet::new(), &mut out);
    out.reverse();
    out
}

impl Ctx<'_> {
    fn violate(&mut self, path: String, message: String) {
        if self.cfg.taste.strict {
            self.strict_errors.push(SpecError::new(path, message));
        } else {
            self.lints.push(format!("taste: {path}: {message}"));
        }
    }

    /// Every taste guard over the spine's reach.
    pub(super) fn taste(&mut self, deps: &BTreeMap<String, Deps>) -> Result<(), SpecError> {
        let order = spine_order(deps);
        let guards = self.cfg.taste.clone();
        let defs = self.defs;
        for name in &order {
            self.term_guards(name, &defs[name].graph, &guards)?;
        }

        // Fine amplitude and bench risers, by gain.
        let mut reach = Reach::default();
        reach.gains.insert(
            SPINE.to_string(),
            Gain {
                value: 1.0,
                ..Gain::default()
            },
        );
        for name in &order {
            let g = reach.gains.get(name).copied().unwrap_or_default();
            self.gain_walk(name, &defs[name].graph, 1.0, g, &mut reach, &guards)?;
        }
        let total: f64 = reach.fine.iter().map(|f| f.1).sum();
        if !(total <= guards.max_fine_amplitude) {
            let mut terms = reach.fine.clone();
            terms.sort_by(|a, b| b.1.total_cmp(&a.1));
            let list = terms
                .iter()
                .take(4)
                .map(|(t, a)| format!("{t} ±{a:.3}"))
                .collect::<Vec<_>>()
                .join(", ");
            self.violate(
                path_of(SPINE),
                if total.is_finite() {
                    format!(
                        "fine terms under {} blocks reach ±{total:.3} blocks on ground ({list}); the cap is {} (no cavity-like fine erosion)",
                        guards.min_ground_wavelength, guards.max_fine_amplitude
                    )
                } else {
                    format!(
                        "fine terms under {} blocks reach ground through a node with no slope bound ({list}), so their amplitude cannot be capped (no cavity-like fine erosion)",
                        guards.min_ground_wavelength
                    )
                },
            );
        }

        // Creases.
        let mut memo: BTreeMap<String, Vec<Crease>> = BTreeMap::new();
        let creases = self.field_creases(SPINE, &mut memo)?;
        let mut seen: BTreeSet<String> = BTreeSet::new();
        for c in creases {
            if !seen.insert(c.origin.clone()) {
                continue;
            }
            let message = if c.step {
                format!(
                    "CreaseOnGround: {} steps ground (a hard Select, or a crease read through a stencil); blend it, or keep the stencil's target smooth",
                    c.origin
                )
            } else {
                format!(
                    "CreaseOnGround: {} creases ground; use SAbs, SMin or SMax, or a smoothstep flat where it creases",
                    c.origin
                )
            };
            self.violate(path_of(SPINE), message);
        }
        Ok(())
    }

    /// The per-term guards in one field: Shape wavelengths, cellular cells,
    /// pulses, terrace softness, warps and literal heights.
    fn term_guards(
        &mut self,
        field: &str,
        e: &FieldExpr,
        guards: &TasteGuards,
    ) -> Result<(), SpecError> {
        let mut terms: Vec<&FieldExpr> = Vec::new();
        e.walk(&mut |n| {
            if matches!(
                n,
                FieldExpr::Noise(_)
                    | FieldExpr::Cellular(_)
                    | FieldExpr::Pulse { .. }
                    | FieldExpr::Terrace { .. }
                    | FieldExpr::Height(Height::Abs(_))
            ) {
                terms.push(n);
            }
        });
        let path = path_of(field);
        for t in terms {
            match t {
                FieldExpr::Noise(n) => {
                    let w = self
                        .analyze(field, t)?
                        .wavelength
                        .unwrap_or_else(|| self.noise_wavelength(n));
                    if n.role != TermRole::Grain && w < guards.min_ground_wavelength {
                        self.violate(
                            path.clone(),
                            format!(
                                "noise {:?} puts a {w:.2}-block wavelength on ground; Shape terms need at least {} (fine texture is a Grain term)",
                                n.salt, guards.min_ground_wavelength
                            ),
                        );
                    }
                    if let Some(warp) = &n.warp {
                        let ax = self.analyze(field, &warp.x)?;
                        let az = self.analyze(field, &warp.z)?;
                        let amp = self.cfg.frame.span(warp.amp);
                        match (ax.wavelength, az.wavelength, ax.lipschitz, az.lipschitz) {
                            (Some(_), Some(_), Some(lx), Some(lz)) => {
                                let slope = lx.fmax(lz) * FOLD_PER_LIPSCHITZ;
                                let fold = amp * slope;
                                if fold > guards.warp_fold_limit {
                                    self.violate(
                                        path.clone(),
                                        format!(
                                            "warp of {:?} folds at {fold:.3} (amp {amp:.1} times its inputs' steepest slope {slope:.5} per block); the limit is {}",
                                            n.salt, guards.warp_fold_limit
                                        ),
                                    );
                                }
                            }
                            _ => self.violate(
                                path.clone(),
                                format!(
                                    "warp of {:?} has an unknown bandwidth or slope, so its fold cannot be bounded",
                                    n.salt
                                ),
                            ),
                        }
                        let span = matches!(warp.amp, Size::Span(_));
                        let mut mixed = false;
                        let mut look = |x: &FieldExpr| match x {
                            FieldExpr::Noise(m) => {
                                mixed |= matches!(m.wavelength, Size::Span(_)) != span;
                            }
                            FieldExpr::Cellular(c) => {
                                mixed |= matches!(c.wavelength, Size::Span(_)) != span;
                            }
                            _ => {}
                        };
                        warp.x.walk(&mut look);
                        warp.z.walk(&mut look);
                        if mixed {
                            self.violate(
                                path.clone(),
                                format!(
                                    "MixedScale: the warp of {:?} mixes Span and Blocks sizes; its amp and its inputs' wavelengths must scale together, or the scale knob changes its fold",
                                    n.salt
                                ),
                            );
                        }
                    }
                }
                FieldExpr::Cellular(c) => {
                    let cell = self.cfg.frame.span(c.wavelength);
                    if cell < guards.min_ground_wavelength {
                        self.violate(
                            path.clone(),
                            format!(
                                "cellular {:?} digs pits on {cell:.2}-block cells; ground terms need at least {} (no cavity-like fine erosion)",
                                c.salt, guards.min_ground_wavelength
                            ),
                        );
                    }
                }
                FieldExpr::Pulse {
                    period,
                    softness,
                    role,
                    ..
                } => {
                    let min = match role {
                        TermRole::Strata => guards.min_strata_period,
                        _ => guards.min_bench_period,
                    };
                    if *period < min {
                        self.violate(
                            path.clone(),
                            format!("a {role:?} pulse with period {period} is below the {min}-block minimum"),
                        );
                    }
                    if *softness < MIN_RISER_SOFTNESS {
                        self.violate(
                            path.clone(),
                            format!("a {role:?} pulse with softness {softness} cuts its risers; the floor is {MIN_RISER_SOFTNESS}"),
                        );
                    }
                }
                FieldExpr::Terrace { softness, .. } => {
                    if *softness < MIN_RISER_SOFTNESS {
                        self.violate(
                            path.clone(),
                            format!("a terrace with softness {softness} cuts its risers; the floor is {MIN_RISER_SOFTNESS}"),
                        );
                    }
                }
                FieldExpr::Height(Height::Abs(y)) => {
                    if guards.forbid_literal_heights {
                        self.violate(
                            path.clone(),
                            format!(
                                "LiteralHeight: Height::Abs({y}) on ground; use a frame-relative height (AboveSea, ShareOfRelief, ShareOfWorld)"
                            ),
                        );
                    }
                }
                _ => unreachable!(),
            }
        }
        Ok(())
    }

    /// Walk `e` (inside `field`, whose gain is `g`) with `l` bounding
    /// `|d field / d e|`: hand gains to the fields it reads, record fine
    /// Grain terms and check terrace risers.
    #[allow(clippy::too_many_arguments)]
    fn gain_walk(
        &mut self,
        field: &str,
        e: &FieldExpr,
        l: f64,
        g: Gain,
        reach: &mut Reach,
        guards: &TasteGuards,
    ) -> Result<(), SpecError> {
        use FieldExpr as E;
        macro_rules! down {
            ($x:expr, $k:expr) => {
                self.gain_walk(field, $x, mul(l, $k), g, reach, guards)?
            };
        }
        match e {
            E::Const(_) | E::Height(_) | E::Relief(_) | E::Cellular(_) => {}
            E::Ref(t) => {
                let k = match self.defs[t].resolution {
                    Resolution::Stride(_) => STRIDED_LIPSCHITZ,
                    Resolution::Full => 1.0,
                };
                reach
                    .gains
                    .entry(t.clone())
                    .or_default()
                    .add(g.scaled(mul(l, k)));
            }
            E::SlopeOf(t) => reach.gains.entry(t.clone()).or_default().add(Gain {
                value: 0.0,
                slope: mul(g.value, l),
                curv: mul(g.slope, l),
            }),
            E::CurvatureOf(t) => reach.gains.entry(t.clone()).or_default().add(Gain {
                value: 0.0,
                slope: 0.0,
                curv: mul(g.value, l),
            }),
            E::Noise(n) => {
                if n.role == TermRole::Grain {
                    let w = self
                        .analyze(field, e)?
                        .wavelength
                        .unwrap_or_else(|| self.noise_wavelength(n));
                    if w < guards.min_ground_wavelength {
                        let a = n.amp.abs() * NOISE_GAIN;
                        reach.fine.push((
                            format!("grain {:?} in {}", n.salt, path_of(field)),
                            g.scaled(l).reach(a, w),
                        ));
                    }
                }
                if let Some(w) = &n.warp {
                    // The warp moves where the noise is sampled.
                    let k = self.noise_lipschitz(n) * self.cfg.frame.span(w.amp);
                    down!(&w.x, k);
                    down!(&w.z, k);
                }
            }
            E::Sum(v) => {
                for t in v {
                    down!(t, 1.0);
                }
            }
            E::Product(v) => {
                let bounds: Vec<f64> = v
                    .iter()
                    .map(|t| self.analyze(field, t).map(|a| a.max_abs()))
                    .collect::<Result<_, _>>()?;
                for (i, t) in v.iter().enumerate() {
                    let others = bounds
                        .iter()
                        .enumerate()
                        .filter(|&(j, _)| j != i)
                        .fold(1.0, |p, (_, &b)| mul(p, b));
                    down!(t, others);
                }
            }
            E::Sub(a, b) => {
                down!(a, 1.0);
                down!(b, 1.0);
            }
            E::Div { num, den, eps } => {
                let (a, b) = (self.analyze(field, num)?, self.analyze(field, den)?);
                let dmin = if b.range.0 >= *eps || b.range.1 <= -eps {
                    b.range.0.abs().fmin(b.range.1.abs())
                } else {
                    *eps
                };
                down!(num, 1.0 / dmin);
                down!(den, a.max_abs() / (dmin * dmin));
            }
            E::Neg(x) | E::Abs(x) => down!(x, 1.0),
            E::Sqrt(x) => {
                let a = self.analyze(field, x)?;
                let k = if a.range.0 > 0.0 {
                    0.5 / a.range.0.sqrt()
                } else {
                    f64::INFINITY
                };
                down!(x, k);
            }
            E::Min(a, b) | E::Max(a, b) => {
                down!(a, 1.0);
                down!(b, 1.0);
            }
            E::SMin { a, b, .. } | E::SMax { a, b, .. } => {
                down!(a, 1.0);
                down!(b, 1.0);
            }
            E::SAbs { x, .. } | E::Clamp { x, .. } => down!(x, 1.0),
            E::Affine { x, mul: m, .. } => down!(x, m.abs()),
            E::Smoothstep { x, e0, e1 } => down!(x, 1.5 / (e1 - e0).abs()),
            E::Smootherstep { x, e0, e1 } => down!(x, 1.875 / (e1 - e0).abs()),
            E::Lerp { a, b, t } => {
                let (aa, ab, at) = (
                    self.analyze(field, a)?,
                    self.analyze(field, b)?,
                    self.analyze(field, t)?,
                );
                let one_minus = (1.0 - at.range.0).abs().fmax((1.0 - at.range.1).abs());
                let diff = (ab.range.1 - aa.range.0)
                    .abs()
                    .fmax((ab.range.0 - aa.range.1).abs());
                down!(a, one_minus);
                down!(b, at.max_abs());
                down!(t, diff);
            }
            E::Bias { x, b: k } | E::Gain { x, g: k } => {
                down!(x, (k / (1.0 - k)).fmax((1.0 - k) / k));
            }
            E::PowSmooth { x, e: ex } => {
                let a = self.analyze(field, x)?;
                let k = if *ex >= 1.0 {
                    *ex
                } else if a.range.0 > 0.0 {
                    pow_smooth_d(a.range.0.fmin(1.0), *ex)
                } else {
                    f64::INFINITY
                };
                down!(x, k);
            }
            E::Terrace { x, step, softness } => {
                let riser = step * mul(l, g.value);
                if riser > 0.0 && riser < guards.min_bench_period {
                    self.violate(
                        path_of(field),
                        format!(
                            "a terrace rises {riser:.2} blocks per step on ground; bench risers need at least {}",
                            guards.min_bench_period
                        ),
                    );
                }
                let w = (0.5 * softness).fclamp(1e-6, 0.5);
                down!(x, 0.75 / w);
            }
            E::Select {
                cond, a, b, blend, ..
            } => {
                let (aa, ab) = (self.analyze(field, a)?, self.analyze(field, b)?);
                let diff = (ab.range.1 - aa.range.0)
                    .abs()
                    .fmax((ab.range.0 - aa.range.1).abs());
                let k = if *blend > 0.0 {
                    diff * 1.5 / blend
                } else {
                    f64::INFINITY
                };
                down!(cond, k);
                down!(a, 1.0);
                down!(b, 1.0);
            }
            E::Spline { x, knots } => {
                let mut secant: f64 = 0.0;
                for w in knots.windows(2) {
                    secant = secant.fmax(((w[1].1 - w[0].1) / (w[1].0 - w[0].0)).abs());
                }
                down!(x, 4.0 * secant);
            }
            E::Router { x, knots } => {
                let ranges: Vec<(f64, f64)> = knots
                    .iter()
                    .map(|(_, k)| self.analyze(field, k).map(|a| a.range))
                    .collect::<Result<_, _>>()?;
                let mut secant: f64 = 0.0;
                for i in 1..knots.len() {
                    let (p, q) = (ranges[i - 1], ranges[i]);
                    let dv = (q.1 - p.0).abs().fmax((q.0 - p.1).abs());
                    secant = secant.fmax(dv / (knots[i].0 - knots[i - 1].0));
                }
                down!(x, 4.0 * secant);
                for (_, k) in knots {
                    down!(k, ROUTER_KNOT_GAIN);
                }
            }
            E::Pulse {
                x,
                period,
                softness,
                ..
            } => {
                let w = (0.5 * softness).fclamp(1e-6, 0.5);
                down!(x, 1.5 / (w * period));
            }
        }
        Ok(())
    }

    /// The creases a field's value carries (none through a strided field's
    /// bicubic).
    fn field_creases(
        &mut self,
        name: &str,
        memo: &mut BTreeMap<String, Vec<Crease>>,
    ) -> Result<Vec<Crease>, SpecError> {
        if let Resolution::Stride(_) = self.defs[name].resolution {
            return Ok(Vec::new());
        }
        if let Some(c) = memo.get(name) {
            return Ok(c.clone());
        }
        let defs = self.defs;
        let c = self.creases(name, &defs[name].graph, memo)?;
        memo.insert(name.to_string(), c.clone());
        Ok(c)
    }

    /// The unabsorbed creases in `e`'s output.
    fn creases(
        &mut self,
        field: &str,
        e: &FieldExpr,
        memo: &mut BTreeMap<String, Vec<Crease>>,
    ) -> Result<Vec<Crease>, SpecError> {
        use FieldExpr as E;
        let origin = |kind: &str| format!("{kind} in {}", path_of(field));
        let anywhere =
            |v: Vec<Crease>| -> Vec<Crease> { v.into_iter().map(|c| c.moved(None)).collect() };
        Ok(match e {
            E::Const(_) | E::Height(_) | E::Relief(_) => Vec::new(),
            E::Ref(t) => self.field_creases(t, memo)?,
            E::SlopeOf(t) | E::CurvatureOf(t) => {
                let mut out: Vec<Crease> = self
                    .field_creases(t, memo)?
                    .into_iter()
                    .map(|mut c| {
                        c.origin = format!("{} (read through a stencil)", c.origin);
                        c.step = true;
                        c.moved(None)
                    })
                    .collect();
                if let E::SlopeOf(_) = e {
                    // |grad f| creases where the gradient vanishes.
                    out.push(Crease::new(
                        origin(&format!("SlopeOf({t})")),
                        Some((0.0, 0.0)),
                    ));
                }
                out
            }
            E::Noise(n) => match &n.warp {
                Some(w) => {
                    let mut v = self.creases(field, &w.x, memo)?;
                    v.extend(self.creases(field, &w.z, memo)?);
                    anywhere(v)
                }
                None => Vec::new(),
            },
            E::Cellular(c) => vec![Crease::new(
                origin(&format!(
                    "cellular {:?} ({})",
                    c.salt,
                    match c.mode {
                        CellMode::F1 => "F1",
                        CellMode::F2MinusF1 => "F2-F1",
                    }
                )),
                None,
            )],
            E::Sum(v) | E::Product(v) => {
                let is_sum = matches!(e, E::Sum(_));
                let ranges: Vec<(f64, f64)> = v
                    .iter()
                    .map(|t| self.analyze(field, t).map(|a| a.range))
                    .collect::<Result<_, _>>()?;
                let mut out = Vec::new();
                for (i, t) in v.iter().enumerate() {
                    let others_const = ranges.iter().enumerate().all(|(j, r)| j == i || r.0 == r.1);
                    let k = ranges.iter().enumerate().filter(|&(j, _)| j != i).fold(
                        if is_sum { 0.0 } else { 1.0 },
                        |acc, (_, r)| {
                            if is_sum {
                                acc + r.0
                            } else {
                                acc * r.0
                            }
                        },
                    );
                    for c in self.creases(field, t, memo)? {
                        if !others_const {
                            out.push(c.moved(None));
                        } else if is_sum {
                            out.push(c.mapped(|y| y + k));
                        } else if k != 0.0 {
                            out.push(c.mapped(|y| y * k));
                        }
                    }
                }
                out
            }
            E::Sub(a, b) => {
                let (ra, rb) = (self.analyze(field, a)?.range, self.analyze(field, b)?.range);
                let mut out = Vec::new();
                for c in self.creases(field, a, memo)? {
                    out.push(if rb.0 == rb.1 {
                        c.mapped(|y| y - rb.0)
                    } else {
                        c.moved(None)
                    });
                }
                for c in self.creases(field, b, memo)? {
                    out.push(if ra.0 == ra.1 {
                        c.mapped(|y| ra.0 - y)
                    } else {
                        c.moved(None)
                    });
                }
                out
            }
            E::Div { num, den, .. } => {
                let mut v = self.creases(field, num, memo)?;
                v.extend(self.creases(field, den, memo)?);
                anywhere(v)
            }
            E::Neg(x) => self
                .creases(field, x, memo)?
                .into_iter()
                .map(|c| c.mapped(|y| -y))
                .collect(),
            E::Abs(x) => {
                let r = self.analyze(field, x)?.range;
                let mut out: Vec<Crease> = self
                    .creases(field, x, memo)?
                    .into_iter()
                    .map(|c| {
                        let at = c.at.map(|(lo, hi)| {
                            if lo <= 0.0 && hi >= 0.0 {
                                (0.0, lo.abs().fmax(hi.abs()))
                            } else {
                                (lo.abs().fmin(hi.abs()), lo.abs().fmax(hi.abs()))
                            }
                        });
                        c.moved(at)
                    })
                    .collect();
                if r.0 < 0.0 && r.1 > 0.0 {
                    out.push(Crease::new(origin("Abs"), Some((0.0, 0.0))));
                }
                out
            }
            E::Sqrt(x) => {
                let r = self.analyze(field, x)?.range;
                let mut out: Vec<Crease> = self
                    .creases(field, x, memo)?
                    .into_iter()
                    .map(|c| c.mapped(|y| y.fmax(0.0).sqrt()))
                    .collect();
                if r.0 <= 0.0 && r.1 > 0.0 {
                    let mut c = Crease::new(origin("Sqrt"), Some((0.0, 0.0)));
                    c.cusp = true;
                    out.push(c);
                }
                out
            }
            E::Min(a, b) | E::Max(a, b) => {
                let (ra, rb) = (self.analyze(field, a)?.range, self.analyze(field, b)?.range);
                let mut out = self.creases(field, a, memo)?;
                out.extend(self.creases(field, b, memo)?);
                let (lo, hi) = (ra.0.fmax(rb.0), ra.1.fmin(rb.1));
                if lo <= hi {
                    let kind = if matches!(e, E::Min(..)) {
                        "Min"
                    } else {
                        "Max"
                    };
                    out.push(Crease::new(origin(kind), Some((lo, hi))));
                }
                out
            }
            E::SMin { a, b, .. } | E::SMax { a, b, .. } => {
                let mut v = self.creases(field, a, memo)?;
                v.extend(self.creases(field, b, memo)?);
                anywhere(v)
            }
            E::SAbs { x, .. } => self
                .creases(field, x, memo)?
                .into_iter()
                .filter(|c| c.cusp || c.step || c.at != Some((0.0, 0.0)))
                .map(|c| c.moved(None))
                .collect(),
            E::Clamp { x, lo, hi } => {
                let r = self.analyze(field, x)?.range;
                let mut out: Vec<Crease> = self
                    .creases(field, x, memo)?
                    .into_iter()
                    .filter(|c| !c.beyond(*lo, *hi, r))
                    .map(|c| {
                        let at = c.at.map(|(a, b)| (a.fclamp(*lo, *hi), b.fclamp(*lo, *hi)));
                        c.moved(at)
                    })
                    .collect();
                for bound in [*lo, *hi] {
                    if r.0 < bound && bound < r.1 {
                        out.push(Crease::new(origin("Clamp"), Some((bound, bound))));
                    }
                }
                out
            }
            E::Affine { x, mul: m, add } => {
                if *m == 0.0 {
                    Vec::new()
                } else {
                    self.creases(field, x, memo)?
                        .into_iter()
                        .map(|c| c.mapped(|y| y * m + add))
                        .collect()
                }
            }
            E::Smoothstep { x, e0, e1 } | E::Smootherstep { x, e0, e1 } => {
                let quintic = matches!(e, E::Smootherstep { .. });
                let r = self.analyze(field, x)?.range;
                let (lo, hi) = (e0.fmin(*e1), e0.fmax(*e1));
                self.creases(field, x, memo)?
                    .into_iter()
                    .filter(|c| !c.absorbed_outside(lo, hi, r))
                    .map(|c| {
                        c.mapped(|y| {
                            if quintic {
                                smootherstep(*e0, *e1, y)
                            } else {
                                smoothstep(*e0, *e1, y)
                            }
                        })
                    })
                    .collect()
            }
            E::Lerp { a, b, t } => {
                let mut v = self.creases(field, a, memo)?;
                v.extend(self.creases(field, b, memo)?);
                v.extend(self.creases(field, t, memo)?);
                anywhere(v)
            }
            E::Bias { x, .. } | E::Gain { x, .. } | E::PowSmooth { x, .. } => {
                let r = self.analyze(field, x)?.range;
                let (kind, flat_at_zero, cusp) = match e {
                    E::Bias { .. } => ("Bias (its clamp to [0, 1])", false, false),
                    E::Gain { .. } => ("Gain (its clamp to [0, 1])", false, false),
                    E::PowSmooth { e: ex, .. } => (
                        "PowSmooth (its clamp to [0, 1])",
                        8.0 * ex >= 9.0,
                        *ex < 1.0,
                    ),
                    _ => unreachable!(),
                };
                // The clamp is flat strictly outside [0, 1].
                let mut out: Vec<Crease> = self
                    .creases(field, x, memo)?
                    .into_iter()
                    .filter(|c| !c.beyond(0.0, 1.0, r))
                    .map(|c| c.moved(None))
                    .collect();
                if r.0 < 0.0 && r.1 > 0.0 && !flat_at_zero {
                    let mut c = Crease::new(origin(kind), Some((0.0, 0.0)));
                    c.cusp = cusp;
                    out.push(c);
                }
                if r.0 < 1.0 && r.1 > 1.0 {
                    out.push(Crease::new(origin(kind), Some((1.0, 1.0))));
                }
                out
            }
            E::Terrace { x, .. } | E::Pulse { x, .. } => anywhere(self.creases(field, x, memo)?),
            E::Select {
                cond,
                a,
                b,
                at,
                blend,
            } => {
                let (rc, ra, rb) = (
                    self.analyze(field, cond)?.range,
                    self.analyze(field, a)?.range,
                    self.analyze(field, b)?.range,
                );
                if *blend > 0.0 {
                    let (lo, hi) = (at - 0.5 * blend, at + 0.5 * blend);
                    let mut out: Vec<Crease> = self
                        .creases(field, cond, memo)?
                        .into_iter()
                        .filter(|c| !c.absorbed_outside(lo, hi, rc))
                        .collect();
                    out.extend(self.creases(field, a, memo)?);
                    out.extend(self.creases(field, b, memo)?);
                    anywhere(out)
                } else {
                    // The output is a or b: their creases keep their values,
                    // and the condition only decides where the step falls.
                    let mut out = self.creases(field, a, memo)?;
                    out.extend(self.creases(field, b, memo)?);
                    if rc.0 < *at && *at <= rc.1 {
                        let mut c = Crease::new(
                            origin("hard Select"),
                            Some((ra.0.fmin(rb.0), ra.1.fmax(rb.1))),
                        );
                        c.step = true;
                        out.push(c);
                    }
                    out
                }
            }
            // Constant strictly beyond the end knots (their end slopes are
            // the end secants, so not flat at the knots themselves).
            E::Spline { x, knots } => {
                let r = self.analyze(field, x)?.range;
                let (lo, hi) = (knots[0].0, knots[knots.len() - 1].0);
                anywhere(
                    self.creases(field, x, memo)?
                        .into_iter()
                        .filter(|c| !c.beyond(lo, hi, r))
                        .collect(),
                )
            }
            E::Router { x, knots } => {
                let r = self.analyze(field, x)?.range;
                let (lo, hi) = (knots[0].0, knots[knots.len() - 1].0);
                let mut out: Vec<Crease> = self
                    .creases(field, x, memo)?
                    .into_iter()
                    .filter(|c| !c.beyond(lo, hi, r))
                    .collect();
                for (_, k) in knots {
                    out.extend(self.creases(field, k, memo)?);
                }
                anywhere(out)
            }
        })
    }
}
