//! Worn cross-section profiles: walls, cones, sea-cliff faces, caldera
//! S-walls, slot sections and dune waves.
//!
//! Every profile is a short chain of pieces that join with C1 continuity:
//! each piece starts from the value and slope the previous piece computes at
//! the knot, so a join differs only by rounding (well under 1e-12). Each
//! profile reports its height and its analytic slope, and the monotone ones
//! have an inverse: analytic where the piece allows (square roots only),
//! otherwise a bracketed Newton solve with a fixed step cap, which is as
//! deterministic as the rest of the kit.
//!
//! Profiles are built from validated specs: a spec that would make a piece
//! overshoot (and so put a dip or a lip where the profile should rise) is
//! refused with a [`ProfileError`] instead of being clamped.

use std::fmt;

use super::math::{
    pow_smooth, pow_smooth_d, pow_smooth_vd, smootherstep, smootherstep_d, smoothstep,
};

/// Why a profile's spec was refused.
#[derive(Debug, Clone, PartialEq)]
pub struct ProfileError {
    pub profile: &'static str,
    pub reason: String,
}

impl fmt::Display for ProfileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.profile, self.reason)
    }
}

impl std::error::Error for ProfileError {}

fn refuse<T>(profile: &'static str, reason: impl Into<String>) -> Result<T, ProfileError> {
    Err(ProfileError {
        profile,
        reason: reason.into(),
    })
}

fn require(ok: bool, profile: &'static str, reason: &str) -> Result<(), ProfileError> {
    if ok {
        Ok(())
    } else {
        refuse(profile, reason)
    }
}

/// A cross-section made of pieces joined at knots.
///
/// Piece `i` covers `[knot(i − 1), knot(i))` inside [`Profile::domain`]; the
/// first starts at the domain's low end and the last runs to its high end.
/// Outside the domain [`Profile::sample`] holds the end height with zero
/// slope.
pub trait Profile {
    /// The parameter range the pieces cover.
    fn domain(&self) -> (f64, f64);
    /// Number of interior knots (pieces − 1).
    fn knot_count(&self) -> usize;
    /// Interior knot `i`, ascending.
    fn knot(&self, i: usize) -> f64;
    /// Height and slope of piece `i`'s own formula at `u`, even outside its
    /// range: evaluating both neighbours at a knot is the C1 join check.
    fn piece(&self, i: usize, u: f64) -> (f64, f64);

    /// Height and slope at `u`.
    fn sample(&self, u: f64) -> (f64, f64) {
        let (lo, hi) = self.domain();
        if u < lo {
            return (self.piece(0, lo).0, 0.0);
        }
        let last = self.knot_count();
        if u > hi {
            return (self.piece(last, hi).0, 0.0);
        }
        let mut i = 0;
        while i < last && u >= self.knot(i) {
            i += 1;
        }
        self.piece(i, u)
    }

    fn height(&self, u: f64) -> f64 {
        self.sample(u).0
    }

    fn slope(&self, u: f64) -> f64 {
        self.sample(u).1
    }
}

/// A profile whose height never decreases across its domain.
pub trait Monotone: Profile {
    /// The smallest parameter in the domain where the height reaches `v`
    /// (the domain's ends for heights beyond its range). The piece holding
    /// `v` is found from the values at the knots, then solved on its own
    /// formula, so a level piece never stalls the solve.
    fn inverse(&self, v: f64) -> f64 {
        let (lo, hi) = self.domain();
        let mut start = lo;
        for i in 0..self.knot_count() {
            let end = self.knot(i);
            if v <= self.piece(i, end).0 {
                return invert_increasing(|u| self.piece(i, u), start, end, v);
            }
            start = end;
        }
        invert_increasing(|u| self.piece(self.knot_count(), u), start, hi, v)
    }
}

/// Step cap of [`invert_increasing`]; it normally stops far sooner.
pub const INVERT_MAX_STEPS: u32 = 100;

