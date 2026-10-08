//! The authored field expression: [`FieldExpr`], a tree of named shared
//! field nodes, as plain data.
//!
//! A tree reads well in JSON and merges well with patches; shared
//! subexpressions are written twice and computed once, because the
//! compiler hash-conses every node ([`super::compile`]). Long sums and
//! products are n-ary (`Sum`, `Product`) so a tree stays shallow.
//!
//! Every node is bit-stable: noise uses v1's owned, golden-pinned kernels,
//! and every other node uses only IEEE add, sub, mul, div, sqrt, floor,
//! abs, comparisons and selects ([`crate::landscape::math`]).
//!
//! Positions are column centres `(x + 0.5, z + 0.5)` for full-rate
//! fields, and lattice nodes `(i * s, j * s)` for strided ones.
//!
//! **Ridges come from smooth folds**, never from per-octave folds: v1's
//! `Ridged` and `Billow` kinds crease at every octave, which reads as cut
//! terrain, so landscape noise is fbm only and a ridge is
//! `1 - SAbs(noise, k)`.

use serde::{Deserialize, Serialize};

use crate::landscape::spec::{Height, Size};

/// What a noise or pulse term is for; the taste guards check each role by
/// its own rule (section 3.3).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TermRole {
    /// Shape: wavelengths at or above `min_ground_wavelength` on ground.
    Shape,
    /// Strata: periodic ledges, checked against `min_strata_period`.
    Strata,
    /// Benches: periodic treads, checked against `min_bench_period`.
    Bench,
    /// Grain: fine texture, at most `max_fine_amplitude` blocks.
    Grain,
}

/// A domain warp: the noise is sampled at `p + amp * (x(p), z(p))`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WarpM {
    /// The x displacement field (practical range ±1).
    pub x: Box<FieldExpr>,
    /// The z displacement field (practical range ±1).
    pub z: Box<FieldExpr>,
    /// Displacement in blocks. A `Span` warp of a `Span` noise keeps its
    /// fold ratio under the scale knob.
    pub amp: Size,
}

/// Normalized fractal noise: `amp * NOISE_GAIN * fbm(p / wavelength)`, with
/// a practical range of `±amp`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NoiseM {
    /// Its salt, claimed world-wide (`"<preset>.<name>"`).
    pub salt: String,
    /// Base wavelength.
    pub wavelength: Size,
    /// Octaves, 1..=8.
    pub octaves: u8,
    /// Amplitude ratio between octaves.
    pub persistence: f64,
    /// Frequency ratio between octaves.
    pub lacunarity: f64,
    /// Output scale.
    pub amp: f64,
    /// What the term is for.
    pub role: TermRole,
    /// An optional domain warp.
    pub warp: Option<WarpM>,
}

/// Which cellular distance.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CellMode {
    /// Distance to the nearest site, over the cell size.
    F1,
    /// Second-nearest minus nearest, over the cell size.
    F2MinusF1,
}

/// Jittered-grid cellular distance (square roots only).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CellularM {
    /// Its salt, claimed world-wide.
    pub salt: String,
    /// Cell size.
    pub wavelength: Size,
    /// Which distance.
    pub mode: CellMode,
    /// Site jitter within a cell, 0..=1.
    pub jitter: f64,
    /// Output scale.
    pub amp: f64,
}

