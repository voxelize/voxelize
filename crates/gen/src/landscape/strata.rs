//! Strata: wandering, absolute-height bands that fold a wall into benches.
//!
//! A band table cuts lifted height into bands. Band `k` starts at
//! `(k + j_k)·B + A·(α_k·n1 + (1 − α_k)·n2)`: a per-band jitter `j_k`, plus a
//! wander along the wall that mixes the column's two slow fields `n1`, `n2`
//! (supplied by the caller, in [−1, 1]) in the band's own proportion `α_k`,
//! so neighbouring boundaries wander on their own. Every per-band roll comes
//! from its own hash input (the roll's lane and the band index never share
//! bits), so no two rolls of a table are tied together. Lifting the height
//! by a tilt along a dip direction makes the bands dip across the country.
//!
//! Within a band, from the bottom: a talus slope, a cliff, then a level
//! tread, each varying per band and along the wall. The fold maps a raw
//! height to the benched one through monotone Hermite pieces that are level
//! at every band boundary, so within a column it is C1, it never inverts a
//! slope (its gain is never negative), and it reports that gain so slope
//! rules stay honest.
//!
//! Along the ground the fold is continuous too: every share, boundary and
//! rise is a continuous function of the slow fields and the column's lift,
//! and a talus thins away instead of vanishing (its rise fades in over the
//! first [`TALUS_FADE_SHARE`] of its share), so neighbouring columns never
//! step apart.

use crate::stream::{hash_unit, mix64};

use super::math::{smoothstep, MinMax};
use super::profile::Hermite;

/// The smallest cliff share a band keeps, so every band has a riser.
pub const MIN_CLIFF_SHARE: f64 = 0.05;
/// The largest tread share a band takes.
pub const MAX_TREAD_SHARE: f64 = 0.9;
/// A talus carries its full rise only once it is at least this share of a
/// band; a thinner talus carries `talus_rise·smoothstep(0, this, share)`, so
/// as it thins its rise fades to nothing with it (instead of standing as a
/// near-vertical step) and the fold stays continuous from column to column.
pub const TALUS_FADE_SHARE: f64 = 0.1;
/// Largest lifted height, in bands, a table folds: far beyond any world,
/// and small enough that band indices stay exact.
pub const MAX_BANDS: f64 = (1u64 << 40) as f64;

/// Salt of a table's roll key.
const SALT_STRATA: u64 = 0x5714_7a00_0000_0000;
/// Roll lanes. A roll hashes `key ^ (lane << 56) ^ (k & K_MASK)`: lane and
/// band index never share a bit, so two rolls of a table hash the same
/// input only if they are the same roll (for |k| < 2^55).
const LANE_JITTER: u64 = 1;
const LANE_WANDER: u64 = 2;
const LANE_TREAD: u64 = 3;
const LANE_CLIFF: u64 = 4;
const LANE_ROLL_TREAD: u64 = 5;
const LANE_ROLL_CLIFF: u64 = 6;
const K_MASK: u64 = (1 << 56) - 1;

/// Why a band table's spec was refused.
#[derive(Debug, Clone, PartialEq)]
pub struct BandError {
    /// Why, in words.
    pub reason: &'static str,
}

impl std::fmt::Display for BandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "BandTable: {}", self.reason)
    }
}

impl std::error::Error for BandError {}

/// A band table's recipe. Thicknesses are in blocks and never scale with a
/// world's horizontal size.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BandSpec {
    /// Mean band thickness `B`.
    pub band: f64,
    /// Per-band thickness jitter, a share of `B` in [0, 0.5).
    pub jitter: f64,
    /// How far a boundary wanders up and down along the wall, `A`.
    pub wander: f64,
    /// Dip of the bands in blocks per block along `dir`.
    pub tilt: f64,
    /// Dip direction (normalised by the table).
    pub dir: (f64, f64),
    /// Mean share of a band that is level tread.
    pub tread: f64,
    /// Mean share of a band that is cliff.
    pub cliff: f64,
    /// Share of a band's rise carried by its talus slope.
    pub talus_rise: f64,
    /// How much treads and cliffs widen and thin along the wall, following
    /// the slow fields (×(1 ± vary)).
    pub vary: f64,
    /// How much treads and cliffs differ from band to band (×(1 ± roll)).
    pub roll: f64,
}

/// Which part of a band a height falls in.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum BandPart {
    /// The slope at the foot of a band's cliff.
    Talus,
    /// The riser.
    Cliff,
    /// The level bench on top.
    Tread,
}

/// A validated band table with its seed.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BandTable {
    spec: BandSpec,
    seed: u64,
    key: u64,
}

