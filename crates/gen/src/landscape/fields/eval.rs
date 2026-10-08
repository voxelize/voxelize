//! Evaluating field programs: the noise and cellular kernels, the monotone
//! Hermite splines, the C1 bicubic lattice interpolation, and the register
//! machine that runs one program at one position.
//!
//! Everything here is bit-stable (IEEE add, sub, mul, div, sqrt, floor,
//! abs, comparisons and selects; v1's owned noise), so a program gives the
//! same bits for the same position whichever window, thread or platform
//! evaluates it. That is what makes a point query equal the chunk grid.

use crate::landscape::math::{
    bias, gain, pow_smooth, smax, smin, smootherstep, smoothstep, MinMax,
};
use crate::noise::{Fractal, NoiseKind};
use crate::stream::{cell_id, mix64, HashStream};

use super::ir::{Op, Program, SplineTable};

/// Scale from v1's fbm (normalized by its octave weights) to a practical
/// range of ±1: the measured 99.9th percentile of `|fbm|` over 1..=6
/// octaves at persistence 0.5 sits between 0.42 and 0.53, so a gain of 2
/// puts it near ±1. Pinned: changing it changes every landscape.
pub const NOISE_GAIN: f64 = 2.0;

/// Gradient bound of one v1 Perlin octave in kernel units: with the
/// quintic fade (largest slope 15/8 per axis), gradients of length at most
/// sqrt 2 dotted with offsets of length at most sqrt 2, and the kernel's
/// 1/sqrt 2 output scale, `|grad n| <= (2 * 15/8 * 2 + sqrt 2) / sqrt 2 <
/// 6.3`. Rounded up to 6.5: loose but provably safe, which is what a
/// conservative tile gate needs.
pub const PERLIN_GRADIENT_BOUND: f64 = 6.5;

/// Most knots a spline or router may have.
pub const MAX_KNOTS: usize = 16;

/// One compiled noise term.
#[derive(Clone, Debug)]
pub struct NoiseKernel {
    /// The fractal (fbm over v1 Perlin octaves).
    pub fractal: Fractal,
    /// `amp * NOISE_GAIN`.
    pub scale: f64,
    /// Octaves (for the work counters).
    pub octaves: u32,
}

impl NoiseKernel {
    /// A kernel from its seed and parameters (frequency in 1/blocks).
    pub fn new(
        seed: u64,
        frequency: f64,
        octaves: u8,
        persistence: f64,
        lacunarity: f64,
        amp: f64,
    ) -> Self {
        Self {
            fractal: Fractal::new(
                seed,
                frequency,
                octaves,
                persistence,
                lacunarity,
                NoiseKind::Fbm,
            ),
            scale: amp * NOISE_GAIN,
            octaves: octaves as u32,
        }
    }

    /// The term at `(x, z)`.
    #[inline]
    pub fn sample(&self, x: f64, z: f64) -> f64 {
        crate::landscape::counters::bump(
            crate::landscape::counters::Counter::NoiseOctaves2d,
            self.octaves as u64,
        );
        self.fractal.sample2(x, z) * self.scale
    }
}

/// One compiled cellular term.
#[derive(Clone, Debug)]
pub struct CellKernel {
    /// Site seed.
    pub seed: u64,
    /// Cell size in blocks.
    pub cell: f64,
    /// Site jitter.
    pub jitter: f64,
    /// Output scale.
    pub amp: f64,
    /// F2 - F1 instead of F1.
    pub f2_minus_f1: bool,
}

impl CellKernel {
    fn site(&self, cx: i64, cz: i64) -> (f64, f64) {
        let mut s = HashStream::new(self.seed ^ mix64(cell_id(cx, cz)));
        let jx = (s.unit() - 0.5) * self.jitter;
        let jz = (s.unit() - 0.5) * self.jitter;
        (
            (cx as f64 + 0.5 + jx) * self.cell,
            (cz as f64 + 0.5 + jz) * self.cell,
        )
    }

