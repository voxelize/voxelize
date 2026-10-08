//! Plan-space geometry: footprints and their fades, distance to a field's
//! zero line, iso-contour tracing, arc schedules, feature frames along a
//! polyline, and the conservative tile gate of Field layouts.
//!
//! Everything here is pure arithmetic over `f64` with square roots only.

use std::f64::consts::FRAC_1_SQRT_2;

use crate::stream::HashStream;

pub use super::math::ring_noise;
use super::math::smootherstep;

/// An axis-aligned box in the (x, z) plane, inclusive of its bounds.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Aabb2 {
    pub min_x: f64,
    pub min_z: f64,
    pub max_x: f64,
    pub max_z: f64,
}

impl Aabb2 {
    pub const EMPTY: Self = Self {
        min_x: f64::INFINITY,
        min_z: f64::INFINITY,
        max_x: f64::NEG_INFINITY,
        max_z: f64::NEG_INFINITY,
    };

    pub fn around(x: f64, z: f64, r: f64) -> Self {
        Self {
            min_x: x - r,
            min_z: z - r,
            max_x: x + r,
            max_z: z + r,
        }
    }

    pub fn union(self, o: Self) -> Self {
        Self {
            min_x: self.min_x.min(o.min_x),
            min_z: self.min_z.min(o.min_z),
            max_x: self.max_x.max(o.max_x),
            max_z: self.max_z.max(o.max_z),
        }
    }

    pub fn grow(self, r: f64) -> Self {
        Self {
            min_x: self.min_x - r,
            min_z: self.min_z - r,
            max_x: self.max_x + r,
            max_z: self.max_z + r,
        }
    }

    pub fn contains(&self, x: f64, z: f64) -> bool {
        x >= self.min_x && x <= self.max_x && z >= self.min_z && z <= self.max_z
    }

    pub fn intersects(&self, o: &Self) -> bool {
        self.min_x <= o.max_x
            && o.min_x <= self.max_x
            && self.min_z <= o.max_z
            && o.min_z <= self.max_z
    }
}

/// Closest point on segment `a`–`b` to `p`: the parameter `t ∈ [0, 1]` and
/// the distance.
#[inline]
pub fn segment_distance(p: (f64, f64), a: (f64, f64), b: (f64, f64)) -> (f64, f64) {
    let (vx, vz) = (b.0 - a.0, b.1 - a.1);
    let len_sq = vx * vx + vz * vz;
    let t = if len_sq > 0.0 {
        (((p.0 - a.0) * vx + (p.1 - a.1) * vz) / len_sq)
            .max(0.0)
            .min(1.0)
    } else {
        0.0
    };
    let (dx, dz) = (p.0 - (a.0 + vx * t), p.1 - (a.1 + vz * t));
    (t, (dx * dx + dz * dz).sqrt())
}

/// The ground a plan claims, as a signed distance: positive inside (the
/// distance to the bound, exact for discs, boxes and polygons), negative
/// outside, zero on the bound.
#[derive(Clone, Debug, PartialEq)]
pub enum Footprint {
    Disc {
        center: (f64, f64),
        radius: f64,
    },
    Rect {
        min: (f64, f64),
        max: (f64, f64),
    },
    /// Capsules along a polyline, the radius varying linearly along each
    /// segment; the union of the capsules. Channels lower to this.
    Capsules {
        points: Vec<(f64, f64)>,
        radii: Vec<f64>,
    },
    /// A simple polygon (either winding), even–odd inside test.
    Polygon {
        points: Vec<(f64, f64)>,
    },
}

impl Footprint {
    pub fn disc(center: (f64, f64), radius: f64) -> Self {
        Self::Disc { center, radius }
    }

    pub fn rect(min: (f64, f64), max: (f64, f64)) -> Self {
        Self::Rect { min, max }
    }

    /// A capsule chain of constant radius.
    pub fn capsule_chain(points: Vec<(f64, f64)>, radius: f64) -> Self {
        let radii = vec![radius; points.len()];
        Self::Capsules { points, radii }
    }

    /// A capsule chain with a radius per point.
    pub fn capsules(points: Vec<(f64, f64)>, radii: Vec<f64>) -> Self {
        assert_eq!(points.len(), radii.len(), "one radius per point");
        Self::Capsules { points, radii }
    }

    pub fn polygon(points: Vec<(f64, f64)>) -> Self {
        Self::Polygon { points }
    }