impl BandTable {
    /// Refuses a table whose boundaries could cross (`2A ≥ B(1 − 2J)`) or
    /// whose shares are out of range.
    pub fn new(spec: BandSpec, seed: u64) -> Result<Self, BandError> {
        let refuse = |reason: &'static str| Err(BandError { reason });
        if !(spec.band > 0.0 && spec.band.is_finite()) {
            return refuse("band must be positive");
        }
        if !(spec.jitter >= 0.0 && spec.jitter < 0.5) {
            return refuse("jitter must be in [0, 0.5)");
        }
        if !(spec.wander >= 0.0 && 2.0 * spec.wander < spec.band * (1.0 - 2.0 * spec.jitter)) {
            return refuse("wander must stay under half the thinnest band, or boundaries cross");
        }
        if !(spec.tread >= 0.0 && spec.tread <= MAX_TREAD_SHARE) {
            return refuse("tread must be in [0, 0.9]");
        }
        if !(spec.cliff > 0.0 && spec.cliff <= 1.0) {
            return refuse("cliff must be in (0, 1]");
        }
        if !(spec.talus_rise >= 0.0 && spec.talus_rise < 1.0) {
            return refuse("talus_rise must be in [0, 1)");
        }
        if !(spec.vary >= 0.0 && spec.vary.is_finite() && spec.roll >= 0.0 && spec.roll < 1.0) {
            return refuse("vary must be non-negative and roll in [0, 1)");
        }
        if !spec.tilt.is_finite() {
            return refuse("tilt must be finite");
        }
        let len = (spec.dir.0 * spec.dir.0 + spec.dir.1 * spec.dir.1).sqrt();
        let dir = if len > 0.0 && len.is_finite() {
            (spec.dir.0 / len, spec.dir.1 / len)
        } else if spec.tilt == 0.0 {
            (1.0, 0.0)
        } else {
            return refuse("a tilted table needs a dip direction");
        };
        Ok(Self {
            spec: BandSpec { dir, ..spec },
            seed,
            key: mix64(seed ^ SALT_STRATA),
        })
    }

    /// The validated spec (its dip direction normalised).
    pub fn spec(&self) -> &BandSpec {
        &self.spec
    }

    /// The seed the table's rolls come from.
    pub fn seed(&self) -> u64 {
        self.seed
    }

    /// Band `k`'s roll on `lane`, in [0, 1).
    fn roll(&self, k: i64, lane: u64) -> f64 {
        hash_unit(mix64(self.key ^ (lane << 56) ^ (k as u64 & K_MASK)))
    }

    /// Band `k`'s own mix of the column's two slow fields, in [−1, 1].
    fn mix(&self, k: i64, lane: u64, slow: [f64; 2]) -> f64 {
        let alpha = self.roll(k, lane);
        let n1 = slow[0].fclamp(-1.0, 1.0);
        let n2 = slow[1].fclamp(-1.0, 1.0);
        alpha * n1 + (1.0 - alpha) * n2
    }

    /// Lifted height where band `k` begins, at a column whose slow fields
    /// read `slow`.
    pub fn boundary(&self, k: i64, slow: [f64; 2]) -> f64 {
        let s = &self.spec;
        let jitter = s.jitter * (2.0 * self.roll(k, LANE_JITTER) - 1.0);
        (k as f64 + jitter) * s.band + s.wander * self.mix(k, LANE_WANDER, slow)
    }