/// [`invert_increasing`] stops once a step moves less than this share of
/// its range. Near a level end the root is double and Newton only halves
/// the error each step, so solving to the last bit there would cost dozens
/// of steps for nothing a voxel can show.
pub const INVERT_TOLERANCE: f64 = 1e-13;

/// Solves `f(u) = target` for a non-decreasing `f` on `[lo, hi]`, given its
/// value and slope: Newton steps kept inside a shrinking bracket, bisection
/// whenever a step would leave it, stopping once a step is under
/// [`INVERT_TOLERANCE`] of the range (or the bracket closes). Every step
/// depends only on the values it computes, so the result is deterministic.
/// Targets beyond the range return the matching end.
pub fn invert_increasing(f: impl Fn(f64) -> (f64, f64), lo: f64, hi: f64, target: f64) -> f64 {
    let f_lo = f(lo).0;
    if !(target > f_lo) {
        return lo;
    }
    let f_hi = f(hi).0;
    if !(target < f_hi) {
        return hi;
    }
    let (mut a, mut b) = (lo, hi);
    let mut x = a + (b - a) * ((target - f_lo) / (f_hi - f_lo));
    if !(x > a && x < b) {
        x = 0.5 * (a + b);
    }
    let tolerance = (hi - lo) * INVERT_TOLERANCE;
    for _ in 0..INVERT_MAX_STEPS {
        let (fx, dfx) = f(x);
        let r = fx - target;
        if r == 0.0 {
            return x;
        }
        if r < 0.0 {
            a = x;
        } else {
            b = x;
        }
        let newton = x - r / dfx;
        let next = if dfx > 0.0 && newton > a && newton < b {
            newton
        } else {
            0.5 * (a + b)
        };
        if next == x || !(next > a && next < b) {
            break;
        }
        if (next - x).abs() <= tolerance {
            return next;
        }
        x = next;
    }
    x
}

/// A cubic Hermite piece from `(x0, y0)` with slope `m0` to `(x1, y1)` with
/// slope `m1`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Hermite {
    x0: f64,
    inv_w: f64,
    y0: f64,
    a: f64,
    c2: f64,
    c3: f64,
}

impl Hermite {
    pub fn new(x0: f64, x1: f64, y0: f64, y1: f64, m0: f64, m1: f64) -> Self {
        let w = x1 - x0;
        let dy = y1 - y0;
        let (a, b) = (m0 * w, m1 * w);
        Self {
            x0,
            inv_w: 1.0 / w,
            y0,
            a,
            c2: 3.0 * dy - 2.0 * a - b,
            c3: a + b - 2.0 * dy,
        }
    }

    /// Value and slope at `x`.
    #[inline]
    pub fn at(&self, x: f64) -> (f64, f64) {
        let t = (x - self.x0) * self.inv_w;
        let v = self.y0 + t * (self.a + t * (self.c2 + t * self.c3));
        let d = (self.a + t * (2.0 * self.c2 + 3.0 * self.c3 * t)) * self.inv_w;
        (v, d)
    }

    /// Whether a Hermite piece with end slopes `m0`, `m1` over a rise with
    /// secant `delta` never decreases (the Fritsch–Carlson region).
    pub fn is_monotone(m0: f64, m1: f64, delta: f64) -> bool {
        if delta == 0.0 {
            return m0 == 0.0 && m1 == 0.0;
        }
        if !(delta > 0.0) || m0 < 0.0 || m1 < 0.0 {
            return false;
        }
        let (alpha, beta) = (m0 / delta, m1 / delta);
        if alpha + beta - 2.0 <= 0.0
            || 2.0 * alpha + beta - 3.0 <= 0.0
            || alpha + 2.0 * beta - 3.0 <= 0.0
        {
            return true;
        }
        let k = 2.0 * alpha + beta - 3.0;
        alpha - k * k / (3.0 * (alpha + beta - 2.0)) >= 0.0
    }
}

