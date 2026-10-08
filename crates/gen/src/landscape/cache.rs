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
//! One mutex guards the whole cache, which serialises threads that hit it
//! at once: the landscape kernel bench's `cache` group shows the total hit
//! rate falling as threads are added. The design stripes it by key hash
//! before the chunk path uses it; which stripe holds a key changes cost
//! only.

use std::hash::Hash;
use std::sync::{Arc, Mutex, OnceLock};

use hashbrown::HashMap;

struct Slot<K, V> {
    key: K,
    value: V,
    referenced: bool,
}

struct Clock<K, V> {
    slots: Vec<Slot<K, V>>,
    index: HashMap<K, usize>,
    hand: usize,
    capacity: usize,
    hits: u64,
    misses: u64,
    evictions: u64,
}

impl<K: Eq + Hash + Clone, V: Clone> Clock<K, V> {
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
        if self.slots.len() < self.capacity {
            self.index.insert(key.clone(), self.slots.len());
            self.slots.push(Slot {
                key,
                value: value.clone(),
                referenced: false,
            });
            return value;
        }
        // Sweep: give every referenced entry a second chance.
        loop {
            let slot = &mut self.slots[self.hand];
            if slot.referenced {
                slot.referenced = false;
                self.hand = (self.hand + 1) % self.capacity;
            } else {
                break;
            }
        }
        let i = self.hand;
        self.index.remove(&self.slots[i].key);
        self.index.insert(key.clone(), i);
        self.slots[i] = Slot {
            key,
            value: value.clone(),
            referenced: false,
        };
        self.hand = (self.hand + 1) % self.capacity;
        self.evictions += 1;
        value
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
    /// Most entries the cache holds.
    pub capacity: usize,
}

/// A bounded cache with CLOCK eviction, safe to share between threads.
pub struct ClockCache<K, V> {
    inner: Mutex<Clock<K, V>>,
}

impl<K: Eq + Hash + Clone, V: Clone> ClockCache<K, V> {
    /// A cache holding at most `capacity` entries (at least 1).
    pub fn new(capacity: usize) -> Self {
        let capacity = Ord::max(capacity, 1);
        Self {
            inner: Mutex::new(Clock {
                slots: Vec::with_capacity(Ord::min(capacity, 1 << 16)),
                index: HashMap::with_capacity(Ord::min(capacity, 1 << 16)),
                hand: 0,
                capacity,
                hits: 0,
                misses: 0,
                evictions: 0,
            }),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Clock<K, V>> {
        // A panic while holding the lock cannot leave a half-written entry
        // that matters: entries are cost-only, so recover the guard.
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// The value cached for `key`, if resident.
    pub fn get(&self, key: &K) -> Option<V> {
        self.lock().get(key)
    }

    /// Cache `value` for `key` unless a value is already resident, and
    /// return the resident one: the first writer wins, so threads racing to
    /// fill one key all leave with the same value.
    pub fn insert(&self, key: K, value: V) -> V {
        self.lock().insert(key, value)
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

    /// Hit, miss and eviction counts so far, with the current size.
    pub fn stats(&self) -> CacheStats {
        let c = self.lock();
        CacheStats {
            hits: c.hits,
            misses: c.misses,
            evictions: c.evictions,
            len: c.slots.len(),
            capacity: c.capacity,
        }
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
