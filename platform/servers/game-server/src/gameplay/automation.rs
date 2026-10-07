//! Fill gauges: a gauge facing away from a container powers its front with
//! how full the container is, as a classic comparator does. Containers live
//! in the game, not in the voxels, so the game sets the gauges' levels.

use platform_content::Content;
use voxelize::{BlockUtils, Chunks, Vec3, VoxelAccess};

use super::inventory::Stack;
use super::Gameplay;

/// Seconds between gauge refreshes.
const REFRESH: f32 = 0.25;

/// Power for a container's contents: 0 when empty, else 1..=15 by how full
/// its slots are (each slot counted by its stack's share of a full stack).
pub fn fill_level(content: &Content, slots: &[Option<Stack>]) -> u32 {
    if slots.is_empty() || slots.iter().all(Option::is_none) {
        return 0;
    }
    let fullness: f32 = slots
        .iter()
        .flatten()
        .map(|s| {
            let max = content
                .item_by_id(s.item)
                .map_or(64, |i| i.stack_size.max(1));
            s.count as f32 / max as f32
        })
        .sum::<f32>()
        / slots.len() as f32;
    1 + (fullness * 14.0).floor() as u32
}

#[derive(Default)]
pub struct GaugeSystem {
    last: Option<std::time::Instant>,
    since: f32,
}

impl<'a> specs::System<'a> for GaugeSystem {
    type SystemData = (
        specs::WriteExpect<'a, Chunks>,
        specs::ReadExpect<'a, Gameplay>,
    );

    fn run(&mut self, (mut chunks, g): Self::SystemData) {
        let now = std::time::Instant::now();
        self.since += self
            .last
            .map(|l| now.duration_since(l).as_secs_f32())
            .unwrap_or(0.0);
        self.last = Some(now);
        if self.since < REFRESH {
            return;
        }
        self.since = 0.0;
        let content = g.rules.content();
        let Some(gauge) = content.block("gauge").map(|b| b.id) else {
            return;
        };
        let mut writes = Vec::new();
        for (at, container) in &g.containers.map {
            let mut level = None;
            for (dx, dy, dz) in [(1, 0, 0), (-1, 0, 0), (0, 0, 1), (0, 0, -1)] {
                let n = [at[0] + dx, at[1] + dy, at[2] + dz];
                let raw = chunks.get_raw_voxel(n[0], n[1], n[2]);
                if BlockUtils::extract_id(raw) != gauge {
                    continue;
                }
                // Only a gauge whose back is against the container reads it.
                if crate::behaviors::front(raw) != (dx, dy, dz) {
                    continue;
                }
                let level = *level.get_or_insert_with(|| fill_level(content, container.slots()));
                if BlockUtils::extract_stage(raw) != level {
                    writes.push((Vec3(n[0], n[1], n[2]), BlockUtils::insert_stage(raw, level)));
                }
            }
        }
        if !writes.is_empty() {
            chunks.update_voxels(&writes);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_follow_how_full_a_container_is() {
        let c = Content::load(platform_content::default_pack_dir()).unwrap();
        let stone = c.item("stone").unwrap().id;
        let bow = c.item("bow").unwrap().id;
        let stack = |item, count| {
            Some(Stack {
                item,
                count,
                durability: None,
            })
        };
        let mut slots = vec![None; 27];
        assert_eq!(fill_level(&c, &slots), 0);
        slots[0] = stack(stone, 1);
        assert_eq!(fill_level(&c, &slots), 1);
        slots.iter_mut().for_each(|s| *s = stack(stone, 64));
        assert_eq!(fill_level(&c, &slots), 15);
        // Unstackable items fill a slot each.
        let mut small = vec![None; 5];
        small[0] = stack(bow, 1);
        small[1] = stack(bow, 1);
        assert_eq!(fill_level(&c, &small), 1 + (2.0f32 / 5.0 * 14.0) as u32);
    }
}
