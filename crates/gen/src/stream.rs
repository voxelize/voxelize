//! Seed streams: every random draw in the generator derives from the
//! five-component identity {world_seed, dimension, subsystem, content salt,
//! owner cell}. There is no global RNG, and no draw depends on iteration
//! order or thread scheduling.

use serde::Serialize;

#[inline]
pub fn mix64(mut x: u64) -> u64 {
    x ^= x >> 30;
    x = x.wrapping_mul(0xbf58476d1ce4e5b9);
    x ^= x >> 27;
    x = x.wrapping_mul(0x94d049bb133111eb);
    x ^= x >> 31;
    x
}

#[inline]
pub fn fnv1a_64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for &b in bytes {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub struct SaltPath(pub &'static str);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub enum Subsystem {
    Fields,
    Partition,
    Carvers,
    Hydrology,
    Structures,
    Ecology,
    Geology,
}

pub fn stream_seed(
    world_seed: u32,
    dimension: &str,
    subsystem: Subsystem,
    content: &SaltPath,
    owner_cell: u64,
) -> u64 {
    mix64(
        (world_seed as u64)
            ^ fnv1a_64(dimension.as_bytes())
            ^ ((subsystem as u64) << 56)
            ^ fnv1a_64(content.0.as_bytes())
            ^ mix64(owner_cell),
    )
}

#[inline]
pub fn cell_id(cx: i64, cz: i64) -> u64 {
    ((cx as u64) << 32) ^ (cz as u64 & 0xffff_ffff)
}

#[inline]
pub fn hash_unit(h: u64) -> f64 {
    (h >> 11) as f64 / (1u64 << 53) as f64
}

/// Deterministic parameter stream: each draw advances the state, so one
/// derived seed yields as many independent rolls as a consumer needs.
#[derive(Debug, Clone)]
pub struct HashStream(u64);

impl HashStream {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }

    pub fn unit(&mut self) -> f64 {
        self.0 = mix64(self.0.wrapping_add(0x9e3779b97f4a7c15));
        hash_unit(self.0)
    }

    pub fn range_f(&mut self, range: (f64, f64)) -> f64 {
        range.0 + self.unit() * (range.1 - range.0)
    }

    pub fn range_i(&mut self, range: (i32, i32)) -> i32 {
        let span = (range.1 - range.0).max(0) as f64 + 1.0;
        range.0 + (self.unit() * span) as i32
    }

    pub fn raw(&mut self) -> u64 {
        self.0 = mix64(self.0.wrapping_add(0x9e3779b97f4a7c15));
        self.0
    }

    /// Weighted pick over cumulative weights; total must be positive
    /// (validated at spec compile, never at draw time).
    pub fn pick_weighted(&mut self, weights: &[f64]) -> usize {
        let total: f64 = weights.iter().sum();
        let mut roll = self.unit() * total;
        for (index, w) in weights.iter().enumerate() {
            roll -= w;
            if roll < 0.0 {
                return index;
            }
        }
        weights.len() - 1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stream_components_are_all_load_bearing() {
        let base = stream_seed(7, "overworld", Subsystem::Fields, &SaltPath("a.b"), 0);
        assert_ne!(
            base,
            stream_seed(8, "overworld", Subsystem::Fields, &SaltPath("a.b"), 0)
        );
        assert_ne!(
            base,
            stream_seed(7, "underrealm", Subsystem::Fields, &SaltPath("a.b"), 0)
        );
        assert_ne!(
            base,
            stream_seed(7, "overworld", Subsystem::Carvers, &SaltPath("a.b"), 0)
        );
        assert_ne!(
            base,
            stream_seed(7, "overworld", Subsystem::Fields, &SaltPath("a.c"), 0)
        );
        assert_ne!(
            base,
            stream_seed(7, "overworld", Subsystem::Fields, &SaltPath("a.b"), 1)
        );
    }

    #[test]
    fn stream_draws_are_stable() {
        // Golden values: any change here is a world-breaking change by
        // definition and must be a deliberate format-version decision.
        let mut s = HashStream::new(stream_seed(
            123123123,
            "surface",
            Subsystem::Structures,
            &SaltPath("structure.test"),
            cell_id(4, -9),
        ));
        let draws: Vec<f64> = (0..4).map(|_| s.unit()).collect();
        let expect = [
            0.43212816592924097,
            0.09027864857538259,
            0.27645644677446879,
            0.88804177025284947,
        ];
        for (draw, expected) in draws.iter().zip(expect.iter()) {
            assert!(
                (draw - expected).abs() < 1e-15,
                "stream drifted: {draw} vs {expected}"
            );
        }
    }

    #[test]
    fn unit_is_always_in_range() {
        let mut s = HashStream::new(1);
        for _ in 0..10_000 {
            let u = s.unit();
            assert!((0.0..1.0).contains(&u));
        }
    }

    #[test]
    fn pick_weighted_respects_shares() {
        let mut s = HashStream::new(42);
        let weights = [0.62, 0.28, 0.10];
        let mut counts = [0usize; 3];
        for _ in 0..20_000 {
            counts[s.pick_weighted(&weights)] += 1;
        }
        let share = |i: usize| counts[i] as f64 / 20_000.0;
        assert!((share(0) - 0.62).abs() < 0.02);
        assert!((share(1) - 0.28).abs() < 0.02);
        assert!((share(2) - 0.10).abs() < 0.02);
    }
}
