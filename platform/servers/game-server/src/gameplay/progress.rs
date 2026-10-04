//! What players have done: counters per trigger, achievements earned, and
//! the queue of fresh actions the progress system turns into achievements
//! (and into quest and job progress).
//!
//! Gameplay code only *notes* actions on the player
//! ([`super::rules::PlayerState::note`]); [`ProgressSystem`] evaluates the
//! notes every tick, so no intent handler needs to know what they unlock.

use std::collections::{BTreeMap, BTreeSet};

use platform_content::{AchievementDef, Content, Trigger, TriggerKind};
use serde::{Deserialize, Serialize};
use serde_json::json;
use voxelize::{ClientFilter, Event};

use super::Gameplay;

/// `{ "unlocked": [{ "key", "name", "xp" }], "done": [key] }` to the player:
/// on joining (all done) and when achievements are earned.
pub const PROGRESS_EVENT: &str = "platform.progress";

/// A player's lifetime counters and earned achievements.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Progress {
    /// `"kind:target"` and `"kind:*"` → how many times.
    #[serde(default)]
    pub counters: BTreeMap<String, u32>,
    #[serde(default)]
    pub done: BTreeSet<String>,
}

/// One action waiting to be counted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Note {
    pub kind: TriggerKind,
    pub target: String,
    pub count: u32,
}

fn counter(kind: TriggerKind, target: Option<&str>) -> String {
    format!("{}:{}", kind.key(), target.unwrap_or("*"))
}

/// Whether `note` counts for `trigger`.
pub fn matches(trigger: &Trigger, note: &Note) -> bool {
    trigger.kind == note.kind && trigger.target.as_deref().is_none_or(|t| t == note.target)
}

impl Progress {
    /// Count a note; the achievements it completes, newly earned.
    pub fn count<'a>(&mut self, content: &'a Content, note: &Note) -> Vec<&'a AchievementDef> {
        for key in [
            counter(note.kind, Some(&note.target)),
            counter(note.kind, None),
        ] {
            let c = self.counters.entry(key).or_default();
            *c = c.saturating_add(note.count);
        }
        let mut earned = Vec::new();
        for a in content.achievements() {
            if self.done.contains(&a.key) || !matches(&a.trigger, note) {
                continue;
            }
            let have = self
                .counters
                .get(&counter(a.trigger.kind, a.trigger.target.as_deref()))
                .copied()
                .unwrap_or(0);
            if have >= a.trigger.count {
                self.done.insert(a.key.clone());
                earned.push(a);
            }
        }
        earned
    }
}

/// Turns players' notes into achievements every tick.
#[derive(Default)]
pub struct ProgressSystem;

impl<'a> specs::System<'a> for ProgressSystem {
    type SystemData = (
        specs::WriteExpect<'a, Gameplay>,
        specs::WriteExpect<'a, voxelize::Events>,
    );

    fn run(&mut self, (mut g, mut events): Self::SystemData) {
        let content = g.rules.content_arc();
        for (id, player) in g.players.iter_mut() {
            if player.notes.is_empty() {
                continue;
            }
            let notes = std::mem::take(&mut player.notes);
            let mut unlocked = Vec::new();
            for note in &notes {
                for a in player.progress.count(&content, note) {
                    player.xp = player.xp.saturating_add(a.xp);
                    unlocked.push(json!({ "key": a.key, "name": a.name, "xp": a.xp }));
                }
            }
            super::work::on_notes(&content, id, player, &notes, &mut events);
            if !unlocked.is_empty() {
                events.dispatch(
                    Event::new(PROGRESS_EVENT)
                        .payload(json!({ "unlocked": unlocked, "done": player.progress.done }))
                        .filter(ClientFilter::Direct(id.clone()))
                        .build(),
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn content() -> Content {
        Content::load(platform_content::default_pack_dir()).unwrap()
    }

    fn note(kind: TriggerKind, target: &str, count: u32) -> Note {
        Note {
            kind,
            target: target.into(),
            count,
        }
    }

    #[test]
    fn actions_count_up_to_achievements_once() {
        let c = content();
        let mut p = Progress::default();
        let earned = p.count(&c, &note(TriggerKind::Mine, "oak_log", 1));
        assert_eq!(
            earned.iter().map(|a| a.key.as_str()).collect::<Vec<_>>(),
            ["getting_wood"]
        );
        assert!(
            p.count(&c, &note(TriggerKind::Mine, "oak_log", 1))
                .is_empty(),
            "earned once"
        );
        // "Plant ten crops": nine are not enough.
        assert!(p
            .count(&c, &note(TriggerKind::Place, "wheat_crop", 9))
            .is_empty());
        let earned = p.count(&c, &note(TriggerKind::Place, "wheat_crop", 1));
        assert_eq!(earned[0].key, "green_thumb");
        // Any target counts towards targetless triggers.
        let earned = p.count(&c, &note(TriggerKind::Mine, "dirt", 498));
        assert_eq!(earned[0].key, "busy_miner", "500 blocks of any kind");
        assert_eq!(p.counters["mine:*"], 500);
        assert_eq!(p.counters["mine:oak_log"], 2);
    }
}
