//! Bit-stable scalar math: the worn-not-cut kit's arithmetic.
//!
//! Every function here is built from IEEE-754 add, sub, mul, div, sqrt,
//! floor, abs, min, max and comparisons, evaluated in a fixed order, so its
//! output is the same bits on every platform, compiler and optimisation
//! level. Nothing calls the platform maths library (`tests/no_libm.rs`
//! enforces that for all of `landscape`), and nothing uses fused
//! multiply-add, which Rust never introduces on its own.
//!
//! Where a true transcendental is wanted, this module supplies a pinned
//! replacement: [`psin`] and [`pcos`] (a minimax polynomial after range
//! reduction), [`pow_smooth`] (fractional powers from square roots),
//! [`exp2_p`] and [`log2_p`] (range reduction plus pinned series), and
//! [`unit_dir`] (a pinned table of directions).
//!
//! The ground operations of the composition contract are here too:
//! [`soft_down`] and [`soft_up`] are one-sided soft clamps that return the
//! current ground bit for bit wherever the target does not ask it to move.

/// 2π, rounded to the nearest `f64`.
pub const TAU: f64 = core::f64::consts::TAU;
/// 1 / (2π), rounded to the nearest `f64` (halving 1/π is exact).
pub const INV_TAU: f64 = core::f64::consts::FRAC_1_PI * 0.5;

/// Largest exponent [`pow_smooth`] accepts; larger exponents are clamped.
pub const POW_SMOOTH_MAX_EXP: f64 = 64.0;

/// Clamp to `[0, 1]`. NaN maps to 0.
#[inline]
pub fn clamp01(t: f64) -> f64 {
    t.max(0.0).min(1.0)
}

/// `a + (b − a)·t`.
#[inline]
pub fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

/// Cubic Hermite smoothstep: `t²(3 − 2t)` with `t = clamp((x − e0)/(e1 − e0))`.
/// A degenerate window (`e0 == e1`) is a step at `e0`.
#[inline]
pub fn smoothstep(e0: f64, e1: f64, x: f64) -> f64 {
    let t = clamp01((x - e0) / (e1 - e0));
    t * t * (3.0 - 2.0 * t)
}

/// d/dx of [`smoothstep`]: `6t(1 − t)/(e1 − e0)` inside the window, 0 outside.
#[inline]
pub fn smoothstep_d(e0: f64, e1: f64, x: f64) -> f64 {
    let t = clamp01((x - e0) / (e1 - e0));
    6.0 * t * (1.0 - t) / (e1 - e0)
}

/// Quintic smootherstep `t³(t(6t − 15) + 10)`: C2, used for edge fades.
#[inline]
pub fn smootherstep(e0: f64, e1: f64, x: f64) -> f64 {
    let t = clamp01((x - e0) / (e1 - e0));
    t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
}

/// d/dx of [`smootherstep`]: `30t²(1 − t)²/(e1 − e0)` inside the window.
#[inline]
pub fn smootherstep_d(e0: f64, e1: f64, x: f64) -> f64 {
    let t = clamp01((x - e0) / (e1 - e0));
    let s = t * (1.0 - t);
    30.0 * s * s / (e1 - e0)
}

/// The soft ramp `r_k(d)`: 0 for `d ≤ 0`, `d²/(2k)` for `0 < d < k`,
/// `d − k/2` for `d ≥ k`. C1, monotone, never above `d`; `k = 0` is the
/// hard ramp `max(d, 0)`.
#[inline]
pub fn soft_ramp(d: f64, k: f64) -> f64 {
    debug_assert!(k >= 0.0, "soft_ramp width must be non-negative");
    if !(d > 0.0) {
        0.0
    } else if d >= k {
        d - 0.5 * k
    } else {
        d * d / (2.0 * k)
    }
}

/// d/dd of [`soft_ramp`]: 0, `d/k`, then 1.
#[inline]
pub fn soft_ramp_d(d: f64, k: f64) -> f64 {
    if !(d > 0.0) {
        0.0
    } else if d >= k {
        1.0
    } else {
        d / k
    }
}