/// A quadratic piece `y0 + s0·dx + c·dx²` from `x0`: monotone and invertible
/// with one square root.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Quad {
    x0: f64,
    y0: f64,
    s0: f64,
    c: f64,
}

impl Quad {
    #[inline]
    fn at(&self, x: f64) -> (f64, f64) {
        let dx = x - self.x0;
        (
            self.y0 + (self.s0 + self.c * dx) * dx,
            self.s0 + 2.0 * self.c * dx,
        )
    }

    /// The `x` where the piece reaches `v`, on its rising branch.
    #[inline]
    fn inverse(&self, v: f64) -> f64 {
        let y = v - self.y0;
        if !(y > 0.0) {
            return self.x0;
        }
        // Stable root of c·dx² + s0·dx − y = 0.
        let disc = (self.s0 * self.s0 + 4.0 * self.c * y).max(0.0);
        self.x0 + 2.0 * y / (self.s0 + disc.sqrt())
    }
}

/// A wall that steepens from its foot and rounds over at its rim: the
/// canyon wall.
///
/// On `u ∈ [0, 1]` (foot to rim) the height is `pow_smooth(u, exp)` up to
/// `u0 = 1 − rim_round`, then a cubic Hermite from `pow_smooth(u0, exp)` with
/// slope `pow_smooth_d(u0, exp)` to `(1, 1)` with slope 0: C1 everywhere,
/// level at the rim, level at the foot for `exp > 1`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Wall {
    exp: f64,
    u0: f64,
    rim: Hermite,
}

impl Wall {
    /// `exp` in [1, 8] (at exactly 1 the foot meets the floor at slope 1;
    /// above 1 it is level); `rim_round` in (0, 1).
    pub fn new(exp: f64, rim_round: f64) -> Result<Self, ProfileError> {
        const NAME: &str = "Wall";
        require((1.0..=8.0).contains(&exp), NAME, "exp must be in [1, 8]")?;
        require(
            rim_round > 0.0 && rim_round < 1.0,
            NAME,
            "rim_round must be in (0, 1)",
        )?;
        let u0 = 1.0 - rim_round;
        let w0 = pow_smooth(u0, exp);
        let g0 = pow_smooth_d(u0, exp);
        // The rim Hermite is monotone when g0·s ≤ 3(1 − w0) (Fritsch–Carlson).
        // For exp ≥ 1 the mean value theorem gives g0·s ≤ 1 − w0, so this
        // always holds; the assertion guards the argument, not the input.
        debug_assert!(
            g0 * rim_round <= 3.0 * (1.0 - w0),
            "Wall rim would overshoot"
        );
        Ok(Self {
            exp,
            u0,
            rim: Hermite::new(u0, 1.0, w0, 1.0, g0, 0.0),
        })
    }

    pub fn exp(&self) -> f64 {
        self.exp
    }

    pub fn rim_round(&self) -> f64 {
        1.0 - self.u0
    }
}

impl Profile for Wall {
    fn domain(&self) -> (f64, f64) {
        (0.0, 1.0)
    }
    fn knot_count(&self) -> usize {
        1
    }
    fn knot(&self, _: usize) -> f64 {
        self.u0
    }
    fn piece(&self, i: usize, u: f64) -> (f64, f64) {
        if i == 0 {
            pow_smooth_vd(u, self.exp)
        } else {
            self.rim.at(u)
        }
    }
}

impl Monotone for Wall {}

/// A cone that steepens toward its summit and rounds over into it: the
/// volcano flank.
///
/// On `t ∈ [0, 1]` (foot to summit): `pow_smooth(t, exp)` up to the
/// shoulder `ts`, then the quadratic `h_s + g_s·x − g_s·x²/(2(1 − ts))`
/// (`x = t − ts`, `h_s`, `g_s` the power's value and slope at `ts`), level at
/// `t = 1`; the whole profile is divided by its summit value so it ends at 1.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cone {
    exp: f64,
    ts: f64,
    hs: f64,
    gs: f64,
    inv_norm: f64,
}

