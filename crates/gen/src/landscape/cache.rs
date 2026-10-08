//! `ClockCache`: a bounded, thread-safe cache with CLOCK eviction.
//!
//! Every landscape cache is cost-only: its values are pure functions of
//! their keys, so a hit, a miss, an eviction or a race between two threads
//! computing the same entry changes how long a query takes, never what it
//! returns. The kit proves it by running everything with every cache at
//! capacity 1.
//!
//! CLOCK evicts one entry at a time: a hand sweeps the slots, clearing
//! reference bits until it finds an entry not used since its last pass. No
//! cache ever clears all of its entries on overflow, so a full cache
//! degrades gracefully instead of falling off a cliff.
//!
//! Values are cloned out, so large values belong behind an `Arc`. A value
//! that is costly to compute and must be computed once (a plan solve)
//! should be an `Arc<OnceLock<T>>`: insert the cell under the lock, then
//! initialise it outside the lock.

use std::hash::Hash;
use std::sync::Mutex;

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

    fn insert(&mut self, key: K, value: V) {
        if let Some(&i) = self.index.get(&key) {
            let slot = &mut self.slots[i];
            slot.value = value;
            slot.referenced = true;
            return;
        }
        if self.slots.len() < self.capacity {
            self.index.insert(key.clone(), self.slots.len());
            self.slots.push(Slot {
                key,
                value,
                referenced: false,
            });
            return;
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
            value,
            referenced: false,
        };
        self.hand = (self.hand + 1) % self.capacity;
        self.evictions += 1;
    }
}

/// Hit, miss and eviction counts: cost only, never output.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CacheStats {
    pub hits: u64,
    pub misses: u64,
    pub evictions: u64,
    pub len: usize,
    pub capacity: usize,
}

/// A bounded cache with CLOCK eviction, safe to share between threads.
pub struct ClockCache<K, V> {
    inner: Mutex<Clock<K, V>>,
}

impl<K: Eq + Hash + Clone, V: Clone> ClockCache<K, V> {
    /// A cache holding at most `capacity` entries (at least 1).
    pub fn new(capacity: usize) -> Self {
        let capacity = capacity.max(1);
        Self {
            inner: Mutex::new(Clock {
                slots: Vec::with_capacity(capacity.min(1 << 16)),
                index: HashMap::with_capacity(capacity.min(1 << 16)),
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

    pub fn get(&self, key: &K) -> Option<V> {
        self.lock().get(key)
    }

    pub fn insert(&self, key: K, value: V) {
        self.lock().insert(key, value);
    }

    /// The cached value, or `compute()` cached and returned. `compute` runs
    /// outside the lock, so two threads may both compute a missing entry;
    /// that is harmless because entries are pure functions of their keys.
    pub fn get_or_insert_with(&self, key: K, compute: impl FnOnce() -> V) -> V {
        if let Some(v) = self.get(&key) {
            return v;
        }
        let value = compute();
        self.insert(key, value.clone());
        value
    }

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