/// One-sided soft clamp down (the `Carve` ground op): `cur − r_k(cur − h)`.
///
/// - Returns `cur` bit for bit whenever `h ≥ cur`: the identity where the
///   target does not ask the ground to move.
/// - Fully engaged (`cur − h ≥ k`) it returns exactly `h + k/2`: a monotone
///   C1 clamp that is the identity at `h == cur` cannot also land on `h`, so
///   the offset is part of the contract and profiles absorb it.
/// - Non-decreasing in `cur` in floating point too (every step below is a
///   monotone rounding of a monotone function), and always in `[h, cur]`.
#[inline]
pub fn soft_down(cur: f64, h: f64, k: f64) -> f64 {
    debug_assert!(k >= 0.0, "soft clamp width must be non-negative");
    let d = cur - h;
    if !(d > 0.0) {
        return cur;
    }
    let engaged = h + 0.5 * k;
    if d >= k {
        return engaged;
    }
    // engaged − (k − d)²/(2k) equals cur − d²/(2k); written this way each
    // operation is monotone in `cur`, and the clamp keeps rounding inside
    // [h, cur] so the junction with the identity branch cannot step back.
    let q = k - d;
    (engaged - q * q / (2.0 * k)).max(h).min(cur)
}

/// d/dcur of [`soft_down`]: `1 − r_k'(cur − h)`.
#[inline]
pub fn soft_down_d(cur: f64, h: f64, k: f64) -> f64 {
    1.0 - soft_ramp_d(cur - h, k)
}

/// One-sided soft clamp up (the `Build` ground op): `cur + r_k(h − cur)`.
/// The mirror of [`soft_down`]: `cur` bit for bit wherever `h ≤ cur`, and
/// exactly `h − k/2` when fully engaged.
#[inline]
pub fn soft_up(cur: f64, h: f64, k: f64) -> f64 {
    // Negation is exact and round-to-nearest is symmetric, so this is
    // soft_down mirrored bit for bit.
    -soft_down(-cur, -h, k)
}

/// d/dcur of [`soft_up`].
#[inline]
pub fn soft_up_d(cur: f64, h: f64, k: f64) -> f64 {
    1.0 - soft_ramp_d(h - cur, k)
}

/// Polynomial smooth minimum: `min(a, b) − h²·k/4` with
/// `h = max(k − |a − b|, 0)/k`. Symmetric, so it is a field node only: it
/// shifts its result where `a == b` and must never be a ground op.
#[inline]
pub fn smin(a: f64, b: f64, k: f64) -> f64 {
    if !(k > 0.0) {
        return a.min(b);
    }
    let h = (k - (a - b).abs()).max(0.0) / k;
    a.min(b) - h * h * k * 0.25
}

/// Polynomial smooth maximum, `−smin(−a, −b, k)`.
#[inline]
pub fn smax(a: f64, b: f64, k: f64) -> f64 {
    -smin(-a, -b, k)
}

/// Rational soft ceiling: `h` below `knee`; above it
/// `knee + (cap − knee)·s/√(1 + s²)` with `s = (h − knee)/(cap − knee)`.
/// Slope 1 at the knee, monotone, approaches `cap` without crossing it
/// (it rounds to `cap` only for `s` beyond about 1e8).
#[inline]
pub fn soft_ceiling(h: f64, knee: f64, cap: f64) -> f64 {
    if !(h > knee) {
        return h;
    }
    let span = cap - knee;
    let s = (h - knee) / span;
    knee + span * ceiling_ratio(s)
}

/// d/dh of [`soft_ceiling`]: `(1 + s²)^(−3/2)` above the knee, 1 below.
#[inline]
pub fn soft_ceiling_d(h: f64, knee: f64, cap: f64) -> f64 {
    if !(h > knee) {
        return 1.0;
    }
    let s = (h - knee) / (cap - knee);
    let r = 1.0 / (1.0 + s * s);
    r * r.sqrt()
}

#[inline]
fn ceiling_ratio(s: f64) -> f64 {
    if s <= 1.0 {
        s / (1.0 + s * s).sqrt()
    } else {
        // Same value, without squaring a large s.
        let inv = 1.0 / s;
        1.0 / (1.0 + inv * inv).sqrt()
    }
}

/// `t^(k/8)` for an integer `k`: `t^⌊k/8⌋ · r2^b2 · r4^b1 · r8^b0` with
/// `r2 = √t, r4 = √r2, r8 = √r4` and `k mod 8 = 4b2 + 2b1 + b0`, multiplied
/// in that fixed order.
#[inline]
fn p8(t: f64, k: u32, r2: f64, r4: f64, r8: f64) -> f64 {
    let mut p = 1.0;
    for _ in 0..(k >> 3) {
        p *= t;
    }
    if k & 4 != 0 {
        p *= r2;
    }
    if k & 2 != 0 {
        p *= r4;
    }
    if k & 1 != 0 {
        p *= r8;
    }
    p
}