    /// The term at `(x, z)`.
    pub fn sample(&self, x: f64, z: f64) -> f64 {
        let cx = (x / self.cell).floor() as i64;
        let cz = (z / self.cell).floor() as i64;
        let mut f1 = f64::INFINITY;
        let mut f2 = f64::INFINITY;
        for dz in -1..=1 {
            for dx in -1..=1 {
                let (sx, sz) = self.site(cx + dx, cz + dz);
                let (ddx, ddz) = (sx - x, sz - z);
                let d = (ddx * ddx + ddz * ddz).sqrt();
                if d < f1 {
                    f2 = f1;
                    f1 = d;
                } else if d < f2 {
                    f2 = d;
                }
            }
        }
        let v = if self.f2_minus_f1 { f2 - f1 } else { f1 };
        self.amp * v / self.cell
    }
}

/// Fritsch-Carlson slopes for knots `(x, y)` (x strictly increasing): the
/// interpolant is monotone on every interval and never leaves the range of
/// that interval's knot values.
pub fn monotone_slopes(xs: &[f64], ys: &[f64], out: &mut [f64]) {
    let n = xs.len();
    for o in out.iter_mut() {
        *o = 0.0;
    }
    if n < 2 {
        return;
    }
    let secant = |i: usize| (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
    out[0] = secant(0);
    out[n - 1] = secant(n - 2);
    for i in 1..n - 1 {
        let (d0, d1) = (secant(i - 1), secant(i));
        out[i] = if d0 * d1 <= 0.0 { 0.0 } else { (d0 + d1) * 0.5 };
    }
    for i in 0..n - 1 {
        let d = secant(i);
        if d == 0.0 {
            out[i] = 0.0;
            out[i + 1] = 0.0;
            continue;
        }
        let a = out[i] / d;
        let b = out[i + 1] / d;
        // Keep the slopes' signs with the secant's.
        if a < 0.0 {
            out[i] = 0.0;
        }
        if b < 0.0 {
            out[i + 1] = 0.0;
        }
        let (a, b) = (out[i] / d, out[i + 1] / d);
        let s = a * a + b * b;
        if s > 9.0 {
            let tau = 3.0 / s.sqrt();
            out[i] = tau * a * d;
            out[i + 1] = tau * b * d;
        }
    }
}

/// Cubic Hermite through `(xs, ys)` with `slopes`, constant beyond the ends.
#[inline]
pub fn hermite(xs: &[f64], ys: &[f64], slopes: &[f64], x: f64) -> f64 {
    let n = xs.len();
    if !(x > xs[0]) {
        return ys[0];
    }
    if !(x < xs[n - 1]) {
        return ys[n - 1];
    }
    let mut i = 0;
    while i + 2 < n && x >= xs[i + 1] {
        i += 1;
    }
    let h = xs[i + 1] - xs[i];
    let s = (x - xs[i]) / h;
    let s2 = s * s;
    let s3 = s2 * s;
    ys[i] * (2.0 * s3 - 3.0 * s2 + 1.0)
        + slopes[i] * h * (s3 - 2.0 * s2 + s)
        + ys[i + 1] * (3.0 * s2 - 2.0 * s3)
        + slopes[i + 1] * h * (s3 - s2)
}

impl SplineTable {
    /// A table from knots (validated by the compiler).
    pub fn new(knots: Vec<(f64, f64)>) -> Self {
        let xs: Vec<f64> = knots.iter().map(|k| k.0).collect();
        let ys: Vec<f64> = knots.iter().map(|k| k.1).collect();
        let mut slopes = vec![0.0; xs.len()];
        monotone_slopes(&xs, &ys, &mut slopes);
        Self { knots, slopes }
    }

    /// The spline at `x`.
    pub fn sample(&self, x: f64) -> f64 {
        // Knots are few; split them per call rather than store twice.
        let n = self.knots.len();
        let mut xs = [0.0f64; MAX_KNOTS];
        let mut ys = [0.0f64; MAX_KNOTS];
        for (i, k) in self.knots.iter().enumerate() {
            xs[i] = k.0;
            ys[i] = k.1;
        }
        hermite(&xs[..n], &ys[..n], &self.slopes, x)
    }
}

/// Catmull-Rom weights at `t` in `[0, 1)`: C1, exact at the nodes.
#[inline]
pub fn catmull_rom(t: f64) -> [f64; 4] {
    let t2 = t * t;
    let t3 = t2 * t;
    [
        -0.5 * t + t2 - 0.5 * t3,
        1.0 - 2.5 * t2 + 1.5 * t3,
        0.5 * t + 2.0 * t2 - 1.5 * t3,
        -0.5 * t2 + 0.5 * t3,
    ]
}

/// A rectangle of lattice node values: node `(i, j)` sits at world
/// `(i * stride, j * stride)`.
#[derive(Clone, Debug, Default)]
pub struct LatticeRect {
    /// Lattice stride in blocks.
    pub stride: i32,
    /// First node index on x.
    pub i0: i64,
    /// First node index on z.
    pub j0: i64,
    /// Nodes along x.
    pub ni: usize,
    /// Nodes along z.
    pub nj: usize,
    /// Values, x fastest.
    pub values: Vec<f64>,
}

impl LatticeRect {
    /// The node range `[i0, i1)` covering every interpolation at world
    /// positions in `[lo, hi]` (inclusive, in blocks).
    pub fn nodes_for(stride: i32, lo: f64, hi: f64) -> (i64, i64) {
        let s = stride as f64;
        let a = (lo / s).floor() as i64 - 1;
        let b = (hi / s).floor() as i64 + 3;
        (a, b)
    }

    /// The node value at `(i, j)`; panics outside the rectangle.
    #[inline]
    pub fn node(&self, i: i64, j: i64) -> f64 {
        let di = (i - self.i0) as usize;
        let dj = (j - self.j0) as usize;
        assert!(
            di < self.ni && dj < self.nj,
            "lattice read outside its rectangle"
        );
        self.values[dj * self.ni + di]
    }

    /// The C1 bicubic interpolation at world `(x, z)`.
    #[inline]
    pub fn sample(&self, x: f64, z: f64) -> f64 {
        let s = self.stride as f64;
        let (u, v) = (x / s, z / s);
        let (fi, fj) = (u.floor(), v.floor());
        let (i, j) = (fi as i64, fj as i64);
        let wx = catmull_rom(u - fi);
        let wz = catmull_rom(v - fj);
        let mut acc = 0.0;
        for (b, wzb) in wz.iter().enumerate() {
            let jj = j - 1 + b as i64;
            let row = self.node(i - 1, jj) * wx[0]
                + self.node(i, jj) * wx[1]
                + self.node(i + 1, jj) * wx[2]
                + self.node(i + 2, jj) * wx[3];
            acc += row * wzb;
        }
        acc
    }
}

/// What the register machine reads besides its own registers: planes,
/// strided lattices and stencils, at the current column.
pub trait Inputs {
    /// Plane `p` at the current column.
    fn plane(&self, p: u32) -> f64;
    /// Strided field `s` at the current position.
    fn strided(&self, s: u32, x: f64, z: f64) -> f64;
    /// Slope (or Laplacian) of plane `p` at the current column.
    fn stencil(&self, p: u32, curvature: bool) -> f64;
}

/// The kernels a program samples.
pub struct Kernels<'a> {
    /// Noise terms.
    pub noise: &'a [NoiseKernel],
    /// Cellular terms.
    pub cells: &'a [CellKernel],
}