    /// The footprint of every line of a channel network, each vertex's half
    /// width read from its payload.
    pub fn channel<P: Copy>(
        net: &super::channels::ChannelNet<P>,
        half_width: impl Fn(&P) -> f64,
    ) -> Vec<Self> {
        (0..net.line_count())
            .map(|line| {
                let vertices = net.line(line);
                Self::Capsules {
                    points: vertices.iter().map(|v| (v.x, v.z)).collect(),
                    radii: vertices.iter().map(|v| half_width(&v.payload)).collect(),
                }
            })
            .collect()
    }

    /// Signed distance, positive inside.
    pub fn sdf_inside(&self, x: f64, z: f64) -> f64 {
        match self {
            Self::Disc { center, radius } => {
                let (dx, dz) = (x - center.0, z - center.1);
                radius - (dx * dx + dz * dz).sqrt()
            }
            Self::Rect { min, max } => {
                let dx = (min.0 - x).max(x - max.0);
                let dz = (min.1 - z).max(z - max.1);
                if dx <= 0.0 && dz <= 0.0 {
                    -dx.max(dz)
                } else {
                    let (ox, oz) = (dx.max(0.0), dz.max(0.0));
                    -(ox * ox + oz * oz).sqrt()
                }
            }
            Self::Capsules { points, radii } => {
                if points.len() == 1 {
                    let (dx, dz) = (x - points[0].0, z - points[0].1);
                    return radii[0] - (dx * dx + dz * dz).sqrt();
                }
                let mut best = f64::NEG_INFINITY;
                for i in 0..points.len().saturating_sub(1) {
                    let (t, d) = segment_distance((x, z), points[i], points[i + 1]);
                    let r = radii[i] + (radii[i + 1] - radii[i]) * t;
                    best = best.max(r - d);
                }
                best
            }
            Self::Polygon { points } => {
                let n = points.len();
                let mut d = f64::INFINITY;
                let mut inside = false;
                for i in 0..n {
                    let a = points[i];
                    let b = points[(i + 1) % n];
                    d = d.min(segment_distance((x, z), a, b).1);
                    if (a.1 > z) != (b.1 > z) && x < a.0 + (z - a.1) * (b.0 - a.0) / (b.1 - a.1) {
                        inside = !inside;
                    }
                }
                if inside {
                    d
                } else {
                    -d
                }
            }
        }
    }

    /// Bounds of the footprint (the zero set lies inside).
    pub fn bounds(&self) -> Aabb2 {
        match self {
            Self::Disc { center, radius } => Aabb2::around(center.0, center.1, *radius),
            Self::Rect { min, max } => Aabb2 {
                min_x: min.0,
                min_z: min.1,
                max_x: max.0,
                max_z: max.1,
            },
            Self::Capsules { points, radii } => {
                points.iter().zip(radii).fold(Aabb2::EMPTY, |b, (p, r)| {
                    b.union(Aabb2::around(p.0, p.1, r.max(0.0)))
                })
            }
            Self::Polygon { points } => points
                .iter()
                .fold(Aabb2::EMPTY, |b, p| b.union(Aabb2::around(p.0, p.1, 0.0))),
        }
    }

    /// This footprint faded inward over `width` blocks.
    pub fn fade(self, width: f64) -> FadedFootprint {
        FadedFootprint {
            footprint: self,
            width,
        }
    }
}

/// A footprint with its fade: `edge = smootherstep(0, width, sdf_inside)`,
/// 0 on and outside the bound and 1 deeper than `width` inside, so any op
/// scaled by it is C0 at the bound by construction.
#[derive(Clone, Debug, PartialEq)]
pub struct FadedFootprint {
    pub footprint: Footprint,
    pub width: f64,
}

impl FadedFootprint {
    pub fn edge(&self, x: f64, z: f64) -> f64 {
        smootherstep(0.0, self.width, self.footprint.sdf_inside(x, z))
    }

    pub fn bounds(&self) -> Aabb2 {
        self.footprint.bounds()
    }
}

/// Distance to the zero line of a field, from its value and gradient.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ZeroLine {
    /// First-order estimate `|f|/|∇f|`.
    pub first: f64,
    /// After one Newton step onto the line: the step's length plus the
    /// first-order estimate there. Near a saddle of the field (where two
    /// courses cross) the first estimate reads about half the true distance
    /// and would open a room; the refined one forks.
    pub refined: f64,
}