/// (k/8)·t^((k − 8)/8): the t-derivative of `p8(t, k)`.
#[inline]
fn d8(t: f64, k: u32, r2: f64, r4: f64, r8: f64) -> f64 {
    if k == 0 {
        return 0.0;
    }
    let c = k as f64 * 0.125;
    if k >= 8 {
        // p8(t, k)/t is p8(t, k − 8): one fewer factor of t, so no division
        // and a correct value at t = 0.
        c * p8(t, k - 8, r2, r4, r8)
    } else if t > 0.0 {
        c * p8(t, k, r2, r4, r8) / t
    } else {
        f64::INFINITY
    }
}

#[inline]
fn pow_smooth_split(e: f64) -> (u32, f64) {
    let s = 8.0 * e.max(0.0).min(POW_SMOOTH_MAX_EXP);
    let kf = s.floor();
    (kf as u32, s - kf)
}

/// A bit-stable stand-in for `t^e` on `t ≥ 0` (negative `t` reads as 0).
///
/// With `k = ⌊8e⌋` and `f = 8e − k`, the result is
/// `(1 − f)·t^(k/8) + f·t^((k+1)/8)`, each power built from repeated
/// multiplication and square roots. It is exact at multiples of 1/8,
/// continuous in `e`, and monotone in `t`.
#[inline]
pub fn pow_smooth(t: f64, e: f64) -> f64 {
    let t = t.max(0.0);
    let (k, f) = pow_smooth_split(e);
    let r2 = t.sqrt();
    let r4 = r2.sqrt();
    let r8 = r4.sqrt();
    let a = p8(t, k, r2, r4, r8);
    if f == 0.0 {
        return a;
    }
    (1.0 - f) * a + f * p8(t, k + 1, r2, r4, r8)
}

/// The exact analytic t-derivative of [`pow_smooth`]:
/// `(1 − f)·(k/8)·t^((k−8)/8) + f·((k+1)/8)·t^((k−7)/8)`. For `e ≥ 1` it
/// is finite everywhere, including at `t = 0`; below that it is infinite at
/// `t = 0` (the true slope of a root).
#[inline]
pub fn pow_smooth_d(t: f64, e: f64) -> f64 {
    let t = t.max(0.0);
    let (k, f) = pow_smooth_split(e);
    let r2 = t.sqrt();
    let r4 = r2.sqrt();
    let r8 = r4.sqrt();
    let a = d8(t, k, r2, r4, r8);
    if f == 0.0 {
        return a;
    }
    (1.0 - f) * a + f * d8(t, k + 1, r2, r4, r8)
}

/// [`pow_smooth`] and [`pow_smooth_d`] together, sharing the roots: the
/// same bits as the two calls, for about the cost of one.
#[inline]
pub fn pow_smooth_vd(t: f64, e: f64) -> (f64, f64) {
    let t = t.max(0.0);
    let (k, f) = pow_smooth_split(e);
    let r2 = t.sqrt();
    let r4 = r2.sqrt();
    let r8 = r4.sqrt();
    let (a, da) = (p8(t, k, r2, r4, r8), d8(t, k, r2, r4, r8));
    if f == 0.0 {
        return (a, da);
    }
    (
        (1.0 - f) * a + f * p8(t, k + 1, r2, r4, r8),
        (1.0 - f) * da + f * d8(t, k + 1, r2, r4, r8),
    )
}

/// Schlick bias: `t/((1/b − 2)(1 − t) + 1)` on `t ∈ [0, 1]`, `b ∈ (0, 1)`.
/// `bias(·, 1 − b)` is its exact inverse.
#[inline]
pub fn bias(t: f64, b: f64) -> f64 {
    t / ((1.0 / b - 2.0) * (1.0 - t) + 1.0)
}

/// Schlick gain: [`bias`] mirrored about `t = 0.5`, an S (or inverse S)
/// curve through (0.5, 0.5). `gain(·, 1 − g)` is its exact inverse.
#[inline]
pub fn gain(t: f64, g: f64) -> f64 {
    if t < 0.5 {
        0.5 * bias(2.0 * t, g)
    } else {
        1.0 - 0.5 * bias(2.0 - 2.0 * t, g)
    }
}

/// Coefficients of the odd degree-9 polynomial for sin(v) on [−π/2, π/2]:
/// minimax in absolute error under the constraints p(π/2) = 1 and
/// p'(π/2) = 0, so folded copies join with C1 at every crest and trough.
/// Measured maximum error 6.3e-9 (the bound promised is 2e-7).
const SIN_C1: f64 = 0.999_999_958_656_720_8;
const SIN_C3: f64 = -0.166_666_368_035_612_27;
const SIN_C5: f64 = 0.008_332_728_433_788_123;
const SIN_C7: f64 = -0.000_197_910_753_667_024_58;
const SIN_C9: f64 = 2.572_047_759_272_989_2e-6;