/// A named field's expression.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum FieldExpr {
    /// A constant.
    Const(f64),
    /// A height resolved by the world frame (an absolute y).
    Height(Height),
    /// An amount of relief in blocks: this share of the relief above sea,
    /// `(H - sea)`, times the vertical relief factor `min(1, sqrt(scale))`.
    Relief(f64),
    /// Another named field at this position.
    Ref(String),
    /// The L2 slope of a full-rate named field (central differences over
    /// one block, read from the field's grid).
    SlopeOf(String),
    /// The Laplacian of a full-rate named field (one-block stencil).
    CurvatureOf(String),
    /// Normalized fractal noise.
    Noise(NoiseM),
    /// Cellular distance.
    Cellular(CellularM),
    /// Left-to-right sum.
    Sum(Vec<FieldExpr>),
    /// Left-to-right product.
    Product(Vec<FieldExpr>),
    /// `a - b`.
    Sub(Box<FieldExpr>, Box<FieldExpr>),
    /// `num / den`, with `den` pushed away from zero to `±eps`.
    Div {
        /// Numerator.
        num: Box<FieldExpr>,
        /// Denominator.
        den: Box<FieldExpr>,
        /// Smallest denominator magnitude.
        eps: f64,
    },
    /// `-x`.
    Neg(Box<FieldExpr>),
    /// `|x|` (creased at 0; prefer `SAbs` on ground).
    Abs(Box<FieldExpr>),
    /// `sqrt(max(x, 0))`.
    Sqrt(Box<FieldExpr>),
    /// The smaller (creased where equal; prefer `SMin` on ground).
    Min(Box<FieldExpr>, Box<FieldExpr>),
    /// The larger (creased where equal; prefer `SMax` on ground).
    Max(Box<FieldExpr>, Box<FieldExpr>),
    /// Smooth minimum with rounding width `k`.
    SMin {
        /// First input.
        a: Box<FieldExpr>,
        /// Second input.
        b: Box<FieldExpr>,
        /// Rounding width.
        k: f64,
    },
    /// Smooth maximum with rounding width `k`.
    SMax {
        /// First input.
        a: Box<FieldExpr>,
        /// Second input.
        b: Box<FieldExpr>,
        /// Rounding width.
        k: f64,
    },
    /// Smooth absolute value: `smax(x, -x, k)`, rounded over `k`.
    SAbs {
        /// Input.
        x: Box<FieldExpr>,
        /// Rounding width.
        k: f64,
    },
    /// `clamp(x, lo, hi)` (creased at the bounds).
    Clamp {
        /// Input.
        x: Box<FieldExpr>,
        /// Lower bound.
        lo: f64,
        /// Upper bound.
        hi: f64,
    },
    /// `x * mul + add`.
    Affine {
        /// Input.
        x: Box<FieldExpr>,
        /// Factor.
        mul: f64,
        /// Offset.
        add: f64,
    },
    /// Hermite smoothstep of `x` over `[e0, e1]`.
    Smoothstep {
        /// Input.
        x: Box<FieldExpr>,
        /// Lower edge.
        e0: f64,
        /// Upper edge.
        e1: f64,
    },
    /// Quintic smootherstep of `x` over `[e0, e1]`.
    Smootherstep {
        /// Input.
        x: Box<FieldExpr>,
        /// Lower edge.
        e0: f64,
        /// Upper edge.
        e1: f64,
    },
    /// `a + (b - a) * t`.
    Lerp {
        /// Value at t = 0.
        a: Box<FieldExpr>,
        /// Value at t = 1.
        b: Box<FieldExpr>,
        /// The blend.
        t: Box<FieldExpr>,
    },
    /// Schlick bias of `clamp01(x)`.
    Bias {
        /// Input.
        x: Box<FieldExpr>,
        /// Bias, 0..1.
        b: f64,
    },
    /// Schlick gain of `clamp01(x)`.
    Gain {
        /// Input.
        x: Box<FieldExpr>,
        /// Gain, 0..1.
        g: f64,
    },
    /// `pow_smooth(clamp01(x), e)`.
    PowSmooth {
        /// Input.
        x: Box<FieldExpr>,
        /// Exponent.
        e: f64,
    },
    /// Soft terraces: treads `step` apart, risers rounded over `softness`
    /// of a step (0 < softness <= 1).
    Terrace {
        /// Input.
        x: Box<FieldExpr>,
        /// Tread spacing.
        step: f64,
        /// Riser share of a step.
        softness: f64,
    },
    /// `a` below `at`, `b` above, blended by a smoothstep `blend` wide (a
    /// hard select at blend 0).
    Select {
        /// The condition.
        cond: Box<FieldExpr>,
        /// Value below.
        a: Box<FieldExpr>,
        /// Value above.
        b: Box<FieldExpr>,
        /// Threshold.
        at: f64,
        /// Blend width.
        blend: f64,
    },
    /// A monotone cubic Hermite spline (Fritsch-Carlson slopes) through
    /// constant knots; constant beyond the ends.
    Spline {
        /// Input.
        x: Box<FieldExpr>,
        /// Knots `(x, y)`, x strictly increasing.
        knots: Vec<(f64, f64)>,
    },
    /// A nested monotone Hermite router: a spline whose knot values are
    /// fields themselves (which may be routers), with Fritsch-Carlson
    /// slopes taken at each column from the knot values there.
    Router {
        /// Input.
        x: Box<FieldExpr>,
        /// Knots `(x, value field)`, x strictly increasing.
        knots: Vec<(f64, FieldExpr)>,
    },
    /// A smooth periodic pulse in `[0, 1]`: rising over `softness` of a
    /// period at the period start, falling at its middle. For strata and
    /// bench terms.
    Pulse {
        /// Input (a height, usually).
        x: Box<FieldExpr>,
        /// Period in the input's units.
        period: f64,
        /// Rise share, 0 < softness <= 1.
        softness: f64,
        /// Strata or Bench.
        role: TermRole,
    },
}