impl ZeroLine {
    /// The first estimate on the line, the refined one away from it, and a
    /// smoothstep between `near` and `far` (a hard switch would leave a seam
    /// where the two estimates disagree).
    pub fn blend(&self, near: f64, far: f64) -> f64 {
        let w = super::math::smoothstep(near, far, self.first);
        self.first + (self.refined - self.first) * w
    }
}

/// Distance from `(x, z)` to the zero line of a field. `eval` returns the
/// field's value and gradient `(f, ∂f/∂x, ∂f/∂z)`; `eps` floors the
/// gradient's length.
pub fn zero_line_distance(
    eval: impl Fn(f64, f64) -> (f64, f64, f64),
    x: f64,
    z: f64,
    eps: f64,
) -> ZeroLine {
    let (f0, gx, gz) = eval(x, z);
    let g2 = (gx * gx + gz * gz).max(eps * eps);
    let first = f0.abs() / g2.sqrt();
    let step = f0 / g2;
    let (x1, z1) = (x - gx * step, z - gz * step);
    let (f1, hx, hz) = eval(x1, z1);
    let h = (hx * hx + hz * hz).sqrt().max(eps);
    let (dx, dz) = (x1 - x, z1 - z);
    ZeroLine {
        first,
        refined: (dx * dx + dz * dz).sqrt() + f1.abs() / h,
    }
}

/// A point on a traced iso-contour, with the field's unit gradient there
/// (pointing up the field).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct IsoNode {
    pub x: f64,
    pub z: f64,
    pub nx: f64,
    pub nz: f64,
}

/// Why a trace stopped.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IsoEnd {
    /// The node budget ran out.
    MaxNodes,
    /// The gradient vanished (a flat or a saddle).
    Flat,
    /// The Newton correction could not reach the contour.
    LostContour,
    /// The contour turned more sharply than allowed.
    SharpTurn,
    /// The caller's `keep` refused a node.
    Refused,
    /// The trace came back to its start.
    Closed,
}

/// The result of [`IsoTracer::trace`].
#[derive(Clone, Debug, PartialEq)]
pub struct IsoTrace {
    pub nodes: Vec<IsoNode>,
    pub end: IsoEnd,
    /// Field evaluations spent: a deterministic step count for plan budgets.
    pub probes: u32,
}

/// Marches along an iso-contour in fixed steps, correcting each step back
/// onto the contour with Newton steps along the normal.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct IsoTracer {
    /// Step length along the contour.
    pub step: f64,
    /// Most nodes to emit.
    pub max_nodes: usize,
    /// Central-difference half step for the gradient.
    pub gradient_h: f64,
    /// Largest |f − iso| accepted after correction.
    pub tolerance: f64,
    /// Smallest cosine between consecutive normals (a sharper turn stops).
    pub min_turn: f64,
    /// Largest correction per Newton step, as a share of `step`.
    pub max_correction: f64,
    /// Gradient lengths below this count as flat.
    pub flat: f64,
}

impl IsoTracer {
    fn gradient(
        &self,
        f: &mut impl FnMut(f64, f64) -> f64,
        x: f64,
        z: f64,
        probes: &mut u32,
    ) -> Option<(f64, f64, f64)> {
        let h = self.gradient_h;
        let gx = (f(x + h, z) - f(x - h, z)) / (2.0 * h);
        let gz = (f(x, z + h) - f(x, z - h)) / (2.0 * h);
        *probes += 4;
        let g = (gx * gx + gz * gz).sqrt();
        if !(g > self.flat) {
            return None;
        }
        Some((gx / g, gz / g, g))
    }

    /// Newton steps from `p` along the normal onto `f = iso`.
    fn snap(
        &self,
        f: &mut impl FnMut(f64, f64) -> f64,
        iso: f64,
        p: (f64, f64),
        probes: &mut u32,
    ) -> Option<((f64, f64), (f64, f64))> {
        let mut q = p;
        for limit in [
            self.step * self.max_correction,
            self.step * self.max_correction * 0.25,
        ] {
            let (nx, nz, g) = self.gradient(f, q.0, q.1, probes)?;
            let r = f(q.0, q.1) - iso;
            *probes += 1;
            let k = (-r / g).max(-limit).min(limit);
            q = (q.0 + nx * k, q.1 + nz * k);
            let r = f(q.0, q.1) - iso;
            *probes += 1;
            if r.abs() <= self.tolerance {
                let (nx, nz, _) = self.gradient(f, q.0, q.1, probes)?;
                return Some((q, (nx, nz)));
            }
        }
        None
    }