impl Cone {
    /// `exp` in [1, 8]; `shoulder` in (0, 1).
    pub fn new(exp: f64, shoulder: f64) -> Result<Self, ProfileError> {
        const NAME: &str = "Cone";
        require((1.0..=8.0).contains(&exp), NAME, "exp must be in [1, 8]")?;
        require(
            shoulder > 0.0 && shoulder < 1.0,
            NAME,
            "shoulder must be in (0, 1)",
        )?;
        let hs = pow_smooth(shoulder, exp);
        let gs = pow_smooth_d(shoulder, exp);
        let norm = hs + 0.5 * gs * (1.0 - shoulder);
        Ok(Self {
            exp,
            ts: shoulder,
            hs,
            gs,
            inv_norm: 1.0 / norm,
        })
    }

    pub fn exp(&self) -> f64 {
        self.exp
    }

    pub fn shoulder(&self) -> f64 {
        self.ts
    }
}

impl Profile for Cone {
    fn domain(&self) -> (f64, f64) {
        (0.0, 1.0)
    }
    fn knot_count(&self) -> usize {
        1
    }
    fn knot(&self, _: usize) -> f64 {
        self.ts
    }
    fn piece(&self, i: usize, t: f64) -> (f64, f64) {
        if i == 0 {
            let (v, d) = pow_smooth_vd(t, self.exp);
            (v * self.inv_norm, d * self.inv_norm)
        } else {
            let x = t - self.ts;
            let l = 1.0 - self.ts;
            (
                (self.hs + self.gs * x - self.gs * x * x / (2.0 * l)) * self.inv_norm,
                self.gs * (1.0 - x / l) * self.inv_norm,
            )
        }
    }
}

impl Monotone for Cone {
    fn inverse(&self, v: f64) -> f64 {
        let raw = v / self.inv_norm;
        if raw <= self.hs {
            return invert_increasing(|t| self.piece(0, t), 0.0, self.ts, v);
        }
        // The shoulder is a quadratic: x = L(1 − √(1 − 2y/(g·L))), written
        // in the stable form.
        let l = 1.0 - self.ts;
        let y = raw - self.hs;
        let r = (1.0 - 2.0 * y / (self.gs * l)).max(0.0);
        (self.ts + (2.0 * y / self.gs) / (1.0 + r.sqrt())).min(1.0)
    }
}

/// How a sea cliff's ledge rises across its width, blocks per block: a worn
/// shelf, never a floor.
pub const SHELF_RISE: f64 = 0.3;

/// The sea-cliff face, as data.
///
/// `sp` runs into the land from the foot of the face; heights are over the
/// foot (for a sea cliff, over the sea). From the foot: a steep lower wall
/// rising `ledge` over `run1` and rounding onto the shelf; a worn shelf
/// `shelf` wide rising [`SHELF_RISE`] per block; an upper wall over `run2`
/// that steepens off the back of the shelf; and a rim rounding over `rim`
/// blocks into the cliff top at `h`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FaceSpec {
    pub h: f64,
    pub ledge: f64,
    pub run1: f64,
    pub shelf: f64,
    pub run2: f64,
    pub rim: f64,
}

/// A validated [`FaceSpec`]: four quadratic pieces (foot, shelf, wall base,
/// rim) joined with C1 continuity, with an analytic inverse
/// [`Face::offset`]. The foot starts at slope `2·ledge/run1 − 0.3` and ends
/// at the shelf's slope; the wall base runs from the shelf's slope to the
/// steepest slope `S`; the rim runs from `S` to level, and `S` is solved so
/// the rim tops out at `h`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Face {
    spec: FaceSpec,
    knots: [f64; 4],
    pieces: [Quad; 4],
    top: f64,
}

