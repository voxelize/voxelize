//! `ClockCache`: a bounded, thread-safe cache with CLOCK eviction.
//!
//! Every landscape cache is cost-only: its values are pure functions of
//! their keys, so a hit, a miss, an eviction or a race between two threads
//! computing the same entry changes how long a query takes, never what it
//! returns. The kernel suite checks it for this cache (capacity 1 against a
//! large one, and under contention); the kit's determinism suite runs whole
//! worlds with every cache at capacity 1.
//!
//! CLOCK evicts one entry at a time: a hand sweeps the slots, clearing
//! reference bits until it finds an entry not used since its last pass. No
//! cache ever clears all of its entries on overflow, so a full cache
//! degrades gracefully instead of falling off a cliff.
//!
//! The first value stored for a key stays until it is evicted: a later
//! insert of the same key returns the resident value instead of replacing
//! it. Values are cloned out, so large values belong behind an `Arc`. A
//! value that is costly to compute and must be computed once (a plan solve)
//! goes through [`ClockCache::get_or_solve`]: the cache holds an
//! `Arc<OnceLock<T>>` cell per key, threads that race on a cold key all end
//! up with the first cell inserted, and the solve runs inside that cell,
//! outside the cache's lock, once.
//!
//! The cache is striped: keys are spread over up to [`MAX_STRIPES`]
//! independently locked CLOCK rings by a fixed hash of the key, so threads
//! hitting different keys rarely wait on one another (one mutex over the
//! whole cache made the total hit rate fall as threads were added; the
//! landscape kernel bench's `cache` group measures it). Which stripe holds
//! a key changes cost only. Small caches keep a single stripe, so a cache
//! of capacity 1 holds exactly one entry, as the determinism suite needs.
//!
//! A cache may also be capped by weight instead of by count
//! ([`ClockCache::weighed`]): every value is weighed when stored, and each
//! stripe evicts until its share of the budget holds (the facts LRU is
//! capped in bytes this way). A stripe always keeps the entry it just
//! stored, even one heavier than its whole share.

use std::hash::{BuildHasher, Hash, Hasher};
use std::sync::{Arc, Mutex, OnceLock};

use hashbrown::HashMap;

/// The most stripes a cache splits into.
pub const MAX_STRIPES: usize = 16;

/// Fewest entries (or weight units, for a weighed cache) per stripe: a
/// cache smaller than this per stripe uses fewer stripes, down to one.
const MIN_PER_STRIPE: usize = 64;

struct Slot<K, V> {
    key: K,
    value: V,
    weight: usize,
    referenced: bool,
}

struct Clock<K, V> {
    slots: Vec<Slot<K, V>>,
    index: HashMap<K, usize>,
    hand: usize,
    /// Most entries this stripe holds (count-capped), or `usize::MAX`.
    capacity: usize,
    /// Most total weight this stripe holds (weighed), or `usize::MAX`.
    budget: usize,
    used: usize,
    weigh: Option<fn(&V) -> usize>,
    hits: u64,
    misses: u64,
    evictions: u64,
}

impl<K: Eq + Hash + Clone, V: Clone> Clock<K, V> {
    fn new(capacity: usize, budget: usize, weigh: Option<fn(&V) -> usize>) -> Self {
        let reserve = Ord::min(capacity, 1 << 12);
        Self {
            slots: Vec::with_capacity(reserve),
            index: HashMap::with_capacity(reserve),
            hand: 0,
            capacity,
            budget,
            used: 0,
            weigh,
            hits: 0,
            misses: 0,
            evictions: 0,
        }
    }

    fn get(&mut self, key: &K) -> Option<V> {
        match self.index.get(key) {
            Some(&i) => {
                self.hits += 1;
                let slot = &mut self.slots[i];
                slot.referenced = true;
                Some(slot.value.clone())
            }
            None => {
                self.misses += 1;
                None
            }
        }
    }

    /// Store `value` unless `key` is resident; returns the resident value.
    fn insert(&mut self, key: K, value: V) -> V {
        if let Some(&i) = self.index.get(&key) {
            let slot = &mut self.slots[i];
            slot.referenced = true;
            return slot.value.clone();
        }
        let weight = self.weigh.map_or(1, |w| w(&value));
        // Evict one entry at a time until the new one fits, never the new
        // one itself.
        while !self.slots.is_empty()
            && (self.slots.len() >= self.capacity || self.used + weight > self.budget)
        {
            self.evict_one();
        }
        self.index.insert(key.clone(), self.slots.len());
        self.slots.push(Slot {
            key,
            value: value.clone(),
            weight,
            referenced: false,
        });
        self.used += weight;
        value
    }

    /// Evict the entry under the hand after giving every referenced entry
    /// a second chance, keeping the slots dense.
    fn evict_one(&mut self) {
        let n = self.slots.len();
        if self.hand >= n {
            self.hand = 0;
        }
        while self.slots[self.hand].referenced {
            self.slots[self.hand].referenced = false;
            self.hand = (self.hand + 1) % n;
        }
        let victim = self.slots.swap_remove(self.hand);
        self.index.remove(&victim.key);
        self.used -= victim.weight;
        if self.hand < self.slots.len() {
            // The last slot moved into the victim's place.
            let moved = self.slots[self.hand].key.clone();
            self.index.insert(moved, self.hand);
        }
        self.evictions += 1;
    }
}

