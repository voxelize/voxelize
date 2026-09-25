//! A sparse feed of voxel changes for game systems whose block logic needs
//! world context an active updater cannot reach: weather, per-world rules,
//! event dispatch, bookkeeping kept in ECS resources.
//!
//! A system names the block ids it follows. The update pass then reports
//! every committed write into or out of a followed id, and the random-tick
//! sampler reports every sample that lands on one, so voxels that already
//! exist (generated, loaded from disk) surface over time without a scan.
//! Nothing is recorded while no id is followed.

use hashbrown::HashSet;

use crate::Vec3;

/// What happened to a watched voxel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WatchedChange {
    /// A committed write: the voxel held block `from` and now holds `to`.
    /// Reported when either id is followed for writes.
    Written { from: u32, to: u32 },
    /// The random-tick sampler landed on this voxel while it held `id`.
    Sampled { id: u32 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WatchedVoxel {
    pub voxel: Vec3<i32>,
    pub change: WatchedChange,
}

/// What [`VoxelWatch::take`] hands back: the recorded changes in the order
/// they happened, and how many were refused because the feed was full.
#[derive(Debug, Default)]
pub struct WatchedBatch {
    pub changes: Vec<WatchedVoxel>,
    pub dropped: usize,
}

/// Held by [`crate::Chunks`]; see the module docs.
#[derive(Debug)]
pub struct VoxelWatch {
    written_ids: HashSet<u32>,
    sampled_ids: HashSet<u32>,
    pending: Vec<WatchedVoxel>,
    capacity: usize,
    dropped: usize,
}

/// Enough for a tick of writes on both update lanes plus a tick of samples;
/// a consumer that drains every tick never comes near it.
pub const DEFAULT_WATCH_CAPACITY: usize = 8192;

impl Default for VoxelWatch {
    fn default() -> Self {
        Self {
            written_ids: HashSet::new(),
            sampled_ids: HashSet::new(),
            pending: Vec::new(),
            capacity: DEFAULT_WATCH_CAPACITY,
            dropped: 0,
        }
    }
}

impl VoxelWatch {
    /// Report every committed write that puts `id` into a voxel or takes it
    /// out of one.
    pub fn follow_writes(&mut self, id: u32) {
        self.written_ids.insert(id);
    }

    /// Report every random-tick sample that lands on a voxel holding `id`.
    pub fn follow_samples(&mut self, id: u32) {
        self.sampled_ids.insert(id);
    }

    /// Bound on changes held between two [`Self::take`] calls. Changes past
    /// it are counted, not stored, and the count comes back with the batch.
    pub fn set_capacity(&mut self, capacity: usize) {
        self.capacity = capacity;
    }

    pub fn is_following(&self) -> bool {
        !self.written_ids.is_empty() || !self.sampled_ids.is_empty()
    }

    /// Called by the update pass for every committed write. Public so a test
    /// harness that commits writes by hand can report them the same way.
    pub fn note_write(&mut self, voxel: &Vec3<i32>, from: u32, to: u32) {
        if from == to || self.written_ids.is_empty() {
            return;
        }
        if self.written_ids.contains(&from) || self.written_ids.contains(&to) {
            self.push(voxel, WatchedChange::Written { from, to });
        }
    }

    /// Called by the random-tick sampler for every sample it takes.
    pub fn note_sample(&mut self, voxel: &Vec3<i32>, id: u32) {
        if self.sampled_ids.contains(&id) {
            self.push(voxel, WatchedChange::Sampled { id });
        }
    }

    fn push(&mut self, voxel: &Vec3<i32>, change: WatchedChange) {
        if self.pending.len() >= self.capacity {
            self.dropped += 1;
            return;
        }
        self.pending.push(WatchedVoxel {
            voxel: voxel.clone(),
            change,
        });
    }

    /// Everything recorded since the last call, oldest first.
    pub fn take(&mut self) -> WatchedBatch {
        WatchedBatch {
            changes: std::mem::take(&mut self.pending),
            dropped: std::mem::replace(&mut self.dropped, 0),
        }
    }

    pub(crate) fn clear(&mut self) {
        self.pending.clear();
        self.dropped = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_is_recorded_until_an_id_is_followed() {
        let mut watch = VoxelWatch::default();
        watch.note_write(&Vec3(1, 2, 3), 0, 7);
        watch.note_sample(&Vec3(1, 2, 3), 7);
        assert!(watch.take().changes.is_empty());
    }

    #[test]
    fn writes_into_and_out_of_a_followed_id_are_reported_with_both_ids() {
        let mut watch = VoxelWatch::default();
        watch.follow_writes(7);
        watch.note_write(&Vec3(0, 0, 0), 0, 7);
        watch.note_write(&Vec3(1, 0, 0), 7, 30000);
        watch.note_write(&Vec3(2, 0, 0), 3, 4);
        watch.note_write(&Vec3(3, 0, 0), 7, 7);
        let batch = watch.take();
        assert_eq!(
            batch.changes,
            vec![
                WatchedVoxel {
                    voxel: Vec3(0, 0, 0),
                    change: WatchedChange::Written { from: 0, to: 7 },
                },
                WatchedVoxel {
                    voxel: Vec3(1, 0, 0),
                    change: WatchedChange::Written { from: 7, to: 30000 },
                },
            ]
        );
        assert_eq!(batch.dropped, 0);
        assert!(watch.take().changes.is_empty(), "take drains the feed");
    }

    #[test]
    fn samples_and_writes_are_followed_separately() {
        let mut watch = VoxelWatch::default();
        watch.follow_samples(9);
        watch.note_write(&Vec3(0, 0, 0), 0, 9);
        watch.note_sample(&Vec3(5, 5, 5), 9);
        watch.note_sample(&Vec3(6, 6, 6), 8);
        assert_eq!(
            watch.take().changes,
            vec![WatchedVoxel {
                voxel: Vec3(5, 5, 5),
                change: WatchedChange::Sampled { id: 9 },
            }]
        );
    }

    #[test]
    fn a_full_feed_counts_what_it_refused() {
        let mut watch = VoxelWatch::default();
        watch.follow_samples(1);
        watch.set_capacity(2);
        for x in 0..5 {
            watch.note_sample(&Vec3(x, 0, 0), 1);
        }
        let batch = watch.take();
        assert_eq!(batch.changes.len(), 2);
        assert_eq!(batch.dropped, 3);
        assert_eq!(watch.take().dropped, 0, "the count resets with each take");
    }
}