impl Face {
    pub fn new(spec: FaceSpec) -> Result<Self, ProfileError> {
        const NAME: &str = "Face";
        let FaceSpec {
            h,
            ledge,
            run1,
            shelf,
            run2,
            rim,
        } = spec;
        require(h > 0.0 && h.is_finite(), NAME, "h must be positive")?;
        require(ledge > 0.0, NAME, "ledge must be positive")?;
        require(run1 > 0.0, NAME, "run1 must be positive")?;
        require(shelf >= 0.0, NAME, "shelf must not be negative")?;
        require(run2 > 0.0, NAME, "run2 must be positive")?;
        require(rim > 0.0, NAME, "rim must be positive")?;
        require(
            2.0 * ledge >= SHELF_RISE * run1,
            NAME,
            "the foot is too gentle to reach the ledge (2·ledge < 0.3·run1)",
        )?;
        let a0 = 2.0 * ledge / run1 - SHELF_RISE;
        let foot = Quad {
            x0: 0.0,
            y0: 0.0,
            s0: a0,
            c: (SHELF_RISE - a0) / (2.0 * run1),
        };
        let s1 = run1;
        let (l1, m1) = foot.at(s1);
        let shelf_q = Quad {
            x0: s1,
            y0: l1,
            s0: m1,
            c: 0.0,
        };
        let s2 = s1 + shelf;
        let (l2, m2) = shelf_q.at(s2);
        let steep = (2.0 * (h - l2) - m2 * run2) / (run2 + rim);
        require(
            steep >= 0.0,
            NAME,
            "the upper wall cannot reach h: the shelf ends too high for run2",
        )?;
        let base = Quad {
            x0: s2,
            y0: l2,
            s0: m2,
            c: (steep - m2) / (2.0 * run2),
        };
        let s3 = s2 + run2;
        let (v3, m3) = base.at(s3);
        let rim_q = Quad {
            x0: s3,
            y0: v3,
            s0: m3,
            c: -m3 / (2.0 * rim),
        };
        let s4 = s3 + rim;
        let top = rim_q.at(s4).0;
        Ok(Self {
            spec,
            knots: [s1, s2, s3, s4],
            pieces: [foot, shelf_q, base, rim_q],
            top,
        })
    }

    pub fn spec(&self) -> FaceSpec {
        self.spec
    }

    /// Total horizontal run from the foot to the cliff top.
    pub fn run(&self) -> f64 {
        self.knots[3]
    }

    /// The steepest slope on the face (at the top of the wall base).
    pub fn steepest(&self) -> f64 {
        self.pieces[3].s0.max(self.pieces[0].s0)
    }

    /// How far into the land the face stands at height `v` over its foot:
    /// the inverse of the profile, analytic per piece. 0 at or below the
    /// foot; infinite above the cliff top (no face there).
    pub fn offset(&self, v: f64) -> f64 {
        if !(v > 0.0) {
            return 0.0;
        }
        if v > self.top {
            return f64::INFINITY;
        }
        for (i, piece) in self.pieces.iter().enumerate() {
            let end = if i < 3 {
                self.pieces[i + 1].y0
            } else {
                self.top
            };
            if v < end || i == 3 {
                return piece.inverse(v).min(self.knots[i]);
            }
        }
        unreachable!()
    }
}

impl Profile for Face {
    fn domain(&self) -> (f64, f64) {
        (0.0, self.knots[3])
    }
    fn knot_count(&self) -> usize {
        3
    }
    fn knot(&self, i: usize) -> f64 {
        self.knots[i]
    }
    fn piece(&self, i: usize, sp: f64) -> (f64, f64) {
        self.pieces[i].at(sp)
    }
}

impl Monotone for Face {
    fn inverse(&self, v: f64) -> f64 {
        self.offset(v).min(self.knots[3])
    }
}

/// Largest slump a caldera S-wall takes before its bump could reverse the
/// descent: the wall stays monotone for `|slump| ≤ 6/32`.
pub const SWALL_MAX_SLUMP: f64 = 0.1875;