/// Run `prog` at position `(x, z)`, leaving results in `regs`.
pub fn run(prog: &Program, k: &Kernels<'_>, inputs: &dyn Inputs, x: f64, z: f64, regs: &mut [f64]) {
    let mut knot_x = [0.0f64; MAX_KNOTS];
    let mut knot_y = [0.0f64; MAX_KNOTS];
    let mut slopes = [0.0f64; MAX_KNOTS];
    for (op, &dst) in prog.ops.iter().zip(prog.dst.iter()) {
        let g = |r: u32| regs[r as usize];
        let v = match *op {
            Op::Const(v) => v,
            Op::Noise { kernel, warp } => {
                let kernel = &k.noise[kernel as usize];
                match warp {
                    None => kernel.sample(x, z),
                    Some((wx, wz, amp)) => kernel.sample(x + amp * g(wx), z + amp * g(wz)),
                }
            }
            Op::Cellular { kernel } => k.cells[kernel as usize].sample(x, z),
            Op::Plane(p) => inputs.plane(p),
            Op::Strided(s) => inputs.strided(s, x, z),
            Op::Stencil { plane, curvature } => inputs.stencil(plane, curvature),
            Op::Add(a, b) => g(a) + g(b),
            Op::Sub(a, b) => g(a) - g(b),
            Op::Mul(a, b) => g(a) * g(b),
            Op::Div { num, den, eps } => {
                let d = g(den);
                let d = if d >= 0.0 { d.fmax(eps) } else { d.fmin(-eps) };
                g(num) / d
            }
            Op::Neg(a) => -g(a),
            Op::Abs(a) => g(a).abs(),
            Op::Sqrt(a) => g(a).fmax(0.0).sqrt(),
            Op::Min(a, b) => g(a).fmin(g(b)),
            Op::Max(a, b) => g(a).fmax(g(b)),
            Op::SMin { a, b, k } => smin(g(a), g(b), k),
            Op::SMax { a, b, k } => smax(g(a), g(b), k),
            Op::Clamp { x: a, lo, hi } => g(a).fclamp(lo, hi),
            Op::Affine { x: a, mul, add } => g(a) * mul + add,
            Op::Smoothstep { x: a, e0, e1 } => smoothstep(e0, e1, g(a)),
            Op::Smootherstep { x: a, e0, e1 } => smootherstep(e0, e1, g(a)),
            Op::Lerp { a, b, t } => {
                let (a, b) = (g(a), g(b));
                a + (b - a) * g(t)
            }
            Op::Bias { x: a, b } => bias(g(a).fclamp(0.0, 1.0), b),
            Op::Gain { x: a, g: gg } => gain(g(a).fclamp(0.0, 1.0), gg),
            Op::PowSmooth { x: a, e } => pow_smooth(g(a).fclamp(0.0, 1.0), e),
            Op::Terrace {
                x: a,
                step,
                softness,
            } => terrace(g(a), step, softness),
            Op::Select {
                cond,
                a,
                b,
                at,
                blend,
            } => {
                let c = g(cond);
                let t = if blend > 0.0 {
                    smoothstep(at - 0.5 * blend, at + 0.5 * blend, c)
                } else if c >= at {
                    1.0
                } else {
                    0.0
                };
                let (a, b) = (g(a), g(b));
                a + (b - a) * t
            }
            Op::Spline { x: a, spline } => prog.splines[spline as usize].sample(g(a)),
            Op::Router { x: a, router } => {
                let table = &prog.routers[router as usize];
                let n = table.knots.len();
                for (i, &(kx, kr)) in table.knots.iter().enumerate() {
                    knot_x[i] = kx;
                    knot_y[i] = g(kr);
                }
                monotone_slopes(&knot_x[..n], &knot_y[..n], &mut slopes[..n]);
                hermite(&knot_x[..n], &knot_y[..n], &slopes[..n], g(a))
            }
            Op::Pulse {
                x: a,
                period,
                softness,
            } => pulse(g(a), period, softness),
        };
        regs[dst as usize] = v;
    }
}

/// Soft terraces: treads `step` apart, risers rounded over `softness` of a
/// step, C1 for softness > 0.
pub fn terrace(x: f64, step: f64, softness: f64) -> f64 {
    let q = x / step;
    let i = q.floor();
    let f = q - i;
    let w = (0.5 * softness).fclamp(1e-6, 0.5);
    step * (i + smoothstep(0.5 - w, 0.5 + w, f))
}

/// A smooth periodic pulse in `[0, 1]`, C1 across periods.
pub fn pulse(x: f64, period: f64, softness: f64) -> f64 {
    let q = x / period;
    let f = q - q.floor();
    let w = (0.5 * softness).fclamp(1e-6, 0.5);
    smoothstep(0.0, w, f) - smoothstep(0.5, 0.5 + w, f)
}
