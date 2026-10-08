//! Strata: wandering, absolute-height bands that fold a wall into benches.
//!
//! A band table cuts lifted height into bands. Band `k` starts at
//! `(k + j_k)·B + A·(α_k·n1 + (1 − α_k)·n2)`: a per-band jitter `j_k`, plus a
//! wander along the wall that mixes the column's two slow fields `n1`, `n2`
//! (supplied by the caller, in [−1, 1]) in the band's own proportion `α_k`,
//! so neighbouring boundaries wander independently. Lifting the height by a
//! tilt along a dip direction makes the bands dip across the country.
//!
//! Within a band, from the bottom: a talus slope, a cliff, then a level
//! tread, each varying per band and along the wall. The fold maps a raw
//! height to the benched one through monotone Hermite pieces that are level
//! at every band boundary, so it is C1, it never inverts a slope (its gain
//! is never negative), and it reports that gain so slope rules stay honest.

use crate::stream::{hash_unit, mix64};

use super::profile::{Hermite, ProfileError};

/// The smallest cliff share a band keeps, so every band has a riser.
pub const MIN_CLIFF_SHARE: f64 = 0.05;
/// The largest tread share a band takes.
pub const MAX_TREAD_SHARE: f64 = 0.9;
/// A talus thinner than this share of a band is left out: the cliff then
/// rises straight off the tread below, instead of off a sliver of talus
/// steep enough to read as a step.
pub const MIN_TALUS_SHARE: f64 = 0.02;

const SALT_JITTER: u64 = 0x5714_7a00_0000_0001;
const SALT_WANDER: u64 = 0x5714_7a00_0000_0002;
const SALT_TREAD: u64 = 0x5714_7a00_0000_0003;
const SALT_CLIFF: u64 = 0x5714_7a00_0000_0004;
const SALT_ROLL_TREAD: u64 = 0x5714_7a00_0000_0005;
const SALT_ROLL_CLIFF: u64 = 0x5714_7a00_0000_0006;

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
    /// How much treads and cliffs widen and thin along the wall (×(1 ± vary)).
    pub vary: f64,
    /// How much treads and cliffs differ from band to band (×(1 ± roll)).
    pub roll: f64,
}

/// Which part of a band a height falls in.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum BandPart {
    Talus,
    Cliff,
    Tread,
}

/// A validated band table with its seed.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BandTable {
    spec: BandSpec,
    seed: u64,
}

impl BandTable {
    /// Refuses a table whose boundaries could cross (`2A ≥ B(1 − 2J)`) or
    /// whose shares are out of range.
    pub fn new(spec: BandSpec, seed: u64) -> Result<Self, ProfileError> {
        let refuse = |reason: &str| {
            Err(ProfileError {
                profile: "BandTable",
                reason: reason.to_string(),
            })
        };
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
        if !(spec.vary >= 0.0 && spec.roll >= 0.0 && spec.roll < 1.0) {
            return refuse("vary must be non-negative and roll in [0, 1)");
        }
        if !spec.tilt.is_finite() {
            return refuse("tilt must be finite");
        }
        let len = (spec.dir.0 * spec.dir.0 + spec.dir.1 * spec.dir.1).sqrt();
        let dir = if len > 0.0 {
            (spec.dir.0 / len, spec.dir.1 / len)
        } else if spec.tilt == 0.0 {
            (1.0, 0.0)
        } else {
            return refuse("a tilted table needs a dip direction");
        };
        Ok(Self {
            spec: BandSpec { dir, ..spec },
            seed,
        })
    }

    pub fn spec(&self) -> &BandSpec {
        &self.spec
    }

    fn roll(&self, k: i64, salt: u64) -> f64 {
        hash_unit(mix64(self.seed ^ mix64((k as u64) ^ salt)))
    }

    /// Band `k`'s own mix of the column's two slow fields, in [−1, 1].
    fn mix(&self, k: i64, salt: u64, vary: [f64; 2]) -> f64 {
        let alpha = self.roll(k, salt);
        let n1 = vary[0].max(-1.0).min(1.0);
        let n2 = vary[1].max(-1.0).min(1.0);
        alpha * n1 + (1.0 - alpha) * n2
    }

    /// Lifted height where band `k` begins, at a column whose slow fields
    /// read `vary`.
    pub fn boundary(&self, k: i64, vary: [f64; 2]) -> f64 {
        let s = &self.spec;
        let jitter = s.jitter * (2.0 * self.roll(k, SALT_JITTER) - 1.0);
        (k as f64 + jitter) * s.band + s.wander * self.mix(k, SALT_WANDER, vary)
    }

    /// The table as seen from one column: its lift along the dip and its
    /// slow-field readings.
    pub fn column(&self, x: f64, z: f64, vary: [f64; 2]) -> BandColumn<'_> {
        let s = &self.spec;
        BandColumn {
            table: self,
            shift: s.tilt * (x * s.dir.0 + z * s.dir.1),
            vary,
        }
    }

    fn band(&self, k: i64, vary: [f64; 2]) -> Band {
        let s = &self.spec;
        let lo = self.boundary(k, vary);
        let hi = self.boundary(k + 1, vary);
        let jiggle = |salt: u64| 1.0 + s.roll * (2.0 * self.roll(k, salt) - 1.0);
        let tread =
            (s.tread * jiggle(SALT_ROLL_TREAD) * (1.0 + s.vary * self.mix(k, SALT_TREAD, vary)))
                .max(0.0)
                .min(MAX_TREAD_SHARE);
        let cliff = (s.cliff
            * jiggle(SALT_ROLL_CLIFF)
            * (1.0 + 0.5 * s.vary * self.mix(k, SALT_CLIFF, vary)))
        .max(MIN_CLIFF_SHARE)
        .min(1.0 - tread);
        let cliff_end = 1.0 - tread;
        let talus_end = (cliff_end - cliff).max(0.0);
        let (talus, cliff_piece) = if talus_end >= MIN_TALUS_SHARE {
            let rise = s.talus_rise;
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
            talus_end: if talus.is_some() { talus_end } else { 0.0 },
            cliff_end,
            talus,
            cliff: cliff_piece,
        }
    }
}

/// One band at one column.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Band {
    pub index: i64,
    /// Lifted heights where the band begins and ends.
    pub lo: f64,
    pub hi: f64,
    /// Shares of the band where the talus ends and where the cliff ends.
    pub talus_end: f64,
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
        let f = f.max(0.0).min(1.0);
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
    pub height: f64,
    /// d(height)/d(raw), never negative.
    pub gain: f64,
    pub part: BandPart,
    pub band: i64,
}

/// A band table seen from one column.
#[derive(Clone, Copy, Debug)]
pub struct BandColumn<'a> {
    table: &'a BandTable,
    shift: f64,
    vary: [f64; 2],
}

impl<'a> BandColumn<'a> {
    /// The column's lift: add it to a height to get the table's lifted
    /// height.
    pub fn shift(&self) -> f64 {
        self.shift
    }

    /// The band holding lifted height `yt`.
    pub fn band_at(&self, yt: f64) -> Band {
        let t = self.table;
        let mut k = (yt / t.spec.band).floor() as i64;
        while yt < t.boundary(k, self.vary) {
            k -= 1;
        }
        while yt >= t.boundary(k + 1, self.vary) {
            k += 1;
        }
        t.band(k, self.vary)
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