/// A caldera's S-wall: level floor, a smoothstep wall, level rim.
///
/// On the normalised radius `r ∈ [0, 1]` (centre to rim) the floor holds 0
/// for `r ≤ 1 − share`; across the wall, with `v` the share of the way up,
/// the height is `smoothstep(v) + slump·16v²(1 − v)²`. The slump bump is zero
/// with zero slope at both ends, so the wall joins the floor and the rim
/// with C1 continuity (a `4v(1 − v)` bump would put a kink at both).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SWall {
    share: f64,
    slump: f64,
}

impl SWall {
    /// `share` in (0, 1]; `|slump| ≤` [`SWALL_MAX_SLUMP`].
    pub fn new(share: f64, slump: f64) -> Result<Self, ProfileError> {
        const NAME: &str = "SWall";
        require(share > 0.0 && share <= 1.0, NAME, "share must be in (0, 1]")?;
        require(
            slump.abs() <= SWALL_MAX_SLUMP,
            NAME,
            "|slump| must be at most 0.1875, or the wall would reverse",
        )?;
        Ok(Self { share, slump })
    }

    pub fn share(&self) -> f64 {
        self.share
    }

    pub fn slump(&self) -> f64 {
        self.slump
    }
}

impl Profile for SWall {
    fn domain(&self) -> (f64, f64) {
        (0.0, 1.0)
    }
    fn knot_count(&self) -> usize {
        1
    }
    fn knot(&self, _: usize) -> f64 {
        1.0 - self.share
    }
    fn piece(&self, i: usize, r: f64) -> (f64, f64) {
        if i == 0 {
            return (0.0, 0.0);
        }
        let v = (r - (1.0 - self.share)) / self.share;
        let s = v * (1.0 - v);
        let height = v * v * (3.0 - 2.0 * v) + self.slump * 16.0 * s * s;
        let slope = (6.0 * s + self.slump * 32.0 * s * (1.0 - 2.0 * v)) / self.share;
        (height, slope)
    }
}

impl Monotone for SWall {}

/// A ledge part-way down a slot canyon's wall.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SlotLedge {
    /// Ledge width, blocks (the flagship recipe keeps it at 4 or less).
    pub width: f64,
    /// Depth of the ledge below the rim datum, as a share of the slot's
    /// depth (the recipe uses 0.25 to 0.5).
    pub depth_share: f64,
    /// Horizontal run of the wall above the ledge, blocks.
    pub run: f64,
}

/// A slot canyon's cross-section, as data. `d` is the distance from the
/// slot's centre line, in blocks; heights are relative to the rim datum, so
/// they run from `−depth` on the floor up to 0 beyond the rim's wear.
///
/// The wall sides of a slot bulge independently: evaluate each side with
/// its own `half` width.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SlotSpec {
    pub depth: f64,
    pub half: f64,
    /// Share of `half` that is level floor; the rest is the lower wall.
    pub flat: f64,
    pub ledge: Option<SlotLedge>,
    /// The rim's quadratic lip: depth (1 to 3) and reach (3), blocks.
    pub lip: f64,
    pub lip_reach: f64,
    /// The bench sloping in toward the rim, `pow_smooth(·, 1.5)`: depth
    /// (1 to 3) and reach (9), blocks.
    pub bench: f64,
    pub bench_reach: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum SlotPiece {
    Level(f64),
    Wall(Hermite),
    Rim { at: f64 },
}

/// A validated [`SlotSpec`]: level floor, a near-vertical lower wall, the
/// optional ledge and the wall above it, then the rim's lip and bench, all
/// joined with C1 continuity and rising monotonically outward.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SlotSection {
    spec: SlotSpec,
    knots: [f64; 5],
    pieces: [SlotPiece; 6],
    count: usize,
    rim_start: f64,
}