/// sin(2π·u) for `u` in turns.
#[inline]
pub fn psin_turns(u: f64) -> f64 {
    // Reduce to [−1/2, 1/2), then fold to [−1/4, 1/4] (sin(π − θ) = sin θ).
    let mut u = u - (u + 0.5).floor();
    if u > 0.25 {
        u = 0.5 - u;
    } else if u < -0.25 {
        u = -0.5 - u;
    }
    let v = u * TAU;
    let v2 = v * v;
    let p = v * (SIN_C1 + v2 * (SIN_C3 + v2 * (SIN_C5 + v2 * (SIN_C7 + v2 * SIN_C9))));
    p.max(-1.0).min(1.0)
}

/// Bit-stable sine: within 2e-7 of sin(x) (6.3e-9 measured) for |x| up to
/// 1e4; argument reduction loses absolute accuracy in proportion to |x|
/// beyond that.
#[inline]
pub fn psin(x: f64) -> f64 {
    psin_turns(x * INV_TAU)
}

/// Bit-stable cosine, `psin` a quarter turn on.
#[inline]
pub fn pcos(x: f64) -> f64 {
    psin_turns(x * INV_TAU + 0.25)
}

/// The diamond angle of a direction, in [0, 4): monotone in the true angle
/// (0 along +x, 1 along +z, 2 along −x, 3 along −z) with no atan2.
/// `(0, 0)` reads as 0.
#[inline]
pub fn pseudo_angle(dx: f64, dz: f64) -> f64 {
    let s = dx.abs() + dz.abs();
    if !(s > 0.0) {
        return 0.0;
    }
    let a = if dz >= 0.0 {
        if dx >= 0.0 {
            dz / s
        } else {
            1.0 - dx / s
        }
    } else if dx < 0.0 {
        2.0 - dz / s
    } else {
        3.0 + dx / s
    };
    // A direction a hair below +x can round up to 4: that is +x itself.
    if a >= 4.0 {
        0.0
    } else {
        a
    }
}

/// cos(2π·i/32) for i in 0..=8, correctly rounded.
const QUARTER_COS: [f64; 9] = [
    1.0,
    0.980_785_280_403_230_4,
    0.923_879_532_511_286_7,
    0.831_469_612_302_545_2,
    core::f64::consts::FRAC_1_SQRT_2,
    0.555_570_233_019_602_2,
    0.382_683_432_365_089_8,
    0.195_090_322_016_128_28,
    0.0,
];

/// Unit vector `i` of `n` evenly spaced directions, counter-clockwise from
/// +x toward +z: `(cos 2πi/n, sin 2πi/n)` from a pinned table, so prevailing
/// directions need no trigonometry. `n` must divide 32 (8, 16 and 32 are the
/// intended sizes); `i` wraps modulo `n`.
#[inline]
pub fn unit_dir(i: i64, n: u32) -> (f64, f64) {
    assert!(n > 0 && 32 % n == 0, "unit_dir: n must divide 32, got {n}");
    let j = (i.rem_euclid(n as i64) as u32) * (32 / n);
    let (q, r) = (j / 8, (j % 8) as usize);
    let (c, s) = (QUARTER_COS[r], QUARTER_COS[8 - r]);
    // `0.0 - v` rather than `-v`, so an axis direction never carries −0.0.
    match q {
        0 => (c, s),
        1 => (0.0 - s, c),
        2 => (0.0 - c, 0.0 - s),
        _ => (s, 0.0 - c),
    }
}

/// Ring noise: `n(c + R·(p − c)/|p − c|)`, the field sampled on a circle of
/// radius `r` about `c` in the direction of `p`. Azimuthal variation with
/// no trigonometry and no seam at any azimuth; `p == c` reads the +x point.
#[inline]
pub fn ring_noise(n: impl Fn(f64, f64) -> f64, c: (f64, f64), p: (f64, f64), r: f64) -> f64 {
    let (dx, dz) = (p.0 - c.0, p.1 - c.1);
    let len = (dx * dx + dz * dz).sqrt();
    if !(len > 0.0) {
        return n(c.0 + r, c.1);
    }
    let s = r / len;
    n(c.0 + dx * s, c.1 + dz * s)
}

