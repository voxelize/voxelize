use specs::{ReadExpect, System, WriteExpect};

use crate::{ClientFilter, Message, MessageQueue, MessageType, Stats, WorldConfig};

pub struct StatsSendingSystem;

impl<'a> System<'a> for StatsSendingSystem {
    type SystemData = (
        ReadExpect<'a, Stats>,
        ReadExpect<'a, WorldConfig>,
        WriteExpect<'a, MessageQueue>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (stats, config, mut queue) = data;

        if stats.tick % config.stats_sync_interval as u64 != 0 {
            return;
        }

        let stats_json = stats.get_stats();

        queue.push((
            Message::new(&MessageType::Stats)
                .json(&serde_json::to_string(&stats_json).unwrap())
                .build(),
            ClientFilter::All,
        ));
    }
}