/// Hit, miss and eviction counts: cost only, never output.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CacheStats {
    /// Lookups that found their key.
    pub hits: u64,
    /// Lookups that did not.
    pub misses: u64,
    /// Entries evicted to make room.
    pub evictions: u64,
    /// Entries held now.
    pub len: usize,
    /// Most entries the cache holds (`usize::MAX` for a weighed cache).
    pub capacity: usize,
    /// Total weight held now (the entry count for a count-capped cache).
    pub weight: usize,
    /// Number of independently locked stripes.
    pub stripes: usize,
}

/// A fixed, process-independent hasher for choosing a key's stripe. Which
/// stripe holds a key is cost only, but a fixed choice keeps cache costs
/// reproducible from run to run.
#[derive(Clone, Copy, Default)]
struct StripeHasher;

impl BuildHasher for StripeHasher {
    type Hasher = std::collections::hash_map::DefaultHasher;
    fn build_hasher(&self) -> Self::Hasher {
        // `DefaultHasher::new` is SipHash with fixed zero keys.
        std::collections::hash_map::DefaultHasher::new()
    }
}

/// A bounded cache with CLOCK eviction, safe to share between threads.
pub struct ClockCache<K, V> {
    stripes: Box<[Mutex<Clock<K, V>>]>,
    capacity: usize,
}

/// Stripes for a cache of `size` entries or weight units: the most powers
/// of two up to [`MAX_STRIPES`] that leave each stripe [`MIN_PER_STRIPE`].
fn stripe_count(size: usize) -> usize {
    let mut n = 1;
    while n < MAX_STRIPES && size / (n * 2) >= MIN_PER_STRIPE {
        n *= 2;
    }
    n
}

/// Split `total` over `n` stripes exactly: the first `total % n` get one
/// more, so the shares sum to `total`.
fn share(total: usize, n: usize, i: usize) -> usize {
    total / n + usize::from(i < total % n)
}

impl<K: Eq + Hash + Clone, V: Clone> ClockCache<K, V> {
    /// A cache holding at most `capacity` entries (at least 1).
    pub fn new(capacity: usize) -> Self {
        let capacity = Ord::max(capacity, 1);
        let n = stripe_count(capacity);
        let stripes = (0..n)
            .map(|i| Mutex::new(Clock::new(share(capacity, n, i), usize::MAX, None)))
            .collect();
        Self { stripes, capacity }
    }

    /// A cache capped by total weight: `weigh` gives each value's weight
    /// (bytes, typically) when it is stored, and each stripe evicts until
    /// its share of `budget` holds. An entry heavier than a whole share is
    /// still stored, alone in its stripe.
    pub fn weighed(budget: usize, weigh: fn(&V) -> usize) -> Self {
        let budget = Ord::max(budget, 1);
        let n = stripe_count(budget);
        let stripes = (0..n)
            .map(|i| Mutex::new(Clock::new(usize::MAX, share(budget, n, i), Some(weigh))))
            .collect();
        Self {
            stripes,
            capacity: usize::MAX,
        }
    }

    fn stripe(&self, key: &K) -> std::sync::MutexGuard<'_, Clock<K, V>> {
        let i = if self.stripes.len() == 1 {
            0
        } else {
            let mut h = StripeHasher.build_hasher();
            key.hash(&mut h);
            // High bits: SipHash mixes them as well as the low ones, and a
            // shift keeps the choice independent of the stripe count's
            // relation to any key pattern.
            (h.finish() >> 32) as usize & (self.stripes.len() - 1)
        };
        // A panic while holding the lock cannot leave a half-written entry
        // that matters: entries are cost-only, so recover the guard.
        self.stripes[i]
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// The value cached for `key`, if resident.
    pub fn get(&self, key: &K) -> Option<V> {
        self.stripe(key).get(key)
    }

    /// Cache `value` for `key` unless a value is already resident, and
    /// return the resident one: the first writer wins, so threads racing to
    /// fill one key all leave with the same value.
    pub fn insert(&self, key: K, value: V) -> V {
        let mut stripe = self.stripe(&key);
        stripe.insert(key, value)
    }

    /// The cached value, or `compute()` cached and returned. `compute` runs
    /// outside the lock, so two threads may both compute a missing entry;
    /// both return the value inserted first. That is harmless because entries
    /// are pure functions of their keys; for a costly value use
    /// [`ClockCache::get_or_solve`].
    pub fn get_or_insert_with(&self, key: K, compute: impl FnOnce() -> V) -> V {
        if let Some(v) = self.get(&key) {
            return v;
        }
        let value = compute();
        self.insert(key, value)
    }

    /// Hit, miss and eviction counts so far, with the current size, summed
    /// over every stripe.
    pub fn stats(&self) -> CacheStats {
        let mut out = CacheStats {
            capacity: self.capacity,
            stripes: self.stripes.len(),
            ..CacheStats::default()
        };
        for stripe in self.stripes.iter() {
            let c = stripe.lock().unwrap_or_else(|p| p.into_inner());
            out.hits += c.hits;
            out.misses += c.misses;
            out.evictions += c.evictions;
            out.len += c.slots.len();
            out.weight += c.used;
        }
        out
    }
}

impl<K: Eq + Hash + Clone, T: Clone> ClockCache<K, Arc<OnceLock<T>>> {
    /// `solve()` for `key`, run at most once while the key stays resident:
    /// a cold key gets one cell (racing threads all take the first one
    /// inserted), and the solve runs inside it, outside the cache's lock,
    /// while other threads asking for the same key wait on the cell.
    pub fn get_or_solve(&self, key: K, solve: impl FnOnce() -> T) -> T {
        let cell = self.get_or_insert_with(key, || Arc::new(OnceLock::new()));
        cell.get_or_init(solve).clone()
    }
}