impl SlotSection {
    pub fn new(spec: SlotSpec) -> Result<Self, ProfileError> {
        const NAME: &str = "SlotSection";
        require(spec.depth > 0.0, NAME, "depth must be positive")?;
        require(spec.half > 0.0, NAME, "half must be positive")?;
        require(
            spec.flat >= 0.0 && spec.flat < 1.0,
            NAME,
            "flat must be in [0, 1)",
        )?;
        require(
            spec.lip >= 0.0 && spec.bench >= 0.0,
            NAME,
            "lip and bench must not be negative",
        )?;
        require(
            spec.lip_reach > 0.0 && spec.bench_reach > 0.0,
            NAME,
            "lip_reach and bench_reach must be positive",
        )?;
        let rim_drop = spec.lip + spec.bench;
        let rim_slope = rim_at(&spec, 0.0).1;
        let f0 = spec.flat * spec.half;
        let mut knots = [0.0; 5];
        let mut pieces = [SlotPiece::Level(-spec.depth); 6];
        let mut count = 0;
        let mut push = |knot: f64, piece: SlotPiece| {
            knots[count] = knot;
            pieces[count + 1] = piece;
            count += 1;
        };
        let wall = |x0: f64, x1: f64, y0: f64, y1: f64, m1: f64| {
            let delta = (y1 - y0) / (x1 - x0);
            if !Hermite::is_monotone(0.0, m1, delta) {
                return refuse(
                    NAME,
                    format!("a wall from {y0} to {y1} over {x0}..{x1} would overshoot"),
                );
            }
            Ok(SlotPiece::Wall(Hermite::new(x0, x1, y0, y1, 0.0, m1)))
        };
        let rim_start;
        match spec.ledge {
            Some(ledge) => {
                require(
                    ledge.width > 0.0 && ledge.run > 0.0,
                    NAME,
                    "ledge width and run must be positive",
                )?;
                let ledge_h = -ledge.depth_share * spec.depth;
                require(
                    ledge.depth_share > 0.0 && ledge.depth_share < 1.0 && -ledge_h > rim_drop,
                    NAME,
                    "the ledge must lie between the floor and the rim's wear",
                )?;
                push(f0, wall(f0, spec.half, -spec.depth, ledge_h, 0.0)?);
                push(spec.half, SlotPiece::Level(ledge_h));
                let x0 = spec.half + ledge.width;
                rim_start = x0 + ledge.run;
                push(x0, wall(x0, rim_start, ledge_h, -rim_drop, rim_slope)?);
            }
            None => {
                require(
                    spec.depth > rim_drop,
                    NAME,
                    "the rim's wear is deeper than the slot",
                )?;
                rim_start = spec.half;
                push(f0, wall(f0, rim_start, -spec.depth, -rim_drop, rim_slope)?);
            }
        }
        push(rim_start, SlotPiece::Rim { at: rim_start });
        let reach = spec.lip_reach.max(spec.bench_reach);
        let near = spec.lip_reach.min(spec.bench_reach);
        if near < reach {
            // Split where the shorter wear term ends, so every knot is a join.
            push(rim_start + near, SlotPiece::Rim { at: rim_start });
        }
        Ok(Self {
            spec,
            knots,
            pieces,
            count,
            rim_start,
        })
    }

    pub fn spec(&self) -> SlotSpec {
        self.spec
    }

    /// Distance from the centre line where the wall tops out and the rim's
    /// wear begins.
    pub fn rim_start(&self) -> f64 {
        self.rim_start
    }

    /// Distance from the centre line where the rim's wear ends.
    pub fn reach(&self) -> f64 {
        self.domain().1
    }
}

/// The rim's wear at distance `o` beyond the wall top: height and slope.
fn rim_at(spec: &SlotSpec, o: f64) -> (f64, f64) {
    let q = (1.0 - o / spec.lip_reach).max(0.0);
    let b = (1.0 - o / spec.bench_reach).max(0.0);
    (
        -(spec.lip * q * q + spec.bench * pow_smooth(b, 1.5)),
        2.0 * spec.lip * q / spec.lip_reach + spec.bench * pow_smooth_d(b, 1.5) / spec.bench_reach,
    )
}

