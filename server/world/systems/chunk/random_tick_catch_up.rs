//! Random ticks a chunk missed while nobody was watching it.
//!
//! The subchunk sampler only visits chunks some client is interested in, so a
//! farm, a sapling or anything else that grows by random ticks stood still
//! whenever its player walked away. This remembers when each chunk lost its
//! last interested client and, when one comes back, owes it the ticks it
//! missed (capped by `WorldConfig::max_random_tick_catch_up_ticks`). The debt
//! is paid out of its own per-dispatch sample budget
//! (`max_random_tick_catch_up_per_tick`), oldest chunk first, so a player
//! arriving at a big farm sees it grow in over a few seconds without a spike.
//!
//! It also covers dispatches that stand for more than one world step (a
//! loaded host): the extra steps' samples for interested chunks come from the
//! same budget, so growth keeps real time there too.

use std::collections::VecDeque;

use hashbrown::{HashMap, HashSet};

use crate::{ChunkInterests, Chunks, Registry, Vec2, WorldConfig};

use super::sample_random_ticks;

/// Per-world bookkeeping for [`RandomTickCatchUp::observe`] and
/// [`RandomTickCatchUp::pay`].
#[derive(Default)]
pub struct RandomTickCatchUp {
    interested: HashSet<Vec2<i32>>,
    /// World tick at which each chunk lost its last interested client.
    left_at: HashMap<Vec2<i32>, u64>,
    /// Chunks owed ticks, oldest first.
    owed: VecDeque<(Vec2<i32>, u64)>,
}

impl RandomTickCatchUp {
    pub fn new() -> Self {
        Self::default()
    }

    /// Ticks still owed across every chunk (for tests and diagnostics).
    pub fn owed_ticks(&self) -> u64 {
        self.owed.iter().map(|(_, ticks)| ticks).sum()
    }

    /// Compare this dispatch's interested chunks with the last one's: note
    /// the chunks that lost interest, and owe the ones that regained it.
    pub fn observe(&mut self, interests: &ChunkInterests, current_tick: u64, max_owed: u64) {
        let now: HashSet<Vec2<i32>> = interests.map.keys().cloned().collect();
        for coords in self.interested.difference(&now) {
            self.left_at.insert(coords.clone(), current_tick);
        }
        for coords in now.difference(&self.interested) {
            if let Some(left) = self.left_at.remove(coords) {
                let missed = current_tick.saturating_sub(left).min(max_owed);
                if missed > 0 {
                    self.owed.push_back((coords.clone(), missed));
                }
            }
        }
        self.interested = now;
    }

    /// Spend up to `budget` samples: first the extra world steps this
    /// dispatch stood for (`extra_steps`, for every interested chunk), then
    /// chunks owed ticks, oldest first. Returns the samples taken.
    pub fn pay(
        &mut self,
        chunks: &mut Chunks,
        registry: &Registry,
        interests: &ChunkInterests,
        config: &WorldConfig,
        current_tick: u64,
        extra_steps: u64,
        budget: usize,
    ) -> usize {
        let mut taken = 0;
        for _ in 0..extra_steps {
            if taken >= budget {
                return taken;
            }
            let samples = sample_random_ticks(chunks, registry, interests, config, current_tick);
            if samples == 0 {
                break;
            }
            taken += samples;
        }
        while taken < budget {
            let Some((coords, ticks)) = self.owed.pop_front() else {
                break;
            };
            if !chunks.is_chunk_ready(&coords) {
                // Not loaded any more: nothing there to grow until it is.
                continue;
            }
            let mut single = ChunkInterests::new();
            single.add("random-tick-catch-up", &coords);
            let mut left = ticks;
            while left > 0 && taken < budget {
                let samples = sample_random_ticks(chunks, registry, &single, config, current_tick);
                if samples == 0 {
                    left = 0;
                    break;
                }
                taken += samples;
                left -= 1;
            }
            if left > 0 {
                self.owed.push_front((coords, left));
            }
        }
        taken
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn interests_of(coords: &[Vec2<i32>]) -> ChunkInterests {
        let mut interests = ChunkInterests::new();
        for c in coords {
            interests.add("player", c);
        }
        interests
    }

    #[test]
    fn a_chunk_is_owed_the_ticks_it_spent_unwatched_capped() {
        let mut catch_up = RandomTickCatchUp::new();
        let farm = Vec2(3, 4);
        catch_up.observe(&interests_of(&[farm.clone()]), 100, 1_000);
        catch_up.observe(&interests_of(&[]), 200, 1_000);
        assert_eq!(catch_up.owed_ticks(), 0, "nothing is owed while nobody is back");
        catch_up.observe(&interests_of(&[farm.clone()]), 700, 1_000);
        assert_eq!(catch_up.owed_ticks(), 500);

        catch_up.observe(&interests_of(&[]), 800, 1_000);
        catch_up.observe(&interests_of(&[farm]), 100_800, 1_000);
        assert_eq!(catch_up.owed_ticks(), 1_500, "the second absence is capped at 1000");
    }

    #[test]
    fn a_chunk_first_seen_owes_nothing() {
        let mut catch_up = RandomTickCatchUp::new();
        catch_up.observe(&interests_of(&[Vec2(0, 0)]), 5_000, 1_000);
        assert_eq!(catch_up.owed_ticks(), 0, "worldgen is a fresh chunk's start");
    }
}