/// Taylor coefficients (ln 2)^j / j! of 2^f, j = 0..=13, correctly rounded.
const EXP2_C: [f64; 14] = [
    1.0,
    core::f64::consts::LN_2,
    0.240_226_506_959_100_72,
    0.055_504_108_664_821_58,
    0.009_618_129_107_628_477,
    0.001_333_355_814_642_844_3,
    0.000_154_035_303_933_816_1,
    1.525_273_380_405_984_1e-5,
    1.321_548_679_014_431e-6,
    1.017_808_600_923_97e-7,
    7.054_911_620_801_123e-9,
    4.445_538_271_870_811_6e-10,
    2.567_843_599_348_820_6e-11,
    1.369_148_885_390_412_8e-12,
];

/// 2^n for an integer n in the normal range, from its bits.
#[inline]
fn pow2i(n: i64) -> f64 {
    debug_assert!((-1022..=1023).contains(&n));
    f64::from_bits(((n + 1023) as u64) << 52)
}

/// Bit-stable 2^x: `x = n + f` with `n = ⌊x + 1/2⌋`, a pinned degree-13
/// series for 2^f on [−1/2, 1/2) (relative error about 1e-16), scaled by
/// 2^n built from bits. For the rare true exponential.
pub fn exp2_p(x: f64) -> f64 {
    if x.is_nan() {
        return x;
    }
    if x >= 1024.0 {
        return f64::INFINITY;
    }
    if x < -1075.0 {
        return 0.0;
    }
    let n = (x + 0.5).floor();
    let f = x - n;
    let mut p = EXP2_C[13];
    for c in EXP2_C[..13].iter().rev() {
        p = p * f + c;
    }
    let n = n as i64;
    if n >= -1022 {
        if n > 1023 {
            // f < 0 here, so p < 1 and the product may still be finite.
            return p * pow2i(1023) * 2.0;
        }
        p * pow2i(n)
    } else {
        p * pow2i(-1022) * pow2i(n + 1022)
    }
}

/// Coefficients 2/(ln 2·(2j + 1)) of the atanh series for log2.
const LOG2_C: [f64; 12] = [
    2.885_390_081_777_926_8,
    0.961_796_693_925_975_6,
    0.577_078_016_355_585_3,
    0.412_198_583_111_132_4,
    0.320_598_897_975_325_2,
    0.262_308_189_252_538_8,
    0.221_953_083_213_686_67,
    0.192_359_338_785_195_12,
    0.169_728_828_339_878_04,
    0.151_862_635_883_048_77,
    0.137_399_527_703_710_8,
    0.125_451_742_685_996_82,
];

/// Bit-stable log2(x): the exponent from the bits, the mantissa reduced to
/// [√½, √2), then `log2 m = (2/ln 2)·atanh((m − 1)/(m + 1))` by a pinned
/// series (truncation below 1e-19). `log2_p(0) = −∞`; negative input is NaN.
pub fn log2_p(x: f64) -> f64 {
    if x.is_nan() || x < 0.0 {
        return f64::NAN;
    }
    if x == 0.0 {
        return f64::NEG_INFINITY;
    }
    if x.is_infinite() {
        return x;
    }
    let (mut x, mut e) = (x, 0i64);
    if x < f64::MIN_POSITIVE {
        // Subnormal: scale into the normal range first.
        x *= pow2i(54);
        e = -54;
    }
    let bits = x.to_bits();
    e += ((bits >> 52) & 0x7ff) as i64 - 1023;
    let mut m = f64::from_bits((bits & 0x000f_ffff_ffff_ffff) | (1023u64 << 52));
    if m > core::f64::consts::SQRT_2 {
        m *= 0.5;
        e += 1;
    }
    let s = (m - 1.0) / (m + 1.0);
    let s2 = s * s;
    let mut p = LOG2_C[11];
    for c in LOG2_C[..11].iter().rev() {
        p = p * s2 + c;
    }
    e as f64 + s * p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_dir_table_is_symmetric() {
        for i in 0..32 {
            let (c, s) = unit_dir(i, 32);
            let len = (c * c + s * s).sqrt();
            assert!((len - 1.0).abs() < 1e-15, "dir {i} length {len}");
        }
        let bits = |d: (f64, f64)| (d.0.to_bits(), d.1.to_bits());
        assert_eq!(bits(unit_dir(0, 8)), bits((1.0, 0.0)));
        assert_eq!(bits(unit_dir(2, 8)), bits((0.0, 1.0)));
        assert_eq!(bits(unit_dir(4, 8)), bits((-1.0, 0.0)));
        assert_eq!(bits(unit_dir(6, 8)), bits((0.0, -1.0)));
        assert_eq!(bits(unit_dir(-1, 16)), bits(unit_dir(15, 16)));
        assert_eq!(bits(unit_dir(3, 16)), bits(unit_dir(6, 32)));
    }
}