    /// The table as seen from one column: its lift along the dip and its
    /// slow-field readings `slow` (each in [−1, 1]; values beyond are
    /// clamped).
    pub fn column(&self, x: f64, z: f64, slow: [f64; 2]) -> BandColumn<'_> {
        let s = &self.spec;
        BandColumn {
            table: self,
            shift: s.tilt * (x * s.dir.0 + z * s.dir.1),
            slow,
        }
    }

    fn band(&self, k: i64, slow: [f64; 2]) -> Band {
        let s = &self.spec;
        let lo = self.boundary(k, slow);
        let hi = self.boundary(k + 1, slow);
        let jiggle = |lane: u64| 1.0 + s.roll * (2.0 * self.roll(k, lane) - 1.0);
        let tread =
            (s.tread * jiggle(LANE_ROLL_TREAD) * (1.0 + s.vary * self.mix(k, LANE_TREAD, slow)))
                .fclamp(0.0, MAX_TREAD_SHARE);
        let cliff = (s.cliff
            * jiggle(LANE_ROLL_CLIFF)
            * (1.0 + 0.5 * s.vary * self.mix(k, LANE_CLIFF, slow)))
        .fclamp(MIN_CLIFF_SHARE, 1.0 - tread);
        let cliff_end = 1.0 - tread;
        let talus_end = (cliff_end - cliff).fmax(0.0);
        // The rise fades in with the talus's share, so a thinning talus
        // slopes away to nothing rather than standing as a step.
        let rise = s.talus_rise * smoothstep(0.0, TALUS_FADE_SHARE, talus_end);
        let (talus, cliff_piece) = if talus_end > 0.0 {
            let d1 = rise / talus_end;
            let d2 = (1.0 - rise) / (cliff_end - talus_end);
            // Harmonic mean of the two secants: at most twice the smaller,
            // so both Hermite pieces stay monotone (Fritsch–Butland).
            let m1 = if d1 > 0.0 && d2 > 0.0 {
                2.0 * d1 * d2 / (d1 + d2)
            } else {
                0.0
            };
            (
                Some(Hermite::new(0.0, talus_end, 0.0, rise, 0.0, m1)),
                Hermite::new(talus_end, cliff_end, rise, 1.0, m1, 0.0),
            )
        } else {
            (None, Hermite::new(0.0, cliff_end, 0.0, 1.0, 0.0, 0.0))
        };
        Band {
            index: k,
            lo,
            hi,
            talus_end,
            cliff_end,
            talus,
            cliff: cliff_piece,
        }
    }
}

/// One band at one column.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Band {
    /// The band's index `k`.
    pub index: i64,
    /// Lifted height where the band begins.
    pub lo: f64,
    /// Lifted height where the band ends (the next band's `lo`).
    pub hi: f64,
    /// Share of the band where the talus ends (0: no talus).
    pub talus_end: f64,
    /// Share of the band where the cliff ends and the tread begins.
    pub cliff_end: f64,
    talus: Option<Hermite>,
    cliff: Hermite,
}

impl Band {
    /// Whether lifted height `yt` lies in this band.
    pub fn contains(&self, yt: f64) -> bool {
        yt >= self.lo && yt < self.hi
    }

    /// The folded share of the band's rise at share `f`, its slope, and the
    /// part.
    fn fold_share(&self, f: f64) -> (f64, f64, BandPart) {
        let f = f.fclamp(0.0, 1.0);
        if f < self.talus_end {
            if let Some(talus) = self.talus {
                let (v, d) = talus.at(f);
                return (v, d, BandPart::Talus);
            }
        }
        if f < self.cliff_end {
            let (v, d) = self.cliff.at(f);
            return (v, d, BandPart::Cliff);
        }
        (1.0, 0.0, BandPart::Tread)
    }

    /// Folded lifted height and gain (folded rise per raw rise) at lifted
    /// height `yt`.
    pub fn fold(&self, yt: f64) -> (f64, f64, BandPart) {
        let span = self.hi - self.lo;
        let (v, d, part) = self.fold_share((yt - self.lo) / span);
        (self.lo + v * span, d, part)
    }

    /// The part at lifted height `yt`.
    pub fn part(&self, yt: f64) -> BandPart {
        let f = (yt - self.lo) / (self.hi - self.lo);
        if f < self.talus_end && self.talus.is_some() {
            BandPart::Talus
        } else if f < self.cliff_end {
            BandPart::Cliff
        } else {
            BandPart::Tread
        }
    }
}

/// The result of folding one height.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Fold {
    /// The folded height.
    pub height: f64,
    /// d(height)/d(raw), never negative.
    pub gain: f64,
    /// The part the raw height falls in.
    pub part: BandPart,
    /// The band's index.
    pub band: i64,
}

/// A band table seen from one column.
#[derive(Clone, Copy, Debug)]
pub struct BandColumn<'a> {
    table: &'a BandTable,
    shift: f64,
    slow: [f64; 2],
}

impl<'a> BandColumn<'a> {
    /// The column's lift: add it to a height to get the table's lifted
    /// height.
    pub fn shift(&self) -> f64 {
        self.shift
    }

    /// The band holding lifted height `yt`.
    ///
    /// Panics if `yt` is not finite or lies beyond [`MAX_BANDS`] bands from
    /// 0: no world reaches that far, and past it band indices stop being
    /// exact.
    pub fn band_at(&self, yt: f64) -> Band {
        let t = self.table;
        let q = yt / t.spec.band;
        assert!(
            q.abs() <= MAX_BANDS,
            "strata: lifted height {yt} is not finite or beyond the table's reach"
        );
        // Boundary k lies within half a band of k·B (|jitter| and |wander|
        // together stay under B/2), so this starts at most one band away
        // and each loop runs at most once.
        let mut k = q.floor() as i64;
        while yt < t.boundary(k, self.slow) {
            k -= 1;
        }
        while yt >= t.boundary(k + 1, self.slow) {
            k += 1;
        }
        t.band(k, self.slow)
    }

