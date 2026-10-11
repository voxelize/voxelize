//! Virtue: in Paradise, what a player does to the world and to others adds
//! up to a level, from Pilgrim to Divine.
//!
//! | deed | virtue |
//! | --- | --- |
//! | placing a block | +2 (at most [`BUILD_CAP`] a day) |
//! | breaking a block you placed | −2 (an undo: building and breaking it again earns nothing) |
//! | breaking any other block | −1 |
//! | a gift through the trade window (items given, nothing taken) | +3 per item, at most +30 a gift |
//! | healing a hurt player with honey | +10 |
//! | killing a player | −1000 |
//!
//! Gifts and healing share a daily cap ([`HELP_CAP`]), so friends cannot
//! farm virtue from each other. Only deeds done in Paradise count. Levels
//! carry gifts: Guardians are kept in regeneration in Paradise, Saints and
//! above glow gold to others, and the Divine may fly there.

use std::collections::VecDeque;

use serde::{Deserialize, Serialize};

/// Virtue a day can earn from building.
pub const BUILD_CAP: i64 = 300;
/// Virtue a day can earn from helping others (gifts and healing).
pub const HELP_CAP: i64 = 300;
/// What killing another player costs.
pub const SLAYING: i64 = 1000;
/// Positions remembered as built by the player (to undo, not to punish).
const REMEMBERED: usize = 2048;

/// The levels and the virtue each starts at; below zero is Fallen.
pub const LEVELS: [(i64, &str); 8] = [
    (0, "Pilgrim"),
    (50, "Seeker"),
    (200, "Gardener"),
    (600, "Builder of Light"),
    (1500, "Guardian"),
    (3500, "Saint"),
    (6500, "Seraph"),
    (10_000, "Divine"),
];
/// The level index from which regeneration keeps a player whole.
pub const GUARDIAN: i8 = 4;
/// The level index from which others see a golden name.
pub const SAINT: i8 = 5;
/// The last level.
pub const DIVINE: i8 = 7;

/// Something a player did that virtue weighs.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Deed {
    Built([i32; 3]),
    Broke([i32; 3]),
    /// Items given away in a trade with nothing in return.
    Gift(u32),
    Healed,
    Slew,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Virtue {
    pub points: i64,
    /// The day (days since the epoch) the caps below count for.
    #[serde(default)]
    pub day: u32,
    #[serde(default)]
    pub built_today: i64,
    #[serde(default)]
    pub helped_today: i64,
    /// Blocks this player placed recently, newest last.
    #[serde(skip)]
    pub placed: VecDeque<[i32; 3]>,
}

/// The level index for some virtue: -1 is Fallen.
pub fn level_of(points: i64) -> i8 {
    if points < 0 {
        return -1;
    }
    LEVELS
        .iter()
        .rposition(|(from, _)| points >= *from)
        .unwrap_or(0) as i8
}

pub fn title_of(level: i8) -> &'static str {
    if level < 0 {
        "Fallen"
    } else {
        LEVELS[level as usize].1
    }
}

impl Virtue {
    pub fn level(&self) -> i8 {
        level_of(self.points)
    }

    /// Weigh a deed done on `day`; returns the change in virtue.
    pub fn record(&mut self, deed: Deed, day: u32) -> i64 {
        if self.day != day {
            self.day = day;
            self.built_today = 0;
            self.helped_today = 0;
        }
        let delta = match deed {
            Deed::Built(at) => {
                if self.placed.len() == REMEMBERED {
                    self.placed.pop_front();
                }
                self.placed.push_back(at);
                let gain = 2.min(BUILD_CAP - self.built_today).max(0);
                self.built_today += gain;
                gain
            }
            Deed::Broke(at) => match self.placed.iter().rposition(|p| *p == at) {
                Some(i) => {
                    self.placed.remove(i);
                    // Undo what placing it earned (never more).
                    let refund = 2.min(self.built_today);
                    self.built_today -= refund;
                    -refund
                }
                None => -1,
            },
            Deed::Gift(items) => self.help((3 * i64::from(items)).min(30)),
            Deed::Healed => self.help(10),
            Deed::Slew => -SLAYING,
        };
        self.points += delta;
        delta
    }

    fn help(&mut self, amount: i64) -> i64 {
        let gain = amount.min(HELP_CAP - self.helped_today).max(0);
        self.helped_today += gain;
        gain
    }

    /// Virtue still needed for the next level (`None` at Divine).
    pub fn to_next(&self) -> Option<i64> {
        let next = (self.level() + 1).max(0) as usize;
        LEVELS.get(next).map(|(from, _)| from - self.points)
    }
}

/// Today, in days since the Unix epoch.
pub fn today() -> u32 {
    (super::sanctions::now() / 86_400) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_rise_from_pilgrim_to_divine() {
        assert_eq!(level_of(-1), -1);
        assert_eq!(title_of(level_of(-5)), "Fallen");
        assert_eq!(title_of(level_of(0)), "Pilgrim");
        assert_eq!(title_of(level_of(199)), "Seeker");
        assert_eq!(title_of(level_of(1500)), "Guardian");
        assert_eq!(level_of(10_000), DIVINE);
        assert_eq!(title_of(level_of(99_999)), "Divine");
        let v = Virtue {
            points: 180,
            ..Default::default()
        };
        assert_eq!(v.to_next(), Some(20));
        let v = Virtue {
            points: 10_000,
            ..Default::default()
        };
        assert_eq!(v.to_next(), None);
        let v = Virtue {
            points: -40,
            ..Default::default()
        };
        assert_eq!(v.to_next(), Some(40), "back to Pilgrim");
    }

    #[test]
    fn building_earns_and_breaking_costs_but_undoing_is_neutral() {
        let mut v = Virtue::default();
        assert_eq!(v.record(Deed::Built([1, 70, 1]), 100), 2);
        assert_eq!(v.record(Deed::Built([2, 70, 1]), 100), 2);
        // Taking back your own block only undoes what it earned.
        assert_eq!(v.record(Deed::Broke([1, 70, 1]), 100), -2);
        // Breaking the world costs.
        assert_eq!(v.record(Deed::Broke([9, 70, 9]), 100), -1);
        assert_eq!(v.points, 1);
        // Placing and breaking the same block over and over earns nothing.
        for _ in 0..50 {
            v.record(Deed::Built([5, 71, 5]), 100);
            v.record(Deed::Broke([5, 71, 5]), 100);
        }
        assert_eq!(v.points, 1);
    }

    #[test]
    fn daily_caps_hold_and_reset() {
        let mut v = Virtue::default();
        for i in 0..1000 {
            v.record(Deed::Built([i, 70, 0]), 7);
        }
        assert_eq!(v.points, BUILD_CAP);
        for _ in 0..100 {
            v.record(Deed::Gift(64), 7);
            v.record(Deed::Healed, 7);
        }
        assert_eq!(v.points, BUILD_CAP + HELP_CAP);
        assert_eq!(v.record(Deed::Gift(1), 8), 3, "a new day");
        assert_eq!(v.record(Deed::Gift(64), 8), 30, "at most 30 a gift");
    }

    #[test]
    fn killing_a_player_casts_down() {
        let mut v = Virtue {
            points: 1600,
            ..Default::default()
        };
        assert_eq!(v.level(), GUARDIAN);
        v.record(Deed::Slew, 1);
        assert_eq!(v.points, 600);
        assert_eq!(title_of(v.level()), "Builder of Light");
        v.record(Deed::Slew, 1);
        assert_eq!(title_of(v.level()), "Fallen");
    }
}
