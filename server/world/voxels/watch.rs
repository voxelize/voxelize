//! A sparse feed of voxel changes for game systems whose block logic needs
//! world context an active updater cannot reach: weather, per-world rules,
//! event dispatch, bookkeeping kept in ECS resources.
//!
//! A system names the block ids it follows. The update pass then reports
//! every committed write into or out of a followed id, and the random-tick
//! sampler reports every sample that lands on one, so voxels that already
//! exist (generated, loaded from disk) surface over time without a scan.
//! Nothing is recorded while no id is followed.
//!
//! Several systems can share the feed: each opens its own [`WatchChannel`],
//! with its own followed ids, queue and drop count, so one system taking its
//! changes never drains what another follows. The un-named calls
//! (`follow_writes`, `follow_samples`, `take`) use the default channel.

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

/// One consumer of the feed, opened with [`VoxelWatch::open_channel`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct WatchChannel(usize);

/// The channel the un-named calls use.
const DEFAULT_CHANNEL: WatchChannel = WatchChannel(0);

#[derive(Debug, Default)]
struct Channel {
    written_ids: HashSet<u32>,
    sampled_ids: HashSet<u32>,
    pending: Vec<WatchedVoxel>,
    dropped: usize,
}

impl Channel {
    fn push(&mut self, capacity: usize, voxel: &Vec3<i32>, change: WatchedChange) {
        if self.pending.len() >= capacity {
            self.dropped += 1;
            return;
        }
        self.pending.push(WatchedVoxel {
            voxel: voxel.clone(),
            change,
        });
    }
}

/// Held by [`crate::Chunks`]; see the module docs.
#[derive(Debug)]
pub struct VoxelWatch {
    channels: Vec<Channel>,
    capacity: usize,
}

/// Enough for a tick of writes on both update lanes plus a tick of samples;
/// a consumer that drains every tick never comes near it.
pub const DEFAULT_WATCH_CAPACITY: usize = 8192;

impl Default for VoxelWatch {
    fn default() -> Self {
        Self {
            channels: vec![Channel::default()],
            capacity: DEFAULT_WATCH_CAPACITY,
        }
    }
}

impl VoxelWatch {
    /// Report every committed write that puts `id` into a voxel or takes it
    /// out of one, on the default channel.
    pub fn follow_writes(&mut self, id: u32) {
        self.follow_writes_on(DEFAULT_CHANNEL, id);
    }

    /// Report every random-tick sample that lands on a voxel holding `id`,
    /// on the default channel.
    pub fn follow_samples(&mut self, id: u32) {
        self.follow_samples_on(DEFAULT_CHANNEL, id);
    }

    /// A new consumer with nothing followed yet. Its changes are recorded
    /// apart from every other channel's and taken with [`Self::take_from`].
    pub fn open_channel(&mut self) -> WatchChannel {
        self.channels.push(Channel::default());
        WatchChannel(self.channels.len() - 1)
    }

    pub fn follow_writes_on(&mut self, channel: WatchChannel, id: u32) {
        self.channel_mut(channel).written_ids.insert(id);
    }

    pub fn follow_samples_on(&mut self, channel: WatchChannel, id: u32) {
        self.channel_mut(channel).sampled_ids.insert(id);
    }

    /// Bound on changes each channel holds between two takes. Changes past
    /// it are counted, not stored, and the count comes back with the batch.
    pub fn set_capacity(&mut self, capacity: usize) {
        self.capacity = capacity;
    }

    pub fn is_following(&self) -> bool {
        self.channels
            .iter()
            .any(|channel| !channel.written_ids.is_empty() || !channel.sampled_ids.is_empty())
    }

    /// Called by the update pass for every committed write. Public so a test
    /// harness that commits writes by hand can report them the same way.
    pub fn note_write(&mut self, voxel: &Vec3<i32>, from: u32, to: u32) {
        if from == to {
            return;
        }
        let capacity = self.capacity;
        for channel in &mut self.channels {
            if channel.written_ids.contains(&from) || channel.written_ids.contains(&to) {
                channel.push(capacity, voxel, WatchedChange::Written { from, to });
            }
        }
    }

    /// Called by the random-tick sampler for every sample it takes.
    pub fn note_sample(&mut self, voxel: &Vec3<i32>, id: u32) {
        let capacity = self.capacity;
        for channel in &mut self.channels {
            if channel.sampled_ids.contains(&id) {
                channel.push(capacity, voxel, WatchedChange::Sampled { id });
            }
        }
    }

    /// Everything the default channel recorded since the last call, oldest
    /// first.
    pub fn take(&mut self) -> WatchedBatch {
        self.take_from(DEFAULT_CHANNEL)
    }

    /// Everything `channel` recorded since its last take, oldest first.
    pub fn take_from(&mut self, channel: WatchChannel) -> WatchedBatch {
        let channel = self.channel_mut(channel);
        WatchedBatch {
            changes: std::mem::take(&mut channel.pending),
            dropped: std::mem::replace(&mut channel.dropped, 0),
        }
    }

    fn channel_mut(&mut self, channel: WatchChannel) -> &mut Channel {
        self.channels
            .get_mut(channel.0)
            .expect("a watch channel is opened on the watch it is used with")
    }

    pub(crate) fn clear(&mut self) {
        for channel in &mut self.channels {
            channel.pending.clear();
            channel.dropped = 0;
        }
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

    #[test]
    fn channels_never_take_each_others_changes() {
        let mut watch = VoxelWatch::default();
        watch.follow_samples(1);
        let other = watch.open_channel();
        assert!(watch.is_following());
        watch.follow_samples_on(other, 2);
        watch.follow_writes_on(other, 1);
        watch.note_sample(&Vec3(0, 0, 0), 1);
        watch.note_sample(&Vec3(1, 0, 0), 2);
        watch.note_write(&Vec3(2, 0, 0), 0, 1);

        let default = watch.take();
        assert_eq!(
            default.changes,
            vec![WatchedVoxel {
                voxel: Vec3(0, 0, 0),
                change: WatchedChange::Sampled { id: 1 },
            }],
            "the default channel follows only its own ids"
        );
        let theirs = watch.take_from(other);
        assert_eq!(
            theirs.changes,
            vec![
                WatchedVoxel {
                    voxel: Vec3(1, 0, 0),
                    change: WatchedChange::Sampled { id: 2 },
                },
                WatchedVoxel {
                    voxel: Vec3(2, 0, 0),
                    change: WatchedChange::Written { from: 0, to: 1 },
                },
            ],
            "taking the default channel left this one's changes in place"
        );
    }

    #[test]
    fn each_channel_counts_its_own_refusals() {
        let mut watch = VoxelWatch::default();
        watch.set_capacity(1);
        watch.follow_samples(1);
        let other = watch.open_channel();
        watch.follow_samples_on(other, 1);
        for x in 0..3 {
            watch.note_sample(&Vec3(x, 0, 0), 1);
        }
        assert_eq!(watch.take().dropped, 2);
        let theirs = watch.take_from(other);
        assert_eq!(theirs.changes.len(), 1);
        assert_eq!(theirs.dropped, 2);
    }
}