    /// Fold raw height `raw` into the benches.
    pub fn fold(&self, raw: f64) -> Fold {
        let yt = raw + self.shift;
        let band = self.band_at(yt);
        let (folded, gain, part) = band.fold(yt);
        Fold {
            height: folded - self.shift,
            gain,
            part,
            band: band.index,
        }
    }

    /// Blend the fold in by `mix` ∈ [0, 1]: `raw + (fold − raw)·mix`, and its
    /// gain `(1 − mix) + mix·gain`. Both terms are non-decreasing in `raw`,
    /// so any mix keeps the slope's sign.
    pub fn apply(&self, raw: f64, mix: f64) -> (f64, f64) {
        let fold = self.fold(raw);
        (
            raw + (fold.height - raw) * mix,
            (1.0 - mix) + mix * fold.gain,
        )
    }

    /// A cursor that walks this column's voxels, re-deriving the band only
    /// when a voxel leaves the current one.
    pub fn cursor(&self) -> BandCursor<'a> {
        BandCursor {
            column: *self,
            band: None,
        }
    }
}

/// Walks a column through the band table without re-deriving the band for
/// every voxel.
#[derive(Clone, Debug)]
pub struct BandCursor<'a> {
    column: BandColumn<'a>,
    band: Option<Band>,
}

impl BandCursor<'_> {
    /// The band holding lifted height `yt`.
    pub fn band(&mut self, yt: f64) -> Band {
        match self.band {
            Some(band) if band.contains(yt) => band,
            _ => {
                let band = self.column.band_at(yt);
                self.band = Some(band);
                band
            }
        }
    }

    /// The part at voxel `y` (sampled at its centre, `y + 0.5`).
    pub fn part(&mut self, y: i32) -> BandPart {
        let yt = y as f64 + 0.5 + self.column.shift;
        self.band(yt).part(yt)
    }

    /// Fold raw height `raw`, reusing the current band when it holds it.
    pub fn fold(&mut self, raw: f64) -> Fold {
        let yt = raw + self.column.shift;
        let band = self.band(yt);
        let (folded, gain, part) = band.fold(yt);
        Fold {
            height: folded - self.column.shift,
            gain,
            part,
            band: band.index,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> BandSpec {
        BandSpec {
            band: 27.0,
            jitter: 0.22,
            wander: 5.0,
            tilt: 0.0,
            dir: (1.0, 0.0),
            tread: 0.3,
            cliff: 0.135,
            talus_rise: 0.4,
            vary: 2.0,
            roll: 0.3,
        }
    }

    #[test]
    fn rolls_never_share_a_hash_input() {
        // Distinct (lane, k) pairs give distinct inputs to a bijection, so
        // no two rolls of a table can be tied together. Check the hashes
        // themselves over a wide band range for several seeds.
        let lanes = [
            LANE_JITTER,
            LANE_WANDER,
            LANE_TREAD,
            LANE_CLIFF,
            LANE_ROLL_TREAD,
            LANE_ROLL_CLIFF,
        ];
        for seed in [0u64, 1, 7, 0xdead_beef, u64::MAX] {
            let table = BandTable::new(spec(), seed).unwrap();
            let mut seen = std::collections::BTreeSet::new();
            for k in -3000i64..3000 {
                for &lane in &lanes {
                    let bits = table.roll(k, lane).to_bits();
                    assert!(
                        seen.insert(bits),
                        "seed {seed}: roll (k {k}, lane {lane}) repeats another roll"
                    );
                }
            }
            // The pattern the shared-salt scheme produced: band k's jitter
            // equal to band (k ^ 3)'s wander mix.
            for k in -64i64..64 {
                assert_ne!(table.roll(k, LANE_JITTER), table.roll(k ^ 3, LANE_WANDER));
            }
        }
    }

    #[test]
    fn band_at_refuses_heights_it_cannot_index() {
        let table = BandTable::new(spec(), 1).unwrap();
        let column = table.column(0.0, 0.0, [0.2, -0.4]);
        for yt in [f64::NAN, f64::INFINITY, -f64::INFINITY, 1e300] {
            assert!(
                std::panic::catch_unwind(|| column.band_at(yt)).is_err(),
                "band_at({yt}) should refuse"
            );
        }
        let far = 27.0 * MAX_BANDS * 0.5;
        assert!(column.band_at(far).contains(far));
    }
}