/// Shorthand constructors, so presets read like formulas.
#[allow(missing_docs)]
pub mod fx {
    use super::*;

    pub fn c(v: f64) -> FieldExpr {
        FieldExpr::Const(v)
    }
    pub fn height(h: Height) -> FieldExpr {
        FieldExpr::Height(h)
    }
    pub fn relief(share: f64) -> FieldExpr {
        FieldExpr::Relief(share)
    }
    pub fn r(name: &str) -> FieldExpr {
        FieldExpr::Ref(name.to_string())
    }
    pub fn slope_of(name: &str) -> FieldExpr {
        FieldExpr::SlopeOf(name.to_string())
    }
    pub fn curvature_of(name: &str) -> FieldExpr {
        FieldExpr::CurvatureOf(name.to_string())
    }
    /// Normalized fbm with the usual persistence 0.5 and lacunarity 2.
    pub fn noise(salt: &str, wavelength: Size, octaves: u8, amp: f64) -> FieldExpr {
        FieldExpr::Noise(NoiseM {
            salt: salt.to_string(),
            wavelength,
            octaves,
            persistence: 0.5,
            lacunarity: 2.0,
            amp,
            role: TermRole::Shape,
            warp: None,
        })
    }
    /// [`noise`] sampled through a domain warp.
    pub fn warped(
        salt: &str,
        wavelength: Size,
        octaves: u8,
        amp: f64,
        wx: FieldExpr,
        wz: FieldExpr,
        warp: Size,
    ) -> FieldExpr {
        FieldExpr::Noise(NoiseM {
            salt: salt.to_string(),
            wavelength,
            octaves,
            persistence: 0.5,
            lacunarity: 2.0,
            amp,
            role: TermRole::Shape,
            warp: Some(WarpM {
                x: Box::new(wx),
                z: Box::new(wz),
                amp: warp,
            }),
        })
    }
    pub fn sum(terms: Vec<FieldExpr>) -> FieldExpr {
        FieldExpr::Sum(terms)
    }
    pub fn product(terms: Vec<FieldExpr>) -> FieldExpr {
        FieldExpr::Product(terms)
    }
    pub fn sub(a: FieldExpr, b: FieldExpr) -> FieldExpr {
        FieldExpr::Sub(Box::new(a), Box::new(b))
    }
    pub fn affine(x: FieldExpr, mul: f64, add: f64) -> FieldExpr {
        FieldExpr::Affine {
            x: Box::new(x),
            mul,
            add,
        }
    }
    pub fn smoothstep(x: FieldExpr, e0: f64, e1: f64) -> FieldExpr {
        FieldExpr::Smoothstep {
            x: Box::new(x),
            e0,
            e1,
        }
    }
    pub fn smootherstep(x: FieldExpr, e0: f64, e1: f64) -> FieldExpr {
        FieldExpr::Smootherstep {
            x: Box::new(x),
            e0,
            e1,
        }
    }
    pub fn lerp(a: FieldExpr, b: FieldExpr, t: FieldExpr) -> FieldExpr {
        FieldExpr::Lerp {
            a: Box::new(a),
            b: Box::new(b),
            t: Box::new(t),
        }
    }
    pub fn sabs(x: FieldExpr, k: f64) -> FieldExpr {
        FieldExpr::SAbs { x: Box::new(x), k }
    }
    pub fn clamp(x: FieldExpr, lo: f64, hi: f64) -> FieldExpr {
        FieldExpr::Clamp {
            x: Box::new(x),
            lo,
            hi,
        }
    }
    pub fn pow_smooth(x: FieldExpr, e: f64) -> FieldExpr {
        FieldExpr::PowSmooth { x: Box::new(x), e }
    }
    pub fn spline(x: FieldExpr, knots: &[(f64, f64)]) -> FieldExpr {
        FieldExpr::Spline {
            x: Box::new(x),
            knots: knots.to_vec(),
        }
    }
    pub fn router(x: FieldExpr, knots: Vec<(f64, FieldExpr)>) -> FieldExpr {
        FieldExpr::Router {
            x: Box::new(x),
            knots,
        }
    }
    pub fn smax(a: FieldExpr, b: FieldExpr, k: f64) -> FieldExpr {
        FieldExpr::SMax {
            a: Box::new(a),
            b: Box::new(b),
            k,
        }
    }
    pub fn smin(a: FieldExpr, b: FieldExpr, k: f64) -> FieldExpr {
        FieldExpr::SMin {
            a: Box::new(a),
            b: Box::new(b),
            k,
        }
    }
}