    /// Trace the contour `f = iso` from near `start`, travelling with the
    /// higher field on the left (`side = 1`) or on the right (`side = −1`).
    /// `keep` may refuse a node, which ends the trace before it.
    pub fn trace(
        &self,
        mut f: impl FnMut(f64, f64) -> f64,
        iso: f64,
        start: (f64, f64),
        side: f64,
        mut keep: impl FnMut(&IsoNode) -> bool,
    ) -> IsoTrace {
        let mut probes = 0;
        let mut nodes = Vec::new();
        let Some((p0, n0)) = self.snap(&mut f, iso, start, &mut probes) else {
            return IsoTrace {
                nodes,
                end: IsoEnd::LostContour,
                probes,
            };
        };
        let first = IsoNode {
            x: p0.0,
            z: p0.1,
            nx: n0.0,
            nz: n0.1,
        };
        if !keep(&first) {
            return IsoTrace {
                nodes,
                end: IsoEnd::Refused,
                probes,
            };
        }
        nodes.push(first);
        let (mut p, mut n) = (p0, n0);
        let end = loop {
            if nodes.len() >= self.max_nodes {
                break IsoEnd::MaxNodes;
            }
            let t = (-n.1 * side, n.0 * side);
            let guess = (p.0 + t.0 * self.step, p.1 + t.1 * self.step);
            let Some((q, nn)) = self.snap(&mut f, iso, guess, &mut probes) else {
                break IsoEnd::LostContour;
            };
            if nn.0 * n.0 + nn.1 * n.1 < self.min_turn {
                break IsoEnd::SharpTurn;
            }
            let node = IsoNode {
                x: q.0,
                z: q.1,
                nx: nn.0,
                nz: nn.1,
            };
            if !keep(&node) {
                break IsoEnd::Refused;
            }
            nodes.push(node);
            let (dx, dz) = (q.0 - p0.0, q.1 - p0.1);
            if nodes.len() > 6 && (dx * dx + dz * dz).sqrt() < self.step * 0.8 {
                break IsoEnd::Closed;
            }
            p = q;
            n = nn;
        };
        IsoTrace { nodes, end, probes }
    }
}

/// Spaces features along an arc with interval reservation, so headlands,
/// coves and falls along one feature never overlap.
#[derive(Clone, Debug, PartialEq)]
pub struct ArcSchedule {
    length: f64,
    /// Reserved intervals, sorted and disjoint.
    taken: Vec<(f64, f64)>,
}

impl ArcSchedule {
    pub fn new(length: f64) -> Self {
        Self {
            length,
            taken: Vec::new(),
        }
    }

    pub fn length(&self) -> f64 {
        self.length
    }

    pub fn reserved(&self) -> &[(f64, f64)] {
        &self.taken
    }

    /// Whether `[s0, s1]` lies on the arc and touches no reservation.
    pub fn is_free(&self, s0: f64, s1: f64) -> bool {
        s0 >= 0.0
            && s1 <= self.length
            && s0 <= s1
            && self.taken.iter().all(|&(a, b)| s1 < a || s0 > b)
    }

    /// Reserve `[s0, s1]` if it is free.
    pub fn reserve(&mut self, s0: f64, s1: f64) -> bool {
        if !self.is_free(s0, s1) {
            return false;
        }
        let at = self.taken.partition_point(|&(a, _)| a < s0);
        self.taken.insert(at, (s0, s1));
        true
    }

    /// Walk the arc from `start` every `spacing` (each step jittered by up to
    /// ±`jitter`/2 of a spacing), keep a candidate with probability `chance`,
    /// and reserve `half` either side of it when free. Returns the centres
    /// placed, in arc order.
    pub fn place(
        &mut self,
        start: f64,
        spacing: f64,
        jitter: f64,
        half: f64,
        chance: f64,
        stream: &mut HashStream,
    ) -> Vec<f64> {
        let mut placed = Vec::new();
        if !(spacing > 0.0) {
            return placed;
        }
        let mut s = start;
        while s <= self.length {
            let at = s + spacing * jitter * (stream.unit() - 0.5);
            let roll = stream.unit();
            if roll < chance && self.reserve(at - half, at + half) {
                placed.push(at);
            }
            s += spacing;
        }
        placed
    }
}

/// Where a point lies relative to a polyline.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FramePoint {
    /// Arc length of the nearest point from the line's start.
    pub s: f64,
    /// Signed distance across: positive on the side travel turns toward
    /// when rotated from +x to +z (counter-clockwise, as `unit_dir` counts).
    pub d: f64,
    /// Nearest segment and the parameter along it.
    pub segment: usize,
    pub t: f64,
}