impl Profile for SlotSection {
    fn domain(&self) -> (f64, f64) {
        (
            0.0,
            self.rim_start + self.spec.lip_reach.max(self.spec.bench_reach),
        )
    }
    fn knot_count(&self) -> usize {
        self.count
    }
    fn knot(&self, i: usize) -> f64 {
        self.knots[i]
    }
    fn piece(&self, i: usize, d: f64) -> (f64, f64) {
        match self.pieces[i] {
            SlotPiece::Level(h) => (h, 0.0),
            SlotPiece::Wall(w) => w.at(d),
            SlotPiece::Rim { at } => rim_at(&self.spec, d - at),
        }
    }
}

impl Monotone for SlotSection {}

/// A dune's cross-section over one wavelength, on the phase `u ∈ [0, 1)`:
/// a long stoss slope `smootherstep(0, stoss, u)` to the crest at
/// `u = stoss`, then the lee `1 − smoothstep(stoss, 1, u)` back to the
/// trough. Both ends of both pieces are level, so crests are rounded and the
/// wrap from one wave to the next is C1.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DuneWave {
    stoss: f64,
}

impl DuneWave {
    /// `stoss` in (0, 1): the share of a wavelength on the windward side.
    pub fn new(stoss: f64) -> Result<Self, ProfileError> {
        require(
            stoss > 0.0 && stoss < 1.0,
            "DuneWave",
            "stoss must be in (0, 1)",
        )?;
        Ok(Self { stoss })
    }

    pub fn stoss(&self) -> f64 {
        self.stoss
    }

    /// Steepest lee slope of a wave `amplitude` tall and `wavelength` long:
    /// `1.5·A/((1 − stoss)·λ)`. Validation compares it with the angle of
    /// repose.
    pub fn max_lee_slope(&self, amplitude: f64, wavelength: f64) -> f64 {
        1.5 * amplitude / ((1.0 - self.stoss) * wavelength)
    }

    /// Steepest stoss slope: `1.875·A/(stoss·λ)`.
    pub fn max_stoss_slope(&self, amplitude: f64, wavelength: f64) -> f64 {
        1.875 * amplitude / (self.stoss * wavelength)
    }

    /// The two phases where the wave stands at `v ∈ [0, 1]`: on the stoss
    /// slope and on the lee.
    pub fn inverse(&self, v: f64) -> (f64, f64) {
        let stoss = invert_increasing(|u| self.piece(0, u), 0.0, self.stoss, v);
        let lee = invert_increasing(
            |u| {
                let (h, s) = self.piece(1, u);
                (1.0 - h, -s)
            },
            self.stoss,
            1.0,
            1.0 - v,
        );
        (stoss, lee)
    }
}

impl Profile for DuneWave {
    fn domain(&self) -> (f64, f64) {
        (0.0, 1.0)
    }
    fn knot_count(&self) -> usize {
        1
    }
    fn knot(&self, _: usize) -> f64 {
        self.stoss
    }
    fn piece(&self, i: usize, u: f64) -> (f64, f64) {
        if i == 0 {
            (
                smootherstep(0.0, self.stoss, u),
                smootherstep_d(0.0, self.stoss, u),
            )
        } else {
            let t = ((u - self.stoss) / (1.0 - self.stoss)).max(0.0).min(1.0);
            (
                1.0 - smoothstep(self.stoss, 1.0, u),
                -6.0 * t * (1.0 - t) / (1.0 - self.stoss),
            )
        }
    }
    /// Periodic: the phase wraps, so any `u` is valid.
    fn sample(&self, u: f64) -> (f64, f64) {
        let u = u - u.floor();
        if u < self.stoss {
            self.piece(0, u)
        } else {
            self.piece(1, u)
        }
    }
}