impl std::ops::Add for FieldExpr {
    type Output = FieldExpr;
    fn add(self, rhs: FieldExpr) -> FieldExpr {
        match self {
            FieldExpr::Sum(mut terms) => {
                terms.push(rhs);
                FieldExpr::Sum(terms)
            }
            lhs => FieldExpr::Sum(vec![lhs, rhs]),
        }
    }
}

impl std::ops::Mul for FieldExpr {
    type Output = FieldExpr;
    fn mul(self, rhs: FieldExpr) -> FieldExpr {
        match self {
            FieldExpr::Product(mut terms) => {
                terms.push(rhs);
                FieldExpr::Product(terms)
            }
            lhs => FieldExpr::Product(vec![lhs, rhs]),
        }
    }
}

impl std::ops::Sub for FieldExpr {
    type Output = FieldExpr;
    fn sub(self, rhs: FieldExpr) -> FieldExpr {
        FieldExpr::Sub(Box::new(self), Box::new(rhs))
    }
}

impl std::ops::Neg for FieldExpr {
    type Output = FieldExpr;
    fn neg(self) -> FieldExpr {
        FieldExpr::Neg(Box::new(self))
    }
}

impl From<f64> for FieldExpr {
    fn from(v: f64) -> Self {
        FieldExpr::Const(v)
    }
}

impl FieldExpr {
    /// Visit this node and every node under it, parents first.
    pub fn walk<'a>(&'a self, f: &mut dyn FnMut(&'a FieldExpr)) {
        f(self);
        match self {
            FieldExpr::Const(_)
            | FieldExpr::Height(_)
            | FieldExpr::Relief(_)
            | FieldExpr::Ref(_)
            | FieldExpr::SlopeOf(_)
            | FieldExpr::CurvatureOf(_)
            | FieldExpr::Cellular(_) => {}
            FieldExpr::Noise(n) => {
                if let Some(w) = &n.warp {
                    w.x.walk(f);
                    w.z.walk(f);
                }
            }
            FieldExpr::Sum(v) | FieldExpr::Product(v) => {
                for e in v {
                    e.walk(f);
                }
            }
            FieldExpr::Sub(a, b) | FieldExpr::Min(a, b) | FieldExpr::Max(a, b) => {
                a.walk(f);
                b.walk(f);
            }
            FieldExpr::Div { num, den, .. } => {
                num.walk(f);
                den.walk(f);
            }
            FieldExpr::SMin { a, b, .. } | FieldExpr::SMax { a, b, .. } => {
                a.walk(f);
                b.walk(f);
            }
            FieldExpr::Neg(x) | FieldExpr::Abs(x) | FieldExpr::Sqrt(x) => x.walk(f),
            FieldExpr::SAbs { x, .. }
            | FieldExpr::Clamp { x, .. }
            | FieldExpr::Affine { x, .. }
            | FieldExpr::Smoothstep { x, .. }
            | FieldExpr::Smootherstep { x, .. }
            | FieldExpr::Bias { x, .. }
            | FieldExpr::Gain { x, .. }
            | FieldExpr::PowSmooth { x, .. }
            | FieldExpr::Terrace { x, .. }
            | FieldExpr::Spline { x, .. }
            | FieldExpr::Pulse { x, .. } => x.walk(f),
            FieldExpr::Lerp { a, b, t } => {
                a.walk(f);
                b.walk(f);
                t.walk(f);
            }
            FieldExpr::Select { cond, a, b, .. } => {
                cond.walk(f);
                a.walk(f);
                b.walk(f);
            }
            FieldExpr::Router { x, knots } => {
                x.walk(f);
                for (_, k) in knots {
                    k.walk(f);
                }
            }
        }
    }
}