/// An (arc, across) frame along a polyline, for spurs, gullies and notches
/// laid out along a feature.
#[derive(Clone, Debug, PartialEq)]
pub struct FeatureFrame {
    points: Vec<(f64, f64)>,
    arc: Vec<f64>,
}

impl FeatureFrame {
    pub fn new(points: Vec<(f64, f64)>) -> Self {
        assert!(points.len() >= 2, "a feature frame needs two points");
        let mut arc = Vec::with_capacity(points.len());
        let mut s = 0.0;
        arc.push(0.0);
        for w in points.windows(2) {
            let (dx, dz) = (w[1].0 - w[0].0, w[1].1 - w[0].1);
            s += (dx * dx + dz * dz).sqrt();
            arc.push(s);
        }
        Self { points, arc }
    }

    pub fn length(&self) -> f64 {
        *self.arc.last().unwrap()
    }

    pub fn points(&self) -> &[(f64, f64)] {
        &self.points
    }

    /// The nearest point of the line to `(x, z)` (ties to the earlier
    /// segment).
    pub fn locate(&self, x: f64, z: f64) -> FramePoint {
        let mut best = FramePoint {
            s: 0.0,
            d: f64::INFINITY,
            segment: 0,
            t: 0.0,
        };
        let mut best_abs = f64::INFINITY;
        for i in 0..self.points.len() - 1 {
            let (a, b) = (self.points[i], self.points[i + 1]);
            let (t, dist) = segment_distance((x, z), a, b);
            if dist < best_abs {
                let (vx, vz) = (b.0 - a.0, b.1 - a.1);
                let cross = vx * (z - a.1) - vz * (x - a.0);
                best_abs = dist;
                best = FramePoint {
                    s: self.arc[i] + (self.arc[i + 1] - self.arc[i]) * t,
                    d: if cross < 0.0 { -dist } else { dist },
                    segment: i,
                    t,
                };
            }
        }
        best
    }

    /// The point at arc length `s` (clamped to the line) and the unit
    /// tangent there.
    pub fn at(&self, s: f64) -> ((f64, f64), (f64, f64)) {
        let s = s.max(0.0).min(self.length());
        let i = (self.arc.partition_point(|&a| a <= s).max(1) - 1).min(self.points.len() - 2);
        let (a, b) = (self.points[i], self.points[i + 1]);
        let len = self.arc[i + 1] - self.arc[i];
        let t = if len > 0.0 {
            (s - self.arc[i]) / len
        } else {
            0.0
        };
        let (vx, vz) = (b.0 - a.0, b.1 - a.1);
        let inv = if len > 0.0 { 1.0 / len } else { 0.0 };
        ((a.0 + vx * t, a.1 + vz * t), (vx * inv, vz * inv))
    }
}

/// Conservative upper bound of a field over a tile, from samples on a
/// stride-`stride` lattice covering the tile: every point of the tile lies
/// within `stride/√2` of a sample, so with Lipschitz bound `lipschitz` the
/// field there is at most `max(samples) + lipschitz·stride/√2`. It can only
/// over-dispatch a tile, never miss one. (The `f64` constant for 1/√2 rounds
/// up, so the margin is not under-estimated.)
pub fn gate_upper_bound(samples: &[f64], lipschitz: f64, stride: f64) -> f64 {
    let max = samples.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    max + lipschitz * stride * FRAC_1_SQRT_2
}

/// [`gate_upper_bound`] over the square tile `[x0, x0 + size] × [z0, z0 +
/// size]`, sampling `f` at world-aligned multiples of `stride` that cover
/// the tile plus a one-sample ring.
pub fn tile_gate_bound(
    mut f: impl FnMut(f64, f64) -> f64,
    x0: f64,
    z0: f64,
    size: f64,
    stride: f64,
    lipschitz: f64,
) -> f64 {
    let i0 = (x0 / stride).floor() as i64 - 1;
    let i1 = ((x0 + size) / stride).ceil() as i64 + 1;
    let j0 = (z0 / stride).floor() as i64 - 1;
    let j1 = ((z0 + size) / stride).ceil() as i64 + 1;
    let mut max = f64::NEG_INFINITY;
    for i in i0..=i1 {
        for j in j0..=j1 {
            max = max.max(f(i as f64 * stride, j as f64 * stride));
        }
    }
    gate_upper_bound(&[max], lipschitz, stride)
}
